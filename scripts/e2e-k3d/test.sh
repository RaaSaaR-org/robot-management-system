#!/usr/bin/env bash
# @file test.sh
# @description The k3d E2E: HF dataset import into a real RustFS, read back through the API (TASK-351).
#
# Steps, each a hard assertion:
#   1. /health answers and reports storage configured + ready
#   2. POST /api/datasets/import/huggingface answers 202 with a dataset id
#   3. the row reaches `ready` (not `failed`) within E2E_IMPORT_TIMEOUT seconds
#   4. every meta/ and data/ file of the Hub repo is an object in the
#      training-datasets bucket under the row's storagePath, with the Hub's size
#   5. the episodes and frames endpoints serve what is in those objects — not
#      the synthetic fallback they print when storage cannot be read
#   6. deleting the dataset removes every object under its storagePath (TASK-359)
#
# Knobs: E2E_DATASET (default lerobot/svla_so101_pickplace, ~450 KB without
# videos), E2E_INCLUDE_VIDEOS=1 (adds ~86 MB of mp4), E2E_PORT (local port for
# the server port-forward, default 18081), E2E_IMPORT_TIMEOUT (default 300),
# E2E_AWSCLI_IMAGE (default: the aws-cli image the chart renders).
set -euo pipefail
source "$(dirname "$0")/lib.sh"

need kubectl
need curl
need jq

DATASET="${E2E_DATASET:-lerobot/svla_so101_pickplace}"
INCLUDE_VIDEOS="${E2E_INCLUDE_VIDEOS:-0}"
PORT="${E2E_PORT:-18081}"
IMPORT_TIMEOUT="${E2E_IMPORT_TIMEOUT:-300}"
API="http://127.0.0.1:$PORT"
WORK="$(mktemp -d)"
PF_PID=""

