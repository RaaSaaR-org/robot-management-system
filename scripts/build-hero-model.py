#!/usr/bin/env python3
"""Build the landing humanoid, drone and quadruped digital twins.

Run with Python 3.10+ and numpy, scipy, trimesh, fast-simplification, pillow, pycollada in a venv:
    python scripts/build-hero-model.py

The posed GLBs are committed; Python is not needed to build the app.
Node/npx runs a pinned glTF Transform version for mesh compression.
This visual pose is artwork only and is never sent to a robot.
"""

from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
import trimesh


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "app/public/assets/robots/g1"
DESTINATION = ROOT / "app/public/assets/landing/g1-twin.glb"
robot = ET.parse(SOURCE / "g1.urdf").getroot()


def origin(element):
    result = np.eye(4)
    if element is not None:
        result = trimesh.transformations.euler_matrix(
            *map(float, element.get("rpy", "0 0 0").split()), axes="sxyz"
        )
        result[:3, 3] = list(map(float, element.get("xyz", "0 0 0").split()))
    return result


transforms = {"pelvis": np.eye(4)}
pending = list(robot.findall("joint"))
while pending:
    resolved = []
    for joint in pending:
        parent = joint.find("parent").get("link")
        if parent not in transforms:
            continue
        local = origin(joint.find("origin"))
        name = joint.get("name")
        angle = 0
        if "elbow_joint" in name:
            angle = 1.12
        elif "shoulder_pitch_joint" in name:
            angle = -0.12
        elif "shoulder_roll_joint" in name:
            angle = 0.08 if "left" in name else -0.08
        if angle:
            axis = list(map(float, joint.find("axis").get("xyz").split()))
            local = local @ trimesh.transformations.rotation_matrix(angle, axis)
        transforms[joint.find("child").get("link")] = transforms[parent] @ local
        resolved.append(joint)
    if not resolved:
        raise ValueError("Unresolved joints in G1 URDF")
    pending = [joint for joint in pending if joint not in resolved]

