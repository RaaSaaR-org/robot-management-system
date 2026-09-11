# Landing page digital twins

These optimized GLBs are visual illustrations of different embodiments, not
claims of tested hardware integrations. Poses and display scales are artistic.

- `g1-twin.glb`: generated from NeoDEM's existing Unitree G1 URDF/STL assets in
  `../robots/g1/`.
- `x500-twin.glb`: Holybro X500 / NXP development drone, BSD-3-Clause
  license (see `x500.LICENSE`).
- `go2-twin.glb`: Unitree Go2 model, BSD-3-Clause license (see
  `unitree_go2.LICENSE`).
- `hero-embodiments.webp`: static rendering of these three models.

The drone geometry is from [PX4 Gazebo Models](https://github.com/PX4/PX4-gazebo-models/tree/5577035667afb4b63fe1f966fb1a58bbb05d905b/models/x500_base),
revision `5577035667afb4b63fe1f966fb1a58bbb05d905b` (Rudis Laboratories).
The quadruped geometry is from [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/8161bba264d7fa7c99ca301e91e7fb44737676ad/unitree_go2),
revision `8161bba264d7fa7c99ca301e91e7fb44737676ad` (Unitree Robotics).
Modifications: simplified surfaces, standing pose for Go2, display orientation,
normal repair, PBR material conversion and GLB export. No runtime third-party
requests are made. The full license texts ship alongside the assets.

Regenerate all models with Python 3.10+ and `numpy scipy trimesh fast-simplification pillow pycollada`:

```sh
python scripts/build-hero-model.py
```

Geometry is compressed with glTF Transform 4.2.1 (via `npx`) and decoded with
Three.js's bundled Meshopt decoder. No runtime dependencies are added.

Source downloads are cached in the system temporary directory. The app build
uses the committed outputs and needs neither Python nor network access.
