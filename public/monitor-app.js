import * as THREE from 'three';

// ===== Scene Setup =====
const container = document.getElementById('scene3d');
const scene = new THREE.Scene();
// Sky gradient background
scene.background = new THREE.Color(0x87CEEB); // Sky blue
scene.fog = new THREE.FogExp2(0x87CEEB, 0.015);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(25, 30, 35);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// Controls
// Controls - FPS-style creative mode camera
let yaw = 0, pitch = 0;
let moveSpeed = 12;
let pointerLocked = false;
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };

// Pointer lock: click overlay to lock, click canvas (locked) or ESC to unlock
const clickCatcher = document.getElementById('click-catcher');
clickCatcher.addEventListener('click', () => {
  clickCatcher.classList.add('hidden');
  renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  document.body.style.cursor = pointerLocked ? 'none' : 'default';
  if (!pointerLocked) clickCatcher.classList.remove('hidden');
});
// Canvas click when locked = unlock
renderer.domElement.addEventListener('click', () => {
  if (pointerLocked) document.exitPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
  document.body.style.cursor = pointerLocked ? 'none' : 'default';
});

// Mouse look
document.addEventListener('mousemove', e => {
  if (!pointerLocked) return;
  yaw -= e.movementX * 0.002;
  pitch -= e.movementY * 0.002;
  pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));
});

// Keyboard
window.addEventListener('keydown', e => {
  // Skip game controls when typing in input/textarea
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.key.toLowerCase() === 'w') keys.w = true;
  if (e.key.toLowerCase() === 'a') keys.a = true;
  if (e.key.toLowerCase() === 's') keys.s = true;
  if (e.key.toLowerCase() === 'd') keys.d = true;
  if (e.key === ' ') { keys.space = true; e.preventDefault(); }
  if (e.key === 'Shift') { keys.shift = true; e.preventDefault(); }
  // Ctrl+Tab releases mouse lock
  if (e.key === 'Tab' && e.ctrlKey) {
    e.preventDefault();
    if (pointerLocked) document.exitPointerLock();
  }
});
window.addEventListener('keyup', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.key.toLowerCase() === 'w') keys.w = false;
  if (e.key.toLowerCase() === 'a') keys.a = false;
  if (e.key.toLowerCase() === 's') keys.s = false;
  if (e.key.toLowerCase() === 'd') keys.d = false;
  if (e.key === ' ') keys.space = false;
  if (e.key === 'Shift') keys.shift = false;
});

// Initial camera direction
camera.position.set(6, 5, 12);
yaw = Math.PI; // face toward the house

// Lights - daytime scene
const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x5a4a3a, 0.5);
scene.add(hemiLight);
const ambientLight = new THREE.AmbientLight(0x8899bb, 0.6);
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
sunLight.position.set(15, 30, 10);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 80;
sunLight.shadow.camera.left = -20;
sunLight.shadow.camera.right = 20;
sunLight.shadow.camera.top = 20;
sunLight.shadow.camera.bottom = -20;
scene.add(sunLight);
// Warm fill light
const fillLight = new THREE.DirectionalLight(0xffeedd, 0.3);
fillLight.position.set(-10, 10, -5);
scene.add(fillLight);
// Indoor warm point light (lamp glow)
const lampLight = new THREE.PointLight(0xffcc66, 0.6, 12);
lampLight.position.set(2, 3, 1);
lampLight.castShadow = true;
scene.add(lampLight);

// Sun sphere (visual)
const sunGeo = new THREE.SphereGeometry(3, 16, 16);
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
sunMesh.position.set(40, 50, -20);
scene.add(sunMesh);
// Sun glow
const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.3 }));
sunGlow.position.copy(sunMesh.position);
scene.add(sunGlow);

// Sky dome
const skyGeo = new THREE.SphereGeometry(120, 32, 16);
const skyMat = new THREE.MeshBasicMaterial({
  color: 0x87CEEB,
  side: THREE.BackSide,
});
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);
// Clouds (simple flat planes)
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
for (let i = 0; i < 8; i++) {
  const cloud = new THREE.Mesh(new THREE.PlaneGeometry(8 + Math.random() * 12, 2 + Math.random() * 2), cloudMat);
  cloud.position.set(-30 + Math.random() * 80, 35 + Math.random() * 15, -40 + Math.random() * 60);
  cloud.rotation.x = -Math.PI / 2;
  scene.add(cloud);
}

// ===== Materials =====
// ===== Procedural Textures =====
function makeCanvasTex(w, h, drawFn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  drawFn(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function woodTexture(ctx, w, h) {
  ctx.fillStyle = '#8B6914'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < h; i += 3) {
    ctx.fillStyle = `rgba(${100+Math.random()*40},${80+Math.random()*30},${20+Math.random()*15},0.3)`;
    ctx.fillRect(0, i, w, 2);
  }
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.arc(Math.random()*w, Math.random()*h, 3+Math.random()*4, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(60,40,10,0.2)'; ctx.fill();
  }
}
function wallTexture(ctx, w, h) {
  ctx.fillStyle = '#f5e6d3'; ctx.fillRect(0, 0, w, h);
  // Subtle plaster texture
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(${200+Math.random()*55},${180+Math.random()*50},${160+Math.random()*40},0.15)`;
    ctx.fillRect(Math.random()*w, Math.random()*h, 2+Math.random()*4, 2+Math.random()*4);
  }
}
function roofTexture(ctx, w, h) {
  ctx.fillStyle = '#b84c3a'; ctx.fillRect(0, 0, w, h);
  // Tile pattern
  const tw = 16, th = 10;
  for (let y = 0; y < h; y += th) {
    const off = (Math.floor(y/th) % 2) * tw/2;
    for (let x = -tw; x < w + tw; x += tw) {
      ctx.strokeStyle = 'rgba(80,30,20,0.3)'; ctx.lineWidth = 1;
      ctx.strokeRect(x+off, y, tw-1, th-1);
      ctx.fillStyle = `rgba(${160+Math.random()*40},${50+Math.random()*20},${40+Math.random()*15},0.15)`;
      ctx.fillRect(x+off+1, y+1, tw-3, th-3);
    }
  }
}
function grassTexture(ctx, w, h) {
  ctx.fillStyle = '#4a8c3f'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 800; i++) {
    const gx = Math.random()*w, gy = Math.random()*h;
    ctx.strokeStyle = `rgba(${50+Math.random()*40},${100+Math.random()*60},${30+Math.random()*30},0.4)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx-2+Math.random()*4, gy-4-Math.random()*6); ctx.stroke();
  }
}
function plankTexture(ctx, w, h) {
  const pw = w / 6;
  for (let i = 0; i < 6; i++) {
    const shade = 130 + Math.random() * 30;
    ctx.fillStyle = `rgb(${shade},${shade-30},${shade-60})`;
    ctx.fillRect(i*pw, 0, pw-1, h);
    // Grain
    for (let j = 0; j < h; j += 2) {
      ctx.fillStyle = `rgba(${shade-20},${shade-40},${shade-70},0.15)`;
      ctx.fillRect(i*pw, j, pw-1, 1);
    }
    ctx.strokeStyle = 'rgba(60,40,20,0.3)'; ctx.lineWidth = 1;
    ctx.strokeRect(i*pw, 0, pw, h);
  }
}

