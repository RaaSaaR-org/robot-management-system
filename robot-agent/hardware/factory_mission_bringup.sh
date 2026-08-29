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
#   isaac_manip_bridge.py   publishes the arm and hand commands; :8778 takes them in
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
# EMPTY IS DELIBERATE, AND IT IS THE WHOLE REASON THIS STACK TALKS AT ALL.
#
# The sim calls ChannelFactoryInitialize(1) with NO interface argument
# (dds_master.py:60, a hardcoded literal -- no flag, no env var). That takes
# unitree_sdk2py's ChannelConfigAutoDetermine branch, and CycloneDDS then ranks the
# host's interfaces by quality: lo scores 1, every real NIC scores 9. So the sim binds
# enp130s0 (192.168.123.222), never loopback.
#
# This script used to pin the three host processes to `lo`. Both sides then sat in the
# SAME network namespace -- --network host, verified identical net/ipc inode -- and never
# exchanged a single packet, because Cyclone only ever transmits and receives on the one
# interface it selected. The bridges' `lo` had auto-added unicast peers (multicast is
# unavailable there); the sim on a multicast-capable NIC had none. The two discovery
# mechanisms do not overlap.
#
# The symptom was thoroughly misleading: the sim ran, stepped at 16 Hz, printed healthy
# DDS banners, and logged cmd=[0,0,0,0.80] -- which is action_provider_wh_dds.py:345's
# DEFAULT, not anything we sent. Nothing anywhere said "interface mismatch".
#
# Empty makes the bridges take the SAME autodetermine branch as the sim, so they follow
# whatever Cyclone picks instead of hardcoding a guess that can drift. All three consumers
# already handle it -- isaac_loco_bridge.py:367, isaac_manip_bridge.py:174 and
# g1_sidecar.py:980 each read `if iface:` and fall back to ChannelFactoryInitialize(domain).
# IFACE=lo still works for a host-side sim (the MuJoCo sim_node.py needs it).
IFACE="${IFACE-}"
TASK_ID="${TASK_ID:-Isaac-Factory-PauseRoom-G129-Dex3-Wholebody}"
SECONDS_CAP="${SECONDS_CAP:-1200}"
MODEL="${MODEL:-qwen3-vl:8b}"
MIN_FREE_MB="${MIN_FREE_MB:-11000}"
GPU_INDEX="${GPU_INDEX:-0}"
LOGDIR="${LOGDIR:-$HOME/factory-mission-logs/$(date +%Y%m%d-%H%M%S)}"
ENABLE_MANIP="${ENABLE_MANIP:-1}"
# The manipulation bridge's HTTP command inlet. 8777 is the sidecar and 8779 the camera
# facade, so 8778 is the free slot between them. Declared once and used twice -- on the
# bridge's --serve and on the facade's --manip-url -- because those two have to agree or
# every /action a VLA rollout sends lands on a closed port.
MANIP_PORT="${MANIP_PORT:-8778}"
CAM_NAME="${CAM_NAME:-head_camera}"
# The facade's default staleness window is 0.5 s, chosen against the cameras' NOMINAL 30 fps.
# What this rig actually delivers is one write per --camera_write_interval control steps at a
# render-bound ~16 Hz, measured at 1.75 Hz / ~620 ms between frames. At 0.5 s essentially every
# snapshot request would 503 as stale even with the stream perfectly healthy, and `look` would
# report the scene as unobservable for a reason that has nothing to do with the scene.
CAM_MAX_AGE="${CAM_MAX_AGE:-1.5}"
# AND THE OTHER HALF OF THAT, WHICH THE SEED MAKES NECESSARY.
#
# Seeding a placeholder frame so the publisher binds turns a LOUD failure into a quiet one:
# if Isaac's renderer never writes -- scene fails to load, cameras disabled -- the placeholder
# is republished at 30 Hz forever and every health field reads OK. Before the seed, that case
# was total silence, which at least could not be mistaken for success.
#
# --max-content-age is the guard: it rejects a frame whose PICTURE has not changed, as opposed
# to one that is merely old. The seeded placeholder is a single static image, so its content
# age grows without bound and the facade starts 503ing within seconds. A real render always
# changes -- even a motionless robot has shadow and sensor noise. The facade's default is 0,
# which disables the check entirely.
CAM_MAX_CONTENT_AGE="${CAM_MAX_CONTENT_AGE:-5.0}"
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
# The scene is AUTHORED in this repo and COPIED into the checkout, and Isaac loads the
# copy. So "the verifiers pass" says nothing about what is about to be simulated: the two
# have already drifted once, leaving the checkout holding a pre-door snapshot while every
# offline check went green against the source. install_into_checkout.sh --check compares
# them file by file and is the only thing standing between that and a wasted run.
#
# It CHECKS rather than installs, for the same reason step 2 asks before killing: writing
# into somebody else's checkout is not a thing a bring-the-stack-up script should do behind
# the operator's back. INSTALL_SCENE=1 is how an operator says otherwise.
SCENE_INSTALLER="$HW/isaac_scenes/install_into_checkout.sh"
[ -x "$SCENE_INSTALLER" ] || die "no scene installer at $SCENE_INSTALLER"
if [ "${INSTALL_SCENE:-0}" = "1" ]; then
  "$SCENE_INSTALLER" || die "installing the scene into the checkout failed"
