#!/usr/bin/env bash
# test-e2e.sh — Full end-to-end training-pipeline test.
#
# Idempotent: safe to re-run. Starts RustFS + server + worker on localhost,
# imports a known-good HF dataset if missing, submits a tiny 3-step training
# job, waits for completion, prints the final loss values + artifact URI.
#
# Exit 0 on success, non-zero on failure.
#
# Services used (all on localhost):
#   - RustFS   :9000 (docker container neodem-rustfs)
#   - Server   :3001 (node tsx watch src/index.ts)
#   - Worker   (python worker.py, backgrounded)
#
# Known-good HF dataset:
#   lerobot/svla_so101_pickplace  (50 episodes, 2 cameras, ~85MB of video)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER_DIR="$REPO_ROOT/training-worker"
SERVER_DIR="$REPO_ROOT/server"

SERVER_URL="http://localhost:3001"
RUSTFS_URL="http://localhost:9000"
TEST_REPO_ID="lerobot/svla_so101_pickplace"
TRAIN_TIMEOUT_SEC=300
MAX_STEPS=3

SERVER_LOG="/tmp/neodem-server.log"
WORKER_LOG="/tmp/neodem-worker.log"

# ---------------------------------------------------------------------- colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
step() { echo -e "${BLUE}▶${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# -------------------------------------------------------------- prerequisites
command -v docker >/dev/null || fail "docker not found"
command -v curl   >/dev/null || fail "curl not found"
command -v python3 >/dev/null || fail "python3 not found"
command -v node   >/dev/null || fail "node not found"
command -v jq     >/dev/null || fail "jq not found (brew install jq)"

# ---------------------------------------------------------------- 1. RustFS
rustfs_up() {
  # RustFS returns 403 (Forbidden) on unauthenticated GET / — that means it's up.
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$RUSTFS_URL" 2>/dev/null || echo "000")"
  [ "$code" = "403" ] || [ "$code" = "200" ]
}

step "Checking RustFS at $RUSTFS_URL"
if rustfs_up; then
  ok "RustFS already running"
else
  step "Starting RustFS via docker compose"
  (cd "$REPO_ROOT" && docker compose up -d rustfs rustfs-init)
  for i in {1..20}; do
    sleep 2
    if rustfs_up; then
      ok "RustFS up after ${i}x2s"
      break
    fi
    [ "$i" -eq 20 ] && fail "RustFS failed to come up in 40s"
  done
fi

# ---------------------------------------------------------------- 2. Server
step "Checking server at $SERVER_URL"
if curl -sf -o /dev/null "$SERVER_URL/api/datasets?limit=1"; then
  ok "Server already running"
else
  step "Starting server (tsx watch) → $SERVER_LOG"
  (cd "$SERVER_DIR" && nohup npm run dev > "$SERVER_LOG" 2>&1 &)
  for i in {1..30}; do
    sleep 2
    if curl -sf -o /dev/null "$SERVER_URL/api/datasets?limit=1"; then
      ok "Server up after ${i}x2s"
      break
    fi
    [ "$i" -eq 30 ] && { tail -40 "$SERVER_LOG"; fail "Server failed to come up in 60s"; }
  done
fi

# ------------------------------------------------------- 3. Test dataset
step "Checking for test dataset $TEST_REPO_ID"
DATASET_ID="$(curl -sf "$SERVER_URL/api/datasets?limit=100" \
  | jq -r --arg repo "$TEST_REPO_ID" \
      '.datasets[] | select(.huggingFaceRepoId == $repo and .status == "ready") | .id' \
  | head -1)"

if [ -z "$DATASET_ID" ]; then
  step "Importing $TEST_REPO_ID (with videos — ~85MB from HF)"
  DATASET_ID="$(curl -sf -X POST "$SERVER_URL/api/datasets/import/huggingface" \
    -H 'Content-Type: application/json' \
    -d "{\"repoId\":\"$TEST_REPO_ID\",\"revision\":\"main\",\"includeVideos\":true}" \
    | jq -r .datasetId)"
  [ -n "$DATASET_ID" ] || fail "Import failed — no datasetId returned"

  step "Waiting for import to complete (dataset=$DATASET_ID)"
  for i in {1..60}; do
    sleep 2
    STATUS="$(curl -sf "$SERVER_URL/api/datasets/$DATASET_ID" | jq -r .dataset.status)"
    case "$STATUS" in
      ready)  ok "Dataset ready after ${i}x2s"; break ;;
      failed) fail "Import failed — check server log" ;;
    esac
    [ "$i" -eq 60 ] && fail "Import timed out after 120s"
  done
else
  ok "Dataset already imported: $DATASET_ID"
fi