const mat = {
  floor: new THREE.MeshStandardMaterial({ map: makeCanvasTex(128, 128, plankTexture), roughness: 0.7 }),
  floorAlt: new THREE.MeshStandardMaterial({ map: makeCanvasTex(128, 128, (c,w,h) => { plankTexture(c,w,h); c.fillStyle='rgba(0,0,0,0.05)'; c.fillRect(0,0,w,h); }), roughness: 0.7 }),
  wall: new THREE.MeshStandardMaterial({ map: makeCanvasTex(128, 128, wallTexture), roughness: 0.9 }),
  wallSide: new THREE.MeshStandardMaterial({ map: makeCanvasTex(128, 128, wallTexture), roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ map: makeCanvasTex(128, 64, roofTexture), roughness: 0.7 }),
  roofDark: new THREE.MeshStandardMaterial({ color: 0x9a3a2a, roughness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ map: makeCanvasTex(64, 64, woodTexture), roughness: 0.6 }),
  woodDark: new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.7 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.25 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xcce8ff, transparent: true, opacity: 0.35, metalness: 0.1, roughness: 0.05 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.9 }),
  pillow: new THREE.MeshStandardMaterial({ color: 0xfff0e0, roughness: 0.95 }),
  book1: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.8 }),
  book2: new THREE.MeshStandardMaterial({ color: 0x2980b9, roughness: 0.8 }),
  book3: new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.8 }),
  grass: new THREE.MeshStandardMaterial({ map: makeCanvasTex(256, 256, grassTexture), roughness: 1 }),
  grassAlt: new THREE.MeshStandardMaterial({ color: 0x5a9c4f, roughness: 1 }),
  rug: new THREE.MeshStandardMaterial({ color: 0x8b2252, roughness: 0.95 }),
  door: new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 }),
  wallDecor: new THREE.MeshStandardMaterial({ color: 0xd4c4a8, roughness: 0.9 }),
  // Minion materials
  minionYellow: new THREE.MeshStandardMaterial({ color: 0xf5d033, roughness: 0.4, metalness: 0.1 }),
  minionBlue: new THREE.MeshStandardMaterial({ color: 0x3b5998, roughness: 0.5 }),
  minionGoggle: new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.85, roughness: 0.15 }),
  minionGoggleGlass: new THREE.MeshStandardMaterial({ color: 0xaaddff, transparent: true, opacity: 0.5 }),
  minionEye: new THREE.MeshStandardMaterial({ color: 0x5a3825, roughness: 0.3 }),
  minionPupil: new THREE.MeshStandardMaterial({ color: 0x111111 }),
  minionMouth: new THREE.MeshStandardMaterial({ color: 0x8b4513 }),
  minionHair: new THREE.MeshStandardMaterial({ color: 0x222222 }),
  minionShoe: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }),
  minionGlove: new THREE.MeshStandardMaterial({ color: 0x222222 }),
  apple: new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.6 }),
  pot: new THREE.MeshStandardMaterial({ color: 0xa0522d, roughness: 0.8 }),
  plant: new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.9 }),
  // Extra colors
  curtain: new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.9 }),
  vase: new THREE.MeshStandardMaterial({ color: 0x3498db, roughness: 0.5 }),
  flower: new THREE.MeshStandardMaterial({ color: 0xe74c3c, roughness: 0.8 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf1c40f }),
  orange: new THREE.MeshStandardMaterial({ color: 0xe67e22 }),
  teal: new THREE.MeshStandardMaterial({ color: 0x1abc9c }),
};

// ===== Build Room =====
function buildRoom(ox, oz, w, d, label) {
  const group = new THREE.Group();
  const TH = 0.15; // tile height
  // Don't reset wallMeshes here - reset in init() instead

  // Floor
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(1, TH, 1), (x + z) % 2 === 0 ? mat.floor : mat.floorAlt);
      tile.position.set(ox + x + 0.5, 0, oz + z + 0.5);
      tile.receiveShadow = true;
      group.add(tile);
    }
  }

  // Rug (center)
  const rug = new THREE.Mesh(new THREE.BoxGeometry(w - 3, TH + 0.01, d - 3), mat.rug);
  rug.position.set(ox + w / 2, TH + 0.01, oz + d / 2);
  group.add(rug);

  // Walls
  // South wall
  for (let x = 0; x < w; x++) {
    if (x === Math.floor(w / 2)) continue; // door gap
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 0.2), mat.wall.clone());
    wall.position.set(ox + x + 0.5, 1.5, oz + d + 0.1);
    wall.castShadow = true;
    wall.userData.isWall = true;
    wallMeshes.push(wall);
    group.add(wall);
  }
  // East wall
  for (let z = 0; z < d; z++) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 1), mat.wallSide.clone());
    wall.position.set(ox + w + 0.1, 1.5, oz + z + 0.5);
    wall.castShadow = true;
    wall.userData.isWall = true;
    wallMeshes.push(wall);
    group.add(wall);
  }
  // North wall
  for (let x = 0; x < w; x++) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 0.2), mat.wall.clone());
    wall.position.set(ox + x + 0.5, 1.5, oz - 0.1);
    wall.userData.isWall = true;
    wallMeshes.push(wall);
    group.add(wall);
  }
  // West wall
  for (let z = 0; z < d; z++) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 1), mat.wallSide.clone());
    wall.position.set(ox - 0.1, 1.5, oz + z + 0.5);
    wall.userData.isWall = true;
    wallMeshes.push(wall);
    group.add(wall);
  }

  // Windows (on south wall)
  for (let x = 2; x < w - 1; x += 3) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.05), mat.glass);
    win.position.set(ox + x + 0.5, 2, oz + d + 0.15);
    group.add(win);
    // Window frame
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.06), mat.woodDark);
    frame.position.set(ox + x + 0.5, 2, oz + d + 0.14);
    group.add(frame);
  }

  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.15), mat.door);
  door.position.set(ox + w / 2 + 0.5, 1.1, oz + d + 0.1);
  group.add(door);
  // Doorknob
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mat.metal);
  knob.position.set(ox + w / 2 + 0.9, 1, oz + d + 0.2);
  group.add(knob);

  // Roof
  const roofGeo = new THREE.ConeGeometry(w * 0.8, 2, 4);
  const roofMat = mat.roof.clone();
  roofMat.transparent = true;
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(ox + w / 2, 4, oz + d / 2);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.userData.isRoof = true;
  wallMeshes.push(roof); // Track for transparency
  group.add(roof);

  // Chimney
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.5), mat.wall);
  chimney.position.set(ox + w - 1, 4.2, oz + 1);
  group.add(chimney);

  // ===== Furniture =====
  // Outdoor ground (grass around the house)
  const outdoorGround = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat.grass);
  outdoorGround.rotation.x = -Math.PI / 2;
  outdoorGround.position.set(6, -0.02, 5);
  outdoorGround.receiveShadow = true;
  group.add(outdoorGround);
  // Path to door
  const pathGeo = new THREE.PlaneGeometry(2, 8);
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xc4a882, roughness: 0.9 });
  const path = new THREE.Mesh(pathGeo, pathMat);
  path.rotation.x = -Math.PI / 2;
  path.position.set(w / 2 + 0.5, 0.01, oz + d + 4);
  group.add(path);
  // Flowers outside
  const flowerColors = [0xe74c3c, 0xf1c40f, 0xff69b4, 0x9b59b6, 0x3498db];
  for (let i = 0; i < 20; i++) {
    const fx = -2 + Math.random() * (w + 4);
    const fz = d + 2 + Math.random() * 6;
    if (Math.abs(fx - w / 2 - 0.5) < 1.5) continue; // skip path
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 6), new THREE.MeshStandardMaterial({ color: flowerColors[i % 5] }));
    flower.position.set(fx, 0.15, fz);
    group.add(flower);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mat.plant);
    stem.position.set(fx, 0.05, fz);
    group.add(stem);
  }

  // Table (center)
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 1.2), mat.wood);
  tableTop.position.set(ox + w / 2, 0.9, oz + d / 2);
  tableTop.castShadow = true;
  group.add(tableTop);
  [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]].forEach(([dx, dz]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), mat.woodDark);
    leg.position.set(ox + w / 2 + dx, 0.4, oz + d / 2 + dz);
    group.add(leg);
  });
  // Apple on table
  const apple = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), mat.apple);
  apple.position.set(ox + w / 2 - 0.3, 1.05, oz + d / 2);
  group.add(apple);

  // Chairs
  const chairPositions = [[ox + w / 2 - 2, oz + d / 2], [ox + w / 2 + 2, oz + d / 2]];
  chairPositions.forEach(([cx, cz]) => {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), mat.wood);
    seat.position.set(cx, 0.55, cz);
    group.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.08), mat.wood);
    back.position.set(cx, 0.95, cz - 0.26);
    group.add(back);
    [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach(([dx, dz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), mat.woodDark);
      leg.position.set(cx + dx, 0.25, cz + dz);
      group.add(leg);
    });
  });

  // Bed (top-left)
  const bedFrame = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 1.5), mat.woodDark);
  bedFrame.position.set(ox + 2, 0.2, oz + 1.5);
  group.add(bedFrame);
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 1.3), new THREE.MeshStandardMaterial({ color: 0xe8e8e8 }));
  mattress.position.set(ox + 2, 0.5, oz + 1.5);
  group.add(mattress);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.4), mat.pillow);
  pillow.position.set(ox + 1.5, 0.65, oz + 1.5);
  group.add(pillow);
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 1.2), mat.fabric);
  blanket.position.set(ox + 2.3, 0.65, oz + 1.5);
  group.add(blanket);

  // Bookshelf (top wall)
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.5), mat.woodDark);
  shelf.position.set(ox + w - 1.5, 1.25, oz + 0.25);
  group.add(shelf);
  // Shelves
  [0.6, 1.4].forEach(y => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.45), mat.wood);
    s.position.set(ox + w - 1.5, y, oz + 0.25);
    group.add(s);
  });
  // Books
  const bookMats = [mat.book1, mat.book2, mat.book3];
  for (let i = 0; i < 6; i++) {
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.3), bookMats[i % 3]);
    book.position.set(ox + w - 2 + i * 0.2, 0.85, oz + 0.25);
    group.add(book);
  }

  // Kitchen counter (right wall)
  const counter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 2), mat.metal);
  counter.position.set(ox + w - 0.3, 0.5, oz + 3);
  group.add(counter);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x666666 }));
  pot.position.set(ox + w - 0.3, 1.1, oz + 3);
  group.add(pot);

  // Lamp (floor)
  const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.1, 8), mat.metal);
  lampBase.position.set(ox + 1.5, 0.05, oz + d - 1);
  group.add(lampBase);
  const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 8), mat.metal);
  lampPole.position.set(ox + 1.5, 1.3, oz + d - 1);
  group.add(lampPole);
  const lampShade = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.5, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xffd700, side: THREE.DoubleSide }));
  lampShade.position.set(ox + 1.5, 2.6, oz + d - 1);
  group.add(lampShade);

  // Plant
  const plantPot = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 8), mat.pot);
  plantPot.position.set(ox + w - 1.5, 0.15, oz + d - 1);
  group.add(plantPot);
  const plantLeaves = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), mat.plant);
  plantLeaves.position.set(ox + w - 1.5, 0.55, oz + d - 1);
  group.add(plantLeaves);

  // Wall decorations: picture frames
  const frameGeo = new THREE.BoxGeometry(0.8, 0.6, 0.05);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.6 });
  // Frame 1 on north wall
  const frame1 = new THREE.Mesh(frameGeo, frameMat);
  frame1.position.set(ox + 4, 2, oz - 0.05);
  group.add(frame1);
  const pic1 = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshStandardMaterial({ color: 0x87CEEB }));
  pic1.position.set(ox + 4, 2, oz + 0.01);
  group.add(pic1);
  // Frame 2 on east wall
  const frame2 = new THREE.Mesh(frameGeo, frameMat);
  frame2.position.set(ox + w + 0.05, 2, oz + 6);
  frame2.rotation.y = Math.PI / 2;
  group.add(frame2);

  // Wall clock on north wall
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.25, 16), new THREE.MeshStandardMaterial({ color: 0xfff8e7 }));
  clockFace.position.set(ox + 8, 2.2, oz - 0.05);
  group.add(clockFace);
  const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.03, 8, 16), mat.woodDark);
  clockRim.position.set(ox + 8, 2.2, oz - 0.04);
  group.add(clockRim);

  // Couch/sofa (bottom wall near lamp)
  const sofaSeat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 0.8), new THREE.MeshStandardMaterial({ color: 0x5b7fa5, roughness: 0.9 }));
  sofaSeat.position.set(ox + 4, 0.35, oz + d - 0.5);
  group.add(sofaSeat);
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(2, 0.6, 0.15), new THREE.MeshStandardMaterial({ color: 0x4a6e94, roughness: 0.9 }));
  sofaBack.position.set(ox + 4, 0.65, oz + d - 0.9);
  group.add(sofaBack);
  const sofaArm1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.8), new THREE.MeshStandardMaterial({ color: 0x4a6e94, roughness: 0.9 }));
  sofaArm1.position.set(ox + 3, 0.5, oz + d - 0.5);
  group.add(sofaArm1);
  const sofaArm2 = sofaArm1.clone(); sofaArm2.position.x = ox + 5;
  group.add(sofaArm2);

  // Trees outside
  for (let i = 0; i < 4; i++) {
    const tx = ox - 3 + Math.random() * (w + 6);
    const tz = oz + d + 4 + Math.random() * 8;
    if (Math.abs(tx - ox - w/2 - 0.5) < 2) continue;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.5, 6), mat.woodDark);
    trunk.position.set(tx, 0.75, tz);
    group.add(trunk);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.6 + Math.random()*0.3, 8, 6), mat.plant);
    canopy.position.set(tx, 1.8 + Math.random()*0.3, tz);
    group.add(canopy);
  }

  // Vase on table
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.25, 8), new THREE.MeshStandardMaterial({ color: 0xcc6644, roughness: 0.5 }));
  vase.position.set(ox + w/2 + 0.3, 1.1, oz + d/2);
  group.add(vase);
  const flower = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshStandardMaterial({ color: 0xff69b4 }));
  flower.position.set(ox + w/2 + 0.3, 1.35, oz + d/2);
  group.add(flower);

  scene.add(group);
  return group;
}

