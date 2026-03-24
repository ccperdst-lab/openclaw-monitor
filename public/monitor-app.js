import * as THREE from 'three';

// ===== Globals =====
const container = document.getElementById('scene3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.012);

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
  pitch = Math.max(-Math.PI/2.5, Math.min(-0.1, pitch));
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

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
sun.position.set(30, 50, 20); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60;
scene.add(sun);

// ===== Materials =====
const mat = {
  grass: new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.9 }),
  dirt: new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 1 }),
  minionYellow: new THREE.MeshStandardMaterial({ color: 0xf5d033, roughness: 0.5 }),
  minionBlue: new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5 }),
  goggle: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xffffff }),
  pupil: new THREE.MeshStandardMaterial({ color: 0x111111 }),
  roofColors: [0x4a90d9, 0xd94a4a, 0x4ad97a, 0xd9a84a, 0x9b59b6, 0x1abc9c],
};

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
  const W = 18, D = 18;
  const cols = Math.ceil(Math.sqrt(agents.length));
  const col = index % cols, row = Math.floor(index / cols);
  const ox = col * (W + 8) - (cols - 1) * (W + 8) / 2;
  const oz = row * (D + 8) - (Math.ceil(agents.length / cols) - 1) * (D + 8) / 2;

  // Ground
  const ground = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), mat.grass);
  ground.position.set(ox + W/2, -0.15, oz + D/2);
  ground.receiveShadow = true;
  scene.add(ground);

  // House
  const houseW = 5, houseD = 5, houseH = 3;
  const roofColor = mat.roofColors[index % mat.roofColors.length];
  const hx = ox + W/2 - houseW/2, hz = oz + D/2 - houseD/2;

  // Walls
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0e6d3 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(houseW, houseH, houseD), wallMat);
  walls.position.set(hx, houseH/2, hz); walls.castShadow = true;
  scene.add(walls);

  // Roof
  const roofGeo = new THREE.ConeGeometry(houseW*0.85, 2, 4);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: roofColor }));
  roof.position.set(hx, houseH + 1, hz); roof.rotation.y = Math.PI/4; roof.castShadow = true;
  scene.add(roof);

  // Sign
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256; signCanvas.height = 64;
  const sctx = signCanvas.getContext('2d');
  sctx.fillStyle = '#1a1a2e'; sctx.fillRect(0, 0, 256, 64);
  sctx.font = 'bold 24px sans-serif'; sctx.textAlign = 'center';
  sctx.fillStyle = '#53d8fb'; sctx.fillText(agentName, 128, 42);
  const signTex = new THREE.CanvasTexture(signCanvas);
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, transparent: true }));
  sign.position.set(hx, houseH + 3.5, hz); sign.scale.set(3, 0.75, 1);
  scene.add(sign);

  // Furniture: table
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.8), new THREE.MeshStandardMaterial({ color: 0x8B6914 }));
  table.position.set(hx - 1, 0.72, hz + 1); scene.add(table);
  [-0.6, 0.6].forEach(xo => [-0.3, 0.3].forEach(zo => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0x8B6914 }));
    leg.position.set(hx - 1 + xo, 0.35, hz + 1 + zo); scene.add(leg);
  }));

  // Chairs
  [-1, 1].forEach(side => {
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0xa0522d }));
    chair.position.set(hx - 1 + side*1.2, 0.25, hz + 1); scene.add(chair);
  });

  // Bed
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 2.5), new THREE.MeshStandardMaterial({ color: 0x5b8dd9 }));
  bed.position.set(hx + 1.5, 0.15, hz - 0.5); scene.add(bed);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.5), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  pillow.position.set(hx + 1.5, 0.36, hz - 1.5); scene.add(pillow);

  // Bookshelf
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.4), new THREE.MeshStandardMaterial({ color: 0x8B6914 }));
  shelf.position.set(hx - 2.2, 1, hz - 1); scene.add(shelf);
  for (let i = 0; i < 4; i++) {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: [0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12][i] }));
    book.position.set(hx - 2.2, 0.3 + i*0.45, hz - 1); scene.add(book);
  }

  // Lamp
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), new THREE.MeshStandardMaterial({ color: 0x888 }));
  lampPole.position.set(hx + 2, 0.6, hz + 1.5); scene.add(lampPole);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.3 }));
  lampShade.position.set(hx + 2, 1.4, hz + 1.5); scene.add(lampShade);
  const lampLight = new THREE.PointLight(0xffd700, 0.5, 5);
  lampLight.position.set(hx + 2, 1.2, hz + 1.5); scene.add(lampLight);

  // ===== Register Obstacles (AABB) =====
  const pad = 0.3; // extra padding around obstacles
  // House building
  addObstacle(hx - houseW/2 - pad, hx + houseW/2 + pad, hz - houseD/2 - pad, hz + houseD/2 + pad, 'house');
  // Table + area around it
  addObstacle(hx - 1 - 0.75 - pad, hx - 1 + 0.75 + pad, hz + 1 - 0.4 - pad, hz + 1 + 0.4 + pad, 'table');
  // Chairs
  [-1, 1].forEach(side => {
    const cx = hx - 1 + side * 1.2;
    addObstacle(cx - 0.25 - pad, cx + 0.25 + pad, hz + 1 - 0.25 - pad, hz + 1 + 0.25 + pad, 'chair');
  });
  // Bed
  addObstacle(hx + 1.5 - 0.75 - pad, hx + 1.5 + 0.75 + pad, hz - 0.5 - 1.25 - pad, hz - 0.5 + 1.25 + pad, 'bed');
  // Bookshelf
  addObstacle(hx - 2.2 - 0.4 - pad, hx - 2.2 + 0.4 + pad, hz - 1 - 0.2 - pad, hz - 1 + 0.2 + pad, 'bookshelf');
  // Lamp
  addObstacle(hx + 2 - 0.3 - pad, hx + 2 + 0.3 + pad, hz + 1.5 - 0.3 - pad, hz + 1.5 + 0.3 + pad, 'lamp');
  // Continent boundary walls (invisible barriers at edges)
  addObstacle(ox - 1, ox + 0.5, oz - 1, oz + D + 1, 'wall_west');
  addObstacle(ox + W - 0.5, ox + W + 1, oz - 1, oz + D + 1, 'wall_east');
  addObstacle(ox - 1, ox + W + 1, oz - 1, oz + 0.5, 'wall_north');
  addObstacle(ox - 1, ox + W + 1, oz + D - 0.5, oz + D + 1, 'wall_south');

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
  const items = [];
  const log = ud.eventLog || [];
  for (const evt of log) {
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
  if (ud.replyText) items.push(`<div class="bact bact-reply"><span>💬</span><span>${esc(ud.replyText)}</span></div>`);
  actsBody.innerHTML = items.slice(-30).join('');
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

// ===== Start =====
connectSSE();
animate();
