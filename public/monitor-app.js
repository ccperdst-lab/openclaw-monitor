import * as THREE from 'three';

// ===== Globals =====
const container = document.getElementById('scene3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ec8e3);
scene.fog = new THREE.FogExp2(0x7ec8e3, 0.008);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(25, 30, 35);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Camera controls
let yaw = 0, pitch = -0.5;
let moveSpeed = 12;
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
let isDragging = false, dragStarted = false, lastMX = 0, lastMY = 0;

// Focus management: track if user is interacting with a DOM overlay
let interactingWithOverlay = false;

// ===== Day/Night Cycle =====
let gameTime = 0; // 0-120s cycle
const DAY_CYCLE = 120;

// ===== Rain System =====
let isRaining = false;
let rainDrops = [];
let rainSplashParticles = [];
const RAIN_COUNT = 200;

// ===== Scene State Persistence =====
let lastStateSave = 0;

// Helper: is event target on our canvas (not a DOM overlay)?
function isCanvasEvent(e) {
  return e.target === renderer.domElement;
}

// Helper: is event target inside a bubble?
function isBubbleEvent(e) {
  return !!e.target.closest('.bubble3d') || !!e.target.closest('.mcp-bubble');
}

// Canvas mouse handlers — only activate when clicking directly on canvas
renderer.domElement.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (!isCanvasEvent(e)) return; // Don't interfere with overlay clicks
  isDragging = true; dragStarted = false;
  lastMX = e.clientX; lastMY = e.clientY;
  renderer.domElement.classList.add('dragging');
  // Make bubbles transparent to mouse during drag (so mousemove doesn't stutter)
  document.querySelectorAll('.bubble3d, .mcp-bubble').forEach(el => {
    el.style.pointerEvents = 'none';
  });
  e.preventDefault();
});
window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragStarted = true;
  yaw -= dx * 0.003;
  pitch -= dy * 0.003;
  pitch = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, pitch));
  lastMX = e.clientX; lastMY = e.clientY;
});
window.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    renderer.domElement.classList.remove('dragging');
    // Restore bubble pointer events
    document.querySelectorAll('.bubble3d, .mcp-bubble').forEach(el => {
      el.style.pointerEvents = '';
    });
  }
});

function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}
window.addEventListener('keydown', e => {
  if (isInputFocused() || interactingWithOverlay) return;
  if (e.code === 'KeyW') keys.w = true;
  else if (e.code === 'KeyA') keys.a = true;
  else if (e.code === 'KeyS') keys.s = true;
  else if (e.code === 'KeyD') keys.d = true;
  else if (e.code === 'Space') keys.space = true;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;
  else if (e.code === 'KeyR') toggleRain();
});
window.addEventListener('keyup', e => {
  if (isInputFocused() || interactingWithOverlay) return;
  if (e.code === 'KeyW') keys.w = false;
  else if (e.code === 'KeyA') keys.a = false;
  else if (e.code === 'KeyS') keys.s = false;
  else if (e.code === 'KeyD') keys.d = false;
  else if (e.code === 'Space') keys.space = false;
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
});
window.addEventListener('wheel', e => { moveSpeed = Math.max(4, Math.min(30, moveSpeed - e.deltaY * 0.01)); }, { passive: true });

// Lighting - warm, Pokemon-style
scene.add(new THREE.AmbientLight(0xffe4c4, 0.4));
scene.add(new THREE.HemisphereLight(0x87ceeb, 0x4ade80, 0.5)); // sky blue top, green bottom
const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
sun.position.set(30, 50, 20); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60;
scene.add(sun);

// ===== Materials =====
const mat = {
  // Ground
  grass: new THREE.MeshStandardMaterial({ color: 0x5ec269, roughness: 0.95 }),
  grassDark: new THREE.MeshStandardMaterial({ color: 0x48a854, roughness: 0.95 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0xc4a672, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.8 }),
  cobblestone: new THREE.MeshStandardMaterial({ color: 0xa89078, roughness: 0.9 }),
  water: new THREE.MeshStandardMaterial({ color: 0x5bc0eb, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 }),
  // House
  wallPink: new THREE.MeshStandardMaterial({ color: 0xfce4ec, roughness: 0.8 }),
  wallBlue: new THREE.MeshStandardMaterial({ color: 0xe3f2fd, roughness: 0.8 }),
  wallYellow: new THREE.MeshStandardMaterial({ color: 0xfff9c4, roughness: 0.8 }),
  wallGreen: new THREE.MeshStandardMaterial({ color: 0xe8f5e9, roughness: 0.8 }),
  doorWood: new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.7 }),
  windowGlass: new THREE.MeshStandardMaterial({ color: 0xbbdefb, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.6 }),
  chimney: new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 0.9 }),
  // Decorations
  wood: new THREE.MeshStandardMaterial({ color: 0xa1887f, roughness: 0.85 }),
  fencePost: new THREE.MeshStandardMaterial({ color: 0xd7ccc8, roughness: 0.8 }),
  trunkBrown: new THREE.MeshStandardMaterial({ color: 0x795548, roughness: 0.9 }),
  leafGreen: new THREE.MeshStandardMaterial({ color: 0x66bb6a, roughness: 0.8 }),
  leafDark: new THREE.MeshStandardMaterial({ color: 0x388e3c, roughness: 0.8 }),
  flowerRed: new THREE.MeshStandardMaterial({ color: 0xef5350, roughness: 0.6 }),
  flowerPink: new THREE.MeshStandardMaterial({ color: 0xf48fb1, roughness: 0.6 }),
  flowerYellow: new THREE.MeshStandardMaterial({ color: 0xfff176, roughness: 0.6 }),
  flowerPurple: new THREE.MeshStandardMaterial({ color: 0xce93d8, roughness: 0.6 }),
  flowerWhite: new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 }),
  bushGreen: new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.85 }),
  lampPost: new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 }),
  lampGlow: new THREE.MeshStandardMaterial({ color: 0xffee58, emissive: 0xffee58, emissiveIntensity: 0.6 }),
  rock: new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.95 }),
  // Minion
  minionYellow: new THREE.MeshStandardMaterial({ color: 0xf5d033, roughness: 0.5 }),
  minionBlue: new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5 }),
  goggle: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  pupil: new THREE.MeshStandardMaterial({ color: 0x111111 }),
  roofColors: [0x5c6bc0, 0xef5350, 0x66bb6a, 0xffa726, 0xab47bc, 0x26c6da, 0xec407a, 0xff7043],
  wallColors: null, // set below
};
mat.wallColors = [mat.wallPink, mat.wallBlue, mat.wallYellow, mat.wallGreen];

// ===== Chinese Names =====
const MINION_NAMES = [
  '小明', '阿花', '大壮', '小美', '阿福', '小龙', '大宝', '小雪', '阿杰', '小芳',
  '阿强', '小红', '大伟', '小玲', '阿亮', '小青', '大兵', '小月', '阿涛', '小燕',
  '阿飞', '小云', '大山', '小雨', '阿军', '小星', '大龙', '小霞', '阿峰', '小玉',
  '阿文', '小兰', '大海', '小凤', '阿勇', '小莲', '大鹏', '小琴', '阿华', '小菊',
];
let minionProfiles = {};
const usedMinionNames = new Set();
function getRandomName() {
  const avail = MINION_NAMES.filter(n => !usedMinionNames.has(n));
  const pool = avail.length > 0 ? avail : MINION_NAMES;
  const n = pool[Math.floor(Math.random() * pool.length)];
  usedMinionNames.add(n);
  return n;
}

// ===== World State =====
let agents = [];     // { name, sessions: [...] }
let minions = [];    // Three.js groups
let bubbles = {};    // sessionKey → DOM element
let obstacles = [];  // { minX, maxX, minZ, maxZ } axis-aligned bounding boxes
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const clickables = []; // minion meshes for click detection

// ===== Collision =====
const MINION_RADIUS = 0.4; // collision radius for minions

function addObstacle(minX, maxX, minZ, maxZ, label) {
  obstacles.push({ minX, maxX, minZ, maxZ, label: label || '' });
}

function collidesAABB(ax, az, ar, box) {
  // Circle (cx, cz, radius) vs AABB collision
  const closestX = Math.max(box.minX, Math.min(ax, box.maxX));
  const closestZ = Math.max(box.minZ, Math.min(az, box.maxZ));
  const dx = ax - closestX, dz = az - closestZ;
  return (dx * dx + dz * dz) < (ar * ar);
}

function collidesWithAny(x, z, excludeKey) {
  for (const obs of obstacles) {
    if (collidesAABB(x, z, MINION_RADIUS, obs)) return true;
  }
  for (const other of minions) {
    if (other.userData.sessionKey === excludeKey) continue;
    const dx = x - other.position.x, dz = z - other.position.z;
    if (dx * dx + dz * dz < (MINION_RADIUS * 2) * (MINION_RADIUS * 2)) return true;
  }
  return false;
}

// ===== Create Minion =====
function createMinion(profile) {
  const p = profile || {};
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: p.color || 0xf5d033, roughness: 0.5 });
  const hs = p.heightScale || (0.8 + Math.random() * 0.4);
  const ws = p.widthScale || (0.9 + Math.random() * 0.2);
  const br = 0.35 * ws, bh = 1.2 * hs;

  // Body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(br, br*1.08, bh, 16), bodyMat);
  body.position.y = 0.5 + bh/2; body.castShadow = true;
  group.add(body);

  // Overalls
  const overalls = new THREE.Mesh(new THREE.CylinderGeometry(br*1.05, br*1.1, bh*0.4, 16), mat.minionBlue);
  overalls.position.y = 0.5 + bh*0.2;
  group.add(overalls);

  // Goggles strap
  const strap = new THREE.Mesh(new THREE.TorusGeometry(br*1.02, 0.04, 8, 32), mat.goggle);
  strap.position.y = 0.5 + bh*0.72; strap.rotation.x = Math.PI/2;
  group.add(strap);

  // Head
  const hr = br*0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(hr, 16, 12), bodyMat);
  head.position.y = 0.5 + bh + hr*0.5; head.castShadow = true;
  group.add(head);

  // Eyes (1 or 2)
  const eyeCount = Math.random() > 0.3 ? 2 : 1;
  const eyeR = br*0.22, pupilR = eyeR*0.55;
  const eyeY = 0.5 + bh + hr*0.65;
  const eyeSpacing = br*0.32;
  for (let i = 0; i < eyeCount; i++) {
    const ex = eyeCount === 1 ? 0 : (i === 0 ? -eyeSpacing : eyeSpacing);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 8, 8), mat.eye);
    eye.position.set(ex, eyeY, br*0.85);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(pupilR, 8, 8), mat.pupil);
    pupil.position.set(ex, eyeY, br*0.85 + eyeR*0.5);
    group.add(pupil);
  }

  // Hair
  const hairCount = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < hairCount; i++) {
    const angle = (i / hairCount) * Math.PI * 2;
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.15 + Math.random()*0.1, 6), bodyMat);
    hair.position.set(Math.cos(angle)*br*0.5, 0.5+bh+hr*1.3, Math.sin(angle)*br*0.5);
    hair.rotation.x = Math.cos(angle)*0.4; hair.rotation.z = Math.sin(angle)*0.4;
    group.add(hair);
  }

  // Arms
  [-1, 1].forEach(side => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.55*hs, 8), bodyMat);
    arm.position.set(side*(br+0.12), 0.5+bh*0.6, 0);
    arm.userData.isArm = true; arm.userData.side = side;
    group.add(arm);
  });

  // Legs
  [-1, 1].forEach(side => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.38*hs, 8), mat.minionBlue);
    leg.position.set(side*br*0.45, 0.19*hs, 0);
    group.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    shoe.position.set(side*br*0.45, 0.04, 0.04);
    group.add(shoe);
  });

  group.userData = {
    state: 'idle', targetX: 0, targetZ: 0, speed: 0,
    bobPhase: Math.random() * Math.PI * 2,
    heightScale: hs, widthScale: ws,
    // Session info
    sessionKey: '', sessionId: '', sessionType: '', sessionLabel: '', agentName: '',
    // Bubble state
    userMsg: '', userName: '', eventLog: [], replyText: '', replyCount: 0,
    // eventLog: [{ type: 'think'|'tool_use'|'tool_result'|'reply_snippet', icon, text, detail, time }]
    lastEventTime: 0,
    // Saved chat input (preserved across bubble close/open)
    savedInput: '',
    // Notification: "!" indicator when conversation ends and bubble is closed
    hasNotification: false, notificationSprite: null,
    // Movement
    idleTimer: 0, idleAction: 'stand', idleActionTimer: 0,
    bounds: null,
    chineseName: p.name || '',
  };

  return group;
}