// ===== Minion Chinese Name Pool =====
const MINION_NAMES = [
  '小明', '阿花', '大壮', '小美', '阿福', '小龙', '大宝', '小雪', '阿杰', '小芳',
  '阿强', '小红', '大伟', '小玲', '阿亮', '小青', '大兵', '小月', '阿涛', '小燕',
  '阿飞', '小云', '大山', '小雨', '阿军', '小星', '大龙', '小霞', '阿峰', '小玉',
  '阿文', '小兰', '大海', '小凤', '阿勇', '小莲', '大鹏', '小琴', '阿华', '小菊',
];
// Track used names per session to avoid duplicates
const usedMinionNames = new Set();
function getRandomChineseName() {
  const available = MINION_NAMES.filter(n => !usedMinionNames.has(n));
  const pool = available.length > 0 ? available : MINION_NAMES;
  const name = pool[Math.floor(Math.random() * pool.length)];
  usedMinionNames.add(name);
  return name;
}

// ===== Build Minion Character =====
// Add a floating name label above a minion (two-line: Feishu name + Chinese name)
function addNameLabel(minion, feishuName, chineseName) {
  // Remove old label if any
  const old = minion.children.find(c => c.userData && c.userData.isNameLabel);
  if (old) minion.remove(old);

  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 96);

  // Measure text to size the pill
  ctx.font = 'bold 20px sans-serif';
  const topW = ctx.measureText(feishuName || '').width;
  ctx.font = '14px sans-serif';
  const botW = ctx.measureText(chineseName || '').width;
  const pillW = Math.min(240, Math.max(topW, botW) + 40);

  // Background pill
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(128 - pillW/2, 6, pillW, 84, 14);
  ctx.fill();

  // Top line: Feishu name (bold, larger)
  if (feishuName) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(feishuName.slice(0, 14), 128, 32);
  }

  // Bottom line: Chinese name (smaller, lighter)
  if (chineseName) {
    ctx.fillStyle = '#b0d4f1';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(chineseName, 128, 62);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 0.8),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide })
  );
  label.position.set(0, 2.5, 0);
  label.userData.isNameLabel = true;
  label.renderOrder = 9999; // render on top of everything
  minion.add(label);
}

