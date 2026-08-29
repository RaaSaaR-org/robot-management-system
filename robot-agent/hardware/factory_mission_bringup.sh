#!/usr/bin/env bash
# Bring up the whole factory-mission stack, in the one order that works.
#
# This is the first configuration in which all five processes are asked to
# coexist, so the ordering below is not arbitrary and the guards are not
# decoration -- each one stands for a way this stack has actually failed.
#
#   Isaac (sim_main.py, factory scene)          GPU, docker, DDS domain 1
#     ^  rt/run_command/cmd  rt/lowcmd  rt/dex3/*/cmd        (commands in)
#     |  rt/lowstate  rt/odommodestate                       (state out)
#     |  ZMQ 55555/6/7 JPEG   +   REQ/REP 60000 config
#     |
#   isaac_loco_bridge.py    answers the sport RPC, publishes run_command + odom
#   isaac_manip_bridge.py   publishes the arm and hand commands
#   g1_sidecar.py   :8777   HTTP /loco/* and /state  ->  sport RPC over DDS
#   isaac_camera_facade.py :8779   HTTP /cameras/*, and proxies the rest to 8777
#   robot-agent            HARDWARE_SIDECAR_URL -> :8779
#
# Agent Mode therefore talks to ONE base URL, exactly as it does against the
# warehouse rig -- the facade is the piece that makes that true here, and it is
# a proxy rather than an extra endpoint because /state and /loco/* have to be
# reachable on the same host and port as /cameras/*.
#
# TWO RULES THIS SCRIPT NOW OBEYS, BOTH LEARNED THE HARD WAY
# ----------------------------------------------------------
# 1. LOOK BEFORE YOU KILL. The GPU check runs BEFORE anything is killed, and
#    nothing that this script did not start is killed without the operator
#    saying so out loud. The old order checked free VRAM only after a pkill
#    sweep had already freed it, which is precisely the reading that made
#    someone else's benchmark look like an idle box.
# 2. ONLY CLEAN UP WHAT YOU STARTED. Every process launched below is recorded
#    in PIDS, and the EXIT trap tears down exactly those, and only when the
#    bringup failed. A successful run is supposed to leave the stack up.
set -euo pipefail

REPO="${REPO:-$HOME/develop/robot-management-system}"
HW="$REPO/robot-agent/hardware"
CHECKOUTS="${CHECKOUTS:-$HOME/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts}"
SIM_DIR="$CHECKOUTS/unitree_sim_isaaclab"
CONDA_ENV="${CONDA_ENV:-$HOME/anaconda3/envs/unitree_sim_env6}"
PY="$CONDA_ENV/bin/python"
NODE_BIN="${NODE_BIN:-$HOME/.nvm/versions/node/v22.23.2/bin}"

DOMAIN="${DOMAIN:-1}"
IFACE="${IFACE:-lo}"
TASK_ID="${TASK_ID:-Isaac-Factory-PauseRoom-G129-Dex3-Wholebody}"
SECONDS_CAP="${SECONDS_CAP:-1200}"
MODEL="${MODEL:-qwen3-vl:8b}"
MIN_FREE_MB="${MIN_FREE_MB:-11000}"
GPU_INDEX="${GPU_INDEX:-0}"
LOGDIR="${LOGDIR:-$HOME/factory-mission-logs/$(date +%Y%m%d-%H%M%S)}"
ENABLE_MANIP="${ENABLE_MANIP:-1}"
CAM_NAME="${CAM_NAME:-head_camera}"
CONTAINER="${CONTAINER:-neodem-factory}"
# 1 = kill leftovers without asking, 0 = never kill, unset = ask. There is no
# default of "yes" here on purpose: see step 2.
KILL_STALE="${KILL_STALE:-}"
ME="${USER:-$(id -un)}"

mkdir -p "$LOGDIR"
say() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nFATAL: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- teardown
# Only PIDs this script started ever go in here. Nothing that was already
# running is added, so the trap below cannot reach it.
PIDS=()
DOCKER_STARTED=0
MODEL_PINNED=0