else
  "$SCENE_INSTALLER" --check \
    || die "the scene in the checkout is not the scene in this repo (see above). Install it
     with the command printed above, or re-run this script with INSTALL_SCENE=1."
fi
# The spawn pose is chosen on the HOST and consumed INSIDE the container, and the
# only thing carrying it across is the -e below. A var that is set but not
# forwarded is silent: the sim starts happily at the authored pose, 8.4 m from
# where the operator asked for, and the first symptom is a camera looking at an
# empty hall. So resolve it here, on the host, with the same resolver the scene
# uses, and print the pose that will actually be spawned.
if [ -n "${NEODEM_ROBOT_SPAWN:-}" ]; then
  SPAWN_DESC="$(NEODEM_ROBOT_SPAWN="$NEODEM_ROBOT_SPAWN" "$PY" - <<'PYEOF' 2>&1
import sys
sys.path.insert(0, "isaac_scenes")
from common_scene.factory_pauseroom_layout import robot_spawn
s = robot_spawn()
print(f"{s['name']} at ({s['pos'][0]:.2f}, {s['pos'][1]:.2f}, {s['pos'][2]:.2f}) yaw {s['yaw_deg']:.0f}")
PYEOF
  )" || die "NEODEM_ROBOT_SPAWN='$NEODEM_ROBOT_SPAWN' was refused by the scene:
     $SPAWN_DESC"
  echo "ok    spawn override: $SPAWN_DESC"
else
  echo "ok    spawn: the authored pose (NEODEM_ROBOT_SPAWN unset)"
fi
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
# `num_predict: 1` because the point is to RESIDENT the weights, not to hear back.
# Without it this call generates until the model stops on its own, and a reasoning
# model does not stop quickly: on the CPU-pinned planner variant that is minutes of
# chain-of-thought at ~9 tok/s, spent before Isaac has even been asked to start,
# and it looks exactly like a hang.
curl -sf localhost:11434/api/generate \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"ready\",\"stream\":false,\"keep_alive\":-1,\"options\":{\"num_predict\":1}}" \
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

MANIP_ARGS=()
if [ "$ENABLE_MANIP" = "1" ]; then
  say "5. manipulation bridge (arms + hands) + command inlet :$MANIP_PORT"
  # --serve is what makes this process reachable by a VLA rollout. Without it the only
  # producers are in-process, so the bridge sits holding the rest pose while the agent
  # POSTs joint dicts at the sidecar's /action -- a real-robot path that cannot serve
  # this rig at all. Loopback only, which is the bridge's own default: this port moves
  # a robot's arms.
  setsid nohup "$PY" -u isaac_manip_bridge.py --domain "$DOMAIN" --iface "$IFACE" \
    --serve "$MANIP_PORT" \
    >"$LOGDIR/manip_bridge.log" 2>&1 </dev/null &
  MANIP_PID=$!
  disown "$MANIP_PID" 2>/dev/null || true
  sleep 2
  watch_pid "$MANIP_PID" "the manipulation bridge" "$LOGDIR/manip_bridge.log"

  # A LIVE PID IS NOT A REACHABLE INLET. watch_pid above proves the process did not
  # refuse its arguments; it says nothing about whether the HTTP server bound. If it
  # did not, the facade proxies every /action into a closed port and the rollout fails
  # at frame 1 -- after Isaac has taken ten minutes to boot. This runs BEFORE that, so
  # a verdict here is cheap and a verdict later is not.
  #
  # /health answers 503 when the publish thread is dead, so `curl -sf` is the whole
  # check: 2xx means bound AND publishing.
  MANIP_UP=0
  for i in $(seq 1 20); do
    if curl -sf -m 2 -o /dev/null "http://localhost:$MANIP_PORT/health"; then
      MANIP_UP=1; break
    fi
    sleep 1
  done
  if [ "$MANIP_UP" = "1" ]; then
    echo "ok   the manipulation inlet answers /health on :$MANIP_PORT"
    MANIP_ARGS=(--manip-url "http://localhost:$MANIP_PORT")
  else
    tail -30 "$LOGDIR/manip_bridge.log" >&2 2>/dev/null || true
    die "the manipulation bridge is running but nothing answers http://localhost:$MANIP_PORT/health after 20 s -- a VLA rollout would have no way to move the arms. See $LOGDIR/manip_bridge.log."
  fi
