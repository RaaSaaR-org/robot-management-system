#!/usr/bin/env bash
# Install this directory's Isaac scene into the unitree_sim_isaaclab checkout.
#
# WHY THIS EXISTS. README.md has always carried an "Install map" table and the copying was
# done by hand. That worked exactly until the scene changed twice in one day: the checkout
# was left holding a pre-door snapshot -- `mdp/pause_door.py` and `pause_room_door.usda`
# absent entirely, three other files stale -- while every offline verifier passed against
# the repo. The verifiers check the SOURCE. Isaac loads the COPY. Nothing compared them, so
# a live run would have silently exercised the previous day's scene and the door would
# simply never have appeared.
#
# So: the table below is the install map, in executable form, and `--check` makes the drift
# a failure instead of a surprise. `factory_mission_bringup.sh` calls `--check` at step 0.
#
#   install_into_checkout.sh            copy anything out of date, then verify
#   install_into_checkout.sh --check    exit 1 if anything is out of date; copy nothing
#   install_into_checkout.sh --force    copy everything even if it compares equal
#
# TWO THINGS IT WILL NOT DO
#   1. It never writes a path that is not in FILES below. The checkout is vendor code under
#      a read-only policy; the only files we own in it are the ones we authored, and they
#      are enumerated by hand rather than globbed so that a new file in this directory
#      cannot quietly acquire the right to land in someone else's tree.
#   2. It never installs a stale door. `pause_room_door.usda` is GENERATED from
#      factory_pauseroom_layout.py, so a layout edit without a regenerate leaves a USD that
#      disagrees with the constants every other check is written against. The generator's
#      own --check runs first and refuses.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CHECKOUTS="${CHECKOUTS:-$HOME/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts}"
SIM_DIR="${SIM_DIR:-$CHECKOUTS/unitree_sim_isaaclab}"
DEST="$SIM_DIR/tasks"
PY="${PYTHON:-python3}"

MODE=install
case "${1:-}" in
  --check) MODE=check ;;
  --force) MODE=force ;;
  "")      MODE=install ;;
  *) echo "usage: $(basename "$0") [--check|--force]" >&2; exit 2 ;;
esac

die() { echo "== ABORT: $*" >&2; exit 1; }

# The install map, exactly as README.md's table states it: "<source here>|<path under tasks/>".
# g1_tasks/__init__.py is a FULL-FILE REPLACEMENT of a vendor file -- it is ours only because
# it carries one added import. It is listed last so that a diff on it stands out in the log.
FILES=(
  "common_scene/factory_pauseroom_layout.py|common_scene/factory_pauseroom_layout.py"
  "common_scene/base_scene_factory_pauseroom.py|common_scene/base_scene_factory_pauseroom.py"
  "common_scene/pause_room_door.usda|common_scene/pause_room_door.usda"
  "common_scene/make_pause_room_door_usda.py|common_scene/make_pause_room_door_usda.py"
  "g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/__init__.py|g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/__init__.py"
  "g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/factory_pause_room_g1_29dof_dex3_hw_env_cfg.py|g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/factory_pause_room_g1_29dof_dex3_hw_env_cfg.py"
  "g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/__init__.py|g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/__init__.py"
  "g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/observations.py|g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/observations.py"
  "g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/pause_door.py|g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/pause_door.py"
  "g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/rewards.py|g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/rewards.py"
  "g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/terminations.py|g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/terminations.py"
  "g1_tasks/__init__.py|g1_tasks/__init__.py"
)

[ -d "$SIM_DIR" ] || die "no unitree_sim_isaaclab at $SIM_DIR (set SIM_DIR or CHECKOUTS)"
[ -d "$DEST" ]    || die "$SIM_DIR has no tasks/ -- is that really the sim checkout?"

# --- the door USD must agree with the layout constants before anything is copied ----------
GEN="$HERE/common_scene/make_pause_room_door_usda.py"
if [ -f "$GEN" ]; then
  if ! (cd "$HERE/common_scene" && "$PY" make_pause_room_door_usda.py --check >/dev/null 2>&1); then
    die "pause_room_door.usda is out of date with factory_pauseroom_layout.py.
     The door's geometry is GENERATED from those constants, so installing now would put a
     door in the scene that disagrees with every number the verifiers check. Run:
       cd $HERE/common_scene && $PY make_pause_room_door_usda.py"
  fi
  echo "ok    pause_room_door.usda agrees with the layout constants"