// ===== Notification "!" Indicator =====
function createNotificationSprite() {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  // Red circle
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fillStyle = '#ef4444';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();
  // Exclamation mark
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText('!', 32, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.5, 0.5, 1);
  return sprite;
}

function showNotification(minion) {
  if (minion.userData.notificationSprite) return;
  const sprite = createNotificationSprite();
  const hs = minion.userData.heightScale || 1;
  sprite.position.y = 2.5 * hs * 0.5 + 1.8;
  minion.add(sprite);
  minion.userData.notificationSprite = sprite;
  minion.userData.hasNotification = true;
  // Trigger attention animation via new system
  const animType = Math.random() > 0.5 ? 'jump' : 'wave';
  triggerAnimation(minion, animType, 2.5);
}

function clearNotification(minion) {
  if (minion.userData.notificationSprite) {
    minion.remove(minion.userData.notificationSprite);
    minion.userData.notificationSprite = null;
  }
  minion.userData.hasNotification = false;
  // Clear active animation for this minion
  const sk = minion.userData.sessionKey;
  if (activeAnimations[sk]) {
    clearTimeout(activeAnimations[sk].timer);
    if (activeAnimations[sk].ring) scene.remove(activeAnimations[sk].ring);
    delete activeAnimations[sk];
    minion.scale.set(1, 1, 1);
    minion.rotation.x = 0;
  }
}

// ===== Name Label (billboard) =====
function addNameLabel(minion, line1, line2) {
  const old = minion.children.find(c => c.userData?.isNameLabel);
  if (old) minion.remove(old);

  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);

  // Line 1: session label
  ctx.font = 'bold 28px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  ctx.strokeText(line1 || '', 256, 45);
  ctx.fillText(line1 || '', 256, 45);

  // Line 2: Chinese name
  if (line2) {
    ctx.font = '22px -apple-system, sans-serif';
    ctx.fillStyle = '#ffd700';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
    ctx.strokeText(line2, 256, 85);
    ctx.fillText(line2, 256, 85);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.y = minion.userData.heightScale ? 2.5 * minion.userData.heightScale * 0.5 + 1.2 : 3;
  sprite.scale.set(2.5, 0.625, 1);
  sprite.userData.isNameLabel = true;
  minion.add(sprite);
}

// ===== Continent (Agent Area) =====
function createContinent(agentName, index) {
  const W = 22, D = 22;
  const cols = Math.ceil(Math.sqrt(agents.length));
  const col = index % cols, row = Math.floor(index / cols);
  const ox = col * (W + 6) - (cols - 1) * (W + 6) / 2;
  const oz = row * (D + 6) - (Math.ceil(agents.length / cols) - 1) * (D + 6) / 2;
  const cx = ox + W/2, cz = oz + D/2; // center

  // ===== Ground: multi-layer grass =====
  const ground = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), mat.grass);
  ground.position.set(cx, -0.15, cz); ground.receiveShadow = true;
  scene.add(ground);
  // Dark grass patches
  for (let i = 0; i < 6; i++) {
    const px = ox + 2 + Math.random() * (W - 4), pz = oz + 2 + Math.random() * (D - 4);
    const sz = 1.5 + Math.random() * 2.5;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(sz, 16), mat.grassDark);
    patch.rotation.x = -Math.PI/2; patch.position.set(px, 0.01, pz);
    scene.add(patch);
  }

  // ===== Cobblestone path =====
  const pathMat = mat.cobblestone;
  for (let i = 0; i < 8; i++) {
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3 + Math.random()*0.2, 0.35 + Math.random()*0.15, 0.06, 6),
      pathMat
    );
    stone.position.set(cx - 0.5 + Math.random(), 0.03, oz + 2 + i * 2.2);
    stone.rotation.y = Math.random() * Math.PI;
    scene.add(stone);
  }

  // ===== House (cute Pokemon-style) =====
  const houseW = 4.5, houseD = 4.5, houseH = 2.8;
  const roofColor = mat.roofColors[index % mat.roofColors.length];
  const wallMat = mat.wallColors[index % mat.wallColors.length];
  const hx = cx - 2, hz = cz - 2;

  // Walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(houseW, houseH, houseD), wallMat);
  walls.position.set(hx, houseH/2, hz); walls.castShadow = true;
  scene.add(walls);

  // Roof (thicker, more round)
  const roofGeo = new THREE.ConeGeometry(houseW * 0.9, 2.2, 4);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.7 }));
  roof.position.set(hx, houseH + 1.1, hz); roof.rotation.y = Math.PI/4; roof.castShadow = true;
  scene.add(roof);

  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.1), mat.doorWood);
  door.position.set(hx, 0.75, hz + houseD/2 + 0.05); scene.add(door);
  // Door knob
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8 }));
  knob.position.set(hx + 0.25, 0.85, hz + houseD/2 + 0.12); scene.add(knob);

  // Windows (2 on front)
  [-1, 1].forEach(side => {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.1), mat.windowGlass);
    win.position.set(hx + side * 1.5, houseH * 0.6, hz + houseD/2 + 0.05); scene.add(win);
    // Window frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.05), mat.doorWood);
    frame.position.set(hx + side * 1.5, houseH * 0.6, hz + houseD/2 + 0.02); scene.add(frame);
  });

  // Chimney
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), mat.chimney);
  chimney.position.set(hx + 1.2, houseH + 1.8, hz - 0.8); scene.add(chimney);

  // ===== Sign (agent name) =====
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256; signCanvas.height = 64;
  const sctx = signCanvas.getContext('2d');
  sctx.fillStyle = '#2d1b00'; sctx.fillRect(0, 0, 256, 64);
  sctx.strokeStyle = '#8d6e63'; sctx.lineWidth = 4; sctx.strokeRect(2, 2, 252, 60);
  sctx.font = 'bold 22px sans-serif'; sctx.textAlign = 'center';
  sctx.fillStyle = '#ffcc02'; sctx.fillText(agentName, 128, 42);
  const signTex = new THREE.CanvasTexture(signCanvas);
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, transparent: true }));
  sign.position.set(hx, houseH + 3.8, hz); sign.scale.set(3.5, 0.875, 1);
  scene.add(sign);

  // ===== Furniture (inside house area) =====
  // Table
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.7), mat.wood);
  table.position.set(hx - 1.5, 0.72, hz + 1); scene.add(table);
  [-0.55, 0.55].forEach(xo => [-0.25, 0.25].forEach(zo => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), mat.wood);
    leg.position.set(hx - 1.5 + xo, 0.35, hz + 1 + zo); scene.add(leg);
  }));
  // Chairs
  [-1, 1].forEach(side => {
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mat.doorWood);
    chair.position.set(hx - 1.5 + side * 1.1, 0.22, hz + 1); scene.add(chair);
  });
  // Bed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 2.2), new THREE.MeshStandardMaterial({ color: 0x90caf9, roughness: 0.7 }));
  bed.position.set(hx + 1.5, 0.12, hz - 0.8); scene.add(bed);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.45), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
  pillow.position.set(hx + 1.5, 0.3, hz - 1.7); scene.add(pillow);

  // ===== Trees (dynamic canopy with wind shader) =====
  const canopyColors = [
    new THREE.Color(0x4caf50), new THREE.Color(0x388e3c),
    new THREE.Color(0x66bb6a), new THREE.Color(0x2e7d32),
  ];
  const treePositions = [
    [ox + 2, oz + 2], [ox + W - 2, oz + 2], [ox + 2, oz + D - 2], [ox + W - 2, oz + D - 2],
    [cx + 5, cz + 3], [cx - 6, cz - 4], [cx + 3, cz - 6],
  ];
  treePositions.forEach(([tx, tz], ti) => {
    const treeH = 1.5 + Math.random() * 1;
    // Trunk with slight lean
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, treeH, 8), mat.trunkBrown);
    trunk.position.set(tx, treeH/2, tz);
    trunk.rotation.z = (Math.random() - 0.5) * 0.1;
    trunk.castShadow = true; scene.add(trunk);
    // Branch stubs
    for (let b = 0; b < 2; b++) {
      const bAngle = Math.random() * Math.PI * 2;
      const bH = treeH * (0.4 + Math.random() * 0.3);
      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 5), mat.trunkBrown);
      branch.position.set(tx + Math.cos(bAngle) * 0.15, bH, tz + Math.sin(bAngle) * 0.15);
      branch.rotation.z = Math.cos(bAngle) * 0.6;
      branch.rotation.x = Math.sin(bAngle) * 0.6;
      scene.add(branch);
    }
    // Canopy (shader-based, wind animated)
    const canopyR = 0.9 + Math.random() * 0.4;
    const canopyColor = canopyColors[ti % canopyColors.length];
    const canopyShaderMat = new THREE.ShaderMaterial({
      vertexShader: canopyVertexShader,
      fragmentShader: canopyFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 0.08 + Math.random() * 0.04 },
        uWindDir: { value: new THREE.Vector3(1, 0.2, 0.5).normalize() },
        uColor: { value: canopyColor },
        uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      },
    });
    // Multiple canopy spheres for fluffy look
    [[0, 0, 0, 1], [0.3, 0.1, 0.2, 0.85], [-0.2, 0.15, -0.15, 0.9], [0.1, -0.1, 0.25, 0.75]].forEach(([dx, dy, dz, scaleMod]) => {
      const canopyGeo = new THREE.SphereGeometry(canopyR * scaleMod, 14, 10);
      const canopy = new THREE.Mesh(canopyGeo, canopyShaderMat);
      canopy.position.set(tx + dx, treeH + canopyR * 0.5 + dy, tz + dz);
      canopy.castShadow = true; scene.add(canopy);
    });
    addObstacle(tx - 0.4, tx + 0.4, tz - 0.4, tz + 0.4, 'tree');
  });

  // ===== Dynamic Grass =====
  createGrassForContinent(ox, oz, W, D);

  // ===== Flowers =====
  const flowerColors = [mat.flowerRed, mat.flowerPink, mat.flowerYellow, mat.flowerPurple, mat.flowerWhite];
  for (let i = 0; i < 15; i++) {
    const fx = ox + 1 + Math.random() * (W - 2);
    const fz = oz + 1 + Math.random() * (D - 2);
    // Skip if too close to house or trees
    if (Math.abs(fx - hx) < 3.5 && Math.abs(fz - hz) < 3.5) continue;
    // Stem
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 4), mat.leafGreen);
    stem.position.set(fx, 0.12, fz); scene.add(stem);
    // Flower head
    const fColor = flowerColors[Math.floor(Math.random() * flowerColors.length)];
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), fColor);
    head.position.set(fx, 0.28, fz); scene.add(head);
  }

  // ===== Bushes =====
  for (let i = 0; i < 5; i++) {
    const bx = ox + 1.5 + Math.random() * (W - 3);
    const bz = oz + 1.5 + Math.random() * (D - 3);
    if (Math.abs(bx - hx) < 3 && Math.abs(bz - hz) < 3) continue;
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.4 + Math.random()*0.2, 10, 8), mat.bushGreen);
    bush.position.set(bx, 0.25, bz); bush.scale.y = 0.7; bush.castShadow = true; scene.add(bush);
  }

  // ===== Small Pond (shader-based animated water) =====
  const pondX = cx + 4, pondZ = cz + 4;
  const waterShaderMat = new THREE.ShaderMaterial({
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x5bc0eb) },
      uDeepColor: { value: new THREE.Color(0x1a7bb5) },
    },
    transparent: true,
    side: THREE.DoubleSide,
  });
  // Use a plane with segments for wave animation
  const pondGeo = new THREE.CircleGeometry(1.8, 24);
  const pond = new THREE.Mesh(pondGeo, waterShaderMat);
  pond.rotation.x = -Math.PI/2; pond.position.set(pondX, 0.02, pondZ); scene.add(pond);
  // Store for animation
  if (!window._waterMeshes) window._waterMeshes = [];
  window._waterMeshes.push(pond);

  // Lily pads
  for (let i = 0; i < 3; i++) {
    const la = Math.random() * Math.PI * 2;
    const lr = 0.5 + Math.random() * 0.8;
    const lily = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 8),
      new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.8, side: THREE.DoubleSide })
    );
    lily.rotation.x = -Math.PI / 2;
    lily.position.set(pondX + Math.cos(la) * lr, 0.04, pondZ + Math.sin(la) * lr);
    scene.add(lily);
  }

  // Pond edge stones
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
    const r = 1.8 + (Math.random() - 0.5) * 0.3;
    const rs = new THREE.Mesh(new THREE.SphereGeometry(0.15 + Math.random()*0.1, 6, 5), mat.rock);
    rs.position.set(pondX + Math.cos(a) * r, 0.1, pondZ + Math.sin(a) * r);
    rs.scale.y = 0.6; scene.add(rs);
  }

  // ===== Rocks =====
  for (let i = 0; i < 4; i++) {
    const rx = ox + 1 + Math.random() * (W - 2);
    const rz = oz + 1 + Math.random() * (D - 2);
    if (Math.abs(rx - hx) < 3 && Math.abs(rz - hz) < 3) continue;
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.15, 0),
      mat.rock
    );
    rock.position.set(rx, 0.12, rz);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.y = 0.7; scene.add(rock);
  }

  // ===== Fence (wooden picket around front yard) =====
  const fenceYard = { x1: hx - 3.5, x2: hx + 3.5, z1: hz + houseD/2 + 0.5, z2: hz + houseD/2 + 4 };
  for (let fx = fenceYard.x1; fx <= fenceYard.x2; fx += 0.8) {
    [fenceYard.z1, fenceYard.z2].forEach(fz => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), mat.fencePost);
      post.position.set(fx, 0.3, fz); scene.add(post);
      // Pointed top
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), mat.fencePost);
      cap.position.set(fx, 0.66, fz); scene.add(cap);
    });
  }
  // Horizontal rails
  [fenceYard.z1, fenceYard.z2].forEach(fz => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(fenceYard.x2 - fenceYard.x1, 0.05, 0.05), mat.fencePost);
    rail.position.set((fenceYard.x1 + fenceYard.x2)/2, 0.45, fz); scene.add(rail);
  });

  // ===== Lamp Post =====
  const lmpx = hx + houseW/2 + 1.5, lmpz = hz + houseD/2 + 1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8), mat.lampPost);
  pole.position.set(lmpx, 1.1, lmpz); scene.add(pole);
  const lampHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat.lampGlow);
  lampHead.position.set(lmpx, 2.3, lmpz); scene.add(lampHead);
  const lampLight = new THREE.PointLight(0xffee58, 0.4, 8);
  lampLight.position.set(lmpx, 2.2, lmpz); scene.add(lampLight);

  // ===== Bench (outside) =====
  const benchX = cx - 5, benchZ = cz + 1;
  const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.4), mat.wood);
  benchSeat.position.set(benchX, 0.45, benchZ); scene.add(benchSeat);
  const benchBack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.06), mat.wood);
  benchBack.position.set(benchX, 0.7, benchZ - 0.18); scene.add(benchBack);
  [-0.5, 0.5].forEach(xo => {
    const bLeg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.35), mat.doorWood);
    bLeg.position.set(benchX + xo, 0.22, benchZ); scene.add(bLeg);
  });

  // ===== Register Obstacles =====
  const pad = 0.3;
  addObstacle(hx - houseW/2 - pad, hx + houseW/2 + pad, hz - houseD/2 - pad, hz + houseD/2 + pad, 'house');
  addObstacle(hx - 1.5 - 0.7 - pad, hx - 1.5 + 0.7 + pad, hz + 1 - 0.35 - pad, hz + 1 + 0.35 + pad, 'table');
  [-1, 1].forEach(side => {
    const ccx = hx - 1.5 + side * 1.1;
    addObstacle(ccx - 0.22 - pad, ccx + 0.22 + pad, hz + 1 - 0.22 - pad, hz + 1 + 0.22 + pad, 'chair');
  });
  addObstacle(hx + 1.5 - 0.7 - pad, hx + 1.5 + 0.7 + pad, hz - 0.8 - 1.1 - pad, hz - 0.8 + 1.1 + pad, 'bed');
  addObstacle(lmpx - 0.2, lmpx + 0.2, lmpz - 0.2, lmpz + 0.2, 'lamp');
  addObstacle(benchX - 0.7, benchX + 0.7, benchZ - 0.3, benchZ + 0.3, 'bench');
  // Pond
  addObstacle(pondX - 2, pondX + 2, pondZ - 2, pondZ + 2, 'pond');
  // Boundary walls
  addObstacle(ox - 1, ox + 0.3, oz - 1, oz + D + 1, 'wall_west');
  addObstacle(ox + W - 0.3, ox + W + 1, oz - 1, oz + D + 1, 'wall_east');
  addObstacle(ox - 1, ox + W + 1, oz - 1, oz + 0.3, 'wall_north');
  addObstacle(ox - 1, ox + W + 1, oz + D - 0.3, oz + D + 1, 'wall_south');

  return { ox, oz, W, D, hx, hz, houseH };
}