// Randomize minion appearance with variations
function createMinion(colorHex) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex || 0xf5d033, roughness: 0.5 });

  // Randomize size variations
  const heightScale = 0.8 + Math.random() * 0.4; // 0.8x - 1.2x
  const widthScale = 0.9 + Math.random() * 0.2;  // 0.9x - 1.1x
  const bodyRadius = 0.35 * widthScale;
  const bodyHeight = 1.2 * heightScale;
  group.userData.heightScale = heightScale;
  group.userData.widthScale = widthScale;

  // Body (rounded cylinder)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(bodyRadius, bodyRadius * 1.08, bodyHeight, 16), bodyMat);
  body.position.y = 0.5 + bodyHeight / 2;
  body.castShadow = true;
  group.add(body);

  // Overalls (blue bottom half)
  const overalls = new THREE.Mesh(new THREE.CylinderGeometry(bodyRadius * 1.05, bodyRadius * 1.1, bodyHeight * 0.4, 16), mat.minionBlue);
  overalls.position.y = 0.5 + bodyHeight * 0.2;
  group.add(overalls);

  // Goggle strap
  const strap = new THREE.Mesh(new THREE.TorusGeometry(bodyRadius * 1.02, 0.04, 8, 32), mat.minionGoggle);
  strap.position.y = 0.5 + bodyHeight * 0.78;
  strap.rotation.x = Math.PI / 2;
  group.add(strap);

  // Head (sphere on top of body)
  const headRadius = bodyRadius * (0.65 + Math.random() * 0.15); // slight head size variation
  const head = new THREE.Mesh(new THREE.SphereGeometry(headRadius, 16, 12), bodyMat);
  head.position.y = 0.5 + bodyHeight + headRadius * 0.5;
  head.castShadow = true;
  group.add(head);

  // Eye(s) - single eye for Stuart-like, or double
  const isOneEye = Math.random() > 0.5;
  const eyeY = 0.5 + bodyHeight * 0.82;

  if (isOneEye) {
    // Single big eye
    const goggleRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 16), mat.minionGoggle);
    goggleRing.position.set(0, eyeY, bodyRadius * 0.92);
    group.add(goggleRing);
    const goggleGlass = new THREE.Mesh(new THREE.CircleGeometry(0.17, 16), mat.minionGoggleGlass);
    goggleGlass.position.set(0, eyeY, bodyRadius * 0.94);
    group.add(goggleGlass);
    const eyeWhite = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    eyeWhite.position.set(0, eyeY, bodyRadius * 0.96);
    group.add(eyeWhite);
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), mat.minionEye);
    iris.position.set(0, eyeY, bodyRadius * 0.98);
    iris.name = 'iris';
    group.add(iris);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), mat.minionPupil);
    pupil.position.set(0, eyeY, bodyRadius * 1.0);
    group.add(pupil);
  } else {
    // Two eyes
    [-0.12, 0.12].forEach(x => {
      const goggleRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 16), mat.minionGoggle);
      goggleRing.position.set(x, eyeY, bodyRadius * 0.95);
      group.add(goggleRing);
      const eyeWhite = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      eyeWhite.position.set(x, eyeY, bodyRadius * 0.97);
      group.add(eyeWhite);
      const iris = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), mat.minionEye);
      iris.position.set(x, eyeY, bodyRadius * 0.99);
      iris.name = 'iris';
      group.add(iris);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), mat.minionPupil);
      pupil.position.set(x, eyeY, bodyRadius * 1.01);
      group.add(pupil);
    });
  }

  // Mouth
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 16, Math.PI), mat.minionMouth);
  mouth.position.set(0, 0.5 + bodyHeight * 0.55, bodyRadius * 0.95);
  mouth.rotation.x = Math.PI;
  mouth.name = 'mouth';
  group.add(mouth);

  // Hair (springs on top of head)
  const hairCount = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < hairCount; i++) {
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.15 + Math.random() * 0.12, 4), mat.minionHair);
    const angle = (i / hairCount) * Math.PI * 2;
    hair.position.set(Math.cos(angle) * headRadius * 0.4, 0.5 + bodyHeight + headRadius + 0.08, Math.sin(angle) * headRadius * 0.4);
    hair.rotation.z = (Math.random() - 0.5) * 0.6;
    group.add(hair);
  }

  // Arms (cylinders that swing when walking)
  [-bodyRadius * 1.15, bodyRadius * 1.15].forEach(x => {
    // Shoulder pivot
    const armPivot = new THREE.Group();
    armPivot.position.set(x, 0.5 + bodyHeight * 0.65, 0);
    armPivot.name = x > 0 ? 'armR' : 'armL';

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.55 * heightScale, 8), bodyMat);
    arm.position.y = -0.27 * heightScale;
    armPivot.add(arm);

    // Glove/hand
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), mat.minionGlove);
    glove.position.y = -0.55 * heightScale;
    armPivot.add(glove);

    group.add(armPivot);
  });

  // Legs (cylinders with pivot at top)
  [-0.12, 0.12].forEach(x => {
    const legPivot = new THREE.Group();
    legPivot.position.set(x, 0.5, 0);
    legPivot.name = x > 0 ? 'legR' : 'legL';

    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.38 * heightScale, 8), bodyMat);
    leg.position.y = -0.19 * heightScale;
    legPivot.add(leg);

    // Shoe
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.2), mat.minionShoe);
    shoe.position.set(0, -0.38 * heightScale, 0.03);
    legPivot.add(shoe);

    group.add(legPivot);
  });

  // Assign random Chinese name
  const chineseName = getRandomChineseName();

  group.userData = {
    state: 'idle', targetX: 0, targetZ: 0, speed: 0,
    bobPhase: Math.random() * Math.PI * 2,
    userMsg: '', userName: '', thinkLog: [], toolLog: [], replyCount: 0,
    chineseName: chineseName,
    // Idle animation state
    idleTimer: 0, idleAction: 'stand', idleActionTimer: 0,
    // Sitting state
    isSitting: false,
  };
  return group;
}

// ===== Globals =====
let minions = [];
let bubbles = {};
let cfg = {};
let clock = new THREE.Clock();
let wallMeshes = []; // Track wall meshes for transparency
let HOUSE_SPACING = 22; // distance between house centers
let ROOM_W = 12, ROOM_D = 10;

// (Furniture defined as AABB below collision functions)

// ===== Init =====
let lastInitKey = '';
function init(d) {
  cfg = d;
  // Build a key to detect if config actually changed
  const initKey = (d.agents || []).map(a => a.id + ':' + (a.sessions || a.channels || []).map(s => s.key || s.id).join(',')).join('|');
  if (initKey === lastInitKey && minions.length > 0) return; // No change, skip reinit
  lastInitKey = initKey;

  // Clear old minions, rooms, and walls
  minions.forEach(m => scene.remove(m));
  minions = [];
  wallMeshes = [];
  scene.children.filter(c => c.isGroup && c.userData && c.userData.isRoom).forEach(g => scene.remove(g));

  const agents = d.agents || [{ id: 'default', sessions: d.channels || [] }];
  const colors = [0xf5d033, 0xffcc00, 0xe8b800, 0xd4a500, 0xc8960f];
  const roofColors = [0xc0392b, 0x2980b9, 0x27ae60, 0x8e44ad, 0xe67e22];

  // Ground plane - wide enough for all houses
  const totalW = agents.length * HOUSE_SPACING + 20;
  const oldGround = scene.children.find(c => c.geometry && c.geometry.type === 'PlaneGeometry' && c.geometry.parameters && c.geometry.parameters.width > 50);
  if (oldGround) scene.remove(oldGround);
  const outdoorGround = new THREE.Mesh(
    new THREE.PlaneGeometry(totalW + 40, 80),
    mat.grass
  );
  outdoorGround.rotation.x = -Math.PI / 2;
  outdoorGround.position.set(totalW / 2 - 10, -0.02, 20);
  outdoorGround.receiveShadow = true;
  scene.add(outdoorGround);

  // Build one house per agent
  agents.forEach((agent, ai) => {
    const ox = ai * HOUSE_SPACING;
    const oz = 0;
    const agentId = agent.id || `agent-${ai}`;

    // Build house
    const houseGroup = buildRoom(ox, oz, ROOM_W, ROOM_D, agentId);
    houseGroup.userData.isRoom = true;
    houseGroup.userData.agentId = agentId;

    // Customize roof color per agent
    const roof = houseGroup.children.find(c => c.userData && c.userData.isRoof);
    if (roof) {
      roof.material = roof.material.clone();
      roof.material.color.setHex(roofColors[ai % roofColors.length]);
    }

    // Agent name sign above door
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.moveTo(8,0); ctx.lineTo(248,0); ctx.quadraticCurveTo(256,0,256,8);
      ctx.lineTo(256,56); ctx.quadraticCurveTo(256,64,248,64); ctx.lineTo(8,64);
      ctx.quadraticCurveTo(0,64,0,56); ctx.lineTo(0,8); ctx.quadraticCurveTo(0,0,8,0);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(agentId, 128, 42);
      const signTex = new THREE.CanvasTexture(canvas);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 0.75),
        new THREE.MeshBasicMaterial({ map: signTex, transparent: true, depthWrite: false })
      );
      sign.position.set(ox + ROOM_W / 2 + 0.5, 3.5, oz + ROOM_D + 0.2);
      houseGroup.add(sign);
    } catch(e) {}

    // Create minions for each INTERACTIVE session (skip cron/subagent)
    const allSessions = agent.sessions || [];
    const sessions = allSessions.filter(s => ['group', 'dm', 'main'].includes(s.type));
    const display = sessions.length > 0 ? sessions : allSessions.slice(0, 2);
    const count = Math.max(display.length, 1);
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    display.forEach((sess, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const px = ox + 3 + col * (ROOM_W - 6) / Math.max(cols - 1, 1);
      const pz = oz + 3 + row * (ROOM_D - 6) / Math.max(rows - 1, 1);
      const m = createMinion(colors[(ai * 3 + i) % colors.length]);
      m.position.set(px, 0, pz);
      m.userData.id = sess.key;
      m.userData.label = sess.name;
      m.userData.agentId = agentId;
      m.userData.targetX = px;
      m.userData.targetZ = pz;
      m.userData.bounds = {
        minX: ox + 1.5, maxX: ox + ROOM_W - 1.5,
        minZ: oz + 1.5, maxZ: oz + ROOM_D - 1.5
      };
      m.userData.houseOffset = { ox, oz };

      // Resolve and display Feishu name + Chinese name label
      const feishuId = (sess.key || '').match(/(oc_\w+|ou_\w+)/)?.[1];
      const cName = m.userData.chineseName;
      if (feishuId) {
        fetch(`/api/resolve/${feishuId}`).then(r => r.json()).then(d => {
          if (d.name && d.name !== feishuId) {
            m.userData.displayName = d.name;
            addNameLabel(m, d.name, cName);
          } else {
            addNameLabel(m, sess.name || 'session', cName);
          }
        }).catch(() => {
          addNameLabel(m, sess.name || 'session', cName);
        });
      } else {
        const fallbackName = sess.name || sess.type || 'session';
        m.userData.displayName = fallbackName;
        addNameLabel(m, fallbackName, cName);
      }

      scene.add(m);
      minions.push(m);
    });
  });

  updateUI(d);
}

