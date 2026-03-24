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

// Request pointer lock on click
renderer.domElement.addEventListener('click', () => {
  if (!pointerLocked) renderer.domElement.requestPointerLock();
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
const ambientLight = new THREE.AmbientLight(0x8899bb, 0.8);
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
const mat = {
  floor: new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.8 }), // warm wood
  floorAlt: new THREE.MeshStandardMaterial({ color: 0x9B8365, roughness: 0.8 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xf5e6d3, roughness: 0.9 }), // cream walls
  wallSide: new THREE.MeshStandardMaterial({ color: 0xe8d5c0, roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: 0xb84c3a, roughness: 0.7 }), // terracotta
  roofDark: new THREE.MeshStandardMaterial({ color: 0x9a3a2a, roughness: 0.7 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.6 }), // golden wood
  woodDark: new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.7 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xaaddff, transparent: true, opacity: 0.4 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x4a6fa5, roughness: 0.9 }), // blue blanket
  pillow: new THREE.MeshStandardMaterial({ color: 0xfff0e0, roughness: 0.95 }),
  book1: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.8 }),
  book2: new THREE.MeshStandardMaterial({ color: 0x2980b9, roughness: 0.8 }),
  book3: new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.8 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x4a8c3f, roughness: 1 }), // green grass
  grassAlt: new THREE.MeshStandardMaterial({ color: 0x5a9c4f, roughness: 1 }),
  rug: new THREE.MeshStandardMaterial({ color: 0x8b2252, roughness: 0.95 }), // burgundy rug
  door: new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 }),
  // Minion materials
  minionYellow: new THREE.MeshStandardMaterial({ color: 0xf5d033, roughness: 0.5 }),
  minionBlue: new THREE.MeshStandardMaterial({ color: 0x3b5998, roughness: 0.6 }),
  minionGoggle: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 }),
  minionGoggleGlass: new THREE.MeshStandardMaterial({ color: 0xaaddff, transparent: true, opacity: 0.6 }),
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
  wallMeshes = []; // Reset wall tracking

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

  scene.add(group);
  return group;
}

// ===== Build Minion Character =====
function createMinion(colorHex) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex || 0xf5d033, roughness: 0.5 });

  // Body (cylinder)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.38, 1.2, 16), bodyMat);
  body.position.y = 0.9;
  body.castShadow = true;
  group.add(body);

  // Overalls (blue bottom)
  const overalls = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.39, 0.5, 16), mat.minionBlue);
  overalls.position.y = 0.5;
  group.add(overalls);

  // Goggle strap
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.04, 8, 32), mat.minionGoggle);
  strap.position.y = 1.25;
  strap.rotation.x = Math.PI / 2;
  group.add(strap);

  // Eye(s) - single eye for Stuart-like, or double
  const isOneEye = Math.random() > 0.5;

  if (isOneEye) {
    // Single big eye
    const goggleRing = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, 16), mat.minionGoggle);
    goggleRing.position.set(0, 1.28, 0.32);
    group.add(goggleRing);
    const goggleGlass = new THREE.Mesh(new THREE.CircleGeometry(0.17, 16), mat.minionGoggleGlass);
    goggleGlass.position.set(0, 1.28, 0.33);
    group.add(goggleGlass);
    const eyeWhite = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    eyeWhite.position.set(0, 1.28, 0.34);
    group.add(eyeWhite);
    const iris = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), mat.minionEye);
    iris.position.set(0, 1.28, 0.35);
    iris.name = 'iris';
    group.add(iris);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), mat.minionPupil);
    pupil.position.set(0, 1.28, 0.36);
    group.add(pupil);
  } else {
    // Two eyes
    [-0.12, 0.12].forEach(x => {
      const goggleRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 8, 16), mat.minionGoggle);
      goggleRing.position.set(x, 1.28, 0.33);
      group.add(goggleRing);
      const eyeWhite = new THREE.Mesh(new THREE.CircleGeometry(0.1, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      eyeWhite.position.set(x, 1.28, 0.34);
      group.add(eyeWhite);
      const iris = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), mat.minionEye);
      iris.position.set(x, 1.28, 0.35);
      iris.name = 'iris';
      group.add(iris);
      const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), mat.minionPupil);
      pupil.position.set(x, 1.28, 0.36);
      group.add(pupil);
    });
  }

  // Mouth
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 8, 16, Math.PI), mat.minionMouth);
  mouth.position.set(0, 1.05, 0.34);
  mouth.rotation.x = Math.PI;
  mouth.name = 'mouth';
  group.add(mouth);

  // Hair (springs)
  for (let i = 0; i < 5; i++) {
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.2 + Math.random() * 0.15, 4), mat.minionHair);
    const angle = (i / 5) * Math.PI * 2;
    hair.position.set(Math.cos(angle) * 0.1, 1.6 + Math.random() * 0.1, Math.sin(angle) * 0.1);
    hair.rotation.z = (Math.random() - 0.5) * 0.5;
    group.add(hair);
  }

  // Arms
  [-0.42, 0.42].forEach(x => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.6, 8), bodyMat);
    arm.position.set(x, 0.85, 0);
    arm.rotation.z = x > 0 ? -0.3 : 0.3;
    arm.name = x > 0 ? 'armR' : 'armL';
    group.add(arm);
    // Glove
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), mat.minionGlove);
    glove.position.set(x + (x > 0 ? -0.15 : 0.15), 0.55, 0);
    group.add(glove);
  });

  // Legs
  [-0.12, 0.12].forEach(x => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.4, 8), bodyMat);
    leg.position.set(x, 0.2, 0);
    leg.name = x > 0 ? 'legR' : 'legL';
    group.add(leg);
    // Shoe
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.22), mat.minionShoe);
    shoe.position.set(x, 0.04, 0.04);
    group.add(shoe);
  });

  group.userData = { state: 'idle', targetX: 0, targetZ: 0, speed: 0, bobPhase: Math.random() * Math.PI * 2, userMsg: '', userName: '', thinkLog: [], toolLog: [], replyCount: 0 };
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