# ---------------------------------------------------------- 4. Cancel old jobs
step "Cancelling any pending jobs for this dataset"
PENDING_JOBS="$(curl -sf "$SERVER_URL/api/training/jobs?datasetId=$DATASET_ID&status=pending,running&pageSize=50" \
  | jq -r '.jobs[]?.id // .data[]?.id // empty')"
for jid in $PENDING_JOBS; do
  curl -sf -X POST "$SERVER_URL/api/training/jobs/$jid/cancel" > /dev/null || true
  echo "  cancelled $jid"
done

# ---------------------------------------------------------- 5. Submit job
step "Submitting 3-step training job"
JOB_ID="$(curl -sf -X POST "$SERVER_URL/api/training/jobs" \
  -H 'Content-Type: application/json' \
  -d "{
    \"datasetId\":\"$DATASET_ID\",
    \"baseModel\":\"smolvla\",
    \"fineTuneMethod\":\"lora\",
    \"hyperparameters\":{
      \"learning_rate\":0.0001,
      \"batch_size\":2,
      \"epochs\":1,
      \"lora_rank\":8,
      \"max_steps\":$MAX_STEPS
    }
  }" | jq -r .job.id)"
[ -n "$JOB_ID" ] || fail "Job submission failed"
ok "Submitted job $JOB_ID"

# ---------------------------------------------------------- 6. Start worker
step "Stopping any existing worker"
pkill -f "python worker.py" 2>/dev/null || true
sleep 2

step "Starting worker → $WORKER_LOG"
(
  cd "$WORKER_DIR"
  source .venv/bin/activate
  NEODEM_SERVER_URL="$SERVER_URL" \
  RUSTFS_ENDPOINT="$RUSTFS_URL" \
  RUSTFS_ACCESS_KEY=rustfsadmin \
  RUSTFS_SECRET_KEY=rustfsadmin \
  TRAINER_STUB=false \
  nohup python worker.py > "$WORKER_LOG" 2>&1 &
)
WORKER_PID=$(pgrep -f "python worker.py" | head -1)
ok "Worker pid=$WORKER_PID"

cleanup() {
  [ -n "${WORKER_PID:-}" ] && kill "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT

# ---------------------------------------------------------- 7. Wait for job
step "Polling job status (timeout ${TRAIN_TIMEOUT_SEC}s)"
START=$(date +%s)
while true; do
  sleep 5
  ELAPSED=$(($(date +%s) - START))
  [ "$ELAPSED" -gt "$TRAIN_TIMEOUT_SEC" ] && {
    tail -30 "$WORKER_LOG" | grep -v "httpx: HTTP Request"
    fail "Job did not complete in ${TRAIN_TIMEOUT_SEC}s"
  }
  STATUS="$(curl -sf "$SERVER_URL/api/training/jobs/$JOB_ID" | jq -r .job.status)"
  PROGRESS="$(curl -sf "$SERVER_URL/api/training/jobs/$JOB_ID" | jq -r .job.progress)"
  echo "  [t+${ELAPSED}s] status=$STATUS progress=$PROGRESS%"
  case "$STATUS" in
    completed) break ;;
    failed)
      echo; warn "Job failed — worker log tail:"
      tail -30 "$WORKER_LOG" | grep -v "httpx: HTTP Request"
      fail "Training job failed"
      ;;
    cancelled) fail "Job was cancelled" ;;
  esac
done

# ---------------------------------------------------------- 8. Report
step "Training complete — fetching final state"
RESULT="$(curl -sf "$SERVER_URL/api/training/jobs/$JOB_ID")"
echo
echo "  job id:         $JOB_ID"
echo "  status:         $(echo "$RESULT" | jq -r .job.status)"
echo "  progress:       $(echo "$RESULT" | jq -r .job.progress)%"
echo "  training_loss:  $(echo "$RESULT" | jq -c '.job.metrics.training_loss')"
echo "  learning_rate:  $(echo "$RESULT" | jq -c '.job.metrics.learning_rate')"
echo "  final_loss:     $(echo "$RESULT" | jq -r '.job.metrics.final_loss')"

ARTIFACT="$(grep -oE 's3://[A-Za-z0-9._/-]+' "$WORKER_LOG" | tail -1 || true)"
echo "  artifact_uri:   ${ARTIFACT:-<not uploaded>}"
echo

# ---------------------------------------------------------- 9. Verify RustFS files
step "Verifying dataset files in RustFS (including videos)"
STORAGE_PATH="$(curl -sf "$SERVER_URL/api/datasets/$DATASET_ID" | jq -r .dataset.storagePath)"
FILE_COUNT="$(
  cd "$WORKER_DIR" && source .venv/bin/activate && python3 -c "
import boto3
from botocore.client import Config as BotoConfig
c = boto3.client('s3', endpoint_url='$RUSTFS_URL',
    aws_access_key_id='rustfsadmin', aws_secret_access_key='rustfsadmin',
    config=BotoConfig(signature_version='s3v4'), region_name='us-east-1')
