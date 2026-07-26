#!/usr/bin/env bash
# Build a working venv for sim_g1_dds. See README.md for why each step exists.
#
#   ./setup.sh [target-dir]        default: .venv next to this script
#
# Afterwards:
#   export CYCLONEDDS_HOME="$PWD/.cyclonedds"
#   .venv/bin/python sim_node.py --domain 1 --http-port 8777
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${1:-$HERE/.venv}"
CDDS_SRC="$HERE/.cyclonedds-src"
CDDS_HOME="$HERE/.cyclonedds"
CDDS_TAG="releases/0.10.x"

# Gotcha 2: the cyclonedds 0.10.2 Python binding pinned by unitree_sdk2py does
# not compile against Python 3.13 (_Py_IsFinalizing was removed). 3.12 only.
PY="${PYTHON:-python3.12}"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "error: $PY not found. Install Python 3.12 (3.13 will NOT work — see README gotcha 2)." >&2
  exit 1
fi

# Gotcha 1: no CycloneDDS wheels for macOS — build the C library from source.
if [ ! -d "$CDDS_HOME" ]; then
  echo "==> building CycloneDDS C library ($CDDS_TAG)"
  [ -d "$CDDS_SRC" ] || git clone -b "$CDDS_TAG" --depth 1 \
    https://github.com/eclipse-cyclonedds/cyclonedds.git "$CDDS_SRC"
  "$PY" -m pip install --quiet --user cmake ninja
  cmake -S "$CDDS_SRC" -B "$CDDS_SRC/build" -G Ninja \
    -DCMAKE_INSTALL_PREFIX="$CDDS_HOME" -DBUILD_EXAMPLES=OFF -DBUILD_TESTING=OFF
  cmake --build "$CDDS_SRC/build" --target install
fi
export CYCLONEDDS_HOME="$CDDS_HOME"

echo "==> creating venv at $VENV"
"$PY" -m venv "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet \
  "cyclonedds==0.10.2" mujoco numpy pillow pytest
"$VENV/bin/python" -m pip install --quiet \
  "git+https://github.com/unitreerobotics/unitree_sdk2_python.git"

# Gotcha 3: mjpython (the live viewer on macOS) cannot find libpython on a
# uv-managed or framework-less Python. Symlink it in if we can work out where
# it lives; harmless when the viewer is never used.
if [ "$(uname)" = "Darwin" ]; then
  MJAPP="$VENV/lib/python3.12/site-packages/mujoco/MuJoCo_(mjpython).app/Contents/lib"
  LIBPY="$("$VENV/bin/python" -c 'import sysconfig,os;
p=sysconfig.get_config_var("LIBDIR") or ""
f=os.path.join(p,"libpython3.12.dylib")
print(f if os.path.exists(f) else "")')"
  if [ -n "$LIBPY" ] && [ -d "$MJAPP" ] && [ ! -e "$MJAPP/libpython3.12.dylib" ]; then
    ln -s "$LIBPY" "$MJAPP/libpython3.12.dylib"
    echo "==> linked libpython3.12.dylib into the mjpython app bundle"
  fi
fi

echo
echo "done. Next:"
echo "  export CYCLONEDDS_HOME=\"$CDDS_HOME\""
echo "  $VENV/bin/python -m pytest $HERE/test_loco_state.py -q"
echo "  $VENV/bin/python $HERE/sim_node.py --domain 1 --http-port 8777"
echo
echo "Reminder (README gotcha 4): clients must use the SAME interface —"
echo "  ChannelFactoryInitialize(1, 'lo0')"