// ===== Minion Animation =====
// Dynamic furniture: offset by house position (AABB version)
function getFurnitureForMinion(m) {
  return getFurnitureAABBForMinion(m);
}

// ===== Collision System =====
const MINION_COLLISION_RADIUS = 0.4; // matches body width

// AABB collision check: minion at (x,z) with radius vs an AABB box
function collidesAABB(px, pz, radius, boxMinX, boxMaxX, boxMinZ, boxMaxZ) {
  // Find closest point on AABB to the minion center
  const closestX = Math.max(boxMinX, Math.min(px, boxMaxX));
  const closestZ = Math.max(boxMinZ, Math.min(pz, boxMaxZ));
  const dx = px - closestX;
  const dz = pz - closestZ;
  return (dx * dx + dz * dz) < (radius * radius);
}

// Furniture boxes defined as AABB (center +/- half-size)
// Format: { x, z, label, halfW, halfD } where (x,z) is center, halfW/halfD are half-extents
const BASE_FURNITURE_AABB = [
  { x: 6, z: 5, label: '坐坐', halfW: 1.0, halfD: 0.8 },  // table
  { x: 4, z: 5, label: '坐坐', halfW: 0.35, halfD: 0.35 }, // chair left
  { x: 8, z: 5, label: '坐坐', halfW: 0.35, halfD: 0.35 }, // chair right
  { x: 2.5, z: 2, label: '休息', halfW: 1.1, halfD: 0.8 }, // bed
  { x: 10, z: 3, label: '做饭', halfW: 0.4, halfD: 1.1 },  // kitchen counter
  { x: 9, z: 1, label: '看书', halfW: 0.8, halfD: 0.3 },   // bookshelf
  { x: 2, z: 8, label: '照明', halfW: 0.25, halfD: 0.25 }, // lamp
  { x: 10, z: 8, label: '绿植', halfW: 0.25, halfD: 0.25 },// plant
  { x: 6, z: 1, label: '装饰', halfW: 0.3, halfD: 0.3 },   // decoration
  { x: 5, z: 8, label: '沙发', halfW: 0.8, halfD: 0.5 },   // sofa area
];

// Get furniture AABB boxes for a minion (offset by house)
function getFurnitureAABBForMinion(m) {
  const off = m.userData.houseOffset || { ox: 0, oz: 0 };
  return BASE_FURNITURE_AABB.map(f => ({
    x: f.x + off.ox, z: f.z + off.oz,
    label: f.label,
    minX: f.x + off.ox - f.halfW, maxX: f.x + off.ox + f.halfW,
    minZ: f.z + off.oz - f.halfD, maxZ: f.z + off.oz + f.halfD,
  }));
}

// Wall collision: check if point is within wall thickness of any wall
function collidesWithWall(x, z, radius) {
  for (const wall of wallMeshes) {
    if (wall.userData.isRoof) continue; // skip roof
    const wp = wall.position;
    const ws = wall.geometry.parameters;
    if (!ws) continue;
    // Each wall mesh is a box; compute its half-extents
    const halfX = ws.width / 2;
    const halfZ = ws.depth / 2;
    if (collidesAABB(x, z, radius, wp.x - halfX, wp.x + halfX, wp.z - halfZ, wp.z + halfZ)) {
      return true;
    }
  }
  return false;
}

// Combined collision: furniture + walls
function collidesWithFurniture(x, z, excludeLabel, furn) {
  // AABB furniture check
  const list = furn || getFurnitureAABBForMinion({ userData: { houseOffset: { ox: 0, oz: 0 } } });
  for (const f of list) {
    if (f.label === excludeLabel) continue;
    if (collidesAABB(x, z, MINION_COLLISION_RADIUS, f.minX, f.maxX, f.minZ, f.maxZ)) return true;
  }
  // Wall collision
  if (collidesWithWall(x, z, MINION_COLLISION_RADIUS)) return true;
  return false;
}

// Minion-to-minion collision
function collidesWithOtherMinions(x, z, excludeMinion) {
  for (const other of minions) {
    if (other === excludeMinion) continue;
    const dx = x - other.position.x;
    const dz = z - other.position.z;
    if (Math.sqrt(dx * dx + dz * dz) < MINION_COLLISION_RADIUS * 2) return true;
  }
  return false;
}

// Keep old FURNITURE for backward compat
const FURNITURE = BASE_FURNITURE_AABB.map(f => ({ x: f.x, z: f.z, label: f.label, cx: f.x, cz: f.z, cr: f.halfW }));