// Base furniture layout (relative to house origin 0,0)
const BASE_FURNITURE = [
  { x: 6, z: 5, label: '坐坐', cx: 6, cz: 5, cr: 1.5 },
  { x: 4, z: 5, label: '坐坐', cx: 4, cz: 5, cr: 0.5 },
  { x: 8, z: 5, label: '坐坐', cx: 8, cz: 5, cr: 0.5 },
  { x: 2.5, z: 2, label: '休息', cx: 2.5, cz: 2, cr: 1.3 },
  { x: 10, z: 3, label: '做饭', cx: 10, cz: 3, cr: 0.9 },
  { x: 9, z: 1, label: '看书', cx: 9, cz: 1, cr: 0.7 },
  { x: 2, z: 8, label: '照明', cx: 2, cz: 8, cr: 0.3 },
  { x: 10, z: 8, label: '绿植', cx: 10, cz: 8, cr: 0.4 },
  { x: 6, z: 1, label: '装饰', cx: 6, cz: 1, cr: 0.4 },
  { x: 5, z: 8, label: '沙发', cx: 5, cz: 8, cr: 1.0 },
];

// ===== Init =====
let lastInitKey = '';
function init(d) {
  cfg = d;
  // Build a key to detect if config actually changed
  const initKey = (d.agents || []).map(a => a.id + ':' + (a.sessions || a.channels || []).map(s => s.key || s.id).join(',')).join('|');
  if (initKey === lastInitKey && minions.length > 0) return; // No change, skip reinit
  lastInitKey = initKey;

  // Clear old minions & room groups
  minions.forEach(m => scene.remove(m));
  minions = [];
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
    // Fallback: if no interactive sessions, show first 2
    const display = sessions.length > 0 ? sessions : allSessions.slice(0, 2);
    // Generate spread positions dynamically based on session count
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
      scene.add(m);
      minions.push(m);
    });
  });

  updateUI(d);
}

