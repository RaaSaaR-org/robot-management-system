/**
 * @file heroEngine.ts
 * @description Real hardware dissolves into shared pixels and reforms across embodiments.
 * @feature landing
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  HERO_EMBODIMENTS,
  getHeroSequence,
  type HeroEngine,
} from './heroEmbodiments';

// Three r160 includes this method; its matching DefinitelyTyped package omits it.
declare module 'three/examples/jsm/math/MeshSurfaceSampler.js' {
  interface MeshSurfaceSampler {
    setRandomGenerator(random: () => number): this;
  }
}

// Compensate for ACES at exposure 0.95 so the canvas blends into CSS #080f18.
const BACKGROUND = 0x1a222c;

export function createHeroEngine(
  host: HTMLDivElement,
  onReady: () => void,
  onLost: () => void,
  onEmbodiment: (index: number) => void,
): HeroEngine {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: 'low-power',
  });
  const compact = window.matchMedia('(max-width: 900px)').matches;
  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, compact ? 1.25 : 1.75),
  );
  renderer.setClearColor(BACKGROUND, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.FogExp2(BACKGROUND, 0.038);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  const world = new THREE.Group();
  scene.add(world);
  const twin = new THREE.Group();
  world.add(twin);

  function createEnvironment() {
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    return target;
  }
  let environment = createEnvironment();
  scene.environment = environment.texture;
  scene.add(new THREE.HemisphereLight(0xc3f7ec, 0x17263d, 1.3));
  const key = new THREE.DirectionalLight(0xe1f5ff, 2.3);
  key.position.set(2, 5, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x73f1d4, 2.0);
  rim.position.set(-4, 2, -1);
  scene.add(rim);
  const blue = new THREE.DirectionalLight(0x7297ed, 1.6);
  blue.position.set(3, 1, -3);
  scene.add(blue);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.45, 1.05);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);

  const atmosphere = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 8),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vUv;
      void main() { vec2 p = vUv - 0.5; float glow = exp(-dot(p, p) * 15.0);
        gl_FragColor = vec4(0.025, 0.115, 0.10, glow * 0.28); }`,
    }),
  );
  atmosphere.position.set(0, 0.3, -3);
  scene.add(atmosphere);

  const uniforms = {
    uTime: { value: 0 },
    uMorph: { value: 0 },
    uDissolve: { value: 0 },
    uResolve: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  };
  const mint = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#a5fce0').multiplyScalar(1.8),
  });
  const subdued = new THREE.MeshBasicMaterial({
    color: '#497d7c',
    transparent: true,
    opacity: 0.38,
  });
  const lineMaterial = new THREE.LineBasicMaterial({
    color: '#77c0b7',
    transparent: true,
    opacity: 0.27,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#142b35',
    metalness: 0.8,
    roughness: 0.35,
  });
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  function ring(
    parent: THREE.Object3D,
    radius: number,
    width: number,
    material: THREE.Material,
    arc = Math.PI * 2,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(radius, width, 6, 180, arc),
      material,
    );
    parent.add(mesh);
    return mesh;
  }
  function dot(
    parent: THREE.Object3D,
    radius: number,
    material: THREE.Material = mint,
  ) {
    const mesh = new THREE.Mesh(sphere, material);
    mesh.scale.setScalar(radius);
    parent.add(mesh);
    return mesh;
  }
  function line(points: THREE.Vector3[], material = lineMaterial) {
    const path = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      material,
    );
    world.add(path);
    return path;
  }

  // A precise, interrupted halo frames the twin; its three paths echo the brand atom.
  const halo = new THREE.Group();
  halo.position.set(0, 0.12, -0.65);
  halo.rotation.set(0.08, -0.16, -0.16);
  world.add(halo);
  ring(halo, 2.56, 0.007, subdued);
  ring(halo, 2.62, 0.009, mint, Math.PI * 0.76).rotation.z = 0.12;
  ring(halo, 2.62, 0.008, subdued, Math.PI * 0.68).rotation.z = Math.PI * 1.16;
  for (let i = 0; i < 84; i++) {
    const angle = (i / 84) * Math.PI * 2;
    const tick = new THREE.Mesh(unitBox, subdued);
    tick.position.set(Math.cos(angle) * 2.73, Math.sin(angle) * 2.73, 0);
    tick.scale.set(i % 7 === 0 ? 0.065 : 0.025, 0.006, 0.006);
    tick.rotation.z = angle;
    halo.add(tick);
  }
  const haloSignal = dot(halo, 0.032);

  // Grounded hardware over a circular, instrument-like platform.
  const base = new THREE.Group();
  base.position.y = -2.13;
  world.add(base);
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 1.78, 0.09, 96),
    dark,
  );
  base.add(pedestal);
  for (const radius of [1.72, 1.86, 2.18, 2.23, 3.1]) {
    const orbit = ring(
      base,
      radius,
      radius === 1.72 ? 0.009 : 0.004,
      radius === 1.72 ? mint : subdued,
    );
    orbit.rotation.x = Math.PI / 2;
    orbit.position.y = 0.055;
  }
  const sweep = ring(base, 2.2, 0.012, mint, Math.PI * 0.23);
  sweep.rotation.x = Math.PI / 2;
  sweep.position.y = 0.065;
  const grid = new THREE.GridHelper(32, 64, 0x294748, 0x18303c);
  grid.position.y = -2.22;
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  scene.add(grid);

  // Data routes connect the world, model and machine. Packets travel in both directions.
  const paths = [-1, 1].flatMap((side) =>
    [0, 1, 2].map((row) => {
      const start = new THREE.Vector3(
        side * (2.6 + row * 0.33),
        -1.8 + row * 0.83,
        -0.2,
      );
      const end = new THREE.Vector3(side * 0.46, -0.1 + row * 0.56, 0);
      const curve = new THREE.CubicBezierCurve3(
        start,
        new THREE.Vector3(side * 1.9, start.y, 0.5),
        new THREE.Vector3(side * 1.8, end.y, 0.5),
        end,
      );
      line(curve.getPoints(64));
      const terminal = ring(world, 0.055, 0.008, subdued);
      terminal.position.copy(start);
      return { curve, signal: dot(world, 0.023), reverse: side > 0 };
    }),
  );

  // A seeded field avoids a new composition each mount and runs entirely on the GPU.
  let seed = 42;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const dust = new Float32Array(360 * 3);
  for (let i = 0; i < dust.length; i += 3) {
    dust[i] = (random() - 0.5) * 12;
    dust[i + 1] = (random() - 0.5) * 7;
    dust[i + 2] = -1 - random() * 5;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const field = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: '#92c6c0',
      size: 0.018,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
  );
  scene.add(field);

  let loaded = false;
  let announced = false;
  let disposed = false;
  let contextLost = false;
  let visible = true;
  let elapsed = 0;
  let activePair = -1;
  let activeEmbodiment = -1;
  let frame = 0;
  let last = 0;
  let lastDraw = 0;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = new THREE.Vector2();
  const smoothedPointer = new THREE.Vector2();
  const abort = new AbortController();

  function release(root: THREE.Object3D) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse((object) => {
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
  }

  interface Embodiment {
    index: number;
    model: THREE.Group;
    samples: THREE.BufferAttribute;
    dissolve: { value: number };
  }
  const embodiments: Embodiment[] = [];
  const particleGeometry = new THREE.BufferGeometry();
  const particleCount = compact ? 8500 : 16000;
  const particleSeeds = Float32Array.from({ length: particleCount }, random);
  particleGeometry.setAttribute(
    'aSeed',
    new THREE.BufferAttribute(particleSeeds, 1),
  );

  // The same voxel threshold drives the solid surface and its released pixels.
  const dissolveShader = `
    float cellThreshold(vec3 p) {
      vec3 cell = floor(p * 14.0);
      float noise = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      return clamp((0.5 - p.y * 0.17) * 0.68 + noise * 0.32, 0.025, 0.975);
    }
  `;
  const pixels = new THREE.Points(
    particleGeometry,
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
      uniform float uTime; uniform float uMorph; uniform float uDissolve;
      uniform float uResolve; uniform float uPixelRatio;
      attribute vec3 aTarget; attribute float aSeed;
      varying float vAlpha; varying float vSeed;
      ${dissolveShader}
      void main() {
        vSeed = aSeed;
        // Slight staggering keeps the silhouette travelling in a wave.
        float t = smoothstep(aSeed * 0.16, 0.84 + aSeed * 0.16, uMorph);
        float flight = sin(t * 3.14159265);
        vec3 p = mix(position, aTarget, t);
        float angle = aSeed * 62.83185 + t * 3.14159265;
        p += vec3(cos(angle) * 0.65, sin(aSeed * 43.0) * 0.3, sin(angle) * 0.5) * flight;
        // Pixels lift off the surface before moving and settle into the next one.
        float lift = sin(uDissolve * 3.14159265) + sin(uResolve * 3.14159265);
        p += vec3(sin(aSeed * 41.0), cos(aSeed * 67.0), sin(aSeed * 29.0)) * lift * 0.035;
        vec3 sourceWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 targetWorld = (modelMatrix * vec4(aTarget, 1.0)).xyz;
        float released = smoothstep(cellThreshold(sourceWorld) - 0.035, cellThreshold(sourceWorld) + 0.035, uDissolve);
        float remaining = smoothstep(cellThreshold(targetWorld) - 0.035, cellThreshold(targetWorld) + 0.035, 1.0 - uResolve);
        vAlpha = released * remaining * (0.55 + aSeed * 0.45);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((1.25 + aSeed * 1.25 + flight * 0.55) * uPixelRatio * (9.0 / -mv.z), 1.0, 5.0);
      }
    `,
      fragmentShader: `
      varying float vAlpha; varying float vSeed;
      void main() {
        if (vAlpha < 0.01) discard;
        // Crisp square pixels, with a restrained bright center.
        vec2 edge = abs(gl_PointCoord - 0.5);
        float core = 1.0 - smoothstep(0.23, 0.49, max(edge.x, edge.y));
        vec3 color = mix(vec3(0.12, 0.47, 0.43), vec3(0.48, 0.92, 0.75), vSeed);
        gl_FragColor = vec4(color * (1.0 + core * 0.15), vAlpha * (0.6 + core * 0.4));
      }
    `,
    }),
  );
  pixels.frustumCulled = false;
  pixels.visible = false;
  twin.add(pixels);

  function prepareModel(model: THREE.Group, index: number): Embodiment {
    if (index === 0) {
      model.position.y = -2.075;
      model.rotation.y = -0.28;
    }
    model.updateWorldMatrix(true, true);
    const dissolve = { value: 0 };
    const surfaces: {
      geometry: THREE.BufferGeometry;
      sampler: MeshSurfaceSampler;
      area: number;
    }[] = [];
    let totalArea = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // Sample in the same final exhibit coordinates for all three shapes.
      // Meshopt uses normalized integer attributes. Expand to floats before
      // baking transforms, otherwise positions outside [-1, 1] get clamped.
      const source = object.geometry.getAttribute('position');
      const coordinates = new Float32Array(source.count * 3);
      for (let i = 0; i < source.count; i++) {
        a.fromBufferAttribute(source, i)
          .applyMatrix4(object.matrixWorld)
          .toArray(coordinates, i * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(coordinates, 3),
      );
      geometry.setIndex(object.geometry.getIndex()?.clone() ?? null);
      const positions = geometry.getAttribute('position');
      const indices = geometry.getIndex();
      const count = indices?.count ?? positions.count;
      let area = 0;
      for (let i = 0; i < count; i += 3) {
        a.fromBufferAttribute(positions, indices ? indices.getX(i) : i);
        b.fromBufferAttribute(positions, indices ? indices.getX(i + 1) : i + 1);
        c.fromBufferAttribute(positions, indices ? indices.getX(i + 2) : i + 2);
        area += b.sub(a).cross(c.sub(a)).length() * 0.5;
      }
      if (area > 0) {
        totalArea += area;
        const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry, dark))
          .setRandomGenerator(random)
          .build();
        surfaces.push({ geometry, sampler, area: totalArea });
      } else {
        geometry.dispose();
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material: THREE.MeshStandardMaterial) => {
        material.envMapIntensity = 0.65;
        material.onBeforeCompile = (shader) => {
          shader.uniforms.uDissolve = dissolve;
          shader.vertexShader =
            `varying vec3 vHeroPosition;\n${shader.vertexShader}`.replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nvHeroPosition = (modelMatrix * vec4(position, 1.0)).xyz;',
            );
          shader.fragmentShader =
            `varying vec3 vHeroPosition;\nuniform float uDissolve;\n${dissolveShader}\n${shader.fragmentShader}`
              .replace(
                '#include <clipping_planes_fragment>',
                `#include <clipping_planes_fragment>
              float threshold = cellThreshold(vHeroPosition);
              if (threshold < uDissolve) discard;`,
              )
              .replace(
                '#include <opaque_fragment>',
                `
              float edge = (1.0 - smoothstep(0.0, 0.065, threshold - uDissolve)) * step(0.001, uDissolve);
              outgoingLight += vec3(0.18, 0.9, 0.66) * edge * 0.8;
              #include <opaque_fragment>`,
              );
        };
      });
    });
    const samples: THREE.Vector3[] = [];
    for (let i = 0; i < particleCount; i++) {
      const weight = random() * totalArea;
      const surface = surfaces.find((entry) => entry.area >= weight)!;
      const point = new THREE.Vector3();
      surface.sampler.sample(point);
      samples.push(point);
    }
    surfaces.forEach(({ geometry }) => geometry.dispose());
    // Spatial correspondence makes a body reshape coherently instead of
    // cross-fading two unrelated particle clouds. Every pixel has a destination.
    const order = (point: THREE.Vector3) =>
      Math.floor((point.y + 3) * 12) * 4096 +
      Math.floor((point.x + 3) * 12) * 64 +
      point.z;
    samples.sort((left, right) => order(left) - order(right));
    const positions = new Float32Array(particleCount * 3);
    samples.forEach((point, i) => point.toArray(positions, i * 3));
    model.visible = false;
    twin.add(model);
    return {
      index,
      model,
      samples: new THREE.BufferAttribute(positions, 3),
      dissolve,
    };
  }

  // Keep successful models if an individual optional embodiment fails to load.
  void Promise.allSettled(
    HERO_EMBODIMENTS.map(async ({ asset }, index) => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}assets/landing/${asset}`,
        { signal: abort.signal },
      );
      if (!response.ok) throw new Error('Digital twin unavailable');
      const { scene: model } = await new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(await response.arrayBuffer(), '');
      if (disposed) {
        release(model);
        return null;
      }
      try {
        return prepareModel(model, index);
      } catch (error) {
        release(model);
        throw error;
      }
    }),
  ).then((results) => {
    if (disposed) return;
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value)
        embodiments.push(result.value);
    }
    if (!embodiments.length) {
      onLost();
      controller.dispose();
      return;
    }
    loaded = true;
    refresh();
  });

  function render(now: number) {
    frame = 0;
    if (disposed || contextLost) return;
    const animate = !motion.matches;
    // Bound GPU work on mobile and high-refresh displays.
    if (animate && now - lastDraw < 1000 / (compact ? 30 : 45)) {
      frame = requestAnimationFrame(render);
      return;
    }
    // Cap a single step so a stall cannot skip a phase, but keep wall-clock
    // pace on slow renderers (software GL, low-end phones) instead of playing
    // the cycle in slow motion. refresh() already zeroes it after a pause.
    const delta = last ? Math.min((now - last) / 1000, 0.25) : 0;
    last = now;
    lastDraw = now;
    if (animate && loaded) elapsed += delta;
    uniforms.uTime.value = elapsed;
    if (loaded) {
      const sequence = getHeroSequence(elapsed, embodiments.length);
      const from = embodiments[sequence.from];
      const to = embodiments[sequence.to];
      if (activePair !== sequence.from) {
        activePair = sequence.from;
        particleGeometry.setAttribute('position', from.samples);
        particleGeometry.setAttribute('aTarget', to.samples);
      }
      const transitioning = embodiments.length > 1;
      uniforms.uDissolve.value = transitioning ? sequence.dissolve : 0;
      uniforms.uMorph.value = sequence.morph;
      uniforms.uResolve.value = sequence.resolve;
      pixels.visible = transitioning && sequence.dissolve > 0;
      embodiments.forEach(({ model }) => {
        model.visible = false;
      });
      from.model.visible = !transitioning || sequence.dissolve < 1;
      from.dissolve.value = uniforms.uDissolve.value;
      if (transitioning && sequence.resolve > 0) {
        to.model.visible = true;
        to.dissolve.value = 1 - sequence.resolve;
      }
      const aerial = THREE.MathUtils.lerp(
        from.index === 1 ? 1 : 0,
        to.index === 1 ? 1 : 0,
        sequence.morph,
      );
      twin.position.y = Math.sin(elapsed * 1.3) * 0.055 * aerial;
      const current =
        sequence.morph >= 0.5 && transitioning ? to.index : from.index;
      if (current !== activeEmbodiment) {
        activeEmbodiment = current;
        onEmbodiment(current);
      }
    }
    smoothedPointer.lerp(pointer, 1 - Math.exp(-3 * delta));
    world.rotation.y = motion.matches ? 0 : smoothedPointer.x * 0.12;
    world.rotation.x = motion.matches ? 0 : smoothedPointer.y * 0.035;
    twin.rotation.y = Math.sin(elapsed * 0.22) * 0.055;
    haloSignal.position.set(
      Math.cos(elapsed * 0.18 + 0.4) * 2.62,
      Math.sin(elapsed * 0.18 + 0.4) * 2.62,
      0,
    );
    sweep.rotation.z = elapsed * 0.18;
    field.rotation.y = elapsed * 0.008;
    paths.forEach(({ curve, signal, reverse }, index) => {
      const progress = (elapsed * 0.14 + index / paths.length) % 1;
      signal.position.copy(curve.getPoint(reverse ? 1 - progress : progress));
    });
    composer.render();
    if (loaded && !announced) {
      announced = true;
      onReady();
    }
    if (visible && !document.hidden && animate)
      frame = requestAnimationFrame(render);
  }
  function refresh() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    lastDraw = 0;
    if (loaded && visible && !document.hidden && !contextLost && !disposed)
      frame = requestAnimationFrame(render);
  }
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.position.set(0, 1.25, camera.aspect < 1 ? 11.8 : 10.7);
    camera.lookAt(0, -0.05, 0);
    camera.updateProjectionMatrix();
    refresh();
  }
  function move(event: PointerEvent) {
    if (event.pointerType === 'touch' || motion.matches) return;
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
    announced = false;
    cancelAnimationFrame(frame);
    onLost();
  }
  function restored() {
    // PMREM is a GPU-generated texture; rebuild it after the context is restored.
    environment.dispose();
    environment = createEnvironment();
    scene.environment = environment.texture;
    contextLost = false;
    refresh();
  }
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    refresh();
  });
  observer.observe(host);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const section = host.closest('section');
  section?.addEventListener('pointermove', move);
  section?.addEventListener('pointerleave', leave);
  motion.addEventListener('change', refresh);
  document.addEventListener('visibilitychange', refresh);
  renderer.domElement.addEventListener('webglcontextlost', lost);
  renderer.domElement.addEventListener('webglcontextrestored', restored);
  resize();

  const controller: HeroEngine = {
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      section?.removeEventListener('pointermove', move);
      section?.removeEventListener('pointerleave', leave);
      motion.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.domElement.removeEventListener('webglcontextrestored', restored);
      release(scene);
      // Some shared materials can be unused after a failed model request.
      mint.dispose();
      subdued.dispose();
      dark.dispose();
      lineMaterial.dispose();
      environment.dispose();
      bloom.dispose();
      output.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  return controller;
}
