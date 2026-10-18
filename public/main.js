import * as THREE from "three";

const canvas = document.querySelector("#scene");
const mapCanvas = document.querySelector("#minimap");
const map = mapCanvas.getContext("2d");
const joystick = document.querySelector("#joystick");
const stick = document.querySelector("#stick");

const CELL = 5;
const CHUNK_SIZE = 12;
const VIEW_RADIUS = 2;
const WALL_HEIGHT = 4.8;
const SAFE_CORRIDOR_X = -1;
const player = new THREE.Vector3(CELL * .5, 1.6, CELL * .5);
const keys = new Set();
const chunks = new Map();
let yaw = 0;
let pitch = -0.04;
let sensorYaw = null;
let sensorPitch = 0;
let useSensor = false;
let sensorRequested = false;
let sensorAlpha = null;
let sensorBeta = null;
let sensorBaseYaw = 0;
let sensorBasePitch = 0;
let joystickVector = { x: 0, y: 0 };
let dragging = false;
let lastPointer = null;
let lastFrame = performance.now();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07110d");
scene.fog = new THREE.FogExp2("#07110d", .028);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, .05, 170);
scene.add(camera);

scene.add(new THREE.HemisphereLight("#9bc7a3", "#0b160e", 1.25));
const moon = new THREE.DirectionalLight("#d8ffd2", 1.8);
moon.position.set(18, 35, 8);
moon.castShadow = true;
moon.shadow.mapSize.set(1024, 1024);
moon.shadow.camera.left = moon.shadow.camera.bottom = -45;
moon.shadow.camera.right = moon.shadow.camera.top = 45;
scene.add(moon);

const floorMaterial = new THREE.MeshStandardMaterial({ color: "#10271a", roughness: .94, metalness: .03 });
const wallMaterial = new THREE.MeshStandardMaterial({ color: "#284a32", roughness: .82, metalness: .08 });
const edgeMaterial = new THREE.MeshStandardMaterial({ color: "#8dca62", emissive: "#315b2c", emissiveIntensity: .5, roughness: .42 });
const floorGeometry = new THREE.PlaneGeometry(CHUNK_SIZE * CELL, CHUNK_SIZE * CELL);
const wallGeometry = new THREE.BoxGeometry(CELL, WALL_HEIGHT, .28);
const pillarGeometry = new THREE.BoxGeometry(.28, WALL_HEIGHT, .28);

function hash(x, z, salt = 0) {
  let n = Math.imul(x + 374761393, 668265263) ^ Math.imul(z + 1274126177, 2246822519) ^ salt;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function hasWall(x, z, side) {
  if ((side === 0 || side === 2) && x === SAFE_CORRIDOR_X) return false;
  const nx = side === 1 ? x + 1 : side === 3 ? x - 1 : x;
  const nz = side === 2 ? z + 1 : side === 0 ? z - 1 : z;
  const a = hash(x, z, 17);
  const b = hash(nx, nz, 17);
  const boundary = Math.min(a, b) < .11;
  const horizontal = side === 0 || side === 2;
  return boundary || (horizontal ? Math.min(hash(x, z, 47), hash(nx, nz, 47)) < .38 : Math.min(hash(x, z, 93), hash(nx, nz, 93)) < .42);
}

function createChunk(cx, cz) {
  const group = new THREE.Group();
  group.position.set(cx * CHUNK_SIZE * CELL, 0, cz * CHUNK_SIZE * CELL);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(CHUNK_SIZE * CELL / 2, 0, CHUNK_SIZE * CELL / 2);
  floor.receiveShadow = true;
  group.add(floor);
  for (let z = 0; z < CHUNK_SIZE; z++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const wx = cx * CHUNK_SIZE + x;
      const wz = cz * CHUNK_SIZE + z;
      [[0, 0, -.5, 0], [3, -.5, 0, Math.PI / 2]].forEach(([side, ox, oz, rotation]) => {
        if (!hasWall(wx, wz, side)) return;
        const wall = new THREE.Mesh(wallGeometry, wallMaterial);
        wall.position.set((x + .5 + ox) * CELL, WALL_HEIGHT / 2, (z + .5 + oz) * CELL);
        wall.rotation.y = rotation;
        wall.castShadow = wall.receiveShadow = true;
        group.add(wall);
      });
      if (hash(wx, wz, 281) > .94) {
        const beacon = new THREE.PointLight("#b6ff65", 1.4, 12, 2);
        beacon.position.set((x + .5) * CELL, 1.8, (z + .5) * CELL);
        group.add(beacon);
      }
    }
  }
  for (let z = 0; z <= CHUNK_SIZE; z++) {
    for (let x = 0; x <= CHUNK_SIZE; x++) {
      const pillar = new THREE.Mesh(pillarGeometry, edgeMaterial);
      pillar.position.set(x * CELL, WALL_HEIGHT / 2, z * CELL);
      group.add(pillar);
    }
  }
  scene.add(group);
  chunks.set(`${cx},${cz}`, group);
}

function updateChunks() {
  const cx = Math.floor(player.x / (CHUNK_SIZE * CELL));
  const cz = Math.floor(player.z / (CHUNK_SIZE * CELL));
  for (let z = cz - VIEW_RADIUS; z <= cz + VIEW_RADIUS; z++) {
    for (let x = cx - VIEW_RADIUS; x <= cx + VIEW_RADIUS; x++) {
      if (!chunks.has(`${x},${z}`)) createChunk(x, z);
    }
  }
  for (const [key, group] of chunks) {
    const [x, z] = key.split(",").map(Number);
    if (Math.abs(x - cx) > VIEW_RADIUS + 1 || Math.abs(z - cz) > VIEW_RADIUS + 1) {
      scene.remove(group);
      chunks.delete(key);
    }
  }
}