// ===== Minion Animation =====
// Dynamic furniture: offset by house position
function getFurnitureForMinion(m) {
  const off = m.userData.houseOffset || { ox: 0, oz: 0 };
  return BASE_FURNITURE.map(f => ({
    x: f.x + off.ox, z: f.z + off.oz,
    label: f.label,
    cx: f.cx + off.ox, cz: f.cz + off.oz, cr: f.cr
  }));
}

// Keep FURNITURE for backward compat (used by first house or when no offset)
const FURNITURE = BASE_FURNITURE;

// Check if position collides with furniture (per-minion)
function collidesWithFurniture(x, z, excludeLabel, furn) {
  const list = furn || FURNITURE;
  for (const f of list) {
    if (f.label === excludeLabel) continue;
    const dx = x - f.cx, dz = z - f.cz;
    if (Math.sqrt(dx * dx + dz * dz) < f.cr) return true;
  }
  return false;
}

function animateMinions(time, dt) {
  minions.forEach(m => {
    const ud = m.userData;
    const bob = Math.sin(time * 3 + ud.bobPhase);
    const furn = getFurnitureForMinion(m);

    if (ud.state === 'idle') {
      const dx = ud.targetX - m.position.x;
      const dz = ud.targetZ - m.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 0.3) {
        if (Math.random() < 0.3) {
          const f = furn[Math.floor(Math.random() * furn.length)];
          const angle = Math.random() * Math.PI * 2;
          const approachDist = f.cr + 0.5 + Math.random() * 0.5;
          ud.targetX = f.x + Math.cos(angle) * approachDist;
          ud.targetZ = f.z + Math.sin(angle) * approachDist;
          ud.interactLabel = f.label;
        } else {
          ud.targetX = ud.bounds.minX + Math.random() * (ud.bounds.maxX - ud.bounds.minX);
          ud.targetZ = ud.bounds.minZ + Math.random() * (ud.bounds.maxZ - ud.bounds.minZ);
          ud.interactLabel = '';
        }
        // Clamp target to room bounds
        ud.targetX = Math.max(ud.bounds.minX + 0.5, Math.min(ud.bounds.maxX - 0.5, ud.targetX));
        ud.targetZ = Math.max(ud.bounds.minZ + 0.5, Math.min(ud.bounds.maxZ - 0.5, ud.targetZ));
      } else {
        // Smooth easing movement with steering avoidance
        const speed = Math.min(1.5 * dt, dist * 0.5);
        let moveX = (dx / dist) * speed;
        let moveZ = (dz / dist) * speed;

        // Check direct path
        let newX = m.position.x + moveX;
        let newZ = m.position.z + moveZ;
        newX = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, newX));
        newZ = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, newZ));

        if (!collidesWithFurniture(newX, newZ, ud.interactLabel, furn)) {
          m.position.x = newX;
          m.position.z = newZ;
        } else {
          // Steering: try perpendicular directions
          const perpX1 = moveZ, perpZ1 = -moveX; // left
          const perpX2 = -moveZ, perpZ2 = moveX; // right
          const alt1X = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, m.position.x + perpX1));
          const alt1Z = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, m.position.z + perpZ1));
          const alt2X = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, m.position.x + perpX2));
          const alt2Z = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, m.position.z + perpZ2));

          if (!collidesWithFurniture(alt1X, alt1Z, '', furn)) {
            m.position.x = alt1X; m.position.z = alt1Z;
          } else if (!collidesWithFurniture(alt2X, alt2Z, '', furn)) {
            m.position.x = alt2X; m.position.z = alt2Z;
          } else {
            // Completely stuck - stop and wait, then pick new target after delay
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
        // Walking bob
        m.position.y = Math.abs(Math.sin(time * 8)) * 0.05;
        // Leg animation
        m.children.forEach(c => {
          if (c.name === 'legL') c.rotation.x = Math.sin(time * 8) * 0.3;
          if (c.name === 'legR') c.rotation.x = Math.sin(time * 8 + Math.PI) * 0.3;
          if (c.name === 'armL') c.rotation.x = Math.sin(time * 8 + Math.PI) * 0.2;
          if (c.name === 'armR') c.rotation.x = Math.sin(time * 8) * 0.2;
        });
      }
    } else if (ud.state === 'thinking') {
      // Small idle movement while thinking
      m.position.y = bob * 0.05;
      m.position.x += Math.sin(time * 0.5 + ud.bobPhase) * 0.002;
      m.position.z += Math.cos(time * 0.3 + ud.bobPhase) * 0.002;
      // Clamp
      m.position.x = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, m.position.x));
      m.position.z = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, m.position.z));
      // Hand on chin
      m.children.forEach(c => {
        if (c.name === 'armR') c.rotation.x = -0.8;
        if (c.name === 'armL') c.rotation.x = 0;
      });
    } else if (ud.state === 'streaming') {
      // Pacing while responding
      m.position.y = bob * 0.04;
      m.position.x += Math.sin(time * 2 + ud.bobPhase) * 0.005;
      m.position.z += Math.cos(time * 1.5 + ud.bobPhase) * 0.003;
      m.position.x = Math.max(ud.bounds.minX + 0.3, Math.min(ud.bounds.maxX - 0.3, m.position.x));
      m.position.z = Math.max(ud.bounds.minZ + 0.3, Math.min(ud.bounds.maxZ - 0.3, m.position.z));
      m.children.forEach(c => {
        if (c.name === 'armR') c.rotation.x = Math.sin(time * 5) * 0.3;
        if (c.name === 'armL') c.rotation.x = Math.sin(time * 5 + 1) * 0.3;
      });
    } else if (ud.state === 'responding') {
      m.position.y = Math.abs(Math.sin(time * 6)) * 0.15;
      m.children.forEach(c => {
        if (c.name === 'armR') c.rotation.x = Math.sin(time * 8) * 0.5;
        if (c.name === 'armL') c.rotation.x = Math.sin(time * 8 + Math.PI) * 0.5;
      });
    } else if (ud.state === 'error') {
      m.position.x += Math.sin(time * 30) * 0.01;
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
      // Clean up removed elements
      if (el && !document.body.contains(el)) { delete bubbles[key]; el = null; }

      if (!el) {
        el = document.createElement('div');
        el.className = 'bubble3d';
        el.innerHTML = '<div class="bc"></div><div class="bx" onclick="this.parentElement.classList.remove(\'show\')">✕</div>';
        document.body.appendChild(el);
        bubbles[key] = el;
      }

      // Project 3D position to 2D screen
      const charPos = new THREE.Vector3(m.position.x, m.position.y + 2.5, m.position.z);
      const screenPos = charPos.clone().project(camera);
      const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

      const camDist = camera.position.distanceTo(new THREE.Vector3(m.position.x, 1, m.position.z));
      const maxBubbleDist = 15;
      const raycaster = new THREE.Raycaster();
      raycaster.set(camera.position, new THREE.Vector3(m.position.x - camera.position.x, 1 - camera.position.y, m.position.z - camera.position.z).normalize());
      raycaster.far = camDist;
      const wallHits = raycaster.intersectObjects(wallMeshes, false);
      const blocked = wallHits.length > 0 && wallHits[0].distance < camDist - 1;

      if (camDist < maxBubbleDist && !blocked && screenPos.z < 1) {
        el.style.left = Math.max(10, Math.min(window.innerWidth - 300, x - 110)) + 'px';
        el.style.top = Math.max(10, Math.min(window.innerHeight - 250, y - 120)) + 'px';
        el.classList.add('show');

        const bc = el.querySelector('.bc');
        const thinkLog = ud.thinkLog || [];
        const toolLog = ud.toolLog || [];
        let h = '';

        if (ud.state === 'thinking') {
          // Phase 1: Message received
          h += '<div style="font-size:11px;color:#0f3460;font-weight:bold;margin-bottom:6px;border-bottom:2px solid #53d8fb;padding-bottom:4px">📩 收到消息</div>';
          if (ud.userName) h += `<div style="font-size:10px;color:#666;margin-bottom:4px">来自 <b style="color:#4cade8">${esc(ud.userName)}</b></div>`;
          if (ud.userMsg) h += `<div style="background:#f0f4ff;border-radius:6px;padding:6px 8px;margin:4px 0;font-size:10px;border-left:4px solid #60a5fa;color:#222;word-break:break-all;line-height:1.6">💬 ${esc(ud.userMsg.slice(0, 200))}</div>`;

          // Phase 2: Thinking log (accumulated)
          if (thinkLog.length > 0) {
            h += '<div style="font-size:10px;color:#7c3aed;font-weight:bold;margin-top:8px;margin-bottom:4px;border-top:1px solid #e0e0e0;padding-top:4px">🧠 思考过程</div>';
            thinkLog.slice(-5).forEach((t, i) => {
              h += `<div style="background:#f5f0ff;border-radius:4px;padding:4px 6px;margin:2px 0;font-size:8px;border-left:3px solid #a78bfa;color:#444;line-height:1.5">${esc(t.slice(0, 150))}</div>`;
            });
            if (thinkLog.length > 5) h += `<div style="font-size:7px;color:#888">...还有 ${thinkLog.length - 5} 条思考</div>`;
          }

          // Tool calls
          if (toolLog.length > 0) {
            h += '<div style="font-size:10px;color:#d97706;font-weight:bold;margin-top:6px;margin-bottom:3px">🔧 工具调用</div>';
            toolLog.slice(-3).forEach(t => {
              h += `<div style="background:#fff8f0;border-radius:4px;padding:3px 6px;margin:2px 0;font-size:8px;border-left:3px solid #f97316;color:#555">${esc(t.name)}: ${esc(t.args.slice(0, 60))}</div>`;
            });
          }

          h += `<div style="font-size:8px;color:#888;margin-top:6px">⏳ 思考中... (${thinkLog.length} 步)</div>`;

        } else if (ud.state === 'streaming') {
          h += '<div style="font-size:11px;color:#0f3460;font-weight:bold;margin-bottom:6px">💬 正在回复</div>';
          if (ud.userName) h += `<div style="font-size:10px;color:#666;margin-bottom:4px">回复 <b style="color:#4cade8">${esc(ud.userName)}</b></div>`;
          if (thinkLog.length > 0) {
            h += `<div style="font-size:8px;color:#888">思考了 ${thinkLog.length} 步，调用 ${toolLog.length} 个工具</div>`;
          }
          h += '<div style="font-size:8px;color:#888;margin-top:3px">流式输出中...</div>';

        } else if (ud.state === 'responding') {
          // Phase 3: Summary
          h += '<div style="font-size:11px;color:#27ae60;font-weight:bold;margin-bottom:6px;border-bottom:2px solid #27ae60;padding-bottom:4px">✅ 回复完成</div>';
          if (ud.userName) h += `<div style="font-size:10px;color:#666;margin-bottom:4px">回复了 <b style="color:#4cade8">${esc(ud.userName)}</b></div>`;
          h += `<div style="font-size:9px;color:#555;line-height:1.6">`;
          h += `📝 思考了 <b>${thinkLog.length}</b> 步<br>`;
          h += `🔧 使用了 <b>${toolLog.length}</b> 个工具<br>`;
          h += `📤 发送了 <b>${ud.replyCount || 0}</b> 条回复`;
          h += `</div>`;
        }

        bc.innerHTML = h;
      } else {
        el.classList.remove('show');
      }
    } else {
      // Hide all bubbles for this minion
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
  const ic = { thinking: '📨', streaming: '💬', idle: '✅', user_msg: '👤', thinking_content: '🧠', tool_detail: '🔧', error: '❌' };
  let display = '';
  if (ev.type === 'user_msg') display = `<b style="color:#34d399">${ev.userName || '用户'}:</b> ${(ev.msg || '').slice(0, 70)}`;
  else if (ev.type === 'thinking_content') display = `<b style="color:#a78bfa">思考:</b> ${(ev.thinking || '').slice(0, 70)}`;
  else if (ev.type === 'tool_detail') display = `<b style="color:#f97316">${ev.tool}</b>`;
  else display = (ev.raw || '').slice(0, 70);
  d.innerHTML = `<span style="color:#445">[${t}]</span> ${ic[ev.type] || '•'} ${display}`;
  el.prepend(d); while (el.children.length > 35) el.removeChild(el.lastChild);

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
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
