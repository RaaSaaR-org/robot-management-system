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
LOGDIR="${LOGDIR:-$HOME/factory-mission-logs/$(date +%Y%m%d-%H%M%S)}"
ENABLE_MANIP="${ENABLE_MANIP:-1}"

mkdir -p "$LOGDIR"
say() { printf '\n=== %s ===\n' "$*"; }
die() { printf '\nFATAL: %s\n' "$*" >&2; exit 1; }

# Domain 0 is the real robot. rt/lowcmd on domain 0 is a live G1's full-body
# low-level bus and this stack writes zeros into its leg slots.
[ "$DOMAIN" = "0" ] && die "domain 0 is the real robot -- refusing"

say "0. preconditions"
[ -x "$PY" ]        || die "no sim python at $PY"
[ -d "$SIM_DIR" ]   || die "no unitree_sim_isaaclab at $SIM_DIR"
[ -d "$SIM_DIR/tasks/g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody" ] \
  || die "the factory task is not installed into the checkout -- run install first"
command -v docker >/dev/null || die "docker missing"

say "1. clear the wire"
# The bracket trick keeps pkill from matching this script's own command line.
docker rm -f neodem-factory >/dev/null 2>&1 || true
for p in "[s]im_main.py" "[i]saac_loco_bridge.py" "[i]saac_manip_bridge.py" \
         "[i]saac_camera_facade.py" "[g]1_sidecar.py" "[s]im_node.py"; do
  pkill -f "$p" >/dev/null 2>&1 || true
done
sleep 2

say "2. the GPU must be ours"
# Isaac needs roughly 10 GB and the planner another 6. Someone else's benchmark
# run has been found on this box mid-flight before; refusing is much cheaper
# than discovering it as an out-of-memory crash twenty minutes in.
FREE=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1)
echo "free VRAM: ${FREE} MiB (need ${MIN_FREE_MB})"
[ "$FREE" -ge "$MIN_FREE_MB" ] || die "only ${FREE} MiB free -- something else is using the GPU. Check nvidia-smi before killing anything."

say "3. pin the planner model BEFORE Isaac takes its memory"
curl -sf localhost:11434/api/generate \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"ready\",\"stream\":false,\"keep_alive\":-1}" \
  >/dev/null || die "ollama did not answer -- is it running, and is $MODEL pulled?"
echo "pinned $MODEL resident"

export CYCLONEDDS_HOME="$CHECKOUTS/cyclonedds/install"
export OMNI_KIT_ACCEPT_EULA=YES

say "4. locomotion bridge (answers the sport RPC; publishes odom)"
cd "$HW"
setsid nohup "$PY" -u isaac_loco_bridge.py --domain "$DOMAIN" --iface "$IFACE" \
  --publish-odom >"$LOGDIR/loco_bridge.log" 2>&1 </dev/null & disown
sleep 2

if [ "$ENABLE_MANIP" = "1" ]; then
  say "5. manipulation bridge (arms + hands)"
  setsid nohup "$PY" -u isaac_manip_bridge.py --domain "$DOMAIN" --iface "$IFACE" \
    >"$LOGDIR/manip_bridge.log" 2>&1 </dev/null & disown
  sleep 1
else
  say "5. manipulation bridge SKIPPED (ENABLE_MANIP=0)"
fi

say "6. Isaac, in docker (Vulkan needs a seat; the host user does not have one)"
setsid nohup docker run --rm --name neodem-factory --user 0 --runtime=nvidia --gpus all \
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
  >"$LOGDIR/isaac.log" 2>&1 </dev/null & disown

echo "waiting for Isaac to build the scene (this takes a while on a cold shader cache)"
for i in $(seq 1 180); do
  grep -qiE 'image server has started|Image Server' "$LOGDIR/isaac.log" 2>/dev/null && break
  grep -qiE 'Traceback|FATAL|Error executing' "$LOGDIR/isaac.log" 2>/dev/null && \
    { tail -30 "$LOGDIR/isaac.log"; die "Isaac failed to start -- see $LOGDIR/isaac.log"; }
  sleep 5
done

say "7. sidecar (DDS speaker) :8777"
cd "$HW"
G1_SIDECAR_PORT=8777 G1_READ_ONLY=1 G1_LOCO_ENABLED=1 \
G1_ROBOT_ID=sim-robot-g1-edu G1_NET_INTERFACE="$IFACE" \
G1_LIDAR_DDS_DOMAIN="$DOMAIN" G1_LIDAR_DDS_IFACE="$IFACE" \
  setsid nohup "$PY" -u g1_sidecar.py >"$LOGDIR/sidecar.log" 2>&1 </dev/null & disown
sleep 3

say "8. camera facade :8779 (serves /cameras/*, proxies the rest to 8777)"
setsid nohup "$PY" -u isaac_camera_facade.py --serve 8779 \
  --sidecar-url http://localhost:8777 --scene "$TASK_ID" \
  >"$LOGDIR/camera_facade.log" 2>&1 </dev/null & disown

echo "waiting for a real camera frame"
FRAME_OK=0
for i in $(seq 1 60); do
  if curl -sf -m 3 http://localhost:8779/health 2>/dev/null | grep -q '"connected": *true'; then
    FRAME_OK=1; break
  fi
  sleep 2
done

say "STATUS"
curl -s -m 5 http://localhost:8779/health 2>/dev/null | head -c 900; echo
if [ "$FRAME_OK" != "1" ]; then
  echo
  echo "NO CAMERA FRAME. Agent Mode will be blind -- look and scan_room will 503."
  echo "This is the open question this rig exists to answer: whether the factory"
  echo "scene publishes on ZMQ at all. Check $LOGDIR/isaac.log for an image-server"
  echo "banner, and $LOGDIR/camera_facade.log for which ports it tried."
fi

cat <<TXT

logs:      $LOGDIR
teardown:  docker rm -f neodem-factory
           pkill -f '[i]saac_loco_bridge.py'; pkill -f '[i]saac_manip_bridge.py'
           pkill -f '[i]saac_camera_facade.py'; pkill -f '[g]1_sidecar.py'

The agent is NOT started here -- start it against the facade:
  cd $REPO/robot-agent && PATH=$NODE_BIN:\$PATH \\
    HARDWARE_SIDECAR_URL=http://localhost:8779 AGENT_MODE_ENABLED=true \\
    AGENT_PLANNER_MODEL=$MODEL AGENT_VISION_MODEL=$MODEL \\
    npm run dev:g1-edu-agent
TXT