cleanup() {
  local rc=$?
  # `set +e` first, and unconditionally: a teardown that aborts half way through
  # because one `kill` found its target already gone is worse than a noisy one,
  # and the EXIT trap inherits `set -e` from the script that is dying.
  set +e
  # A successful bringup is supposed to LEAVE the stack running -- that is the
  # whole point of the script. Only a failure tears down.
  if [ "$rc" -eq 0 ]; then return 0; fi
  printf '\n--- bringup failed (exit %s): tearing down what THIS script started ---\n' \
    "$rc" >&2
  local pid
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill -0 "$pid" 2>/dev/null || continue
    printf 'stopping pid %s\n' "$pid" >&2
    # setsid gave each child its own session, so its pid is also its process
    # group leader: signal the group, then the pid, so a bridge that forked
    # does not survive its parent.
    kill -TERM "-$pid" 2>/dev/null
    kill -TERM "$pid" 2>/dev/null
  done
  if [ "$DOCKER_STARTED" = "1" ]; then
    printf 'removing container %s\n' "$CONTAINER" >&2
    docker rm -f "$CONTAINER" >/dev/null 2>&1
  fi
  if [ "$MODEL_PINNED" = "1" ]; then
    # keep_alive:-1 pins the model in VRAM until something says otherwise, and
    # a failed bringup that leaves 6 GB pinned is the next run's GPU guard
    # failing for no reason. keep_alive:0 unloads it.
    printf 'unpinning %s from VRAM\n' "$MODEL" >&2
    curl -sf -m 5 localhost:11434/api/generate \
      -d "{\"model\":\"$MODEL\",\"prompt\":\"\",\"keep_alive\":0}" >/dev/null 2>&1
  fi
  printf 'logs kept at %s\n' "$LOGDIR" >&2
  return 0
}
trap cleanup EXIT
trap 'die "interrupted"' INT TERM

# Register a background pid and refuse to go on if it is already gone. A bridge
# that refuses its arguments exits 2 within milliseconds; without this the
# refusal is written to a log nobody reads and the next step fails somewhere
# else entirely. This is how a domain-0 refusal used to be swallowed.
watch_pid() {
  local pid="$1" label="$2" log="$3"
  PIDS+=("$pid")
  if ! kill -0 "$pid" 2>/dev/null; then
    printf '\n--- last 30 lines of %s ---\n' "$log" >&2
    tail -30 "$log" >&2 2>/dev/null || true
    die "$label exited immediately (pid $pid). Exit 2 from a bridge means it REFUSED its arguments -- domain 0 is the usual reason. See $log."
  fi
  printf 'started %s (pid %s)\n' "$label" "$pid"
}

# --- domain guard (extracted and executed by verify_isaac_manip_offline.py) ---
# Domain 0 is the real robot. rt/lowcmd on domain 0 is a live G1's full-body
# low-level bus and this stack writes zeros into its leg slots.
#
# This has to be a NUMERIC comparison, and the numeric comparison has to be
# preceded by a syntactic one. `[ "$DOMAIN" = "0" ]` passes `00`, ` 0`, `+0` and
# `-0` straight through to argparse's `type=int`, all four of which are domain
# zero by the time Python sees them. So: digits only, then compare as a number.
# `10#` is not decoration either -- without it `08` is an invalid octal literal
# and the guard dies with an arithmetic error instead of a verdict.
if ! [[ "$DOMAIN" =~ ^[0-9]+$ ]]; then
  die "DOMAIN must be plain digits, got '$DOMAIN' -- anything else is guesswork about what Python will make of it"