// ===== Parse Session Key for Display =====
function parseSessionKey(key) {
  const parts = key.split(':');
  if (parts[0] !== 'agent') return { type: 'unknown', label: key.slice(0, 30), icon: '❓' };

  if (parts[2] === 'main' && parts.length === 3) return { type: 'main', label: '主会话', icon: '🏠' };
  if (parts[2] === 'feishu' && parts[3] === 'group') {
    const gid = parts.slice(4).join(':');
    return { type: 'group', label: gid.length > 16 ? gid.slice(0, 16) + '…' : gid, icon: '💬' };
  }
  if (parts[2] === 'feishu' && parts[3] === 'dm') {
    const uid = parts.slice(4).join(':');
    return { type: 'dm', label: uid.length > 16 ? uid.slice(0, 16) + '…' : uid, icon: '📩' };
  }
  if (parts[2] === 'cron') return { type: 'cron', label: '定时任务', icon: '⏰' };
  if (parts[2] === 'subagent') return { type: 'subagent', label: '子代理', icon: '🤖' };
  return { type: parts[2] || 'session', label: key.slice(0, 30), icon: '❓' };
}

// ===== Init World =====
function initWorld(worldData) {
  // Save existing minion positions & state before clearing
  const savedPositions = {};
  const savedBubbles = {};
  for (const m of minions) {
    const sk = m.userData.sessionKey;
    if (!sk) continue;
    savedPositions[sk] = {
      x: m.position.x, z: m.position.z,
      targetX: m.userData.targetX, targetZ: m.userData.targetZ,
    };
    // Save bubble visibility + content state
    const bub = bubbles[sk];
    if (bub) {
      const actsEl = bub.querySelector('.bub-acts');
      savedBubbles[sk] = {
        show: bub.classList.contains('show'),
        dismissed: bub._dismissed,
        collapsed: actsEl ? actsEl.classList.contains('collapsed') : true,
        userMsg: m.userData.userMsg,
        userName: m.userData.userName,
        state: m.userData.state,
        eventLog: m.userData.eventLog,
        replyText: m.userData.replyText,
        replyCount: m.userData.replyCount,
      };
    }
  }

  // Clear old scene objects (keep lights, camera)
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const c = scene.children[i];
    if (c.isLight) continue;
    scene.remove(c);
  }
  // Clear old bubbles
  Object.values(bubbles).forEach(el => el.remove());
  Object.keys(bubbles).forEach(k => delete bubbles[k]);
  minions.length = 0;
  clickables.length = 0;
  obstacles.length = 0;

  agents = worldData.agents || [];

  // Update HUD
  document.getElementById('h-agents').textContent = `Agents: ${agents.length}`;
  let totalSess = 0;
  agents.forEach(a => totalSess += a.sessions.length);
  document.getElementById('h-sess').textContent = `Sessions: ${totalSess}`;

  // Drawer: agents
  const agentsEl = document.getElementById('b-agents');
  agentsEl.innerHTML = agents.map(a => `<div class="row"><span><span class="dot on"></span>${esc(a.name)}</span><span>${a.sessions.length} sessions</span></div>`).join('');

  // Create continents and minions
  agents.forEach((agent, ai) => {
    const continent = createContinent(agent.name, ai);

    agent.sessions.forEach((sess, si) => {
      const profile = sess.profile || {};
      if (!profile.name) {
        profile.name = getRandomName();
        if (!profile.color) profile.color = [0xf5d033, 0xff6b6b, 0x4ecdc4, 0xffe66d, 0xa8e6cf][Math.floor(Math.random()*5)];
        if (!profile.heightScale) profile.heightScale = 0.8 + Math.random() * 0.4;
        if (!profile.widthScale) profile.widthScale = 0.9 + Math.random() * 0.2;
        // Save
        fetch('/api/minion-profiles', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [sess.key]: profile })
        }).catch(() => {});
      }

      const m = createMinion(profile);
      const cols = Math.ceil(Math.sqrt(agent.sessions.length));
      const col = si % cols, row = Math.floor(si / cols);
      const defaultPx = continent.ox + 3 + col * (continent.W - 6) / Math.max(cols - 1, 1);
      const defaultPz = continent.oz + 3 + row * (continent.D - 6) / Math.max(Math.ceil(agent.sessions.length / cols) - 1, 1);

      // Restore saved position if available
      const saved = savedPositions[sess.key];
      const px = saved ? saved.x : defaultPx;
      const pz = saved ? saved.z : defaultPz;
      m.position.set(px, 0, pz);
      m.userData.targetX = saved ? saved.targetX : defaultPx;
      m.userData.targetZ = saved ? saved.targetZ : defaultPz;
      m.userData.sessionKey = sess.key;
      m.userData.sessionId = sess.sessionId;
      m.userData.sessionType = sess.type;
      m.userData.sessionLabel = sess.label;
      m.userData.agentName = agent.name;
      m.userData.bounds = {
        minX: continent.ox + 1, maxX: continent.ox + continent.W - 1,
        minZ: continent.oz + 1, maxZ: continent.oz + continent.D - 1,
      };

      // Label
      const parsed = parseSessionKey(sess.key);
      const labelLine = `${parsed.icon} ${sess.label || parsed.label}`;
      addNameLabel(m, labelLine, profile.name);

      scene.add(m);
      minions.push(m);
      clickables.push(m);

      // Restore bubble state if it was open
      const sb = savedBubbles[sess.key];
      if (sb && sb.show) {
        m.userData.userMsg = sb.userMsg;
        m.userData.userName = sb.userName;
        m.userData.state = sb.state;
        m.userData.eventLog = sb.eventLog;
        m.userData.replyText = sb.replyText;
        m.userData.replyCount = sb.replyCount;
        const el = getOrCreateBubble(sess.key);
        el._dismissed = sb.dismissed;
        // Restore collapsed state
        if (sb.collapsed !== undefined) {
          const acts = el.querySelector('.bub-acts');
          if (acts) {
            if (sb.collapsed) acts.classList.add('collapsed');
            else acts.classList.remove('collapsed');
          }
        }
        if (!sb.dismissed) showBubble(m);
      }
    });
  });

  // Drawer: sessions
  const sessEl = document.getElementById('b-sessions');
  sessEl.innerHTML = agents.flatMap(a => a.sessions.map(s => {
    const p = parseSessionKey(s.key);
    return `<div class="row"><span>${p.icon} ${esc(s.label || p.label)}</span><span style="color:#556;font-size:7px">${esc(a.name)}</span></div>`;
  })).join('');
}