function collides(x, z) {
  const cellX = Math.floor(x / CELL);
  const cellZ = Math.floor(z / CELL);
  const localX = x - cellX * CELL;
  const localZ = z - cellZ * CELL;
  const radius = .38;
  return (localZ < radius && hasWall(cellX, cellZ, 0)) ||
    (localX > CELL - radius && hasWall(cellX, cellZ, 1)) ||
    (localZ > CELL - radius && hasWall(cellX, cellZ, 2)) ||
    (localX < radius && hasWall(cellX, cellZ, 3));
}

function placePlayerAtOpenCell() {
  player.set((SAFE_CORRIDOR_X + .5) * CELL, 1.6, CELL * .5);
}

function move(dx, dz) {
  if (!collides(player.x + dx, player.z)) player.x += dx;
  if (!collides(player.x, player.z + dz)) player.z += dz;
}

function drawMap() {
  const width = mapCanvas.width;
  map.clearRect(0, 0, width, width);
  map.fillStyle = "#07120d";
  map.fillRect(0, 0, width, width);
  const scale = 9;
  const center = width / 2;
  const px = Math.floor(player.x / CELL);
  const pz = Math.floor(player.z / CELL);
  map.strokeStyle = "rgba(150, 235, 140, .48)";
  map.lineWidth = 2;
  for (let z = pz - 12; z <= pz + 12; z++) {
    for (let x = px - 12; x <= px + 12; x++) {
      const sx = center + (x - px) * scale;
      const sz = center + (z - pz) * scale;
      if (hasWall(x, z, 0)) { map.beginPath(); map.moveTo(sx, sz); map.lineTo(sx + scale, sz); map.stroke(); }
      if (hasWall(x, z, 3)) { map.beginPath(); map.moveTo(sx, sz); map.lineTo(sx, sz + scale); map.stroke(); }
    }
  }
  map.save();
  map.translate(center, center);
  map.rotate(-(useSensor && sensorYaw !== null ? sensorYaw : yaw));
  map.fillStyle = "#c7ff67";
  map.beginPath();
  map.moveTo(0, -7); map.lineTo(5, 6); map.lineTo(0, 3); map.lineTo(-5, 6); map.closePath();
  map.fill();
  map.restore();
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function animate(now) {
  const dt = Math.min((now - lastFrame) / 1000, .05);
  lastFrame = now;
  const activeYaw = useSensor && sensorYaw !== null ? sensorYaw : yaw;
  const forward = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - joystickVector.y;
  const strafe = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0) + joystickVector.x;
  if (forward || strafe) {
    const speed = 4.1 * dt;
    move((-Math.sin(activeYaw) * forward + Math.cos(activeYaw) * strafe) * speed, (-Math.cos(activeYaw) * forward - Math.sin(activeYaw) * strafe) * speed);
  }
  const activePitch = useSensor ? sensorPitch : pitch;
  camera.position.copy(player);
  camera.rotation.set(activePitch, activeYaw, 0, "YXZ");
  updateChunks();
  drawMap();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function setJoystick(event) {
  const rect = joystick.getBoundingClientRect();
  const x = Math.max(-1, Math.min(1, (event.clientX - (rect.left + 51)) / 42));
  const y = Math.max(-1, Math.min(1, (event.clientY - (rect.top + 51)) / 42));
  joystickVector = { x, y };
  stick.style.transform = `translate(${x * 27}px, ${y * 27}px)`;
}

canvas.addEventListener("pointerdown", (event) => {
  if (!useSensor) enableSensor();
  dragging = true;
  lastPointer = event;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging || useSensor) return;
  yaw -= (event.clientX - lastPointer.clientX) * .004;
  pitch = Math.max(-1.2, Math.min(1.2, pitch - (event.clientY - lastPointer.clientY) * .003));
  lastPointer = event;
});
canvas.addEventListener("pointerup", () => { dragging = false; });
addEventListener("keydown", (event) => keys.add(event.code));
addEventListener("keyup", (event) => keys.delete(event.code));
addEventListener("resize", resize);
joystick.addEventListener("pointerdown", (event) => { joystick.setPointerCapture(event.pointerId); setJoystick(event); });
joystick.addEventListener("pointermove", (event) => { if (event.buttons) setJoystick(event); });
joystick.addEventListener("pointerup", () => { joystickVector = { x: 0, y: 0 }; stick.style.transform = ""; });

async function enableSensor() {
  try {
    if (typeof DeviceOrientationEvent === "undefined") return;
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") throw new Error("设备方向权限未授予");
    }
    sensorRequested = true;
    sensorAlpha = null;
    sensorBeta = null;
    sensorBaseYaw = yaw;
    sensorBasePitch = pitch;
  } catch (error) {
    console.warn("Device orientation permission was not granted.", error);
  }
}

addEventListener("deviceorientation", (event) => {
  if (!sensorRequested || event.alpha === null) return;
  useSensor = true;
  if (sensorAlpha === null) {
    sensorAlpha = event.alpha;
    sensorBeta = event.beta || 0;
    sensorYaw = sensorBaseYaw;
    sensorPitch = sensorBasePitch;
    return;
  }
  const yawDelta = THREE.MathUtils.euclideanModulo(THREE.MathUtils.degToRad(event.alpha - sensorAlpha) + Math.PI, Math.PI * 2) - Math.PI;
  sensorYaw = sensorBaseYaw + yawDelta;
  sensorPitch = Math.max(-1.05, Math.min(.8, sensorBasePitch - THREE.MathUtils.degToRad((event.beta || 0) - sensorBeta)));
});
placePlayerAtOpenCell();
updateChunks();
requestAnimationFrame(animate);
