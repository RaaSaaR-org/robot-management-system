# Supplies root (to bypass the seat0 /dev/dri ACL) plus the handful of system
# libraries Isaac's own .so files link against. Deliberately does NOT contain
# Isaac Sim: the host conda env `unitree_sim_env6` is bind-mounted and its
# python is what actually runs, so there is no second install to keep in sync.
# See README.md — `libgomp1` in particular fails with a misleading omni.usd error.
FROM nvidia/cuda:12.8.0-base-ubuntu24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 libxml2 libxt6 \
      libglu1-mesa libsm6 libice6 libglib2.0-0 \
      libxrandr2 libxinerama1 libxcursor1 libxi6 \
 && rm -rf /var/lib/apt/lists/*