// ===== Bubbles =====
function getOrCreateBubble(sessionKey) {
  let el = bubbles[sessionKey];
  if (el && !document.body.contains(el)) { delete bubbles[sessionKey]; el = null; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'bubble3d';
    const sk = sessionKey;
    el.innerHTML = `<div class="bub-hd"><span class="bub-avatar">🟡</span><span class="bub-user"></span><button class="bub-close">✕</button></div><div class="bub-msg"></div><div class="bub-acts collapsed"><div class="bub-acts-hd"><span class="bub-acts-tri">▶</span><span class="bub-acts-lbl">思考过程</span><span class="bub-acts-cnt">0</span></div><div class="bub-acts-body"></div></div><div class="bub-chat"><input class="bub-chat-in" placeholder="直接对话..." /></div><div class="bub-foot"></div>`;

    // --- Focus management: prevent events from reaching canvas ---
    // Stop all mouse events from propagating out of the bubble
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    el.addEventListener('mouseup', (e) => { e.stopPropagation(); });
    el.addEventListener('mousemove', (e) => { e.stopPropagation(); });

    // Close button
    const closeBtn = el.querySelector('.bub-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideBubble(sk);
    });

    // Collapse/expand thinking panel
    const actsEl = el.querySelector('.bub-acts');
    const actsHd = el.querySelector('.bub-acts-hd');
    actsHd.addEventListener('click', (e) => {
      e.stopPropagation();
      actsEl.classList.toggle('collapsed');
    });
    // Also stop propagation on the acts body (clickable area)
    actsEl.addEventListener('mousedown', (e) => { e.stopPropagation(); });

    // IME-safe input handling: Enter submits only when not in composition
    const inputEl = el.querySelector('.bub-chat-in');
    let isComposing = false;
    inputEl.addEventListener('compositionstart', () => { isComposing = true; });
    inputEl.addEventListener('compositionend', () => { isComposing = false; });
    inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !isComposing) {
        e.preventDefault();
        sendDirectChat(sk, inputEl);
      }
      // Escape closes bubble
      if (e.key === 'Escape') {
        hideBubble(sk);
        inputEl.blur();
        inputEl.blur();
      }
    });
    // Track focus on input to prevent keyboard camera controls
    inputEl.addEventListener('focus', () => { interactingWithOverlay = true; });
    inputEl.addEventListener('blur', () => { interactingWithOverlay = false; });
    // Stop mousedown on input from starting canvas drag
    inputEl.addEventListener('mousedown', (e) => { e.stopPropagation(); });

    document.body.appendChild(el);
    bubbles[sessionKey] = el;
  }
  return el;
}

function updateBubblePosition(m, time) {
  const el = bubbles[m.userData.sessionKey];
  if (!el || !el.classList.contains('show')) return;

  const pos = new THREE.Vector3(m.position.x, m.position.y + 2.2, m.position.z);
  const sp = pos.clone().project(camera);
  if (sp.z > 1) { el.classList.remove('show'); return; }
  const x = (sp.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-sp.y * 0.5 + 0.5) * window.innerHeight;
  el.style.left = (x - 30) + 'px';
  el.style.top = (y - el.offsetHeight - 15) + 'px';
}

function updateBubbleContent(m) {
  const el = bubbles[m.userData.sessionKey];
  if (!el) return;
  const ud = m.userData;

  // Header
  const avatar = el.querySelector('.bub-avatar');
  avatar.textContent = ud.state === 'thinking' ? '🧠' : ud.state === 'streaming' ? '✍️' : '✅';
  el.querySelector('.bub-user').textContent = ud.userName || ud.sessionLabel || 'Session';

  // User message
  el.querySelector('.bub-msg').textContent = ud.userMsg || '';

  // Thinking/tools - interleaved from unified eventLog
  const actsBody = el.querySelector('.bub-acts-body');

  // Smart auto-scroll: only scroll to bottom if user is already near the bottom
  const wasAtBottom = actsBody.scrollHeight - actsBody.scrollTop - actsBody.clientHeight < 30;

  const items = [];
  const log = ud.eventLog || [];
  // Find the last reply_snippet index for divider placement
  let lastReplyIdx = -1;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === 'reply_snippet') { lastReplyIdx = i; break; }
  }
  const hasFinalReply = !!ud.replyText;

  for (let i = 0; i < log.length; i++) {
    const evt = log[i];
    // Insert divider before the last reply snippet
    if (i === lastReplyIdx || (i === log.length - 1 && hasFinalReply && evt.type !== 'reply_snippet')) {
      items.push('<div class="bact-divider"><span>── 回复 ──</span></div>');
    }
    if (evt.type === 'think') {
      items.push(`<div class="bact bact-think"><span>💭</span><span>${esc(evt.text)}${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ''}</span></div>`);
    } else if (evt.type === 'tool_use') {
      items.push(`<div class="bact bact-tool"><span>🔧</span><span>${esc(evt.text)} <em>${esc(evt.detail || '')}</em>${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ''}</span></div>`);
    } else if (evt.type === 'tool_result') {
      items.push(`<div class="bact bact-result"><span>📋</span><span>${esc(evt.text)} <em>${esc(evt.detail || '')}</em>${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ''}</span></div>`);
    } else if (evt.type === 'reply_snippet') {
      items.push(`<div class="bact bact-reply"><span>💬</span><span>${esc(evt.text)}${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ''}</span></div>`);
    }
  }
  // Final reply text (from reply_text event) with divider
  if (hasFinalReply) {
    if (lastReplyIdx === -1) items.push('<div class="bact-divider"><span>── 回复 ──</span></div>');
    items.push(`<div class="bact bact-reply bact-final"><span>💬</span><span>${esc(ud.replyText)}</span></div>`);
  }

  actsBody.innerHTML = items.slice(-30).join('');

  // Smart scroll: only auto-scroll if user was at the bottom
  if (wasAtBottom) {
    actsBody.scrollTop = actsBody.scrollHeight;
  }
  const thinkCount = log.filter(e => e.type === 'think').length;
  const toolCount = log.filter(e => e.type === 'tool_use' || e.type === 'tool_result').length;
  el.querySelector('.bub-acts-cnt').textContent = thinkCount + toolCount;

  // State class
  el.classList.remove('s-think', 's-stream', 's-done', 's-error');
  if (ud.state === 'thinking') el.classList.add('s-think');
  else if (ud.state === 'streaming') el.classList.add('s-stream');
  else el.classList.add('s-done');

  // Footer
  const tc = log.filter(e => e.type === 'think').length;
  const oc = log.filter(e => e.type === 'tool_use' || e.type === 'tool_result').length;
  el.querySelector('.bub-foot').textContent =
    ud.state === 'thinking' ? `🧠 思考中 (${tc}步, ${oc}工具)...` :
    ud.state === 'streaming' ? `✍️ 流式输出中...` :
    `✅ 思考了${tc}步 · 🔧${oc}工具 · 📤${ud.replyCount}条`;
}

// Unified bubble hide: cleans up focus, state, and refresh timer
function hideBubble(sessionKey) {
  const el = bubbles[sessionKey];
  if (!el) return;
  el.classList.remove('show');
  el._dismissed = true;
  // Blur input to release focus
  const inputEl = el.querySelector('.bub-chat-in');
  if (inputEl) inputEl.blur();
  interactingWithOverlay = false;
  stopBubbleRefresh(sessionKey);
}

function showBubble(m) {
  const el = getOrCreateBubble(m.userData.sessionKey);
  updateBubbleContent(m);
  if (!el._dismissed) el.classList.add('show');
  // Restore saved input if any
  if (m.userData.savedInput) {
    const inputEl = el.querySelector('.bub-chat-in');
    if (inputEl && !inputEl.value) {
      inputEl.value = m.userData.savedInput;
      m.userData.savedInput = '';
    }
  }
  // Clear notification when bubble is shown
  clearNotification(m);
  updateBubblePosition(m, 0);
}

// ===== SSE =====
let eventSource = null;
function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');
  eventSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'init') {
        initWorld(msg.data);
      } else if (msg.type === 'event') {
        handleEvent(msg.data);
      } else if (msg.type === 'control') {
        handleControl(msg.data);
      }
    } catch {}
  };
  eventSource.onerror = () => { setTimeout(connectSSE, 3000); };
}

// ===== Bubble Auto-Refresh (polling fallback for SSE gaps) =====
const bubbleRefreshTimers = {}; // sessionKey -> intervalId
const REFRESH_INTERVAL_MS = 3000; // refresh every 3s when bubble is active