else
  echo "warn  no make_pause_room_door_usda.py -- cannot confirm the door USD is current"
fi

# --- compare -------------------------------------------------------------------------------
STALE=()
MISSING=()
for entry in "${FILES[@]}"; do
  src="$HERE/${entry%%|*}"
  dst="$DEST/${entry##*|}"
  [ -f "$src" ] || die "install map names a file that is not here: ${entry%%|*}"
  if [ ! -f "$dst" ]; then
    MISSING+=("$entry")
  elif ! cmp -s "$src" "$dst"; then
    STALE+=("$entry")
  fi
done

TOTAL=$(( ${#MISSING[@]} + ${#STALE[@]} ))

if [ "$TOTAL" -eq 0 ] && [ "$MODE" != "force" ]; then
  echo "ok    checkout is up to date -- all ${#FILES[@]} files match"
  exit 0
fi

for entry in ${MISSING[@]+"${MISSING[@]}"}; do
  printf '  ABSENT   %s\n' "${entry##*|}"
done
for entry in ${STALE[@]+"${STALE[@]}"}; do
  printf '  STALE    %-88s (%s changed lines)\n' "${entry##*|}" \
    "$({ diff "$HERE/${entry%%|*}" "$DEST/${entry##*|}" 2>/dev/null || true; } | grep -c '^[<>]')"
done

if [ "$MODE" = "check" ]; then
  die "$TOTAL of ${#FILES[@]} scene files in the checkout are absent or stale.
     Isaac loads the CHECKOUT, not this repo, so a run started now would exercise a
     DIFFERENT SCENE from the one every offline verifier just passed against. Run:
       $HERE/$(basename "$0")"
fi

# --- copy ------------------------------------------------------------------------------------
COPIED=0
for entry in "${FILES[@]}"; do
  src="$HERE/${entry%%|*}"
  dst="$DEST/${entry##*|}"
  if [ "$MODE" = "force" ] || [ ! -f "$dst" ] || ! cmp -s "$src" "$dst"; then
    mkdir -p "$(dirname "$dst")"
    cp -f "$src" "$dst"
    COPIED=$(( COPIED + 1 ))
    printf '  installed %s\n' "${entry##*|}"
  fi
done

# --- stale bytecode ---------------------------------------------------------------------------
# Isaac runs in docker as root and leaves root-owned __pycache__ directories behind in a tree
# this user otherwise owns. `rm -rf` on them fails, and the first version of this script
# swallowed that failure with `|| true` and then printed "ok" -- which is precisely the kind
# of quiet lie the whole script exists to stop.
#
# So: try, and then CHECK. Python invalidates a .pyc by comparing the source mtime it recorded
# against the source on disk, and a freshly copied file is newer than any earlier cache, so in
# the normal case there is nothing to do. The check is here for the case where that reasoning
# does not hold -- a clock skew, a preserved mtime, a `cp -p` added later -- because a .pyc
# from the previous scene shadowing the new one would present as the door simply not existing.
for entry in "${FILES[@]}"; do
  src_rel="${entry##*|}"
  case "$src_rel" in *.py) ;; *) continue ;; esac
  dst="$DEST/$src_rel"
  mod="$(basename "$dst" .py)"
  cache_dir="$(dirname "$dst")/__pycache__"
  [ -d "$cache_dir" ] || continue
  for pyc in "$cache_dir/$mod".*.pyc; do
    [ -e "$pyc" ] || continue
    rm -f "$pyc" 2>/dev/null || true
    if [ -e "$pyc" ] && [ ! "$dst" -nt "$pyc" ]; then
      die "stale bytecode shadows a file just installed, and it could not be removed:
       $pyc
     It is owned by $(stat -c %U "$pyc") and this user cannot remove it. (Isaac runs in
     docker as root, which is how root-owned caches appear in a tree you otherwise own.)
     Python would load it in preference to the source that was just copied, so the scene
     Isaac builds would not be the scene in this repo. Remove it and re-run:
       sudo rm -rf $cache_dir"
    fi
  done
done

# --- verify the copy, rather than trusting cp ------------------------------------------------
BAD=0
for entry in "${FILES[@]}"; do
  cmp -s "$HERE/${entry%%|*}" "$DEST/${entry##*|}" || { echo "  MISMATCH ${entry##*|}" >&2; BAD=1; }
done
[ "$BAD" -eq 0 ] || die "a file did not land identically -- check permissions on $DEST"

echo "ok    installed $COPIED file(s); all ${#FILES[@]} verified identical"