fi
if (( 10#$DOMAIN == 0 )); then
  die "domain 0 is the REAL ROBOT -- refusing. Use the sim domain (1) or the mock (9)."
fi
# --- end domain guard ---

say "0. preconditions"
[ -x "$PY" ]        || die "no sim python at $PY"
[ -d "$SIM_DIR" ]   || die "no unitree_sim_isaaclab at $SIM_DIR"
[ -d "$SIM_DIR/tasks/g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody" ] \
  || die "the factory task is not installed into the checkout -- run install first"
command -v docker >/dev/null     || die "docker missing"
command -v nvidia-smi >/dev/null || die "nvidia-smi missing -- step 1 cannot tell whose GPU this is"
command -v curl >/dev/null       || die "curl missing"
command -v pgrep >/dev/null      || die "pgrep missing -- step 2 cannot scope its sweep to one user"

say "1. the GPU must be ours -- CHECKED BEFORE ANYTHING IS KILLED"
# Isaac needs roughly 10 GB and the planner another 6. Someone else's benchmark
# run has been found on this box mid-flight before; refusing is much cheaper
# than discovering it as an out-of-memory crash twenty minutes in.
#
# This step comes first for one reason: a kill sweep frees VRAM, so a VRAM check
# that runs after one cannot answer the question it was written to answer. If
# the memory is busy the operator gets the compute-apps table and decides -- the
# script does not decide for them, because it cannot tell a stale run of its own
# from a colleague's twelve-hour job.
nvidia-smi --query-gpu=index,name,memory.free,memory.total --format=csv,noheader || true
FREE=$(nvidia-smi --id="$GPU_INDEX" --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 || true)
[[ "$FREE" =~ ^[0-9]+$ ]] \
  || die "could not read free VRAM for GPU $GPU_INDEX from nvidia-smi (got '${FREE}')"
echo "GPU $GPU_INDEX free VRAM: ${FREE} MiB (need ${MIN_FREE_MB})"
if [ "$FREE" -lt "$MIN_FREE_MB" ]; then
  echo "processes holding this GPU:" >&2
  nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv >&2 || true
  die "only ${FREE} MiB free on GPU $GPU_INDEX -- something else is using it. Read the table above before killing anything; if it is your own leftover run, stop it yourself and re-run."
fi

say "2. clear the wire (this user's leftovers only, and only with consent)"
# Scoped to $ME on purpose. Isaac is launched below INSIDE DOCKER and without
# --pid=host, so its sim_main.py is not visible in the host pid namespace at
# all: a host-side sim_main.py match is by definition NOT this stack's. It is
# either a previous non-docker run or somebody else's work, and the difference
# is not something a pattern match can see -- so it is put to the operator.
# (sim_node.py, the MuJoCo sim, used to be swept here too. This script never
# starts it, so killing it was pure collateral damage. It is gone.)
STALE=()
for pat in "isaac_loco_bridge.py" "isaac_manip_bridge.py" \
           "isaac_camera_facade.py" "g1_sidecar.py" "sim_main.py"; do
  while read -r pid; do
    [ -n "$pid" ] || continue
    if [ "$pid" = "$$" ]; then continue; fi
    case " ${STALE[*]-} " in *" $pid "*) continue ;; esac
    STALE+=("$pid")
  done < <(pgrep -u "$ME" -f -- "$pat" 2>/dev/null || true)
done

FOUND_CONTAINER=0
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  FOUND_CONTAINER=1
fi

if [ "${#STALE[@]}" -eq 0 ] && [ "$FOUND_CONTAINER" = "0" ]; then
  echo "wire is clear -- nothing of $ME's to stop"
else
  echo "these are already running and this script did NOT start them:"
  for pid in ${STALE[@]+"${STALE[@]}"}; do
    printf '  pid %-8s %s\n' "$pid" \
      "$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | cut -c1-120)"
  done
  if [ "$FOUND_CONTAINER" = "1" ]; then echo "  docker container $CONTAINER"; fi
  ANSWER="$KILL_STALE"
  if [ -z "$ANSWER" ]; then
    if [ -t 0 ]; then
      read -r -p "stop all of the above? [y/N] " ANSWER || ANSWER=""
      case "$ANSWER" in y|Y|yes|YES) ANSWER=1 ;; *) ANSWER=0 ;; esac
    else
      # No terminal to ask at. Refusing is the safe answer, and KILL_STALE=1 is
      # how an operator who has already looked says otherwise.
      ANSWER=0
    fi
  fi
  [ "$ANSWER" = "1" ] \
    || die "leftovers are still running and consent was not given. Stop them yourself, or re-run with KILL_STALE=1 once you have read the list above."
  for pid in ${STALE[@]+"${STALE[@]}"}; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  if [ "$FOUND_CONTAINER" = "1" ]; then docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; fi
  sleep 2
  for pid in ${STALE[@]+"${STALE[@]}"}; do
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  done
  sleep 1
fi

say "3. pin the planner model BEFORE Isaac takes its memory"
curl -sf localhost:11434/api/generate \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"ready\",\"stream\":false,\"keep_alive\":-1}" \
  >/dev/null || die "ollama did not answer -- is it running, and is $MODEL pulled?"
MODEL_PINNED=1
echo "pinned $MODEL resident"