function startBubbleRefresh(minion) {
  const sk = minion.userData.sessionKey;
  if (bubbleRefreshTimers[sk]) return; // already running

  bubbleRefreshTimers[sk] = setInterval(() => {
    const el = bubbles[sk];
    if (!el || !el.classList.contains('show') || el._dismissed) {
      stopBubbleRefresh(sk);
      return;
    }
    // Fetch latest messages and update bubble
    fetch(`/api/messages/${minion.userData.sessionId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.messages || data.messages.length === 0) return;
        applyMessagesToMinion(minion, data.messages);
        updateBubbleContent(minion);
      })
      .catch(() => {});
  }, REFRESH_INTERVAL_MS);
}

function stopBubbleRefresh(sk) {
  if (bubbleRefreshTimers[sk]) {
    clearInterval(bubbleRefreshTimers[sk]);
    delete bubbleRefreshTimers[sk];
  }
}

// Apply parsed messages from API to minion userData (rebuild eventLog)
function applyMessagesToMinion(minion, messages) {
  const ud = minion.userData;
  const last = messages.filter(m => m.role === 'user').pop();
  if (last) ud.userMsg = last.text || '';

  // Build eventLog from recent messages
  const histLog = [];
  const recent = messages.slice(-30);
  for (const msg of recent) {
    if (msg.role === 'assistant') {
      if (msg.thinking) histLog.push({ type: 'think', text: msg.thinking.slice(0, 150) });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          histLog.push({ type: 'tool_use', text: tc.name, detail: (tc.args || '').slice(0, 100) });
        }
      }
      if (msg.texts?.length) histLog.push({ type: 'reply_snippet', text: msg.texts.join(' ').slice(0, 150) });
    } else if (msg.role === 'toolResult') {
      histLog.push({ type: 'tool_result', text: (msg.toolName || '?') + ' ✓', detail: (msg.result || '').slice(0, 100) });
    }
  }
  // Only update if we got new data
  if (histLog.length > 0) {
    ud.eventLog = histLog;
    const lastReply = recent.filter(m => m.role === 'assistant' && m.texts?.length).pop();
    if (lastReply) ud.replyText = lastReply.texts.join(' ').slice(0, 200);
    // Determine state from last message
    const lastMsg = recent[recent.length - 1];
    if (lastMsg?.role === 'assistant') {
      ud.state = lastMsg.texts?.length ? 'done' : 'thinking';
    } else if (lastMsg?.role === 'toolResult') {
      ud.state = 'thinking';
    }
  }
}

function handleEvent(ev) {
  const m = minions.find(mn => mn.userData.sessionKey === ev.session);
  if (!m) return;
  const ud = m.userData;

  // Add to drawer log
  addLog(ev);

  if (ev.type === 'user_msg') {
    ud.userMsg = ev.msg || '';
    ud.userName = ev.userName || '';
    ud.eventLog = []; ud.replyText = ''; ud.replyCount = 0;
    ud.state = 'thinking'; ud.lastEventTime = Date.now();
    const b = bubbles[ud.sessionKey]; if (b) b._dismissed = false;
    showBubble(m);
    // Auto-expand thinking panel when new conversation starts
    const bubEl = bubbles[ud.sessionKey];
    if (bubEl) {
      const acts = bubEl.querySelector('.bub-acts');
      if (acts) acts.classList.remove('collapsed');
    }
    startBubbleRefresh(m); // Start polling for updates
  } else if (ev.type === 'thinking') {
    const now = new Date();
    ud.eventLog.push({ type: 'think', text: (ev.thinking || '').slice(0, 150), time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
    ud.state = 'thinking'; ud.lastEventTime = Date.now();
    const b = bubbles[ud.sessionKey]; if (b) b._dismissed = false;
    showBubble(m);
  } else if (ev.type === 'tool_use') {
    const now = new Date();
    ud.eventLog.push({ type: 'tool_use', text: ev.tool, detail: ev.args, time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
    ud.state = 'thinking'; ud.lastEventTime = Date.now();
    showBubble(m);
  } else if (ev.type === 'tool_result') {
    const now = new Date();
    ud.eventLog.push({ type: 'tool_result', text: ev.tool + ' ✓', detail: ev.result, time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
    showBubble(m);
  } else if (ev.type === 'reply_intermediate') {
    const now = new Date();
    ud.eventLog.push({ type: 'reply_snippet', text: (ev.text || '').slice(0, 120), time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
    ud.replyText = ev.text || '';
    ud.state = 'thinking'; ud.lastEventTime = Date.now();
    showBubble(m);
  } else if (ev.type === 'reply_text') {
    ud.replyText = ev.text || '';
    ud.replyCount++;
    ud.state = 'done'; ud.lastEventTime = Date.now();
    showBubble(m);
    clearNotification(m);
    // Do one final refresh after 2s to catch any trailing data
    setTimeout(() => {
      fetch(`/api/messages/${m.userData.sessionId}`)
        .then(r => r.json())
        .then(data => { if (data.messages) { applyMessagesToMinion(m, data.messages); updateBubbleContent(m); } })
        .catch(() => {});
    }, 2000);
    // Stop polling after a short delay (conversation is done)
    setTimeout(() => stopBubbleRefresh(ud.sessionKey), 5000);
    // Auto-hide after 30s, preserving chat input
    setTimeout(() => {
      if (Date.now() - ud.lastEventTime > 29500) {
        const b2 = bubbles[ud.sessionKey];
        if (b2 && b2.classList.contains('show')) {
          const inputEl = b2.querySelector('.bub-chat-in');
          if (inputEl && inputEl.value) ud.savedInput = inputEl.value;
          if (document.activeElement === inputEl && inputEl.value.trim()) return;
          hideBubble(ud.sessionKey);
          ud.state = 'idle';
        }
      }
    }, 30000);
  }
}

function addLog(ev) {
  const el = document.getElementById('b-logs');
  if (!el) return;
  const cls = `t_${ev.type}`;
  const icon = { user_msg: '👤', thinking: '💭', tool_use: '🔧', tool_result: '📋', reply_text: '💬', reply_intermediate: '💬' }[ev.type] || '📡';
  const text = ev.msg || ev.thinking || ev.text || ev.tool || '';
  const div = document.createElement('div');
  div.className = `log ${cls}`;
  div.textContent = `${icon} ${text.slice(0, 120)}`;
  el.appendChild(div);
  if (el.children.length > 80) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}

// ===== MCP Control Handler =====
function handleControl(data) {
  const m = minions.find(mn => mn.userData.sessionKey === data.sessionKey);
  if (!m && data.action !== 'batch') {
    console.warn('Control: minion not found', data.sessionKey);
    return;
  }
  const ud = m?.userData;

  switch (data.action) {
    case 'move': {
      if (!m) break;
      // Set walk target, clamped to bounds
      let tx = data.x, tz = data.z;
      if (ud.bounds) {
        tx = Math.max(ud.bounds.minX, Math.min(ud.bounds.maxX, tx));
        tz = Math.max(ud.bounds.minZ, Math.min(ud.bounds.maxZ, tz));
      }
      ud.targetX = tx;
      ud.targetZ = tz;
      ud.idleAction = 'walk';
      ud.idleTimer = 10; // force walk for a while
      if (data.speed) ud._mcpSpeed = data.speed;
      break;
    }
    case 'move_to_minion': {
      if (!m) break;
      const target = minions.find(mn => mn.userData.sessionKey === data.targetKey);
      if (!target) break;
      const offset = data.offsetDistance || 1.5;
      const angle = Math.random() * Math.PI * 2;
      let tx = target.position.x + Math.cos(angle) * offset;
      let tz = target.position.z + Math.sin(angle) * offset;
      if (ud.bounds) {
        tx = Math.max(ud.bounds.minX, Math.min(ud.bounds.maxX, tx));
        tz = Math.max(ud.bounds.minZ, Math.min(ud.bounds.maxZ, tz));
      }
      ud.targetX = tx;
      ud.targetZ = tz;
      ud.idleAction = 'walk';
      ud.idleTimer = 10;
      break;
    }
    case 'teleport': {
      if (!m) break;
      let tx = data.x, tz = data.z;
      if (ud.bounds) {
        tx = Math.max(ud.bounds.minX, Math.min(ud.bounds.maxX, tx));
        tz = Math.max(ud.bounds.minZ, Math.min(ud.bounds.maxZ, tz));
      }
      // Flash effect
      m.position.set(tx, 0.5, tz);
      ud.targetX = tx;
      ud.targetZ = tz;
      // Brief scale pop for visual feedback
      m.scale.set(1.3, 1.3, 1.3);
      setTimeout(() => { m.scale.set(1, 1, 1); }, 300);
      break;
    }
    case 'animate': {
      if (!m) break;
      triggerAnimation(m, data.animation, data.duration || 2.0);
      break;
    }
    case 'say': {
      if (!m) break;
      showMcpBubble(m, data.text, data.duration || 5.0, data.sender || '🤖 MCP');
      break;
    }
  }
}

// MCP-triggered animations
const activeAnimations = {}; // sessionKey -> { type, timer, endTime, duration, ring }

// Shared ring geometry & materials for animation effects
let ringGeo = null;
const ringColors = {
  jump: 0x22d3ee,    // cyan
  wave: 0xa78bfa,    // purple
  dance: 0xf472b6,   // pink
  spin: 0xfbbf24,    // amber
  nod: 0x60a5fa,     // blue
  shake: 0xef4444,   // red
  bow: 0x34d399,     // green
  clap: 0xf59e0b,    // orange
  think: 0x818cf8,   // indigo
  celebrate: 0xf43f5e, // rose
};

function triggerAnimation(minion, animType, duration) {
  const sk = minion.userData.sessionKey;
  // Clear any existing animation
  if (activeAnimations[sk]) {
    clearTimeout(activeAnimations[sk].timer);
    if (activeAnimations[sk].ring) scene.remove(activeAnimations[sk].ring);
  }

  // Create glow ring
  if (!ringGeo) ringGeo = new THREE.RingGeometry(0.6, 0.9, 32);
  const ringColor = ringColors[animType] || 0x22d3ee;
  const ringMat = new THREE.MeshBasicMaterial({
    color: ringColor, transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(minion.position.x, 0.02, minion.position.z);
  scene.add(ring);

  const endTime = Date.now() + duration * 1000;
  activeAnimations[sk] = { type: animType, endTime, duration, timer: null, ring };

  activeAnimations[sk].timer = setTimeout(() => {
    if (activeAnimations[sk]?.ring) scene.remove(activeAnimations[sk].ring);
    delete activeAnimations[sk];
    // Reset minion scale
    minion.scale.set(1, 1, 1);
    minion.rotation.x = 0;
    // Reset child rotations (head, arms)
    minion.children.forEach(c => {
      if (c.userData?.isArm || c.geometry?.type === 'SphereGeometry') {
        c.rotation.x = 0; c.rotation.z = 0;
      }
    });
  }, duration * 1000);
}

// MCP speech bubble (separate from the conversation bubble)
const mcpBubbles = {}; // sessionKey -> DOM element

function showMcpBubble(minion, text, duration, sender) {
  const sk = minion.userData.sessionKey;

  // Remove existing MCP bubble
  if (mcpBubbles[sk]) { mcpBubbles[sk].remove(); delete mcpBubbles[sk]; }

  const el = document.createElement('div');
  el.className = 'mcp-bubble';
  el.innerHTML = `<div class="mcp-bub-hd">${esc(sender)}</div><div class="mcp-bub-text">${esc(text)}</div>`;
  // Isolate events from canvas
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(el);
  mcpBubbles[sk] = el;

  // Position update function
  function updatePos() {
    if (!mcpBubbles[sk]) return;
    const pos = new THREE.Vector3(minion.position.x, minion.position.y + 3.2, minion.position.z);
    const sp = pos.clone().project(camera);
    if (sp.z > 1) { el.style.display = 'none'; return; }
    el.style.display = '';
    const x = (sp.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-sp.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = (x - 40) + 'px';
    el.style.top = (y - el.offsetHeight - 10) + 'px';
  }
  el._updatePos = updatePos;
  updatePos();

  // Auto-remove
  setTimeout(() => {
    if (mcpBubbles[sk] === el) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px) scale(0.9)';
      setTimeout(() => { el.remove(); delete mcpBubbles[sk]; }, 300);
    }
  }, duration * 1000);
}

// ===== Position Reporting =====
let lastPosReport = 0;
function reportPositions() {
  const now = Date.now();
  if (now - lastPosReport < 2000) return; // report every 2s
  lastPosReport = now;

  const positions = {};
  for (const m of minions) {
    const ud = m.userData;
    if (!ud.sessionKey) continue;
    positions[ud.sessionKey] = {
      x: m.position.x, y: m.position.y, z: m.position.z,
      state: ud.state,
      bounds: ud.bounds,
    };
  }
  fetch('/api/minions/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions })
  }).catch(() => {});
}

// ===== Click Detection =====
window.addEventListener('click', (e) => {
  // Don't process clicks that were part of a drag, or on DOM overlays
  if (isDragging || dragStarted) return;
  if (isBubbleEvent(e)) return;

  const mouse = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(clickables, true);
  if (hits.length > 0) {
    let target = hits[0].object;
    while (target.parent && !target.userData.sessionKey) target = target.parent;
    if (target.userData.sessionKey) {
      // Toggle bubble
      const b = bubbles[target.userData.sessionKey];
      if (b && b.classList.contains('show')) {
        hideBubble(target.userData.sessionKey);
      } else {
        // Load messages from API
        fetch(`/api/messages/${target.userData.sessionId}`).then(r => r.json()).then(data => {
          if (data.messages) {
            const last = data.messages.filter(m => m.role === 'user').pop();
            if (last) target.userData.userMsg = last.text || '';
            const lastReply = data.messages.filter(m => m.role === 'assistant' && m.texts?.length).pop();
            if (lastReply) target.userData.replyText = lastReply.texts.join(' ').slice(0, 200);
            // Build eventLog from historical messages — interleaved in chronological order
            const histLog = [];
            const recent = data.messages.slice(-20);
            for (const msg of recent) {
              if (msg.role === 'assistant') {
                if (msg.thinking) histLog.push({ type: 'think', text: msg.thinking.slice(0, 100) });
                if (msg.toolCalls) {
                  for (const tc of msg.toolCalls) {
                    histLog.push({ type: 'tool_use', text: tc.name, detail: (tc.args || '').slice(0, 80) });
                  }
                }
                if (msg.texts?.length) histLog.push({ type: 'reply_snippet', text: msg.texts.join(' ').slice(0, 100) });
              } else if (msg.role === 'toolResult') {
                histLog.push({ type: 'tool_result', text: (msg.toolName || '?') + ' ✓', detail: (msg.result || '').slice(0, 60) });
              }
            }
            target.userData.eventLog = histLog;
          }
          const b2 = getOrCreateBubble(target.userData.sessionKey);
          b2._dismissed = false;
          showBubble(target);
        }).catch(() => showBubble(target));
      }
    }
  }
});

// ===== Animation Loop =====
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.getElapsedTime();

  // Camera movement (must match lookAt direction: sin(yaw), 0, cos(yaw))
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  // right = forward × up (right-handed: if looking at +Z, right = +X)
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const speed = moveSpeed * dt;
  if (keys.w) camera.position.addScaledVector(forward, speed);
  if (keys.s) camera.position.addScaledVector(forward, -speed);
  if (keys.a) camera.position.addScaledVector(right, -speed);
  if (keys.d) camera.position.addScaledVector(right, speed);
  if (keys.space) camera.position.y += speed;
  if (keys.shift) camera.position.y -= speed;

  // Camera rotation
  const lookTarget = camera.position.clone().add(new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)
  ));
  camera.lookAt(lookTarget);

  // Minion animations
  minions.forEach(m => {
    const ud = m.userData;

    // Random movement
    ud.idleTimer -= dt;
    if (ud.idleTimer <= 0) {
      ud.idleTimer = 2 + Math.random() * 5;
      ud.idleAction = Math.random() < 0.3 ? 'walk' : 'stand';
      if (ud.idleAction === 'walk' && ud.bounds) {
        ud.targetX = ud.bounds.minX + Math.random() * (ud.bounds.maxX - ud.bounds.minX);
        ud.targetZ = ud.bounds.minZ + Math.random() * (ud.bounds.maxZ - ud.bounds.minZ);
      }
    }

    // Move towards target with collision detection
    if (ud.bounds) {
      const dx = ud.targetX - m.position.x, dz = ud.targetZ - m.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist > 0.1) {
        const baseSpd = 0.8;
        const spd = (ud._mcpSpeed || baseSpd) * dt;
        delete ud._mcpSpeed; // one-shot override
        const nx = m.position.x + (dx/dist) * spd;
        const nz = m.position.z + (dz/dist) * spd;
        // Check collision, try X-only or Z-only as fallback
        if (!collidesWithAny(nx, nz, ud.sessionKey)) {
          m.position.x = nx; m.position.z = nz;
        } else if (!collidesWithAny(nx, m.position.z, ud.sessionKey)) {
          m.position.x = nx;
        } else if (!collidesWithAny(m.position.x, nz, ud.sessionKey)) {
          m.position.z = nz;
        } else {
          // Fully blocked, pick new target
          ud.idleTimer = 0;
        }
        m.rotation.y = Math.atan2(dx, dz);
      }
      // Clamp bounds
      m.position.x = Math.max(ud.bounds.minX, Math.min(ud.bounds.maxX, m.position.x));
      m.position.z = Math.max(ud.bounds.minZ, Math.min(ud.bounds.maxZ, m.position.z));
    }

    // Subtle bob (base)
    let yOff = Math.sin(time * 1.5 + ud.bobPhase) * 0.02;
    let extraRotY = 0;
    let extraRotX = 0;
    let pulseScale = 1;

    // MCP custom animations (dramatic and visible)
    const anim = activeAnimations[ud.sessionKey];
    if (anim && Date.now() < anim.endTime) {
      const remaining = (anim.endTime - Date.now()) / 1000;
      const progress = 1 - remaining / anim.duration; // 0→1

      switch (anim.type) {
        case 'jump':
          // Big bouncing jumps
          yOff += Math.abs(Math.sin(time * 6)) * 0.6;
          pulseScale = 1 + Math.sin(time * 8) * 0.08;
          break;
        case 'dance':
          // Rhythmic body sway + bounce
          extraRotY = Math.sin(time * 5) * 0.4;
          extraRotX = Math.sin(time * 7) * 0.1;
          yOff += Math.abs(Math.sin(time * 4)) * 0.3;
          pulseScale = 1 + Math.sin(time * 6) * 0.05;
          break;
        case 'spin':
          // Fast spinning
          extraRotY = dt * 12;
          yOff += 0.15;
          pulseScale = 1 + Math.sin(time * 10) * 0.06;
          break;
        case 'nod':
          // Dramatic head nod
          m.children.forEach(c => {
            if (c.geometry?.type === 'SphereGeometry') {
              c.rotation.x = Math.sin(time * 6) * 0.4;
            }
          });
          yOff += Math.abs(Math.sin(time * 3)) * 0.1;
          break;
        case 'shake':
          // Vigorous shaking
          m.position.x += Math.sin(time * 20) * 0.08;
          m.position.z += Math.cos(time * 20) * 0.04;
          pulseScale = 1 + Math.sin(time * 15) * 0.04;
          break;
        case 'bow':
          // Deep bow
          const bowAngle = Math.sin(Math.min(1, progress * 2) * Math.PI) * 0.5;
          extraRotX = bowAngle;
          yOff -= Math.abs(bowAngle) * 0.3;
          break;
        case 'clap':
          // Arms clapping together
          m.children.forEach(c => {
            if (c.userData?.isArm) {
              c.rotation.x = -1.0 + Math.sin(time * 12) * 0.5;
              c.rotation.z = c.userData.side * (0.5 + Math.sin(time * 12) * 0.3);
            }
          });
          yOff += Math.abs(Math.sin(time * 4)) * 0.15;
          break;
        case 'celebrate':
          // Big jumps + wiggle
          yOff += Math.abs(Math.sin(time * 5)) * 0.55;
          extraRotY = Math.sin(time * 4) * 0.3;
          pulseScale = 1 + Math.sin(time * 8) * 0.1;
          break;
        case 'wave':
          // One arm waving high
          m.children.forEach(c => {
            if (c.userData?.isArm && c.userData.side > 0) {
              c.rotation.x = Math.sin(time * 8) * 0.6 - 0.9;
            }
          });
          yOff += 0.08;
          break;
        case 'think':
          // Tilted head + slow sway
          extraRotY = Math.sin(time * 1.5) * 0.15;
          m.children.forEach(c => {
            if (c.geometry?.type === 'SphereGeometry') {
              c.rotation.z = 0.2;
            }
          });
          yOff += Math.sin(time * 2) * 0.05;
          break;
      }

      // Glow ring under minion during animation
      if (anim.ring) {
        anim.ring.position.set(m.position.x, 0.02, m.position.z);
        anim.ring.material.opacity = 0.4 + Math.sin(time * 8) * 0.2;
        anim.ring.rotation.z = time * 2;
        const ringScale = 1 + Math.sin(time * 6) * 0.2;
        anim.ring.scale.set(ringScale, ringScale, 1);
      }

      // Apply scale pulse
      m.scale.set(pulseScale, pulseScale, pulseScale);
    } else {
      // Not animating: reset scale smoothly
      m.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
    }

    // Apply rotation
    m.rotation.y += extraRotY;
    m.rotation.x = extraRotX;

    // (attentionAnim replaced by activeAnimations system)

    m.position.y = yOff;

    // Arm swing (default subtle, animations override via switch above)
    m.children.forEach(c => {
      if (c.userData?.isArm) {
        if (!anim || (anim.type !== 'wave' && anim.type !== 'clap')) {
          c.rotation.x = Math.sin(time * 2 + ud.bobPhase + (c.userData.side > 0 ? 0 : Math.PI)) * 0.15;
          c.rotation.z = 0;
        }
      }
    });

    // Notification indicator bob
    if (ud.notificationSprite) {
      ud.notificationSprite.position.y = 2.5 * (ud.heightScale || 1) * 0.5 + 1.8 + Math.sin(time * 3 + ud.bobPhase) * 0.1;
    }

    // Update MCP bubble positions
    const mcpBub = mcpBubbles[ud.sessionKey];
    if (mcpBub && mcpBub._updatePos) mcpBub._updatePos();

    // Update bubble position
    updateBubblePosition(m, time);
  });

  // Report positions to server periodically
  reportPositions();

  // Update floating petals
  updatePetals(dt, time);

  // Day/Night cycle
  updateDayNightCycle(dt);

  // Minimap
  drawMinimap();

  // Agent dashboard (every ~2s)
  if (Math.floor(time * 0.5) !== Math.floor((time - dt) * 0.5)) {
    updateAgentDashboard();
  }

  // Minion interaction
  updateMinionInteraction(dt);

  // Rain system
  updateRain(dt);

  // State persistence
  updateSaveStateTimer(dt);

  // Update dynamic grass wind (with LOD)
  updateGrassWithLOD(time);

  // Update water shader
  if (window._waterMeshes) {
    for (const w of window._waterMeshes) {
      if (w.material.uniforms?.uTime) w.material.uniforms.uTime.value = time;
    }
  }

  renderer.render(scene, camera);
}

// ===== CLI =====
window.runCmd = function() {
  const inp = document.getElementById('cmd-in');
  const out = document.getElementById('cmd-out');
  const cmd = inp.value.trim();
  if (!cmd) return;
  out.style.display = 'block'; out.textContent = 'Running...';
  fetch('/api/cli', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd })
  }).then(r => r.json()).then(d => { out.textContent = d.output || d.error || 'No output'; })
    .catch(e => { out.textContent = 'Error: ' + e.message; });
};

// ===== Helper =====
// ===== Direct Chat =====
window.sendDirectChat = function(sessionKey, inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  const minion = minions.find(m => m.userData.sessionKey === sessionKey);
  if (!minion) return;
  const sessionId = minion.userData.sessionId;

  // Show in bubble immediately
  const ud = minion.userData;
  ud.userMsg = text;
  ud.userName = '🖥️ Monitor';
  ud.eventLog = []; ud.replyText = '';
  ud.state = 'thinking'; ud.lastEventTime = Date.now();
  showBubble(minion);

  // Send to server
  fetch(`/api/chat/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).catch(e => console.error('Chat error:', e));
};

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

// ===== Resize =====
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ===== Drawer / Sidebar Initialization =====
(function initDrawer() {
  const drawer = document.getElementById('drawer');
  const toggle = document.getElementById('toggle');

  // Toggle button
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    drawer.classList.toggle('shut');
  });
  toggle.addEventListener('mousedown', (e) => e.stopPropagation());

  // Section collapse/expand
  document.querySelectorAll('.sec-h').forEach(hd => {
    hd.addEventListener('click', (e) => {
      e.stopPropagation();
      hd.parentElement.classList.toggle('off');
    });
  });

  // CLI input: Enter to run, Escape to blur, isolate events
  const cmdIn = document.getElementById('cmd-in');
  if (cmdIn) {
    cmdIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        window.runCmd();
      }
      if (e.key === 'Escape') {
        cmdIn.blur();
      }
    });
    cmdIn.addEventListener('focus', () => { interactingWithOverlay = true; });
    cmdIn.addEventListener('blur', () => { interactingWithOverlay = false; });
    cmdIn.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // Drawer body: stop mouse events from reaching canvas
  drawer.addEventListener('mousedown', (e) => e.stopPropagation());
  drawer.addEventListener('mouseup', (e) => e.stopPropagation());
})();