function animateMinions(time, dt) {
  minions.forEach(m => {
    const ud = m.userData;
    const furn = getFurnitureForMinion(m);
    const hScale = ud.heightScale || 1;

    if (ud.state === 'idle') {
      const dx = ud.targetX - m.position.x;
      const dz = ud.targetZ - m.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 0.3) {
        // === Arrived at target: pick idle behavior ===
        ud.idleTimer = (ud.idleTimer || 0) + dt;

        // Every few seconds, choose a new action
        if (!ud.idleActionTimer || ud.idleActionTimer <= 0) {
          const r = Math.random();
          if (r < 0.25) {
            // Go to furniture
            const f = furn[Math.floor(Math.random() * furn.length)];
            const angle = Math.random() * Math.PI * 2;
            const approachDist = 0.8 + Math.random() * 0.5;
            ud.targetX = f.x + Math.cos(angle) * approachDist;
            ud.targetZ = f.z + Math.sin(angle) * approachDist;
            ud.interactLabel = f.label;
            ud.idleAction = 'walk';
            ud.idleActionTimer = 2 + Math.random() * 3;
          } else if (r < 0.45) {
            // Random walk
            ud.targetX = ud.bounds.minX + 1 + Math.random() * (ud.bounds.maxX - ud.bounds.minX - 2);
            ud.targetZ = ud.bounds.minZ + 1 + Math.random() * (ud.bounds.maxZ - ud.bounds.minZ - 2);
            ud.interactLabel = '';
            ud.idleAction = 'walk';
            ud.idleActionTimer = 3 + Math.random() * 4;
          } else if (r < 0.65) {
            // Look around idle
            ud.idleAction = 'lookAround';
            ud.idleActionTimer = 2 + Math.random() * 3;
          } else if (r < 0.8) {
            // Stretch
            ud.idleAction = 'stretch';
            ud.idleActionTimer = 1.5 + Math.random() * 1;
          } else {
            // Just stand
            ud.idleAction = 'stand';
            ud.idleActionTimer = 2 + Math.random() * 3;
          }
          // Clamp target to room bounds
          ud.targetX = Math.max(ud.bounds.minX + 0.5, Math.min(ud.bounds.maxX - 0.5, ud.targetX));
          ud.targetZ = Math.max(ud.bounds.minZ + 0.5, Math.min(ud.bounds.maxZ - 0.5, ud.targetZ));
        }

        ud.idleActionTimer -= dt;

        // === Idle animations ===
        if (ud.idleAction === 'lookAround') {
          // Slow head turn left/right
          m.rotation.y += Math.sin(time * 0.8 + ud.bobPhase) * 0.01;
          // Very subtle body sway
          m.position.y = Math.sin(time * 1.2 + ud.bobPhase) * 0.01;
          // Arms relaxed
          m.children.forEach(c => {
            if (c.name === 'armL') c.rotation.x = Math.sin(time * 0.5) * 0.05;
            if (c.name === 'armR') c.rotation.x = Math.sin(time * 0.5 + 1) * 0.05;
            if (c.name === 'legL' || c.name === 'legR') c.rotation.x = 0;
          });
        } else if (ud.idleAction === 'stretch') {
          // Arms up stretch
          const stretchT = 1 - (ud.idleActionTimer / 2.5);
          const armAngle = Math.sin(stretchT * Math.PI) * 0.8;
          m.children.forEach(c => {
            if (c.name === 'armL') c.rotation.x = -armAngle;
            if (c.name === 'armR') c.rotation.x = -armAngle;
            if (c.name === 'legL' || c.name === 'legR') c.rotation.x = 0;
          });
          // Slight rise on toes
          m.position.y = Math.sin(stretchT * Math.PI) * 0.05;
        } else {
          // Stand idle - very subtle breathing
          m.position.y = Math.sin(time * 1.0 + ud.bobPhase) * 0.015;
          m.children.forEach(c => {
            if (c.name === 'armL' || c.name === 'armR') c.rotation.x *= 0.9; // slowly relax
            if (c.name === 'legL' || c.name === 'legR') c.rotation.x = 0;
          });
        }

      } else {
        // === Walking toward target (slower, more casual) ===
        const walkSpeed = Math.min(0.8 * dt, dist * 0.4); // much slower: 0.8 instead of 1.5
        let moveX = (dx / dist) * walkSpeed;
        let moveZ = (dz / dist) * walkSpeed;

        let newX = m.position.x + moveX;
        let newZ = m.position.z + moveZ;
        newX = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, newX));
        newZ = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, newZ));

        // Check furniture + wall + other minion collision
        if (!collidesWithFurniture(newX, newZ, ud.interactLabel, furn) &&
            !collidesWithOtherMinions(newX, newZ, m)) {
          m.position.x = newX;
          m.position.z = newZ;
        } else {
          // Steering: try perpendicular directions
          const perpX1 = moveZ, perpZ1 = -moveX;
          const perpX2 = -moveZ, perpZ2 = moveX;
          const alt1X = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, m.position.x + perpX1));
          const alt1Z = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, m.position.z + perpZ1));
          const alt2X = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, m.position.x + perpX2));
          const alt2Z = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, m.position.z + perpZ2));

          const canGo1 = !collidesWithFurniture(alt1X, alt1Z, '', furn) && !collidesWithOtherMinions(alt1X, alt1Z, m);
          const canGo2 = !collidesWithFurniture(alt2X, alt2Z, '', furn) && !collidesWithOtherMinions(alt2X, alt2Z, m);

          if (canGo1) {
            m.position.x = alt1X; m.position.z = alt1Z;
          } else if (canGo2) {
            m.position.x = alt2X; m.position.z = alt2Z;
          } else {
            // Stuck - pick new target after delay
            if (!ud._stuckTimer) {
              ud._stuckTimer = setTimeout(() => {
                ud.targetX = ud.bounds.minX + 1 + Math.random() * (ud.bounds.maxX - ud.bounds.minX - 2);
                ud.targetZ = ud.bounds.minZ + 1 + Math.random() * (ud.bounds.maxZ - ud.bounds.minZ - 2);
                ud.interactLabel = '';
                ud._stuckTimer = null;
              }, 1000 + Math.random() * 2000);
            }
          }
        }

        // Face direction of movement
        m.rotation.y = Math.atan2(dx, dz);

        // Subtle walking bob (0.02 amplitude, was 0.05)
        const walkCycle = time * 5; // slower cycle: 5 instead of 8
        m.position.y = Math.abs(Math.sin(walkCycle)) * 0.02;

        // Subtle leg and arm swing
        m.children.forEach(c => {
          if (c.name === 'legL') c.rotation.x = Math.sin(walkCycle) * 0.2; // was 0.3
          if (c.name === 'legR') c.rotation.x = Math.sin(walkCycle + Math.PI) * 0.2;
          if (c.name === 'armL') c.rotation.x = Math.sin(walkCycle + Math.PI) * 0.15; // was 0.2
          if (c.name === 'armR') c.rotation.x = Math.sin(walkCycle) * 0.15;
        });
      }

    } else if (ud.state === 'thinking') {
      // Very subtle idle movement while thinking
      m.position.y = Math.sin(time * 1.0 + ud.bobPhase) * 0.015; // was bob * 0.05
      m.position.x += Math.sin(time * 0.3 + ud.bobPhase) * 0.001; // was 0.002
      m.position.z += Math.cos(time * 0.2 + ud.bobPhase) * 0.001;
      // Clamp
      m.position.x = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, m.position.x));
      m.position.z = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, m.position.z));
      // Hand on chin pose
      m.children.forEach(c => {
        if (c.name === 'armR') c.rotation.x = -0.6;
        if (c.name === 'armL') c.rotation.x = 0.05;
        if (c.name === 'legL' || c.name === 'legR') c.rotation.x = 0;
      });

    } else if (ud.state === 'streaming') {
      // Subtle pacing while responding
      m.position.y = Math.sin(time * 1.0 + ud.bobPhase) * 0.015;
      m.position.x += Math.sin(time * 1.5 + ud.bobPhase) * 0.003; // was 0.005
      m.position.z += Math.cos(time * 1.0 + ud.bobPhase) * 0.002; // was 0.003
      m.position.x = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, m.position.x));
      m.position.z = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, m.position.z));
      m.children.forEach(c => {
        if (c.name === 'armR') c.rotation.x = Math.sin(time * 3) * 0.15; // was 0.3
        if (c.name === 'armL') c.rotation.x = Math.sin(time * 3 + 1) * 0.15;
      });

    } else if (ud.state === 'responding') {
      // Celebratory but subtle
      m.position.y = Math.abs(Math.sin(time * 4)) * 0.04; // was 0.15
      m.children.forEach(c => {
        if (c.name === 'armR') c.rotation.x = Math.sin(time * 5) * 0.25; // was 0.5
        if (c.name === 'armL') c.rotation.x = Math.sin(time * 5 + Math.PI) * 0.25;
      });

    } else if (ud.state === 'error') {
      m.position.x += Math.sin(time * 20) * 0.005; // was 0.01
    }
  });
}