export CYCLONEDDS_HOME="$CHECKOUTS/cyclonedds/install"
export OMNI_KIT_ACCEPT_EULA=YES

say "4. locomotion bridge (answers the sport RPC; publishes odom)"
cd "$HW"
setsid nohup "$PY" -u isaac_loco_bridge.py --domain "$DOMAIN" --iface "$IFACE" \
  --publish-odom >"$LOGDIR/loco_bridge.log" 2>&1 </dev/null &
LOCO_PID=$!
disown "$LOCO_PID" 2>/dev/null || true
sleep 2
watch_pid "$LOCO_PID" "the locomotion bridge" "$LOGDIR/loco_bridge.log"

if [ "$ENABLE_MANIP" = "1" ]; then
  say "5. manipulation bridge (arms + hands)"
  setsid nohup "$PY" -u isaac_manip_bridge.py --domain "$DOMAIN" --iface "$IFACE" \
    >"$LOGDIR/manip_bridge.log" 2>&1 </dev/null &
  MANIP_PID=$!
  disown "$MANIP_PID" 2>/dev/null || true
  sleep 2
  watch_pid "$MANIP_PID" "the manipulation bridge" "$LOGDIR/manip_bridge.log"
else
  say "5. manipulation bridge SKIPPED (ENABLE_MANIP=0)"
fi

say "6. Isaac, in docker (Vulkan needs a seat; the host user does not have one)"
setsid nohup docker run --rm --name "$CONTAINER" --user 0 --runtime=nvidia --gpus all \
  -e ACCEPT_EULA=Y -e OMNI_KIT_ACCEPT_EULA=YES -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e HOME=/home/humanoid -e PYTHONPATH= \
  -e CYCLONEDDS_HOME="$CHECKOUTS/cyclonedds/install" \
  ${NEODEM_FILM_DIR:+-e NEODEM_FILM_DIR="$NEODEM_FILM_DIR"} \
  --device /dev/dri --ipc=host --network host \
  -v /home/humanoid:/home/humanoid -w "$SIM_DIR" \
  neodem-isaac-host:latest \
  "$PY" -u sim_main.py --task "$TASK_ID" \
    --enable_dex3_dds --enable_wholebody_dds --robot_type g129 \
    --device cuda --headless --enable_cameras --camera_write_interval 10 \
  >"$LOGDIR/isaac.log" 2>&1 </dev/null &
ISAAC_PID=$!
DOCKER_STARTED=1
disown "$ISAAC_PID" 2>/dev/null || true
sleep 3
watch_pid "$ISAAC_PID" "the Isaac container" "$LOGDIR/isaac.log"

# Isaac's log is extremely noisy and contains the words "error" and "fatal" in
# perfectly healthy lines (shader warnings, Kit extension chatter, carb plugin
# probes). A case-insensitive match on those words is a false-positive `die`
# waiting to happen, so this matches only the four things that are always fatal
# and always appear in the vendor's own wording, anchored where they occur.
ISAAC_FATAL='^Traceback \(most recent call last\):|^Fatal Python error|Error executing job with overrides|torch\.(cuda\.)?OutOfMemoryError|CUDA error: out of memory'

echo "waiting for Isaac to build the scene (this takes a while on a cold shader cache)"
ISAAC_UP=0
for i in $(seq 1 180); do
  if grep -qiE 'image server has started|Image Server' "$LOGDIR/isaac.log" 2>/dev/null; then
    ISAAC_UP=1; break
  fi
  if grep -qE "$ISAAC_FATAL" "$LOGDIR/isaac.log" 2>/dev/null; then
    tail -30 "$LOGDIR/isaac.log"
    die "Isaac failed to start -- see $LOGDIR/isaac.log"
  fi
  # The container dying is not always a traceback: an OOM kill or a missing
  # image leaves the docker client exiting with nothing useful in the log.
  if ! kill -0 "$ISAAC_PID" 2>/dev/null; then
    tail -30 "$LOGDIR/isaac.log"
    die "the Isaac container exited before the image server came up -- see $LOGDIR/isaac.log"
  fi
  sleep 5
done
# The loop used to simply fall through here, and the rest of the script would
# then bring a sidecar and a facade up against a sim that never existed. Fifteen
# minutes of waiting deserves a verdict.
[ "$ISAAC_UP" = "1" ] || {
  tail -30 "$LOGDIR/isaac.log"
  die "Isaac did not announce its image server within 15 minutes -- see $LOGDIR/isaac.log"
}