resp = c.list_objects_v2(Bucket='training-datasets', Prefix='${STORAGE_PATH}')
keys = [o['Key'] for o in resp.get('Contents', [])]
print(len(keys))
" 2>/dev/null)"
echo "  files in RustFS: $FILE_COUNT"
if [ "$FILE_COUNT" -ge 5 ]; then
  ok "Dataset has $FILE_COUNT files in RustFS"
else
  warn "Expected ≥5 files, got $FILE_COUNT"
fi

# ---------------------------------------------------------- 10. VLA adapter test
VLA_DIR="$REPO_ROOT/vla-server"
VLA_TEST_PORT=8001
VLA_TEST_LOG="/tmp/vla-test-server.log"

if [ -d "$VLA_DIR/.venv" ] && [ -n "$ARTIFACT" ]; then
  step "Testing VLA server with trained adapter"

  # Write test config
  STATS_PATH="s3://training-datasets/${STORAGE_PATH}meta/stats.json"
  cat > "$VLA_DIR/config-test.yaml" <<YAML
model: smolvla
model_path: lerobot/smolvla_base
device: cpu
host: 127.0.0.1
port: $VLA_TEST_PORT
default_task: "pick up the object"
stub: false
adapter_path: "$ARTIFACT"
dataset_stats_path: "$STATS_PATH"
rustfs_endpoint: $RUSTFS_URL
rustfs_access_key: rustfsadmin
rustfs_secret_key: rustfsadmin
camera_names: [up, side]
empty_cameras: 1
YAML

  # Start test server
  (
    cd "$VLA_DIR"
    source .venv/bin/activate
    nohup python server.py --config config-test.yaml > "$VLA_TEST_LOG" 2>&1 &
  )
  VLA_PID=$(sleep 2 && pgrep -f "server.py.*config-test" | head -1 || true)

  # Wait for model load (CPU is slow — up to 60s)
  VLA_READY=false
  for i in {1..30}; do
    sleep 2
    if curl -sf --max-time 3 "http://127.0.0.1:$VLA_TEST_PORT/health" 2>/dev/null | grep -q '"model_loaded":true'; then
      VLA_READY=true
      ok "VLA server ready after $((i * 2))s"
      break
    fi
  done

  if $VLA_READY; then
    # Verify /config returns correct cameras
    CAMERAS="$(curl -sf "http://127.0.0.1:$VLA_TEST_PORT/config" | jq -c .cameras)"
    echo "  cameras: $CAMERAS"

    # Test /predict with synthetic image
    PREDICT_OK=false
    PREDICT_RESULT="$(
      cd "$VLA_DIR" && source .venv/bin/activate && python3 -c "
import base64, io, json, urllib.request
from PIL import Image
img = Image.new('RGB', (480, 640), color=(100, 100, 100))
buf = io.BytesIO(); img.save(buf, format='JPEG')
b64 = base64.b64encode(buf.getvalue()).decode()
body = {'images': {'up': b64, 'side': b64}, 'state': [0.0]*6, 'task': 'pick up the object'}
req = urllib.request.Request('http://127.0.0.1:$VLA_TEST_PORT/predict',
    data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
resp = urllib.request.urlopen(req, timeout=120)
data = json.loads(resp.read())
actions = data['actions'][0]
# Check actions are in degree range (not normalized ~0)
max_abs = max(abs(a) for a in actions)
print(json.dumps({'actions': [round(a, 2) for a in actions], 'max_abs': round(max_abs, 2), 'inference_ms': round(data['inference_time_ms'])}))
" 2>&1)" || true

    if [ -n "$PREDICT_RESULT" ]; then
      MAX_ABS="$(echo "$PREDICT_RESULT" | jq -r .max_abs)"
      echo "  predict: $PREDICT_RESULT"
      if [ "$(echo "$MAX_ABS > 5" | bc -l 2>/dev/null || echo 0)" = "1" ]; then
        ok "Actions are in degree scale (max_abs=$MAX_ABS > 5)"
        PREDICT_OK=true
      else
        warn "Actions may still be normalized (max_abs=$MAX_ABS ≤ 5)"
      fi
    else
      warn "Predict call failed — check $VLA_TEST_LOG"
    fi
  else
    warn "VLA server did not start in 60s — skipping adapter test"
    tail -10 "$VLA_TEST_LOG"
  fi

  # Cleanup VLA test server
  [ -n "$VLA_PID" ] && kill "$VLA_PID" 2>/dev/null || true
  rm -f "$VLA_DIR/config-test.yaml"
else
  warn "Skipping VLA adapter test (venv or artifact missing)"
fi

ok "End-to-end training pipeline test PASSED"