materials = {
    "white": trimesh.visual.material.PBRMaterial(
        name="titanium", baseColorFactor=[174, 193, 201, 255],
        metallicFactor=0.62, roughnessFactor=0.34,
    ),
    "dark": trimesh.visual.material.PBRMaterial(
        name="graphite", baseColorFactor=[24, 35, 42, 255],
        metallicFactor=0.35, roughnessFactor=0.42,
    ),
}
meshes = []
for link in robot.findall("link"):
    for visual in link.findall("visual"):
        source = visual.find("geometry/mesh")
        if source is None:
            continue
        mesh = trimesh.load(SOURCE / source.get("filename"), force="mesh")
        # Keep silhouette detail while reducing the multi-megabyte CAD surfaces.
        target = max(160, min(3200, len(mesh.faces) // 12))
        mesh = mesh.simplify_quadric_decimation(face_count=target)
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.remove_unreferenced_vertices()
        mesh.apply_transform(transforms[link.get("name")] @ origin(visual.find("origin")))
        material = visual.find("material")
        mesh.visual = trimesh.visual.TextureVisuals(
            material=materials.get(material.get("name") if material is not None else "dark", materials["dark"])
        )
        meshes.append((link.get("name"), mesh))

# URDF: Z up, X forward. Web scene: Y up, Z forward. Ground sits at Y=0.
basis = trimesh.transformations.rotation_matrix(-np.pi / 2, [0, 1, 0]) @ trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
for _, mesh in meshes:
    mesh.apply_transform(basis)
bounds = trimesh.util.concatenate([mesh for _, mesh in meshes]).bounds
center = (bounds[0] + bounds[1]) / 2
center[1] = bounds[0, 1]
scale = 4.1 / (bounds[1, 1] - bounds[0, 1])
scene = trimesh.Scene()
for name, mesh in meshes:
    mesh.apply_translation(-center)
    mesh.apply_scale(scale)
    # A zero normal from a collapsed CAD seam produces NaNs in PBR shading,
    # which can contaminate the entire bloom chain. Keep every normal valid.
    normals = mesh.vertex_normals.copy()
    normals[np.linalg.norm(normals, axis=1) < 0.5] = [0, 1, 0]
    mesh.vertex_normals = normals
    scene.add_geometry(mesh, node_name=name, geom_name=name)
DESTINATION.parent.mkdir(parents=True, exist_ok=True)
DESTINATION.write_bytes(scene.export(file_type="glb", include_normals=True))
print(f"{DESTINATION.relative_to(ROOT)}: {DESTINATION.stat().st_size / 1024:.0f} KiB, {sum(len(mesh.faces) for _, mesh in meshes):,} triangles")

# Additional embodiments come from a pinned, permissively licensed simulation
# source. Only visual geometry is downloaded; source meshes stay in a temp cache.
import tempfile
import urllib.request

MENAGERIE_REVISION = "8161bba264d7fa7c99ca301e91e7fb44737676ad"
MENAGERIE_URL = f"https://raw.githubusercontent.com/google-deepmind/mujoco_menagerie/{MENAGERIE_REVISION}"
CACHE = Path(tempfile.gettempdir()) / "neodem-hero-models" / MENAGERIE_REVISION
OUTPUT = DESTINATION.parent


def source_file(folder, name):
    path = CACHE / folder / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(f"{MENAGERIE_URL}/{folder}/{name}", timeout=60) as response:
            data = response.read()
        path.write_bytes(data)
    return path


def mjcf_transform(element):
    result = np.eye(4)
    if element.get("quat"):
        result = trimesh.transformations.quaternion_matrix(list(map(float, element.get("quat").split())))
    result[:3, 3] = list(map(float, element.get("pos", "0 0 0").split()))
    return result


def build_embodiment(folder, description, filename, quadruped):
    model = ET.parse(source_file(folder, description)).getroot()
    material_map = {}
    for material in model.findall("asset/material"):
        name = material.get("name")
        rgba = np.array(list(map(float, material.get("rgba").split())))
        # Preserve the source's component finishes, with readable dark plastics
        # under the hero's low-key studio lighting.
        rgba[:3] = np.maximum(rgba[:3], 0.085)
        metallic = 0.65 if any(part in name for part in ["metal", "gold", "chrome"]) else 0.18
        material_map[name] = trimesh.visual.material.PBRMaterial(
            name=name, baseColorFactor=np.round(rgba * 255).astype(np.uint8),
            metallicFactor=metallic, roughnessFactor=0.31 if metallic > 0.5 else 0.4,
        )
    asset_files = {Path(asset.get("file")).stem: asset.get("file") for asset in model.findall("asset/mesh")}
    mesh_cache = {}
    visual_meshes = []

    def body_meshes(body, parent):
        transform = parent @ mjcf_transform(body)
        for joint in body.findall("joint"):
            name = joint.get("name", "")
            # The Go2 source's relaxed standing pose, as in its home keyframe.
            angle = 0.9 if "thigh" in name else -1.8 if "calf" in name else 0
            if angle:
                transform = transform @ trimesh.transformations.rotation_matrix(angle, [0, 1, 0])
        for index, visual in enumerate(body.findall("geom")):
            if visual.get("class") != "visual" or visual.get("mesh") is None:
                continue
            name = visual.get("mesh")
            if name not in mesh_cache:
                mesh = trimesh.load(source_file(folder, f"assets/{asset_files[name]}"), force="mesh", process=True, skip_materials=True)
                # OBJ UV/normal seams duplicate vertices. Weld before decimating
                # so the reducer preserves shells instead of tearing them open.
                mesh.merge_vertices(merge_tex=True, merge_norm=True)
                if len(mesh.faces) > 2800 and not name.startswith("base_"):
                    mesh = mesh.simplify_quadric_decimation(face_count=max(800, min(5500, len(mesh.faces) // 5)), aggression=4)
                mesh.update_faces(mesh.nondegenerate_faces())
                mesh.remove_unreferenced_vertices()
                mesh = trimesh.graph.smooth_shade(mesh, angle=np.radians(45))
                mesh_cache[name] = mesh
            mesh = mesh_cache[name].copy()
            mesh.apply_transform(transform @ mjcf_transform(visual))
            mesh.visual = trimesh.visual.TextureVisuals(material=material_map[visual.get("material")])
            visual_meshes.append((f"{body.get('name')}_{name}_{index}", mesh))
        for child in body.findall("body"):
            body_meshes(child, transform)

    for body in model.findall("worldbody/body"):
        body_meshes(body, np.eye(4))
    orientation = trimesh.transformations.rotation_matrix(-0.92 if quadruped else 0.25, [0, 1, 0]) @ basis
    if not quadruped:
        orientation = trimesh.transformations.rotation_matrix(0.42, [1, 0, 0]) @ orientation
    for _, mesh in visual_meshes:
        mesh.apply_transform(orientation)
    bounds = trimesh.util.concatenate([mesh for _, mesh in visual_meshes]).bounds
    center = (bounds[0] + bounds[1]) / 2
    center[1] = bounds[0, 1] if quadruped else center[1]
    scale = (4.45 if quadruped else 4.65) / max((bounds[1] - bounds[0])[[0, 2]])
    scene = trimesh.Scene()
    for name, mesh in visual_meshes:
        mesh.apply_translation(-center)
        mesh.apply_scale(scale)
        # Export in final exhibit coordinates, shared by meshes and morph targets.
        mesh.apply_translation([0, -2.075 if quadruped else 0.15, 0])
        normals = mesh.vertex_normals.copy()
        normals[np.linalg.norm(normals, axis=1) < 0.5] = [0, 1, 0]
        mesh.vertex_normals = normals
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    destination = OUTPUT / filename
    destination.write_bytes(scene.export(file_type="glb", include_normals=True))
    (OUTPUT / f"{folder}.LICENSE").write_bytes(source_file(folder, "LICENSE").read_bytes())
    print(f"{destination.relative_to(ROOT)}: {destination.stat().st_size / 1024:.0f} KiB, {sum(len(mesh.faces) for _, mesh in visual_meshes):,} triangles")


PX4_REVISION = "5577035667afb4b63fe1f966fb1a58bbb05d905b"


def build_drone():
    base_url = f"https://raw.githubusercontent.com/PX4/PX4-gazebo-models/{PX4_REVISION}/models/x500_base"
    cache = Path(tempfile.gettempdir()) / "neodem-hero-x500" / PX4_REVISION

    def download(name):
        path = cache / name
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen(f"{base_url}/{name}", timeout=60) as response:
                path.write_bytes(response.read())
        return path

    def pose(text):
        values = list(map(float, (text or "0 0 0 0 0 0").split()))
        result = trimesh.transformations.euler_matrix(*values[3:], axes="sxyz")
        result[:3, 3] = values[:3]
        return result

    finishes = {
        "carbon": ([25, 34, 40, 255], 0.4, 0.38),
        "metal": ([155, 171, 180, 255], 0.75, 0.28),
        "rubber": ([7, 10, 13, 255], 0.05, 0.8),
        "plastic": ([48, 63, 72, 255], 0.22, 0.38),
        "motor": ([24, 32, 40, 255], 0.65, 0.28),
    }
    materials = {
        name: trimesh.visual.material.PBRMaterial(
            name=f"x500_{name}", baseColorFactor=color,
            metallicFactor=metallic, roughnessFactor=roughness,
        ) for name, (color, metallic, roughness) in finishes.items()
    }
    root = ET.parse(download("model.sdf")).getroot()
    parts = []
    for link in root.findall("model/link"):
        for visual in link.findall("visual"):
            geometry = visual.find("geometry/mesh")
            if geometry is None:
                continue
            filename = geometry.findtext("uri").replace("model://x500_base/", "")
            source = trimesh.load(download(filename), force="scene")
            transform = pose(link.findtext("pose")) @ pose(visual.findtext("pose"))
            scale = list(map(float, geometry.findtext("scale", "1 1 1").split()))
            for node in source.graph.nodes_geometry:
                matrix, name = source.graph[node]
                mesh = source.geometry[name].copy()
                mesh.apply_transform(matrix)
                mesh.merge_vertices(merge_tex=True, merge_norm=True)
                if len(mesh.faces) > 1800:
                    mesh = mesh.simplify_quadric_decimation(face_count=max(900, min(4500, len(mesh.faces) // 8)))
                mesh.update_faces(mesh.nondegenerate_faces())
                mesh.remove_unreferenced_vertices()
                mesh.apply_scale(scale)
                mesh.apply_transform(transform)
                lower = name.lower()
                finish = "rubber" if "rubber" in lower or "foam" in lower else "metal" if "metal" in lower else "carbon" if "carbon" in lower or "prop" in filename else "plastic"
                if "5010" in filename:
                    finish = "motor"
                mesh.visual = trimesh.visual.TextureVisuals(material=materials[finish])
                parts.append((f"{visual.get('name')}_{name}", mesh))
    orientation = trimesh.transformations.rotation_matrix(0.32, [1, 0, 0]) @ trimesh.transformations.rotation_matrix(0.38, [0, 1, 0]) @ basis
    for _, mesh in parts:
        mesh.apply_transform(orientation)
    bounds = trimesh.util.concatenate([mesh for _, mesh in parts]).bounds
    center = (bounds[0] + bounds[1]) / 2
    scale = 4.7 / max((bounds[1] - bounds[0])[[0, 2]])
    scene = trimesh.Scene()
    for name, mesh in parts:
        mesh.apply_translation(-center)
        mesh.apply_scale(scale)
        mesh.apply_translation([0, 0.15, 0])
        normals = mesh.vertex_normals.copy()
        normals[np.linalg.norm(normals, axis=1) < 0.5] = [0, 1, 0]
        mesh.vertex_normals = normals
        scene.add_geometry(mesh, node_name=name, geom_name=name)
    destination = OUTPUT / "x500-twin.glb"
    destination.write_bytes(scene.export(file_type="glb", include_normals=True))
    (OUTPUT / "x500.LICENSE").write_bytes(download("LICENSE").read_bytes())
    print(f"{destination.relative_to(ROOT)}: {destination.stat().st_size / 1024:.0f} KiB, {sum(len(mesh.faces) for _, mesh in parts):,} triangles")


build_drone()

build_embodiment("unitree_go2", "go2.xml", "go2-twin.glb", True)
(OUTPUT / "README.md").write_text(f"""# Landing page digital twins

These optimized GLBs are visual illustrations of different embodiments, not
claims of tested hardware integrations. Poses and display scales are artistic.

- `g1-twin.glb`: generated from NeoDEM's existing Unitree G1 URDF/STL assets in
  `../robots/g1/`.
- `x500-twin.glb`: Holybro X500 / NXP development drone, BSD-3-Clause
  license (see `x500.LICENSE`).
- `go2-twin.glb`: Unitree Go2 model, BSD-3-Clause license (see
  `unitree_go2.LICENSE`).
- `hero-embodiments.webp`: static rendering of these three models.

The drone geometry is from [PX4 Gazebo Models](https://github.com/PX4/PX4-gazebo-models/tree/{PX4_REVISION}/models/x500_base),
revision `{PX4_REVISION}` (Rudis Laboratories).
The quadruped geometry is from [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/{MENAGERIE_REVISION}/unitree_go2),
revision `{MENAGERIE_REVISION}` (Unitree Robotics).
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
""")

# Preserve surface detail while reducing both download size and draw calls.
# Use a pinned CLI; its packages live in npm's cache, not app dependencies.
import subprocess
for filename in ["g1-twin.glb", "x500-twin.glb", "go2-twin.glb"]:
    asset = OUTPUT / filename
    with tempfile.TemporaryDirectory(prefix="neodem-hero-compress-") as temporary:
        compressed = Path(temporary) / filename
        subprocess.run([
            "npx", "--yes", "@gltf-transform/cli@4.2.1", "optimize",
            str(asset), str(compressed), "--compress", "meshopt",
            "--simplify", "false", "--palette", "false",
            "--instance", "false", "--texture-compress", "false",
        ], check=True)
        asset.write_bytes(compressed.read_bytes())