# Kill the port-forward and WAIT for it: kill only sends the signal, and a
# script that exits right after can leave kubectl holding the port for the
# next run. INT/TERM go through exit so the EXIT trap runs on Ctrl-C too.
cleanup() {
  if [ -n "$PF_PID" ]; then
    kill "$PF_PID" 2>/dev/null || true
    # `kill -0` cannot tell an exited child from a live one until it is
    # reaped, so wait on it — with a watchdog for a kubectl that ignores TERM.
    ( sleep 5; kill -9 "$PF_PID" 2>/dev/null ) &
    local watchdog=$!
    wait "$PF_PID" 2>/dev/null || true
    kill "$watchdog" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# On any failure, the server's own account of it is the first thing wanted.
dump_server_logs() {
  log "last server log lines:"
  kc logs "deploy/$SERVER_DEPLOY" --tail=60 2>/dev/null || true
}

# `|| true`: under set -e a failed lookup (no namespace, no context) would
# abort here silently instead of reaching the fail message below.
SERVER_SVC="$(kc get svc -l app.kubernetes.io/component=server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
SERVER_DEPLOY="$(kc get deploy -l app.kubernetes.io/component=server -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
[ -n "$SERVER_SVC" ] || fail "no server Service in $NAMESPACE — run install.sh first"

# --- port-forward ------------------------------------------------------------
# A port someone else holds (an orphan from an older run, another service)
# would make the forward fail, or worse, the curl below answer from the wrong
# process. Say who holds it instead.
if command -v lsof >/dev/null 2>&1; then
  holder="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  [ -z "$holder" ] || fail "port $PORT is already in use by PID $holder ($(ps -o command= -p "$holder" 2>/dev/null | cut -c1-80)) — stop it or set E2E_PORT"
fi
# kubectl itself, not `kc`: a shell function in the background runs in a
# subshell, so `$!` was the subshell's PID, `cleanup` killed that, and the
# kubectl port-forward under it lived on as an orphan holding the port.
kubectl --context "$KUBE_CONTEXT" -n "$NAMESPACE" port-forward "svc/$SERVER_SVC" "$PORT:3001" >"$WORK/pf.log" 2>&1 &
PF_PID=$!
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "$API/health" 2>/dev/null && break
  kill -0 "$PF_PID" 2>/dev/null || fail "port-forward died: $(cat "$WORK/pf.log")"
  sleep 1
done

# --- 1. health, storage ready ------------------------------------------------
# The RustFS client connects in the background and retries (#369), so
# "configured but connecting" is a state to wait out, not a failure.
state=""
for _ in $(seq 1 60); do
  health="$(curl -fsS "$API/health" 2>/dev/null || true)"
  state="$(jq -r '.dependencies.storage.state // "missing"' <<<"$health" 2>/dev/null || echo unparsable)"
  [ "$state" = ready ] && break
  sleep 2
done
[ "$state" = ready ] || { dump_server_logs; fail "storage never became ready (last: $state) — $health"; }
[ "$(jq -r '.dependencies.storage.configured' <<<"$health")" = true ] \
  || fail "storage is ready but not configured — the chart did not set RUSTFS_ENDPOINT"
ok "/health: storage configured and ready (server $(jq -r .version <<<"$health"))"

# --- 2. trigger the import ---------------------------------------------------
videos=false; [ "$INCLUDE_VIDEOS" = 1 ] && videos=true
body="$(jq -nc --arg r "$DATASET" --argjson v "$videos" '{repoId:$r, revision:"main", includeVideos:$v}')"
code="$(curl -sS -o "$WORK/import.json" -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -d "$body" "$API/api/datasets/import/huggingface")"
[ "$code" = 202 ] || { dump_server_logs; fail "import answered $code: $(cat "$WORK/import.json")"; }
DATASET_ID="$(jq -r .datasetId "$WORK/import.json")"
ok "import of $DATASET accepted (202), dataset $DATASET_ID"

# --- 3. poll to a terminal status --------------------------------------------
import_start=$(now)
status=""
while :; do
  curl -fsS "$API/api/datasets/$DATASET_ID" >"$WORK/row.json" || fail "GET dataset failed"
  status="$(jq -r .dataset.status "$WORK/row.json")"
  case "$status" in ready|failed) break ;; esac
  (( $(now) - import_start < IMPORT_TIMEOUT )) || { dump_server_logs; fail "still '$status' after ${IMPORT_TIMEOUT}s"; }
  sleep 2
done
if [ "$status" != ready ]; then
  dump_server_logs
  fail "import ended '$status': $(jq -c '.dataset | {importError, validationErrors}' "$WORK/row.json")"
fi
STORAGE_PATH="$(jq -r .dataset.storagePath "$WORK/row.json")"
ok "dataset ready in $(( $(now) - import_start ))s, storagePath=$STORAGE_PATH"

# --- 4. the objects are really in RustFS -------------------------------------
# What the Hub has at the pinned commit, filtered the way the importer filters
# (selectRepoFiles in HuggingFaceImportService.ts), as "path size" lines.
SHA="$(jq -r .dataset.sourceRevision "$WORK/row.json")"
# Follow the Link rel="next" cursor like the importer's listRepoTree does — a
# large repo's tree spans several pages, and page one alone under-counts.
: >"$WORK/tree.ndjson"
url="https://huggingface.co/api/datasets/$DATASET/tree/$SHA?recursive=true"
for _ in $(seq 1 100); do
  [ -n "$url" ] || break
  curl -fsS -D "$WORK/tree.hdr" "$url" | jq -c '.[]' >>"$WORK/tree.ndjson" \
    || fail "could not list $DATASET@$SHA on the Hub"
  url="$(tr -d '\r' <"$WORK/tree.hdr" | sed -n 's/^[Ll]ink:.*<\([^>]*\)>; *rel="next".*/\1/p' | head -1)"
done
# selectRepoFiles: meta/, data/*.parquet; with videos also videos/*.mp4 and
# everything under images/. Size as the importer takes it: max(size, lfs.size).
jq -r --argjson v "$videos" 'select(.type=="file")
    | select((.path|startswith("meta/"))
          or ((.path|startswith("data/")) and (.path|endswith(".parquet")))
          or ($v and (.path|startswith("videos/")) and (.path|endswith(".mp4")))
          or ($v and (.path|startswith("images/"))))
    | "\(.path) \([.size // 0, .lfs.size // 0] | max)"' "$WORK/tree.ndjson" | sort >"$WORK/expected.txt"