// ===== Clouds (sky decoration) =====
function initClouds() {
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 15; i++) {
    const cloud = new THREE.Group();
    const count = 4 + Math.floor(Math.random() * 4);
    for (let j = 0; j < count; j++) {
      const r = 2 + Math.random() * 3;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), cloudMat);
      puff.position.set(j * 2.5 - count * 1.2, Math.random() * 0.8, Math.random() * 1.2);
      puff.scale.y = 0.35 + Math.random() * 0.15;
      cloud.add(puff);
    }
    cloud.position.set(
      (Math.random() - 0.5) * 120,
      25 + Math.random() * 10,
      (Math.random() - 0.5) * 120
    );
    cloud.userData = { speed: 0.2 + Math.random() * 0.3, dir: Math.random() > 0.5 ? 1 : -1 };
    scene.add(cloud);
  }
}
initClouds();

// ===== Dynamic Grass (InstancedMesh + Custom Shader) =====
const grassInstances = []; // { mesh, count }

const grassVertexShader = `
  uniform float uTime;
  uniform float uWindStrength;
  varying vec2 vUv;
  varying float vHeight;
  void main() {
    vUv = uv;
    vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 mvPosition = modelViewMatrix * instancePos;
    vec3 pos = position;
    vHeight = pos.y;
    // Wind sway: stronger at top
    float sway = sin(uTime * 2.0 + instancePos.x * 0.5 + instancePos.z * 0.7) * uWindStrength;
    float sway2 = cos(uTime * 1.5 + instancePos.x * 0.3 - instancePos.z * 0.4) * uWindStrength * 0.5;
    pos.x += sway * pos.y * 0.8;
    pos.z += sway2 * pos.y * 0.5;
    // Apply instance transform
    vec4 worldPos = instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * worldPos;
  }
`;