// ===== Speech Bubbles (3D → 2D projection) =====
function updateBubbles() {
  minions.forEach(m => {
    const ud = m.userData;
    const key = ud.id;
    const hasContent = (ud.userMsg && ud.userMsg.length > 0) || (ud.thinkLog && ud.thinkLog.length > 0) || (ud.toolLog && ud.toolLog.length > 0);
    const show = (ud.state === 'thinking' || ud.state === 'streaming' || ud.state === 'responding') && hasContent;

    let el = bubbles[key] || null;
    if (show) {
      if (el && !document.body.contains(el)) { delete bubbles[key]; el = null; }

      if (!el) {
        el = document.createElement('div');
        el.className = 'bubble3d';
        el.innerHTML = '<div class="bx">✕</div><div class="bc"></div>';
        el.querySelector('.bx').addEventListener('click', function(e) {
          el.classList.remove('show');
          e.preventDefault();
          e.stopPropagation();
        });

        // Capture ALL pointer events on bubble - exit pointer lock and consume events
        el.addEventListener('pointerdown', function(e) {
          if (document.pointerLockElement) document.exitPointerLock();
          e.stopPropagation();
        }, false);
        el.addEventListener('pointerup', e => e.stopPropagation(), false);
        el.addEventListener('click', e => e.stopPropagation(), false);
        el.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
        el.style.touchAction = 'pan-y';

        document.body.appendChild(el);
        bubbles[key] = el;
      }

      // Project 3D → 2D
      const charPos = new THREE.Vector3(m.position.x, m.position.y + 2.5, m.position.z);
      const screenPos = charPos.clone().project(camera);
      const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
      const camDist = camera.position.distanceTo(new THREE.Vector3(m.position.x, 1, m.position.z));
      const raycaster = new THREE.Raycaster();
      raycaster.set(camera.position, new THREE.Vector3(m.position.x - camera.position.x, 1 - camera.position.y, m.position.z - camera.position.z).normalize());
      raycaster.far = camDist;
      const wallHits = raycaster.intersectObjects(wallMeshes, false);
      const blocked = wallHits.length > 0 && wallHits[0].distance < camDist - 1;

      if (camDist < 15 && !blocked && screenPos.z < 1) {
        el.style.left = Math.max(10, Math.min(window.innerWidth - 370, x - 120)) + 'px';
        el.style.top = Math.max(10, Math.min(window.innerHeight - 300, y - 140)) + 'px';
        el.classList.add('show');

        const bc = el.querySelector('.bc');
        const thinkLog = ud.thinkLog || [];
        const toolLog = ud.toolLog || [];
        let h = '';

        if (ud.state === 'thinking') {
          // Section 1: Message (always visible)
          h += '<div class="b3d-section b3d-section-s1">';
          h += '<div class="b3d-header">📩 收到消息</div>';
          if (ud.userName) h += `<div style="font-size:9px;color:#60a5fa;font-weight:bold;margin-bottom:3px">${esc(ud.userName)}</div>`;
          if (ud.userMsg) h += `<div class="b3d-section-msg">${esc(ud.userMsg.slice(0, 200))}</div>`;
          h += '</div>';

          // Section 2: Thinking + tools mixed (collapsible)
          const totalSteps = thinkLog.length + toolLog.length;
          if (totalSteps > 0) {
            h += '<div class="b3d-section b3d-section-s2">';
            h += `<div class="b3d-header collapsible">🧠 思考过程 (${thinkLog.length}步, ${toolLog.length}工具)</div>`;
            h += `<div class="b3d-body" style="max-height:180px;overflow-y:auto">`;
            // Interleave thinking and tool calls
            const items = [];
            thinkLog.forEach(t => items.push({ type: 'think', data: t }));
            toolLog.forEach(t => items.push({ type: 'tool', data: t }));
            items.slice(-8).forEach(item => {
              if (item.type === 'think') {
                h += `<div class="b3d-section-think">${esc((item.data || '').slice(0, 120))}</div>`;
              } else {
                h += `<div class="b3d-section-tool">🔧 ${esc(item.data.name)}: ${esc((item.data.args || '').slice(0, 60))}</div>`;
              }
            });
            if (items.length > 8) h += `<div class="b3d-summary">...还有 ${items.length - 8} 条</div>`;
            h += '</div></div>';
          }

          h += '<div class="b3d-section"><div class="b3d-summary">⏳ 思考中...</div></div>';

        } else if (ud.state === 'streaming') {
          h += '<div class="b3d-section b3d-section-s1">';
          h += '<div class="b3d-header">📩 收到消息</div>';
          if (ud.userName) h += `<div style="font-size:9px;color:#60a5fa;font-weight:bold">${esc(ud.userName)}</div>`;
          if (ud.userMsg) h += `<div class="b3d-section-msg" style="max-height:60px;overflow:hidden">${esc(ud.userMsg.slice(0, 100))}</div>`;
          h += '</div>';
          h += '<div class="b3d-section b3d-section-s3">';
          h += '<div class="b3d-header">💬 正在回复</div>';
          h += `<div class="b3d-summary">思考了 ${thinkLog.length} 步，调用 ${toolLog.length} 个工具</div>`;
          h += '<div class="b3d-summary">流式输出中...</div>';
          h += '</div>';

        } else if (ud.state === 'responding') {
          h += '<div class="b3d-section b3d-section-s3">';
          h += '<div class="b3d-header">✅ 回复完成</div>';
          if (ud.userName) h += `<div style="font-size:9px;color:#27ae60;font-weight:bold;margin-bottom:3px">回复了 ${esc(ud.userName)}</div>`;
          h += `<div style="font-size:9px;color:#555;line-height:1.7">`;
          h += `📝 思考 <b>${thinkLog.length}</b> 步 · `;
          h += `🔧 <b>${toolLog.length}</b> 工具 · `;
          h += `📤 <b>${ud.replyCount || 0}</b> 条`;
          h += `</div></div>`;
        }

        bc.innerHTML = h;
        // Add collapsible toggle handlers
        bc.querySelectorAll('.b3d-header.collapsible').forEach(header => {
          header.addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.toggle('collapsed');
            const body = this.nextElementSibling;
            if (body) body.classList.toggle('collapsed');
          });
        });
      } else {
        el.classList.remove('show');
      }
    } else {
      if (el) el.classList.remove('show');
    }
  });
}

function esc(s) { return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function cleanThinking(t) {
  if (!t) return '';
  t = t.replace(/"sender_id"[^,}]*/g, '');
  t = t.replace(/"conversation_label"[^,}]*/g, '');
  t = t.replace(/"message_id"[^,}]*/g, '');
  t = t.replace(/"timestamp"[^,}]*/g, '');
  t = t.replace(/"is_group_chat"[^,}]*/g, '');
  t = t.replace(/"was_mentioned"[^,}]*/g, '');
  t = t.replace(/"sender"[^,}]*/g, '');
  t = t.replace(/"group_subject"[^,}]*/g, '');
  t = t.replace(/\{[^{}]*\}/g, '').trim();
  t = t.replace(/\s+/g, ' ').trim();
  return t || t;
}

// ===== Event Handling =====
function setMinionState(id, state, dur) {
  const m = minions.find(m => m.userData.id === id);
  if (!m) return;
  if (m.userData._timer) clearTimeout(m.userData._timer);
  m.userData.state = state;
  console.log(`Minion ${id} -> ${state}, msg=${(m.userData.userMsg||'').slice(0,30)}`);
  if (state !== 'idle' && dur) m.userData._timer = setTimeout(() => { m.userData.state = 'idle'; }, dur);
}

