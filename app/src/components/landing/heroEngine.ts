/**
 * @file heroEngine.ts
 * @description Procedural CPU atom and multi-embodiment fleet; no external models or textures.
 * @feature landing
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export function createHeroEngine(
  host: HTMLDivElement,
  onReady: () => void,
  onLost: () => void,
) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch {
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x080f18, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080f18);
  scene.fog = new THREE.FogExp2(0x080f18, 0.035);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 90);
  camera.position.set(0, 3.7, 13.5);
  camera.lookAt(0, 0, 0);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 0.85);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);
  const world = new THREE.Group();
  world.rotation.set(0.12, -0.32, -0.12);
  scene.add(world);
  scene.add(new THREE.HemisphereLight(0xd7fff3, 0x172f4c, 2.8));
  const key = new THREE.DirectionalLight(0xe5fff6, 5);
  key.position.set(-3, 7, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x648bff, 4);
  rim.position.set(4, 0, -3);
  scene.add(rim);

  const metal = new THREE.MeshStandardMaterial({
    color: 0x819aab,
    metalness: 0.75,
    roughness: 0.28,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x162a39,
    metalness: 0.7,
    roughness: 0.32,
  });
  const mint = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xb2f8df).multiplyScalar(1.4),
  });
  const dim = new THREE.MeshBasicMaterial({
    color: 0x528d88,
    transparent: true,
    opacity: 0.42,
  });
  const boxGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.09);
  const sphereGeometry = new THREE.SphereGeometry(1, 12, 8);
  function box(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    mat: THREE.Material = metal,
  ) {
    const mesh = new THREE.Mesh(boxGeometry, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }
  function ball(
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    r: number,
    mat: THREE.Material = mint,
  ) {
    const mesh = new THREE.Mesh(sphereGeometry, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(r);
    parent.add(mesh);
    return mesh;
  }
  function ring(
    parent: THREE.Object3D,
    radius: number,
    width: number,
    mat: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, width, 6, 160),
      mat,
    );
    parent.add(mesh);
    return mesh;
  }
  // An architectural chip stack echoes the CPU at the center of the NeoDEM atom.
  const core = new THREE.Group();
  world.add(core);
  core.rotation.set(0.22, 0.15, 0);
  box(core, 0, 0, 0, 1.5, 0.22, 1.5, dark);
  box(core, 0, 0.14, 0, 1.28, 0.08, 1.28, mint);
  box(core, 0, 0.23, 0, 1.16, 0.12, 1.16, metal);
  box(core, 0, 0.33, 0, 0.8, 0.1, 0.8, dark);
  box(core, 0, 0.39, 0, 0.58, 0.025, 0.58, mint);
  for (let i = 0; i < 8; i++) {
    const offset = (i - 3.5) * 0.16;
    for (const sign of [-1, 1]) {
      box(core, offset, -0.02, sign * 0.85, 0.06, 0.06, 0.24);
      box(core, sign * 0.85, -0.02, offset, 0.24, 0.06, 0.06);
    }
  }
  // Fine surface traces keep the core engineered rather than fantastical.
  for (let i = 0; i < 5; i++) {
    box(core, (i - 2) * 0.11, 0.409, 0, 0.012, 0.005, 0.46, dark);
  }
  const orbits = [-0.85, 0.85, 0].map((tilt, i) => {
    const group = new THREE.Group();
    group.rotation.set(0.65, tilt, i === 2 ? Math.PI / 2 : 0);
    world.add(group);
    ring(group, 2.05 + i * 0.12, 0.014, i === 2 ? dim : mint);
    ring(group, 2.11 + i * 0.12, 0.004, dim);
    const signal = ball(group, 0, 0, 0, 0.055);
    return { group, signal, radius: 2.05 + i * 0.12 };
  });
  const base = new THREE.Group();
  base.position.y = -1.65;
  world.add(base);
  for (const radius of [2.9, 3.12, 3.9, 4.0]) {
    ring(base, radius, 0.006, dim).rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const tick = box(
      base,
      Math.cos(a) * 3.9,
      0,
      Math.sin(a) * 3.9,
      i % 8 === 0 ? 0.16 : 0.06,
      0.012,
      0.014,
      dim,
    );
    tick.rotation.y = -a;
  }
  const grid = new THREE.GridHelper(50, 70, 0x254a50, 0x172b39);
  grid.position.y = -2.0;
  scene.add(grid);
  grid.material.transparent = true;
  grid.material.opacity = 0.28;

  const drones: THREE.Object3D[] = [];
  function robot(
    kind: "humanoid" | "drone" | "dog" | "rover",
    x: number,
    y: number,
    z: number,
  ) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = -0.35;
    world.add(group);
    if (kind === "humanoid") {
      box(group, 0, 0.68, 0, 0.32, 0.42, 0.2);
      box(group, 0, 1.04, 0, 0.23, 0.22, 0.22);
      box(group, 0, 1.06, 0.116, 0.17, 0.05, 0.018, mint);
      box(group, 0, 0.41, 0, 0.27, 0.13, 0.18, dark);
      for (const sign of [-1, 1]) {
        ball(group, sign * 0.23, 0.81, 0, 0.075, dark);
        box(group, sign * 0.26, 0.62, 0, 0.09, 0.27, 0.1);
        ball(group, sign * 0.26, 0.46, 0, 0.055, dark);
        box(group, sign * 0.26, 0.33, 0.025, 0.08, 0.22, 0.1);
        box(group, sign * 0.09, 0.2, 0, 0.105, 0.28, 0.13);
        ball(group, sign * 0.09, 0.035, 0, 0.065, dark);
        box(group, sign * 0.09, -0.13, 0, 0.095, 0.25, 0.12);
        box(group, sign * 0.09, -0.29, 0.045, 0.13, 0.07, 0.24, dark);
      }
    } else if (kind === "drone") {
      box(group, 0, 0, 0, 0.36, 0.15, 0.35, dark);
      box(group, 0, 0.09, 0, 0.23, 0.06, 0.2);
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          const arm = box(group, a * 0.22, 0, b * 0.22, 0.5, 0.04, 0.06);
          arm.rotation.y = (-a * b * Math.PI) / 4;
          const rotor = ring(group, 0.21, 0.015, metal);
          rotor.rotation.x = Math.PI / 2;
          rotor.position.set(a * 0.4, 0.05, b * 0.4);
          const blade = box(
            group,
            a * 0.4,
            0.06,
            b * 0.4,
            0.36,
            0.012,
            0.025,
            mint,
          );
          drones.push(blade);
        }
      ball(group, 0, -0.08, 0.16, 0.055);
    } else if (kind === "dog") {
      box(group, 0, 0.36, 0, 0.7, 0.23, 0.3);
      box(group, 0.4, 0.4, 0, 0.18, 0.2, 0.27, dark);
      box(group, 0.5, 0.43, 0, 0.015, 0.05, 0.19, mint);
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          ball(group, a * 0.25, 0.31, b * 0.19, 0.07, dark);
          const thigh = box(group, a * 0.21, 0.16, b * 0.19, 0.08, 0.26, 0.08);
          thigh.rotation.z = -0.35;
          const calf = box(
            group,
            a * 0.2,
            -0.07,
            b * 0.19,
            0.065,
            0.24,
            0.065,
            dark,
          );
          calf.rotation.z = 0.3;
          ball(group, a * 0.16, -0.2, b * 0.19, 0.045, metal);
        }
    } else {
      box(group, 0, 0.05, 0, 0.65, 0.22, 0.48, dark);
      box(group, 0, 0.2, 0, 0.48, 0.1, 0.36);
      box(group, 0, 0.33, 0, 0.12, 0.2, 0.12);
      box(group, 0, 0.45, 0, 0.25, 0.09, 0.18, mint);
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          const wheel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.14, 0.09, 16),
            metal,
          );
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(a * 0.22, -0.04, b * 0.27);
          group.add(wheel);
        }
    }
    return group;
  }
  robot("humanoid", -2.95, -0.4, 0.4);
  const second = robot("humanoid", -3.35, -0.48, -0.1);
  second.scale.setScalar(0.8);
  const third = robot("humanoid", -2.65, -0.48, -0.4);
  third.scale.setScalar(0.8);
  const drone = robot("drone", 2.7, 1.65, -0.3);
  robot("dog", 2.95, -0.95, 1.1);
  robot("rover", -1.85, -1.25, 2.4);
  const paths = [
    new THREE.Vector3(-2.95, -0.5, 0.4),
    new THREE.Vector3(2.7, 1.65, -0.3),
    new THREE.Vector3(2.95, -0.95, 1.1),
    new THREE.Vector3(-1.85, -1.25, 2.4),
  ].map((end) => {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, -0.1, 0),
      new THREE.Vector3(end.x * 0.7, end.y + 0.7, end.z * 0.7),
      end,
    );
    world.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
        new THREE.LineBasicMaterial({
          color: 0x6ba79e,
          transparent: true,
          opacity: 0.35,
        }),
      ),
    );
    return { curve, signal: ball(world, 0, 0, 0, 0.035, mint) };
  });
  // A sparse, deterministic point field provides depth without a starfield effect.
  const positions = new Float32Array(180 * 3);
  for (let i = 0; i < 180; i++) {
    positions[i * 3] = Math.sin(i * 127.1) * 11;
    positions[i * 3 + 1] = Math.cos(i * 63.7) * 5;
    positions[i * 3 + 2] = -4 - (i % 13) * 0.6;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(positions, 3),
  );
  scene.add(
    new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: 0x80b4b8,
        size: 0.025,
        transparent: true,
        opacity: 0.5,
      }),
    ),
  );

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true;
  let contextLost = false;
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  const pointer = new THREE.Vector2();
  const render = (now: number) => {
    frame = 0;
    if (contextLost) return;
    const delta = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    if (!motion.matches) elapsed += delta;
    const t = elapsed;
    world.rotation.y =
      -0.32 +
      (motion.matches ? 0 : Math.sin(t * 0.14) * 0.08 + pointer.x * 0.07);
    world.rotation.x = 0.12 + (motion.matches ? 0 : pointer.y * 0.035);
    core.position.y = Math.sin(t * 0.8) * 0.075;
    drone.position.y = 1.65 + Math.sin(t * 1.2) * 0.12;
    drones.forEach((blade) => {
      blade.rotation.y = t * 5;
    });
    orbits.forEach(({ group, signal, radius }, i) => {
      group.rotation.z =
        (i === 2 ? Math.PI / 2 : 0) + t * (i === 1 ? -0.025 : 0.035);
      signal.position.set(
        Math.cos(t * 0.45 + i * 2) * radius,
        Math.sin(t * 0.45 + i * 2) * radius,
        0,
      );
    });
    paths.forEach(({ curve, signal }, i) => {
      signal.position.copy(curve.getPoint((t * 0.16 + i * 0.25) % 1));
    });
    composer.render();
    if (visible && !document.hidden && !motion.matches)
      frame = requestAnimationFrame(render);
  };
  function refresh() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    if (visible && !document.hidden && !contextLost)
      frame = requestAnimationFrame(render);
  }
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height);
    composer.setSize(width, height);
    camera.aspect = width / Math.max(height, 1);
    camera.position.z = camera.aspect < 1.2 ? 17.5 : 13.5;
    camera.updateProjectionMatrix();
    refresh();
  }
  function move(event: PointerEvent) {
    const bounds = host.getBoundingClientRect();
    pointer.set(
      THREE.MathUtils.clamp(
        (event.clientX - bounds.left) / bounds.width - 0.5,
        -0.5,
        0.5,
      ),
      THREE.MathUtils.clamp(
        (event.clientY - bounds.top) / bounds.height - 0.5,
        -0.5,
        0.5,
      ),
    );
  }
  function leave() {
    pointer.set(0, 0);
  }
  function lost(event: Event) {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frame);
    onLost();
  }
  function restored() {
    contextLost = false;
    onReady();
    refresh();
  }
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    refresh();
  });
  observer.observe(host);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  motion.addEventListener("change", refresh);
  document.addEventListener("visibilitychange", refresh);
  const section = host.closest("section");
  section?.addEventListener("pointermove", move);
  section?.addEventListener("pointerleave", leave);
  renderer.domElement.addEventListener("webglcontextlost", lost);
  renderer.domElement.addEventListener("webglcontextrestored", restored);
  resize();
  onReady();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    resizeObserver.disconnect();
    motion.removeEventListener("change", refresh);
    document.removeEventListener("visibilitychange", refresh);
    section?.removeEventListener("pointermove", move);
    section?.removeEventListener("pointerleave", leave);
    renderer.domElement.removeEventListener("webglcontextlost", lost);
    renderer.domElement.removeEventListener("webglcontextrestored", restored);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>([metal, dark, mint, dim]);
    scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Line ||
        object instanceof THREE.Points
      ) {
        geometries.add(object.geometry);
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((material) => materials.add(material));
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    bloom.dispose();
    output.dispose();
    composer.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}