say "7. sidecar (DDS speaker) :8777"
cd "$HW"
G1_SIDECAR_PORT=8777 G1_READ_ONLY=1 G1_LOCO_ENABLED=1 \
G1_ROBOT_ID=sim-robot-g1-edu G1_NET_INTERFACE="$IFACE" \
G1_LIDAR_DDS_DOMAIN="$DOMAIN" G1_LIDAR_DDS_IFACE="$IFACE" \
  setsid nohup "$PY" -u g1_sidecar.py >"$LOGDIR/sidecar.log" 2>&1 </dev/null &
SIDECAR_PID=$!
disown "$SIDECAR_PID" 2>/dev/null || true
sleep 3
watch_pid "$SIDECAR_PID" "the sidecar" "$LOGDIR/sidecar.log"

say "8. camera facade :8779 (serves /cameras/*, proxies the rest to 8777)"
setsid nohup "$PY" -u isaac_camera_facade.py --serve 8779 \
  --sidecar-url http://localhost:8777 --scene "$TASK_ID" \
  >"$LOGDIR/camera_facade.log" 2>&1 </dev/null &
FACADE_PID=$!
disown "$FACADE_PID" 2>/dev/null || true
sleep 2
watch_pid "$FACADE_PID" "the camera facade" "$LOGDIR/camera_facade.log"

echo "waiting for a real camera frame from $CAM_NAME"
# THE GATE IS THE SNAPSHOT ROUTE, NOT /health's "connected".
#
# With --sidecar-url set, isaac_camera_facade.py copies `status` and `connected`
# from the SIDECAR's /health and passes them through untouched -- deliberately,
# so a cold camera cannot switch locomotion off. So `"connected": true` means
# "g1_sidecar.py answered on :8777" and says NOTHING about whether a single JPEG
# has ever arrived on ZMQ. Gating on it made the warning below unreachable, which
# is a problem because that warning is the one question this whole rig exists to
# answer: nobody has yet confirmed that the factory scene publishes camera frames
# at all.
#
# /health's `ready` would be an improvement but is still not enough: it is true
# if ANY of the three cameras is fresh, so a wrist-only stream would pass while
# `look` -- which reads head_camera -- still has nothing. So the gate is a real
# GET on the exact route Agent Mode's `look` calls. That route 503s on "never",
# "stale" and "frozen" alike and 200s only with a JPEG in hand.
FRAME_OK=0
for i in $(seq 1 60); do
  if curl -sf -m 5 -o /dev/null "http://localhost:8779/cameras/$CAM_NAME/snapshot?format=raw"; then
    FRAME_OK=1; break
  fi
  sleep 2
done

say "STATUS"
curl -s -m 5 http://localhost:8779/health 2>/dev/null | head -c 1200; echo
if [ "$FRAME_OK" != "1" ]; then
  echo
  echo "NO CAMERA FRAME from $CAM_NAME. Agent Mode will be blind -- look and scan_room will 503."
  echo "This is the open question this rig exists to answer: whether the factory"
  echo "scene publishes on ZMQ at all. Check $LOGDIR/isaac.log for an image-server"
  echo "banner, and $LOGDIR/camera_facade.log for which ports it tried."
  echo "The per-camera 'state' in the /health above says which of never/stale/frozen it is."
else
  echo
  echo "camera OK: $CAM_NAME answered /cameras/$CAM_NAME/snapshot with a frame."
fi

cat <<TXT

logs:      $LOGDIR
pids:      ${PIDS[*]}
teardown:  docker rm -f $CONTAINER
           kill ${PIDS[*]}
           curl -sf localhost:11434/api/generate -d '{"model":"$MODEL","prompt":"","keep_alive":0}'

The agent is NOT started here -- start it against the facade:
  cd $REPO/robot-agent && PATH=$NODE_BIN:\$PATH \\
    HARDWARE_SIDECAR_URL=http://localhost:8779 AGENT_MODE_ENABLED=true \\
    AGENT_PLANNER_MODEL=$MODEL AGENT_VISION_MODEL=$MODEL \\
    npm run dev:g1-edu-agent
TXT
