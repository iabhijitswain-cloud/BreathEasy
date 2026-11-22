import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Eye, Wind, ShieldCheck } from 'lucide-react';

export interface AirQuality3DProps {
  pm25: number;
  windKmh: number;
  roomSealed: boolean;
  purifierActive: boolean;
  commuteMode: 'metro' | 'car_ac' | 'auto_rickshaw' | 'walk';
  onToggleSeal: () => void;
  onTogglePurifier: () => void;
}

type CameraPreset = 'overview' | 'saferoom' | 'street' | 'horizon';

const PRESET_VIEWS: Record<
  CameraPreset,
  { pos: [number, number, number]; target: [number, number, number]; label: string }
> = {
  overview: { pos: [10.5, 6.8, 11.2], target: [0.2, 1.4, 0], label: 'Overview' },
  saferoom: { pos: [3.8, 2.7, 4.6], target: [-0.8, 1.3, -0.4], label: 'Safe Room' },
  street: { pos: [7.6, 2.4, 7.8], target: [2.8, 0.9, 2.8], label: 'Roadside' },
  horizon: { pos: [0.5, 11.0, 14.5], target: [0, 1.8, 0], label: 'Inversion Lid' },
};

// Reusable scratch math objects (zero GC allocations in animation loop)
const _vec3 = new THREE.Vector3();
const _targetVec = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scaleVec = new THREE.Vector3();

function createProceduralRoadTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#333b3a';
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 4500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 42 + Math.floor(Math.random() * 26);
    ctx.fillStyle = `rgb(${v},${v + 4},${v + 3})`;
    ctx.fillRect(x, y, 2, 2);
  }
  // Dashed lane divider
  ctx.fillStyle = '#e5c158';
  for (let y = 20; y < 512; y += 72) {
    ctx.fillRect(250, y, 12, 38);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function createProceduralTileTexture(maxAniso: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e9e2d5';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#cfc5b4';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(256, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(12, 18, 17, 0.55)');
  grad.addColorStop(0.6, 'rgba(12, 18, 17, 0.18)');
  grad.addColorStop(1, 'rgba(12, 18, 17, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const AirQuality3DScene: React.FC<AirQuality3DProps> = ({
  pm25,
  windKmh,
  roomSealed,
  purifierActive,
  commuteMode,
  onToggleSeal,
  onTogglePurifier,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [preset, setPreset] = useState<CameraPreset>('overview');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  const liveStateRef = useRef({
    pm25,
    windKmh,
    roomSealed,
    purifierActive,
    commuteMode,
    preset,
    presetTransitionActive: false,
  });

  useEffect(() => {
    liveStateRef.current.pm25 = pm25;
    liveStateRef.current.windKmh = windKmh;
    liveStateRef.current.roomSealed = roomSealed;
    liveStateRef.current.purifierActive = purifierActive;
    liveStateRef.current.commuteMode = commuteMode;
  }, [pm25, windKmh, roomSealed, purifierActive, commuteMode]);

  const selectPreset = (next: CameraPreset) => {
    setPreset(next);
    liveStateRef.current.preset = next;
    liveStateRef.current.presetTransitionActive = true;
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Detect Software WebGL cleanly via GPU renderer string
    const isSoftwareGl = (() => {
      try {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('3D WebGL preview is unavailable on this device.');
      return;
    }

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || 520;

    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglError('3D context temporarily suspended.');
    };
    const handleContextRestored = () => {
      setWebglError(null);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    const initialBg = new THREE.Color(0xc9d4cf);
    scene.background = initialBg;
    const fog = new THREE.FogExp2(0xc9d4cf, 0.022);
    scene.fog = fog;

    // Mandatory studio environment map for metallic & glass PBR reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 120);
    camera.position.set(...PRESET_VIEWS.overview.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 3.5;
    controls.maxDistance = 24;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.target.set(...PRESET_VIEWS.overview.target);
    controls.addEventListener('start', () => {
      liveStateRef.current.presetTransitionActive = false;
    });

    // Warm Key + Cool Hemisphere Fill + Rim Light (<= 3 shadow casters)
    const hemi = new THREE.HemisphereLight(0xcfe4ec, 0x73695c, 0.72);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.55);
    keyLight.position.set(11, 14, 9);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 36;
    const d = 11;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x9bd7d1, 0.45);
    rimLight.position.set(-9, 6, -8);
    scene.add(rimLight);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const roadTex = createProceduralRoadTexture(maxAniso);
    const tileTex = createProceduralTileTexture(maxAniso);
    const shadowTex = createContactShadowTexture();

    // Extended Horizon Ground (no floating rectangular box void)
    const terrainGeo = new THREE.PlaneGeometry(110, 110);
    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0xaab0a4,
      roughness: 0.92,
      metalness: 0.02,
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    scene.add(terrain);

    // Street Corridor Roadway (y = 0.02 offset to prevent Z-fighting)
    const roadGeo = new THREE.PlaneGeometry(4.6, 56);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTex,
      roughness: 0.86,
      metalness: 0.04,
    });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.set(3.8, 0.02, 0);
    road.receiveShadow = true;
    scene.add(road);

    // =========================================================================
    // 1. COMPOSITE 8-PART HOUSEHOLD & SAFE ROOM CUTAWAY (THREE.Group, y=0)
    // =========================================================================
    const houseGroup = new THREE.Group();
    houseGroup.position.set(-1.3, 0, -0.4);

    // Contact shadow plane
    const houseShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(6.8, 5.8),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.42,
      }),
    );
    houseShadow.rotation.x = -Math.PI / 2;
    houseShadow.position.y = 0.015;
    houseGroup.add(houseShadow);

    // Part 1: Concrete Plinth Foundation
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x797d78,
      roughness: 0.88,
      metalness: 0.05,
    });
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.3, 4.4), plinthMat);
    plinth.position.y = 0.15;
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    houseGroup.add(plinth);

    // Part 2: Tiled Bedroom Floor (offset +0.02 above plinth top)
    const floorTile = new THREE.Mesh(
      new THREE.BoxGeometry(5.1, 0.05, 4.1),
      new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.55, metalness: 0.05 }),
    );
    floorTile.position.y = 0.325;
    floorTile.receiveShadow = true;
    houseGroup.add(floorTile);

    // Part 3 & 4: Cutaway Back Wall & Side Wall (warm sand plaster)
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0xf4efe4,
      roughness: 0.82,
      metalness: 0.02,
    });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.7, 0.18), wallMat);
    backWall.position.set(0, 1.65, -2.0);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    houseGroup.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.7, 4.18), wallMat);
    leftWall.position.set(-2.51, 1.65, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    houseGroup.add(leftWall);

    // Part 5: Right Roadside Wall Frame with Window Opening
    const rightLower = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 4.18), wallMat);
    rightLower.position.set(2.51, 0.75, 0);
    rightLower.castShadow = true;
    houseGroup.add(rightLower);

    const rightUpper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 4.18), wallMat);
    rightUpper.position.set(2.51, 2.72, 0);
    rightUpper.castShadow = true;
    houseGroup.add(rightUpper);

    // Part 6: Sliding Glass Window Sash (animated open/closed by roomSealed)
    const sashGroup = new THREE.Group();
    const sashFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.25, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x2a3533, roughness: 0.35, metalness: 0.7 }),
    );
    const sashGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 1.15, 2.1),
      new THREE.MeshPhysicalMaterial({
        color: 0xcbe8e6,
        roughness: 0.08,
        metalness: 0.0,
        transparent: true,
        opacity: 0.42,
      }),
    );
    sashGroup.add(sashFrame, sashGlass);
    sashGroup.position.set(2.51, 1.82, 0.9);
    houseGroup.add(sashGroup);

    // Part 7: Bed Platform & Linen (safe-room anchor)
    const bedFrame = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.36, 1.45),
      new THREE.MeshStandardMaterial({ color: 0x7b563c, roughness: 0.65, metalness: 0.05 }),
    );
    bedFrame.position.set(-1.35, 0.52, -0.9);
    bedFrame.castShadow = true;
    houseGroup.add(bedFrame);

    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.16, 1.36),
      new THREE.MeshStandardMaterial({ color: 0xdfeae8, roughness: 0.85, metalness: 0 }),
    );
    mattress.position.set(-1.35, 0.78, -0.9);
    houseGroup.add(mattress);

    // Part 8: Roof Overhang + Solar Rooftop Tank (Indian residential context)
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(5.7, 0.16, 4.7),
      new THREE.MeshStandardMaterial({ color: 0xd9d2c5, roughness: 0.78, metalness: 0.05 }),
    );
    roof.position.set(0, 3.08, 0);
    roof.castShadow = true;
    roof.receiveShadow = true;
    houseGroup.add(roof);

    const rooftopTank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.9, 20),
      new THREE.MeshStandardMaterial({ color: 0x202827, roughness: 0.45, metalness: 0.35 }),
    );
    rooftopTank.position.set(-1.5, 3.6, -1.0);
    rooftopTank.castShadow = true;
    houseGroup.add(rooftopTank);

    scene.add(houseGroup);

    // =========================================================================
    // 2. COMPOSITE 6-PART HEPA AIR PURIFIER (inside Safe Room)
    // =========================================================================
    const purifierGroup = new THREE.Group();
    purifierGroup.position.set(-0.2, 0.35, -1.4);

    // Base plinth
    const purBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.27, 0.06, 24),
      new THREE.MeshStandardMaterial({ color: 0x293231, roughness: 0.7, metalness: 0.2 }),
    );
    purBase.position.y = 0.03;
    purifierGroup.add(purBase);

    // Perforated intake cylinder
    const purIntake = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.23, 0.32, 24),
      new THREE.MeshStandardMaterial({ color: 0x3b4846, roughness: 0.75, metalness: 0.15 }),
    );
    purIntake.position.y = 0.22;
    purifierGroup.add(purIntake);

    // Upper matte body housing
    const purBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.23, 0.36, 24),
      new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.42, metalness: 0.04 }),
    );
    purBody.position.y = 0.56;
    purBody.castShadow = true;
    purifierGroup.add(purBody);

    // Brushed aluminum top collar
    const purCollar = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.022, 12, 32),
      new THREE.MeshStandardMaterial({ color: 0xc8d0cf, roughness: 0.2, metalness: 0.9 }),
    );
    purCollar.rotation.x = Math.PI / 2;
    purCollar.position.y = 0.74;
    purifierGroup.add(purCollar);

    // Status LED Ring
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x14b8a6,
      emissive: 0x0f766e,
      emissiveIntensity: 1.2,
      roughness: 0.3,
    });
    const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 10, 28), ledMat);
    ledRing.rotation.x = Math.PI / 2;
    ledRing.position.y = 0.745;
    purifierGroup.add(ledRing);

    // Spinning 4-blade exhaust impeller
    const rotorGroup = new THREE.Group();
    rotorGroup.position.y = 0.72;
    const bladeGeo = new THREE.BoxGeometry(0.28, 0.012, 0.055);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x1f2928,
      roughness: 0.38,
      metalness: 0.4,
    });
    const bladeA = new THREE.Mesh(bladeGeo, bladeMat);
    const bladeB = new THREE.Mesh(bladeGeo, bladeMat);
    bladeB.rotation.y = Math.PI / 2;
    rotorGroup.add(bladeA, bladeB);
    purifierGroup.add(rotorGroup);

    scene.add(purifierGroup);

    // =========================================================================
    // 3. COMPOSITE 6-PART ROADSIDE AUTORICKSHAW (Indian Street Context)
    // =========================================================================
    const autoGroup = new THREE.Group();
    autoGroup.position.set(3.4, 0, 2.2);

    const autoBodyMat = new THREE.MeshStandardMaterial({
      color: 0x0d7a52,
      roughness: 0.4,
      metalness: 0.2,
    });
    const autoCanopyMat = new THREE.MeshStandardMaterial({
      color: 0xf4b41a,
      roughness: 0.55,
      metalness: 0.05,
    });
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x1b1f1f,
      roughness: 0.88,
      metalness: 0.05,
    });

    const autoChassis = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.62, 1.9), autoBodyMat);
    autoChassis.position.y = 0.52;
    autoChassis.castShadow = true;
    autoGroup.add(autoChassis);

    const autoCanopy = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.72, 1.65), autoCanopyMat);
    autoCanopy.position.set(0, 1.18, -0.05);
    autoCanopy.castShadow = true;
    autoGroup.add(autoCanopy);

    const windShield = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.45, 0.05),
      new THREE.MeshPhysicalMaterial({ color: 0xd9f2f0, transparent: true, opacity: 0.45, roughness: 0.1 }),
    );
    windShield.position.set(0, 1.1, 0.86);
    autoGroup.add(windShield);

    const wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.14, 16);
    const wheelOffsets: [number, number, number][] = [
      [0, 0.22, 0.76],
      [-0.56, 0.22, -0.68],
      [0.56, 0.22, -0.68],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const w = new THREE.Mesh(wheelGeo, tireMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, wy, wz);
      w.castShadow = true;
      autoGroup.add(w);
    }
    scene.add(autoGroup);

    // =========================================================================
    // 4. PROCEDURAL URBAN NEEM TREES (Multi-part Groups grounded at y=0)
    // =========================================================================
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4736, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4c7858, roughness: 0.82 });

    const treePositions: [number, number][] = [
      [-5.2, 2.2],
      [-5.4, -3.6],
      [7.4, -3.2],
      [7.8, 4.4],
    ];
    for (const [tx, tz] of treePositions) {
      const tree = new THREE.Group();
      tree.position.set(tx, 0, tz);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.18, 1.5, 10), trunkMat);
      trunk.position.y = 0.75;
      trunk.castShadow = true;
      const crownA = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 1), leafMat);
      crownA.position.set(0, 1.9, 0);
      crownA.castShadow = true;
      const crownB = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 1), leafMat);
      crownB.position.set(0.42, 1.65, 0.22);
      const crownC = new THREE.Mesh(new THREE.DodecahedronGeometry(0.58, 1), leafMat);
      crownC.position.set(-0.38, 1.72, -0.2);
      tree.add(trunk, crownA, crownB, crownC);
      scene.add(tree);
    }

    // Subtle Distant Skyline Silhouettes (depth in horizon fog)
    const skyMat = new THREE.MeshStandardMaterial({
      color: 0x8e9996,
      roughness: 0.9,
      metalness: 0.05,
    });
    const skylineBlocks: [number, number, number, number][] = [
      [-14, -18, 4.5, 9],
      [-7, -20, 5.0, 13],
      [2, -21, 6.0, 10],
      [12, -19, 4.2, 15],
      [19, -15, 5.2, 8],
    ];
    for (const [bx, bz, bw, bh] of skylineBlocks) {
      const bldg = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw * 0.8), skyMat);
      bldg.position.set(bx, bh / 2, bz);
      scene.add(bldg);
    }

    // =========================================================================
    // 5. INSTANCED PM2.5 PARTICULATE FIELD (280 airborne spheres)
    // =========================================================================
    const PARTICLE_COUNT = 280;
    const particleGeo = new THREE.IcosahedronGeometry(0.055, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xb99a74,
      roughness: 0.8,
      metalness: 0.0,
      transparent: true,
      opacity: 0.78,
    });
    const particles = new THREE.InstancedMesh(particleGeo, particleMat, PARTICLE_COUNT);
    particles.frustumCulled = false;

    const pData = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const isIndoor = i < 75;
      return {
        isIndoor,
        x: isIndoor ? -3.4 + Math.random() * 4.2 : -8 + Math.random() * 18,
        y: isIndoor ? 0.55 + Math.random() * 2.1 : 0.4 + Math.random() * 5.2,
        z: isIndoor ? -2.2 + Math.random() * 3.6 : -8 + Math.random() * 16,
        speed: 0.35 + Math.random() * 0.7,
        phase: Math.random() * Math.PI * 2,
      };
    });
    scene.add(particles);

    // Pre-compile shaders on hardware GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Resize handling
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // =========================================================================
    // 6. SMOOTH DAMPED ANIMATION LOOP (Software-WebGL Safe)
    // =========================================================================
    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick(now: number) {
      if (disposed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const st = liveStateRef.current;

      // Update Fog & Sky based on PM2.5 concentration
      const hazeFactor = THREE.MathUtils.clamp((st.pm25 - 30) / 350, 0, 1);
      fog.density = THREE.MathUtils.damp(fog.density, 0.008 + hazeFactor * 0.042, 4, dt);
      const cleanSky = _vec3.set(0.8, 0.89, 0.88);
      const smogSky = _targetVec.set(0.76, 0.72, 0.64);
      initialBg.setRGB(
        THREE.MathUtils.lerp(cleanSky.x, smogSky.x, hazeFactor),
        THREE.MathUtils.lerp(cleanSky.y, smogSky.y, hazeFactor),
        THREE.MathUtils.lerp(cleanSky.z, smogSky.z, hazeFactor),
      );
      scene.background = initialBg;
      fog.color.copy(initialBg);

      // Animate window sash sliding smoothly (z = -0.15 when sealed, z = 1.05 when open)
      const targetSashZ = st.roomSealed ? -0.15 : 1.05;
      sashGroup.position.z = THREE.MathUtils.damp(sashGroup.position.z, targetSashZ, 6, dt);

      // Spin HEPA purifier blades & update LED indicator
      if (st.purifierActive) {
        rotorGroup.rotation.y += dt * 11.5;
        ledMat.color.setHex(0x14b8a6);
        ledMat.emissive.setHex(0x0f766e);
      } else {
        rotorGroup.rotation.y += dt * 0.25;
        ledMat.color.setHex(0xd97706);
        ledMat.emissive.setHex(0x78350f);
      }

      // Gentle autorickshaw idle oscillation on road
      autoGroup.position.z =
        st.commuteMode === 'auto_rickshaw'
          ? Math.sin(now * 0.0005) * 3.8
          : THREE.MathUtils.damp(autoGroup.position.z, 2.2, 3, dt);

      // Smooth damped camera preset glide
      if (st.presetTransitionActive) {
        const view = PRESET_VIEWS[st.preset];
        camera.position.x = THREE.MathUtils.damp(camera.position.x, view.pos[0], 5, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, view.pos[1], 5, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, view.pos[2], 5, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, view.target[0], 5, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, view.target[1], 5, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, view.target[2], 5, dt);

        if (
          Math.abs(camera.position.x - view.pos[0]) < 0.03 &&
          Math.abs(camera.position.y - view.pos[1]) < 0.03 &&
          Math.abs(camera.position.z - view.pos[2]) < 0.03
        ) {
          st.presetTransitionActive = false;
        }
      }

      // Update Instanced PM2.5 Particles
      const windFactor = Math.max(0.25, st.windKmh / 6);
      const indoorReduction =
        (st.roomSealed ? 0.55 : 1.0) * (st.purifierActive ? 0.22 : 1.0);

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = pData[i];
        p.x += dt * p.speed * (p.isIndoor ? 0.25 : windFactor);
        p.y += Math.sin(now * 0.0015 + p.phase) * dt * 0.18;
        if (p.isIndoor) {
          if (p.x > 0.9) p.x = -3.4;
        } else if (p.x > 10) {
          p.x = -8;
        }

        const scaleVal = p.isIndoor
          ? (0.45 + hazeFactor * 0.95) * indoorReduction
          : 0.45 + hazeFactor * 1.15;

        _vec3.set(p.x, p.y, p.z);
        _scaleVec.setScalar(scaleVal);
        _mat4.compose(_vec3, _quat, _scaleVec);
        particles.setMatrixAt(i, _mat4);
      }
      particles.instanceMatrix.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(() => tick(performance.now()));
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (isSoftwareGl) {
      renderer.render(scene, camera);
      afterDraw(() => tick(performance.now()));
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      roadTex.dispose();
      tileTex.dispose();
      shadowTex.dispose();
      envTarget.dispose();
      renderer.dispose();
    };
  }, []);

  if (webglError) {
    return (
      <div className="w-full h-[520px] rounded-2xl border border-[#E2DDD2] dark:border-[#283836] bg-[#F0ECE3] dark:bg-[#16201F] flex flex-col items-center justify-center p-6 text-center">
        <Wind className="w-10 h-10 text-[#0F766E] mb-3" />
        <p className="font-display font-semibold text-lg">{webglError}</p>
        <p className="text-sm text-[#4B5B59] dark:text-[#A7B8B5] mt-1">
          Simulation physics remain active in the comparison panel below.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[520px] md:h-[580px] rounded-2xl overflow-hidden border border-[#E2DDD2] dark:border-[#283836] bg-[#C9D4CF]">
      {/* Isolated WebGL mount container */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Top-Left Minimal Spec Overlay (Solid rgba, no backdrop-filter over WebGL) */}
      <div
        className="absolute top-4 left-4 z-10 rounded-xl px-4 py-2.5 text-white pointer-events-none"
        style={{ backgroundColor: 'rgba(22, 32, 31, 0.86)' }}
      >
        <div className="text-xs text-[#A7B8B5]">3D Household & Street Airshed</div>
        <div className="text-sm font-semibold tabular-nums mt-0.5">
          Outdoor PM2.5: {pm25} µg/m³ · Wind {windKmh} km/h ·{' '}
          {roomSealed && purifierActive
            ? 'Safe Room Protected'
            : roomSealed
              ? 'Windows Sealed'
              : 'Windows Open'}
        </div>
      </div>

      {/* Collapsible Unified Bottom Control Dock */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[min(780px,94%)] flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="mb-1.5 px-3 py-1 rounded-lg text-xs font-medium text-white flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          style={{ backgroundColor: 'rgba(22, 32, 31, 0.9)' }}
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" /> Show 3D Controls
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" /> Hide 3D Controls
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div
            className="w-full rounded-2xl px-4 py-3 text-white flex flex-wrap items-center justify-between gap-3 border border-white/15"
            style={{ backgroundColor: 'rgba(22, 32, 31, 0.92)' }}
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <Eye className="w-4 h-4 text-[#2DD4BF] mr-1 shrink-0" />
              {(Object.keys(PRESET_VIEWS) as CameraPreset[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectPreset(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    preset === key
                      ? 'bg-[#0F766E] text-white'
                      : 'bg-white/10 text-white/80 hover:bg-white/20'
                  }`}
                >
                  {PRESET_VIEWS[key].label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onToggleSeal}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  roomSealed
                    ? 'bg-[#0F766E] text-white'
                    : 'bg-[#D97706] text-white'
                }`}
              >
                {roomSealed ? 'Window Sealed' : 'Seal Window'}
              </button>
              <button
                type="button"
                onClick={onTogglePurifier}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  purifierActive
                    ? 'bg-[#0F766E] text-white'
                    : 'bg-white/10 text-white/85 hover:bg-white/20'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                {purifierActive ? 'HEPA Purifier: On' : 'Turn On HEPA'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