[ -s "$WORK/expected.txt" ] || fail "could not list $DATASET@$SHA on the Hub"

# What the bucket holds, listed from INSIDE the cluster with the same
# credentials and endpoint the server uses — a throwaway aws-cli pod, the image
# the chart's bucket-init Job already pulled (up.sh imported it), read off the
# chart rather than hardcoded so a pin there is honoured here.
AWSCLI_IMAGE="${E2E_AWSCLI_IMAGE:-$(chart_images 2>/dev/null | grep -E '(^|/)aws-cli:' | head -1 || true)}"
AWSCLI_IMAGE="${AWSCLI_IMAGE:-amazon/aws-cli:2.37.4}"
ENDPOINT="$(kc get configmap -l app.kubernetes.io/instance="$RELEASE" -o json 2>/dev/null \
  | jq -r '[.items[].data.RUSTFS_ENDPOINT // empty][0]' || true)"
SECRET="$(kc get secret -l app.kubernetes.io/instance="$RELEASE" -o json 2>/dev/null \
  | jq -r '[.items[] | select(.data.RUSTFS_ACCESS_KEY) | .metadata.name][0] // empty' || true)"
[ -n "$ENDPOINT" ] && [ -n "$SECRET" ] || fail "no RUSTFS_ENDPOINT/secret found for release $RELEASE"
AK="$(kc get secret "$SECRET" -o jsonpath='{.data.RUSTFS_ACCESS_KEY}' | base64 -d)"
SK="$(kc get secret "$SECRET" -o jsonpath='{.data.RUSTFS_SECRET_KEY}' | base64 -d)"
# Run detached and read the pod's log afterwards: `kubectl run -i` loses the
# race with a command this short and, falling back to streaming the log,
# printed the listing twice (measured).
# list_objects <out-file>: the training-datasets objects under $STORAGE_PATH, as JSON.
list_objects() {
  local out="$1" pod="e2e-s3ls-$$-$RANDOM" phase=""
  kc run "$pod" --restart=Never --image="$AWSCLI_IMAGE" --image-pull-policy=IfNotPresent \
    --env="AWS_ACCESS_KEY_ID=$AK" --env="AWS_SECRET_ACCESS_KEY=$SK" --env=AWS_DEFAULT_REGION=us-east-1 \
    -- --endpoint-url "$ENDPOINT" s3api list-objects-v2 --bucket training-datasets \
       --prefix "$STORAGE_PATH" --output json >/dev/null
  for _ in $(seq 1 60); do
    phase="$(kc get pod "$pod" -o jsonpath='{.status.phase}')"
    case "$phase" in Succeeded|Failed) break ;; esac
    sleep 1
  done
  kc logs "$pod" >"$out" 2>&1 || true
  kc delete pod "$pod" --wait=false >/dev/null 2>&1 || true
  [ "$phase" = Succeeded ] \
    || fail "listing s3://training-datasets/$STORAGE_PATH ended '$phase': $(cat "$out")"
}
list_objects "$WORK/objects.json"
jq -r --arg p "$STORAGE_PATH" '(.Contents // [])[] | "\(.Key | ltrimstr($p)) \(.Size)"' \
  "$WORK/objects.json" | sort >"$WORK/actual.txt"

if ! diff -u "$WORK/expected.txt" "$WORK/actual.txt" >"$WORK/objects.diff"; then
  cat "$WORK/objects.diff" >&2
  fail "RustFS objects under $STORAGE_PATH differ from the Hub repo (- Hub, + bucket)"
fi
ok "$(wc -l <"$WORK/actual.txt" | tr -d ' ') objects in s3://training-datasets/$STORAGE_PATH match the Hub, byte for byte in size"