function addLog(ev) {
  const el = document.getElementById('b-logs');
  const t = ev.ts ? new Date(ev.ts).toLocaleTimeString('zh-CN') : '';
  const d = document.createElement('div');
  d.className = 'log t_' + (ev.type || '');

  // Human-readable event display with color coding
  let icon = '•', color = '#888', label = '', content = '';
  switch (ev.type) {
    case 'user_msg':
      icon = '👤'; color = '#34d399';
      label = ev.userName || '用户';
      content = (ev.msg || '').replace(/\[图片消息\]/g, '🖼️ 图片').replace(/\[media attached[^\]]*\]/g, '📎 附件').slice(0, 60);
      break;
    case 'thinking_content':
      icon = '💭'; color = '#a78bfa';
      label = '思考中';
      content = (ev.thinking || '').slice(0, 50);
      break;
    case 'tool_detail':
      icon = '🔧'; color = '#f97316';
      label = ev.tool || '工具';
      content = (ev.args || '').replace(/[{}\[\]"]/g, '').slice(0, 40);
      break;
    case 'thinking':
      icon = '📨'; color = '#60a5fa'; label = '收到消息'; content = '';
      break;
    case 'streaming':
      icon = '💬'; color = '#3b82f6'; label = '正在回复'; content = '';
      break;
    case 'idle':
      icon = '✅'; color = '#22c55e';
      label = '回复完成';
      content = ev.replies ? `${ev.replies} 条回复` : '';
      break;
    case 'error':
      icon = '❌'; color = '#ef4444';
      label = '出错';
      content = (ev.message || ev.raw || '').slice(0, 50);
      break;
    case 'agent_run':
      icon = '🚀'; color = '#8b5cf6'; label = '开始执行'; content = '';
      break;
    case 'agent_done':
      icon = '🏁'; color = '#8b5cf6'; label = '执行完成'; content = '';
      break;
    default:
      icon = '•'; color = '#888';
      label = ev.type || '';
      content = (ev.raw || '').slice(0, 50);
  }

  const timeStr = t ? `<span style="color:#556;font-size:7px">${t}</span> ` : '';
  const labelHtml = `<span style="color:${color};font-weight:bold">${label}</span>`;
  const contentHtml = content ? ` <span style="color:#999">${content}</span>` : '';
  d.innerHTML = `${timeStr}${icon} ${labelHtml}${contentHtml}`;
  el.prepend(d); while (el.children.length > 40) el.removeChild(el.lastChild);

  // Filter minions by session key first, then agentId
  let targets;
  if (ev.session) {
    targets = minions.filter(m => m.userData.id === ev.session);
  }
  if (!targets || targets.length === 0) {
    targets = ev.agentId ? minions.filter(m => m.userData.agentId === ev.agentId) : minions;
  }
  if (targets.length === 0) targets = minions;

  if (ev.type === 'user_msg') {
    console.log('EVENT user_msg:', ev.userName, ev.msg?.slice(0, 50), 'agent:', ev.agentId);
    targets.forEach(m => { m.userData.userMsg = ev.msg; m.userData.userName = ev.userName; m.userData.thinkLog = []; m.userData.toolLog = []; m.userData.replyCount = 0; });
  }
  if (ev.type === 'thinking_content') {
    const t = cleanThinking(ev.thinking);
    console.log('EVENT thinking:', t?.slice(0, 50), 'agent:', ev.agentId);
    targets.forEach(m => {
      if (!m.userData.thinkLog) m.userData.thinkLog = [];
      if (t) m.userData.thinkLog.push(t.slice(0, 200));
      if (m.userData.state === 'idle' && (m.userData.userMsg || m.userData.thinkLog.length > 0)) {
        setMinionState(m.userData.id, 'thinking', 60000);
      }
    });
  }
  if (ev.type === 'tool_detail') {
    console.log('EVENT tool:', ev.tool, 'agent:', ev.agentId);
    targets.forEach(m => { if (!m.userData.toolLog) m.userData.toolLog = []; m.userData.toolLog.push({ name: ev.tool, args: (ev.args||'').slice(0, 100) }); });
  }
  if (ev.type === 'thinking') { console.log('EVENT thinking state', 'agent:', ev.agentId); targets.forEach(m => setMinionState(m.userData.id, 'thinking', 60000)); }
  if (ev.type === 'streaming') { console.log('EVENT streaming', 'agent:', ev.agentId); targets.forEach(m => setMinionState(m.userData.id, 'streaming', 60000)); }
  if (ev.type === 'idle') {
    console.log('EVENT idle, replies:', ev.replies, 'agent:', ev.agentId);
    targets.forEach(m => {
      m.userData.replyCount = ev.replies || 0;
      if (m.userData._timer) clearTimeout(m.userData._timer);
      m.userData._timer = setTimeout(() => { setMinionState(m.userData.id, 'responding', 5000); }, 3000);
    });
  }
  if (ev.type === 'error') targets.forEach(m => setMinionState(m.userData.id, 'error', 6000));
}

function updateUI(d) {
  const agents = d.agents || [];
  document.getElementById('b-agents').innerHTML = agents.map(a => {
    const sessCount = (a.sessions || a.channels || []).length;
    return `<div class="row"><span><span class="dot on"></span>${a.id}</span><span style="color:#667">${sessCount} sessions</span></div>`;
  }).join('') || '<div class="row" style="color:#334">—</div>';

  // Show sessions grouped by agent
  let sessHtml = '';
  for (const a of agents) {
    const sess = a.sessions || a.channels || [];
    for (const s of sess) {
      const icon = s.type === 'group' ? '💬' : s.type === 'dm' ? '👤' : s.type === 'cron' ? '⏰' : s.type === 'main' ? '🏠' : '🔹';
      sessHtml += `<div class="row"><span>${icon} ${s.name || s.key || s.id}</span><span style="color:#556">${a.id}</span></div>`;
    }
  }
  document.getElementById('b-channels').innerHTML = sessHtml || '<div class="row" style="color:#334">—</div>';

  document.getElementById('b-status').innerHTML = `<div class="row"><span>Bind</span><span>${d.gateway?.bind || '?'}:${d.gateway?.port || '?'}</span></div><div class="row"><span>Rooms</span><span>${agents.length}</span></div>`;
  const totalSess = agents.reduce((sum, a) => sum + (a.sessions || a.channels || []).length, 0);
  document.getElementById('h-rooms').textContent = 'Rooms: ' + agents.length;
  document.getElementById('h-sess').textContent = 'Sessions: ' + totalSess;
}

async function runCmd() {
  const inp = document.getElementById('cmd-in'), out = document.getElementById('cmd-out');
  const cmd = inp.value.trim(); if (!cmd) return; out.style.display = 'block'; out.textContent = '执行中...';
  try { const r = await fetch('/api/exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: cmd }) }); const d = await r.json(); out.textContent = d.stdout || d.stderr || `exit: ${d.code}`; } catch (e) { out.textContent = 'Error: ' + e.message; }
}
window.runCmd = runCmd; // expose for inline onclick/onkeydown handlers

// ===== Main Loop =====
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const time = clock.getElapsedTime();

  // FPS camera movement
  if (pointerLocked) {
    const speed = moveSpeed * dt;
    // Forward/back in the direction we're looking (horizontal only)
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    if (keys.w) camera.position.addScaledVector(forward, speed);
    if (keys.s) camera.position.addScaledVector(forward, -speed);
    if (keys.a) camera.position.addScaledVector(right, -speed);
    if (keys.d) camera.position.addScaledVector(right, speed);
    if (keys.space) camera.position.y += speed;
    if (keys.shift) camera.position.y -= speed;

    // Clamp camera y (don't go underground)
    camera.position.y = Math.max(0.5, camera.position.y);
  }

  // Apply look direction
  const lookDir = new THREE.Vector3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  );
  camera.lookAt(camera.position.clone().add(lookDir));

  // Wall transparency
  wallMeshes.forEach(wall => {
    const dist = camera.position.distanceTo(wall.position);
    const targetOpacity = dist < 10 ? Math.max(0.1, dist / 10) : 1;
    wall.material.transparent = true;
    wall.material.opacity += (targetOpacity - wall.material.opacity) * 0.1;
  });

  animateMinions(time, dt);
  updateBubbles();
  // Billboard: make all name labels face camera (Y-axis only for stability)
  minions.forEach(m => {
    const label = m.children.find(c => c.userData && c.userData.isNameLabel);
    if (label) {
      // Get label world position
      const worldPos = new THREE.Vector3();
      label.getWorldPosition(worldPos);
      // Look at camera, keeping label upright (only Y rotation)
      const target = camera.position.clone();
      target.y = worldPos.y; // ignore vertical difference
      label.lookAt(target);
      label.position.y = 2.5;
    }
  });
  // Lamp flicker
  lampLight.intensity = 0.7 + Math.sin(time * 2) * 0.1;
  renderer.render(scene, camera);
}

// ===== SSE =====
function sse() {
  const es = new EventSource('/api/events');
  es.onmessage = e => {
    const m = JSON.parse(e.data);
    console.log('SSE:', m.type, m.data ? JSON.stringify(m.data).slice(0, 100) : '');
    if (m.type === 'init' || m.type === 'config') init(m.data);
    if (m.type === 'event') addLog(m.data);
  };
  es.onerror = () => setTimeout(sse, 3000);
}
sse();
fetch('/api/state').then(r => r.json()).then(init);
fetch('/api/logs/tail').then(r => r.json()).then(d => { if (d.events) d.events.forEach(addLog); });
fetch('/api/events/history').then(r => r.json()).then(d => { if (d.events) d.events.forEach(addLog); });
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