else
  say "5. manipulation bridge SKIPPED (ENABLE_MANIP=0)"
  # No --manip-url either. With no bridge to route to, POST /action falls through to
  # the sidecar and gets its honest 403 (G1_READ_ONLY), which is a far better answer
  # than a 503 from a port nothing is listening on.
fi

say "5b. pre-seed the camera shared memory (the image server loses a race without it)"
# The vendor image server binds its ZMQ publishers lazily, inside publish(), which it only
# reaches once a frame exists. Its per-camera thread reads the ring buffer ONCE at startup
# and, finding it empty, sets a SHARED stop event and breaks -- killing all three cameras for
# the life of the process while :60000 keeps answering config queries perfectly. Measured on
# this box: that read happened 1.74 s before Isaac's own writer created the shared memory.
#
# Seeding a valid placeholder frame first makes that read succeed. Isaac overwrites the same
# segments seconds later, so the placeholder is never what anything sees.
#
# It must run HERE: after the stale sweep has removed any old container (leftover segments are
# root-owned and this user cannot unlink them) and before the sim starts writing.
if [ "${SKIP_CAMERA_SEED:-0}" = "1" ]; then
  echo "SKIPPED (SKIP_CAMERA_SEED=1) -- expect no camera frames"
else
  "$HW/seed_camera_shm.py" || die "could not seed the camera shared memory -- Agent Mode would
     be blind for the whole run. Re-run with SKIP_CAMERA_SEED=1 to proceed deliberately blind."
fi

# NEODEM_LOG_EVERY has to be forwarded EXPLICITLY, like NEODEM_FILM_DIR above. The sim runs
# inside the container, so a shell variable set in front of this script reaches this script and
# not the process that reads it -- and the failure is silent, because the default of 25 is a
# perfectly working value. It sets BOTH the [TASK-203]/[TASK-223] log interval and, since the
# film camera writes inside the same gate, the film's frame rate: frames per second of
# simulated time = sim rate / NEODEM_LOG_EVERY. At the default and this rig's ~13-16 Hz that is
# under 1 fps, which is a slideshow rather than footage. 3 is a reasonable filming value; 5 is
# what TASK-203 asks for when measuring gait, because 25 ALIASES the ~1.7 Hz step cadence.
say "6. Isaac, in docker (Vulkan needs a seat; the host user does not have one)"
setsid nohup docker run --rm --name "$CONTAINER" --user 0 --runtime=nvidia --gpus all \
  -e ACCEPT_EULA=Y -e OMNI_KIT_ACCEPT_EULA=YES -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e HOME=/home/humanoid -e PYTHONPATH= \
  -e CYCLONEDDS_HOME="$CHECKOUTS/cyclonedds/install" \
  ${NEODEM_FILM_DIR:+-e NEODEM_FILM_DIR="$NEODEM_FILM_DIR"} \
  ${NEODEM_LOG_EVERY:+-e NEODEM_LOG_EVERY="$NEODEM_LOG_EVERY"} \
  ${NEODEM_ROBOT_SPAWN:+-e NEODEM_ROBOT_SPAWN="$NEODEM_ROBOT_SPAWN"} \
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

# A FIFTH FATAL, AND THE ONLY ONE THAT IS NOT AN EXCEPTION.
#
# The vendor image server binds its ZMQ publisher lazily, inside publish(), which is only
# reached once a frame exists (image_server.py:1366). Its per-camera thread reads the ring
# buffer once at startup and, if it is empty, logs this line, sets a SHARED stop event and
# breaks (image_server.py:1368-1370) -- killing the frame threads for all three cameras. The
# ports then never bind for the life of the process.
#
# Measured here: the read happened 1.74 s before Isaac's own writer created the shared memory.
# One line, once, and the cameras are dead for the whole run -- while port 60000 keeps
# answering config queries perfectly, so every other signal still looks healthy.
ISAAC_CAMERA_RACE='Image Server\].*returned no frame'

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
  if grep -qE "$ISAAC_CAMERA_RACE" "$LOGDIR/isaac.log" 2>/dev/null; then
    die "the image server lost its startup race -- it read an empty frame buffer before
     Isaac had written one, and has shut down every camera thread. Ports 55555/6/7 will
     never bind and Agent Mode would be blind for this whole run. seed_camera_shm.py
     exists to prevent exactly this; check that it ran and that /dev/shm holds three
     921728-byte isaac_*_image_shm segments BEFORE the container starts.
     See $LOGDIR/isaac.log"
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