# --- 5. read it back through the API -----------------------------------------
# Both endpoints below fall back to SYNTHETIC data when they cannot read the
# parquet from storage — even episode lengths, sine-wave frames, HTTP 200 — so
# a 200 alone proves nothing. Real metadata is told apart by its content.
# -L: the Hub answers /resolve/ with a 307 to its resolve cache.
curl -fsSL "https://huggingface.co/datasets/$DATASET/resolve/$SHA/meta/info.json" >"$WORK/info.json" \
  || fail "could not fetch info.json of $DATASET@$SHA from the Hub"
HUB_EPISODES="$(jq .total_episodes "$WORK/info.json")"
HUB_FRAMES="$(jq .total_frames "$WORK/info.json")"

curl -fsS "$API/api/datasets/$DATASET_ID/episodes" >"$WORK/episodes.json" || fail "GET episodes failed"
n_eps="$(jq '.episodes | length' "$WORK/episodes.json")"
sum_frames="$(jq '[.episodes[].frameCount] | add // 0' "$WORK/episodes.json")"
distinct="$(jq '[.episodes[].frameCount] | unique | length' "$WORK/episodes.json")"
[ "$n_eps" = "$HUB_EPISODES" ] || fail "API lists $n_eps episodes, the Hub says $HUB_EPISODES"
[ "$sum_frames" = "$HUB_FRAMES" ] \
  || fail "episode lengths sum to $sum_frames, the Hub says $HUB_FRAMES — synthetic fallback? (server could not read meta/episodes from RustFS)"
(( distinct > 1 )) || fail "every episode has the same length — that is the synthetic fallback, not the parquet"
ok "episodes read from RustFS: $n_eps episodes, $sum_frames frames (matches the Hub)"

EP0_LEN="$(jq '.episodes[0].frameCount' "$WORK/episodes.json")"
EP0_IDX="$(jq '.episodes[0].index' "$WORK/episodes.json")"
curl -fsS "$API/api/datasets/$DATASET_ID/episodes/$EP0_IDX/frames?limit=100000" >"$WORK/frames.json" \
  || fail "GET frames failed"
n_frames="$(jq '.frames | length' "$WORK/frames.json")"
[ "$n_frames" = "$EP0_LEN" ] \
  || fail "episode $EP0_IDX: $n_frames frames served, its metadata says $EP0_LEN — synthetic fallback? (server could not read data/ from RustFS)"
# To a file first: `kubectl logs | grep -q` fails under pipefail once grep
# exits early and kubectl takes the SIGPIPE (measured, with a busy log).
kc logs "deploy/$SERVER_DEPLOY" --since=5m >"$WORK/server.log" 2>/dev/null || true
grep -q "Read $EP0_LEN frames from parquet for episode $EP0_IDX" "$WORK/server.log" \
  || fail "the server never logged reading episode $EP0_IDX from parquet — those frames were synthesised"
ok "episode $EP0_IDX: $n_frames frames read from data/ parquet in RustFS"

# --- 6. delete removes the objects ------------------------------------------
# The importer writes under a fresh uuid prefix, and the delete used to remove
# only `<id>/latest` and `<id>/upload` — every imported object stayed behind.
code="$(curl -sS -o "$WORK/delete.json" -w '%{http_code}' -X DELETE "$API/api/datasets/$DATASET_ID")"
[ "$code" = 200 ] || { dump_server_logs; fail "delete answered $code: $(cat "$WORK/delete.json")"; }
list_objects "$WORK/after-delete.json"
# -s: an empty listing may print nothing at all, which is still zero objects.
left="$(jq -s '[.[] | (.Contents // [])[]] | length' "$WORK/after-delete.json" 2>/dev/null || echo unparsable)"
[ "$left" = 0 ] || fail "$left objects left under s3://training-datasets/$STORAGE_PATH after the delete"
ok "dataset deleted and s3://training-datasets/$STORAGE_PATH is empty"

ok "E2E passed: $DATASET imported into RustFS, read back and deleted (dataset $DATASET_ID)"
