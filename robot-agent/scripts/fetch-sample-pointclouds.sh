#!/usr/bin/env bash
#
# fetch-sample-pointclouds.sh — download REAL LiDAR recordings for the G1
# perception replay source. These are genuine sensor scans (not synthetic);
# point the agent at one to see the Perception tab render real data:
#
#   POINTCLOUD_REPLAY_FILE=robot-agent/data/pointclouds-real/unitree-mid360.pcd npm run dev:g1
#   # or a whole directory (cycles through frames):
#   POINTCLOUD_REPLAY_DIR=robot-agent/data/pointclouds-real npm run dev:g1
#
# The files are gitignored (a few MB); run this once after cloning.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)/data/pointclouds-real"
mkdir -p "$DIR"

# Real Unitree LiDAR frame (same vendor as the G1's MID-360) — x y z intensity ring time.
UNITREE="https://raw.githubusercontent.com/Croquembouche/DAVOS_SIM/master/Rule-Based/Perception/examples/unitreelidar/output_point_cloud.pcd"
# Real KITTI Velodyne HDL-64E scan — outdoor scene, float32 x,y,z,intensity.
KITTI="https://raw.githubusercontent.com/kuixu/kitti_object_vis/master/data/object/training/velodyne/000000.bin"

echo "Downloading real Unitree LiDAR frame…"
curl -fsSL "$UNITREE" -o "$DIR/unitree-mid360.pcd"
echo "Downloading real KITTI Velodyne scan…"
curl -fsSL "$KITTI" -o "$DIR/kitti-000000.bin"

echo "Done. Recordings in: $DIR"
ls -la "$DIR"