# THE BANNER IS NOT THE GATE. "Image server has started, waiting for client connections"
# is printed BEFORE the per-camera threads read a frame -- 2 s before the race above was
# lost, in the run that found this. Waiting for it therefore proves only that the server
# object was constructed. What actually matters is whether the PUBLISHER BOUND, and that is
# observable: publish() is what calls bind(), so a listening 55555 means a frame was
# genuinely published at least once.
echo "waiting for the head camera's ZMQ publisher to bind (the banner does not prove this)"
ZMQ_BOUND=0
for i in $(seq 1 30); do
  if ss -ltn 2>/dev/null | grep -qE ':55555\b'; then ZMQ_BOUND=1; break; fi
  if grep -qE "$ISAAC_CAMERA_RACE" "$LOGDIR/isaac.log" 2>/dev/null; then break; fi
  sleep 2
done
if [ "$ZMQ_BOUND" = "1" ]; then
  echo "ok   55555 is bound -- at least one real frame has been published"
else
  echo "WARNING: nothing is listening on 55555 after 60 s. The image server binds that port"
  echo "         only when it publishes its first frame, so this means no frame has ever been"
  echo "         published. The run can continue -- locomotion does not need cameras -- but"
  echo "         look and scan_room will 503 and Agent Mode will be blind."
fi

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
# ${MANIP_ARGS[@]+...} is the empty-array-under-`set -u` idiom used everywhere else in
# this script: with ENABLE_MANIP=0 the array is empty and the flag is simply absent.
setsid nohup "$PY" -u isaac_camera_facade.py --serve 8779 \
  --sidecar-url http://localhost:8777 ${MANIP_ARGS[@]+"${MANIP_ARGS[@]}"} \
  --scene "$TASK_ID" --max-age "$CAM_MAX_AGE" \
  --max-content-age "$CAM_MAX_CONTENT_AGE" \
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

# --- the OTHER half of a rollout: does it get an observation? ---------------------
#
# Non-fatal, and reported here rather than at step 5 because rt/lowstate only starts
# flowing once Isaac is stepping, which is minutes after the bridge starts.
#
# This asks the facade, not the bridge, so it proves the whole path the agent takes:
# HARDWARE_SIDECAR_URL -> :8779 -> :$MANIP_PORT -> rt/lowstate + rt/dex3/*/state. A
# 200 here means getStateNow() gets measured joints. Anything else means it gets 43
# zeros, silently -- the sidecar's own /state/fast answers `{"joints": []}` with a
# 200 because its state source is a TCP link to a real G1 that is not on this box,
# and getStateNow() fills every joint it does not receive with 0.0.
if [ "$ENABLE_MANIP" = "1" ]; then
  STATE_JSON="$(curl -s -m 5 "http://localhost:8779/state/fast" 2>/dev/null || true)"
  STATE_CODE="$(curl -s -m 5 -o /dev/null -w '%{http_code}' \
    "http://localhost:8779/state/fast" 2>/dev/null || echo 000)"
  if [ "$STATE_CODE" = "200" ]; then
    STATE_COUNT="$(printf '%s' "$STATE_JSON" | grep -o '"count": *[0-9]*' | head -1)"
    echo "joint state OK: /state/fast answered 200 -- ${STATE_COUNT:-count ?} of 43"
    if ! printf '%s' "$STATE_JSON" | grep -q '"complete": *true'; then
      echo "     WARNING: incomplete -- $(printf '%s' "$STATE_JSON" \
             | grep -o '"missing": *\[[^]]*\]')"
      echo "     Those joints are ABSENT from the reply (never fabricated as 0.0), but"
      echo "     getStateNow() fills every joint it does not receive with 0.0, so the"
      echo "     policy sees zeros there. http://localhost:$MANIP_PORT/health has the"
      echo "     per-source ages."
    fi
  else
    echo
    echo "NO JOINT STATE (HTTP $STATE_CODE from /state/fast). A VLA rollout would run"
    echo "on a 43-zero observation, which is not a rollout. Check that Isaac is"
    echo "stepping and that the manipulation bridge is on DDS domain $DOMAIN:"
    echo "  curl -s http://localhost:$MANIP_PORT/health | python3 -m json.tool"
    echo "and look at the 'state.sources' block -- it names each topic and its age."
  fi
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