const grassFragmentShader = `
  varying vec2 vUv;
  varying float vHeight;
  uniform vec3 uColorBottom;
  uniform vec3 uColorTop;
  void main() {
    // Gradient from dark bottom to bright top
    vec3 color = mix(uColorBottom, uColorTop, vHeight * 2.5);
    // Slight tip darkening
    if (vHeight > 0.35) color *= 0.9;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function createGrassForContinent(ox, oz, W, D) {
  const grassBladeGeo = new THREE.PlaneGeometry(0.06, 0.35, 1, 3);
  // Slightly curve the blade
  const posAttr = grassBladeGeo.getAttribute('position');
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    if (y > 0) posAttr.setX(i, posAttr.getX(i) + 0.02 * (y / 0.175));
  }
  posAttr.needsUpdate = true;

  const grassMat = new THREE.ShaderMaterial({
    vertexShader: grassVertexShader,
    fragmentShader: grassFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uWindStrength: { value: 0.04 },
      uColorBottom: { value: new THREE.Color(0x2d7a3a) },
      uColorTop: { value: new THREE.Color(0x66cc6e) },
    },
    side: THREE.DoubleSide,
  });

  // Place grass instances across the continent
  const density = 12; // blades per unit
  const count = Math.floor(W * D * density / 4); // spread over area
  const grassMesh = new THREE.InstancedMesh(grassBladeGeo, grassMat, count);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const gx = ox + 1 + Math.random() * (W - 2);
    const gz = oz + 1 + Math.random() * (D - 2);
    dummy.position.set(gx, 0.15, gz);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.scale.set(0.8 + Math.random() * 0.6, 0.7 + Math.random() * 0.8, 1);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);
  }
  grassMesh.instanceMatrix.needsUpdate = true;
  scene.add(grassMesh);
  grassInstances.push({ mesh: grassMesh, mat: grassMat });
}

function updateGrass(time) {
  for (const g of grassInstances) {
    g.mat.uniforms.uTime.value = time;
  }
}

// ===== Tree Canopy Wind Shader =====
const canopyVertexShader = `
  uniform float uTime;
  uniform float uWindStrength;
  uniform vec3 uWindDir;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec3 pos = position;
    // Wind sway: based on height and world X/Z
    float heightFactor = max(0.0, pos.y) * 0.5;
    float sway = sin(uTime * 1.8 + pos.x * 2.0 + pos.z * 1.5) * uWindStrength * heightFactor;
    pos += uWindDir * sway;
    pos.x += cos(uTime * 1.2 + pos.z * 3.0) * uWindStrength * 0.3 * heightFactor;
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const canopyFragmentShader = `
  uniform vec3 uColor;
  uniform vec3 uLightDir;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    // Simple toon-ish lighting
    float NdotL = dot(normalize(vNormal), normalize(uLightDir));
    float light = 0.4 + 0.6 * max(0.0, NdotL);
    // Darken bottom
    float bottomDark = smoothstep(-0.5, 1.0, vWorldPos.y);
    vec3 color = uColor * light * (0.7 + 0.3 * bottomDark);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ===== Enhanced Water Shader =====
const waterVertexShader = `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec3 pos = position;
    // Gentle waves
    pos.y += sin(pos.x * 3.0 + uTime * 1.5) * 0.02;
    pos.y += cos(pos.z * 2.5 + uTime * 1.2) * 0.015;
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const waterFragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uDeepColor;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    // Ripple pattern
    float ripple = sin(vUv.x * 20.0 + uTime * 2.0) * cos(vUv.y * 18.0 + uTime * 1.5) * 0.5 + 0.5;
    // Fresnel-like edge brightening
    float dist = length(vUv - 0.5) * 2.0;
    float edge = smoothstep(0.0, 0.8, dist);
    vec3 color = mix(uDeepColor, uColor, ripple * 0.5 + 0.3);
    color = mix(color, uColor * 1.3, edge * 0.3);
    // Sparkle
    float sparkle = pow(max(0.0, sin(vUv.x * 50.0 + uTime * 3.0) * sin(vUv.y * 45.0 - uTime * 2.5)), 8.0);
    color += vec3(sparkle * 0.4);
    float alpha = 0.65 + ripple * 0.1;
    gl_FragColor = vec4(color, alpha);
  }
`;

// ===== Floating Petals (atmosphere particles) =====
const petals = [];
const petalColors = [0xffc0cb, 0xffb7c5, 0xfff0f5, 0xffe4e1, 0xfce4ec, 0xe8f5e9];
function initPetals() {
  const petalGeo = new THREE.PlaneGeometry(0.12, 0.08);
  for (let i = 0; i < 30; i++) {
    const color = petalColors[Math.floor(Math.random() * petalColors.length)];
    const pmat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    const petal = new THREE.Mesh(petalGeo, pmat);
    petal.position.set(
      (Math.random() - 0.5) * 100,
      2 + Math.random() * 15,
      (Math.random() - 0.5) * 100
    );
    petal.userData = {
      speed: 0.3 + Math.random() * 0.5,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 1 + Math.random() * 2,
      rotSpeed: (Math.random() - 0.5) * 3,
      drift: (Math.random() - 0.5) * 0.3,
    };
    scene.add(petal);
    petals.push(petal);
  }
}
initPetals();
initRainSystem();

function updatePetals(dt, time) {
  for (const p of petals) {
    const ud = p.userData;
    p.position.y -= ud.speed * dt;
    p.position.x += Math.sin(time * ud.wobbleSpeed + ud.wobble) * ud.drift * dt;
    p.position.z += Math.cos(time * ud.wobbleSpeed * 0.7 + ud.wobble) * ud.drift * dt * 0.5;
    p.rotation.x += ud.rotSpeed * dt;
    p.rotation.z += ud.rotSpeed * 0.5 * dt;
    // Reset when below ground
    if (p.position.y < 0) {
      p.position.y = 12 + Math.random() * 5;
      p.position.x = (Math.random() - 0.5) * 100;
      p.position.z = (Math.random() - 0.5) * 100;
    }
  }
}

// ===== Day/Night Cycle =====
function updateDayNightCycle(dt) {
  gameTime = (gameTime + dt) % DAY_CYCLE;
  const t = gameTime / DAY_CYCLE; // 0-1

  let skyColor, fogColor, sunIntensity, sunAngle;

  if (t < 20/120) {
    // Dawn (0-20s): pink/orange sky, dim sun
    const p = t / (20/120);
    skyColor = new THREE.Color(0xffb6c1).lerp(new THREE.Color(0xff8c00), p);
    fogColor = skyColor.clone();
    sunIntensity = 0.2 + p * 0.3;
    sunAngle = p * Math.PI * 0.3; // rising
  } else if (t < 60/120) {
    // Day (20-60s): blue sky, bright sun
    const p = (t - 20/120) / (40/120);
    skyColor = new THREE.Color(0x87ceeb).lerp(new THREE.Color(0x7ec8e3), Math.sin(p * Math.PI));
    fogColor = skyColor.clone();
    sunIntensity = 0.5 + Math.sin(p * Math.PI) * 0.7;
    sunAngle = Math.PI * 0.3 + p * Math.PI * 0.4;
  } else if (t < 80/120) {
    // Dusk (60-80s): purple/orange sky, dim sun
    const p = (t - 60/120) / (20/120);
    skyColor = new THREE.Color(0xff8c00).lerp(new THREE.Color(0x9b59b6), p);
    fogColor = skyColor.clone();
    sunIntensity = 0.5 - p * 0.35;
    sunAngle = Math.PI * 0.7 + p * Math.PI * 0.3;
  } else {
    // Night (80-120s): dark blue sky, moonlight
    const p = (t - 80/120) / (40/120);
    skyColor = new THREE.Color(0x1a1a3e).lerp(new THREE.Color(0x0a0a2e), Math.sin(p * Math.PI));
    fogColor = skyColor.clone();
    sunIntensity = 0.15 + Math.sin(p * Math.PI) * 0.05;
    sunAngle = Math.PI + p * Math.PI * 0.5;
  }

  scene.background = skyColor;
  scene.fog.color = fogColor;
  sun.intensity = sunIntensity;
  sun.color.copy(skyColor).lerp(new THREE.Color(0xffeedd), 0.5);
  sun.position.set(
    Math.cos(sunAngle) * 40,
    20 + Math.sin(sunAngle) * 30,
    Math.sin(sunAngle) * 30
  );

  // Lamp posts: on at night, off during day
  const isNight = t > 70/120 || t < 10/120;
  scene.traverse(obj => {
    if (obj.isPointLight && obj.color.getHex() === 0xffee58) {
      obj.intensity = isNight ? 0.8 : 0;
    }
  });
}

// ===== Minimap =====
function drawMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 200, H = 200;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = 'rgba(8, 8, 24, 0.85)';
  ctx.fillRect(0, 0, W, H);

  // World bounds approximation
  const worldSize = 120;
  const scale = W / worldSize;
  const offsetX = W / 2;
  const offsetZ = H / 2;

  // Draw continents as green rectangles
  agents.forEach((agent, ai) => {
    const cols = Math.ceil(Math.sqrt(agents.length));
    const col = ai % cols, row = Math.floor(ai / cols);
    const W2 = 22, D = 22;
    const ox = col * (W2 + 6) - (cols - 1) * (W2 + 6) / 2;
    const oz = row * (D + 6) - (Math.ceil(agents.length / cols) - 1) * (D + 6) / 2;

    const mx = offsetX + ox * scale;
    const mz = offsetZ + oz * scale;
    ctx.fillStyle = 'rgba(34, 197, 94, 0.5)';
    ctx.fillRect(mx, mz, W2 * scale, D * scale);
    // House dot
    const hx = ox + W2/2 - 2, hz = oz + D/2 - 2;
    ctx.fillStyle = '#a16207';
    ctx.beginPath();
    ctx.arc(offsetX + hx * scale, offsetZ + hz * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw minions as colored circles
  for (const m of minions) {
    const mx = offsetX + m.position.x * scale;
    const mz = offsetZ + m.position.z * scale;
    const color = '#' + (m.userData.sessionKey ? 'f5d033' : '888888');
    ctx.fillStyle = m.userData.state === 'thinking' ? '#a78bfa' :
                    m.userData.state === 'streaming' ? '#3b82f6' :
                    m.userData.state === 'done' ? '#10b981' : '#f5d033';
    ctx.beginPath();
    ctx.arc(mx, mz, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Camera position indicator
  const camX = offsetX + camera.position.x * scale;
  const camZ = offsetZ + camera.position.z * scale;
  ctx.strokeStyle = '#53d8fb';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(camX - 5, camZ);
  ctx.lineTo(camX + 5, camZ);
  ctx.moveTo(camX, camZ - 5);
  ctx.lineTo(camX, camZ + 5);
  ctx.stroke();
  // Direction triangle
  const dirX = Math.sin(yaw) * 8;
  const dirZ = Math.cos(yaw) * 8;
  ctx.fillStyle = '#53d8fb';
  ctx.beginPath();
  ctx.moveTo(camX + dirX, camZ + dirZ);
  ctx.lineTo(camX - dirZ * 0.4, camZ + dirX * 0.4);
  ctx.lineTo(camX + dirZ * 0.4, camZ - dirX * 0.4);
  ctx.closePath();
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(83, 216, 251, 0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, W, H);
}

// Minimap click handler
(function initMinimapClick() {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  canvas.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const mz = e.clientY - rect.top;
    const worldSize = 120;
    const scale = 200 / worldSize;
    const worldX = (mx - 100) / scale;
    const worldZ = (mz - 100) / scale;
    camera.position.x = worldX;
    camera.position.z = worldZ;
  });
  canvas.addEventListener('mousedown', (e) => e.stopPropagation());
})();

// ===== Agent Dashboard Enhancement =====
function updateAgentDashboard() {
  const now = Date.now();
  const FIVE_MIN = 5 * 60 * 1000;

  agents.forEach(agent => {
    let activeCount = 0;
    agent.sessions.forEach(sess => {
      const m = minions.find(mn => mn.userData.sessionKey === sess.key);
      if (m && m.userData.lastEventTime && (now - m.userData.lastEventTime) < FIVE_MIN) {
        activeCount++;
      }
    });
    agent._activeCount = activeCount;
  });

  // Update HUD
  const totalActive = agents.reduce((sum, a) => sum + (a._activeCount || 0), 0);
  const hudEl = document.getElementById('h-sess');
  if (hudEl) {
    let totalSess = 0;
    agents.forEach(a => totalSess += a.sessions.length);
    hudEl.textContent = `Sessions: ${totalSess} (${totalActive} active)`;
  }

  // Update drawer agents with active counts
  const agentsEl = document.getElementById('b-agents');
  if (agentsEl) {
    agentsEl.innerHTML = agents.map(a =>
      `<div class="row"><span><span class="dot ${a._activeCount > 0 ? 'on' : 'off'}"></span>${esc(a.name)}</span><span>${a._activeCount || 0}/${a.sessions.length} active</span></div>`
    ).join('');
  }
}

// ===== Minion Interaction =====
const minionEmojis = ['💚', '💬'];
const floatingEmojis = []; // { sprite, life, maxLife }

function updateMinionInteraction(dt) {
  const now = Date.now();

  for (let i = 0; i < minions.length; i++) {
    for (let j = i + 1; j < minions.length; j++) {
      const a = minions[i], b = minions[j];
      const dx = a.position.x - b.position.x;
      const dz = a.position.z - b.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 2) {
        // 5% chance per second
        if (Math.random() < 0.05 * dt) {
          const target = Math.random() > 0.5 ? a : b;
          triggerAnimation(target, 'wave', 1.5);

          // Show floating emoji between them
          const emoji = minionEmojis[Math.floor(Math.random() * minionEmojis.length)];
          const midX = (a.position.x + b.position.x) / 2;
          const midZ = (a.position.z + b.position.z) / 2;
          const midY = Math.max(a.position.y, b.position.y) + 1.5;
          showFloatingEmoji(emoji, midX, midY, midZ);
        }
      }
    }
  }

  // Update floating emojis
  for (let i = floatingEmojis.length - 1; i >= 0; i--) {
    const fe = floatingEmojis[i];
    fe.life -= dt;
    fe.sprite.position.y += dt * 0.8;
    fe.sprite.material.opacity = Math.max(0, fe.life / fe.maxLife);
    if (fe.life <= 0) {
      scene.remove(fe.sprite);
      fe.sprite.material.dispose();
      floatingEmojis.splice(i, 1);
    }
  }
}

function showFloatingEmoji(emoji, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 32, 36);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.set(0.8, 0.8, 1);
  scene.add(sprite);
  floatingEmojis.push({ sprite, life: 2.0, maxLife: 2.0 });
}

// ===== Rain System =====
function initRainSystem() {
  const rainGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4);
  const rainMat = new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.4 });

  for (let i = 0; i < RAIN_COUNT; i++) {
    const drop = new THREE.Mesh(rainGeo, rainMat.clone());
    drop.position.set(
      (Math.random() - 0.5) * 80,
      15 + Math.random() * 10,
      (Math.random() - 0.5) * 80
    );
    drop.visible = false;
    scene.add(drop);
    rainDrops.push(drop);
  }

  // Splash particles
  const splashGeo = new THREE.SphereGeometry(0.03, 4, 4);
  const splashMat = new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.3 });
  for (let i = 0; i < 60; i++) {
    const splash = new THREE.Mesh(splashGeo, splashMat.clone());
    splash.visible = false;
    scene.add(splash);
    rainSplashParticles.push(splash);
  }
}

function toggleRain() {
  isRaining = !isRaining;
  for (const drop of rainDrops) {
    drop.visible = isRaining;
  }
}

function updateRain(dt) {
  if (!isRaining) return;

  // Dim lighting
  sun.intensity = Math.max(0.15, sun.intensity * 0.7);

  // Update raindrops
  for (const drop of rainDrops) {
    drop.position.y -= 15 * dt;
    drop.position.x += Math.sin(drop.position.z * 0.1) * dt * 0.5;

    if (drop.position.y < 0) {
      // Trigger splash
      const splash = rainSplashParticles[Math.floor(Math.random() * rainSplashParticles.length)];
      if (splash) {
        splash.visible = true;
        splash.position.set(drop.position.x, 0.1, drop.position.z);
        splash.userData.life = 0.3;
        splash.userData.vx = (Math.random() - 0.5) * 2;
        splash.userData.vz = (Math.random() - 0.5) * 2;
        splash.userData.vy = 1 + Math.random() * 2;
      }

      drop.position.y = 15 + Math.random() * 10;
      drop.position.x = camera.position.x + (Math.random() - 0.5) * 60;
      drop.position.z = camera.position.z + (Math.random() - 0.5) * 60;
    }
  }

  // Update splash particles
  for (const splash of rainSplashParticles) {
    if (!splash.visible) continue;
    splash.userData.life -= dt;
    if (splash.userData.life <= 0) {
      splash.visible = false;
      continue;
    }
    splash.position.x += (splash.userData.vx || 0) * dt;
    splash.position.y += (splash.userData.vy || 0) * dt;
    splash.position.z += (splash.userData.vz || 0) * dt;
    splash.userData.vy -= 5 * dt; // gravity
    splash.material.opacity = splash.userData.life / 0.3 * 0.3;
  }
}

// ===== Grass LOD =====
const originalUpdateGrass = updateGrass;
function updateGrassWithLOD(time) {
  const camPos = camera.position;
  for (const g of grassInstances) {
    // Default wind
    let windStrength = 0.04;

    // Check approximate distance from camera to grass mesh center
    // Use instance count midpoint as rough estimate
    // Actually, per-blade LOD is too expensive with InstancedMesh,
    // so we'll modify the shader uniform based on camera distance
    // We need to find the continent center from the mesh position
    // Since grass meshes don't move, use the first instance matrix as reference
    const mat4 = new THREE.Matrix4();
    g.mesh.getMatrixAt(0, mat4);
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(mat4);
    const dist = camPos.distanceTo(pos);

    if (dist > 60) {
      // Hide distant grass (set wind to 0 and very low opacity trick - actually just skip)
      g.mesh.visible = false;
    } else if (dist > 30) {
      g.mesh.visible = true;
      windStrength = 0.01; // reduced wind
    } else {
      g.mesh.visible = true;
      windStrength = 0.04;
    }

    g.mat.uniforms.uTime.value = time;
    g.mat.uniforms.uWindStrength.value = windStrength;
  }
}

// ===== Scene State Persistence =====
function saveSceneState() {
  const state = {
    camera: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      yaw: yaw,
      pitch: pitch,
    },
    openBubbles: [],
  };

  // Save open bubble states
  for (const sk in bubbles) {
    const el = bubbles[sk];
    if (el && el.classList.contains('show') && !el._dismissed) {
      state.openBubbles.push(sk);
    }
  }

  try {
    localStorage.setItem('openclaw-monitor-state', JSON.stringify(state));
  } catch {}
}

function restoreSceneState() {
  try {
    const raw = localStorage.getItem('openclaw-monitor-state');
    if (!raw) return;
    const state = JSON.parse(raw);

    if (state.camera) {
      camera.position.set(state.camera.x || 25, state.camera.y || 30, state.camera.z || 35);
      yaw = state.camera.yaw || 0;
      pitch = state.camera.pitch || -0.5;
    }
  } catch {}
}

function updateSaveStateTimer(dt) {
  lastStateSave += dt;
  if (lastStateSave >= 5) {
    lastStateSave = 0;
    saveSceneState();
  }
}

// Restore state on load
restoreSceneState();

// ===== Start =====
connectSSE();
animate();
