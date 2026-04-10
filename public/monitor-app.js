import * as THREE from 'three';

// ===== Globals =====
const container = document.getElementById('scene3d');

// ===== Auth (session cookie) =====
function authFetch(url, options = {}) { return fetch(url, options); }

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/status');
    const d = await res.json();
    if (!d.authenticated) { location.href = '/login.html'; return false; }
    window._currentUser = d.user;
    return true;
  } catch { return true; }
}


// Login handler (elements only exist on login.html)
const loginTokenEl = document.getElementById('login-token');
if (loginTokenEl) {
  loginTokenEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('login-btn')?.click();
  });
}

// ===== Feature 2: World Chat Panel =====
let chatPanelOpen = false;
let chatMessagesData = [];

// Chat panel toggle
document.getElementById('chat-close')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleChatPanel();
});
document.getElementById('chat-panel')?.addEventListener('mousedown', (e) => e.stopPropagation());

function toggleChatPanel() {
  chatPanelOpen = !chatPanelOpen;
  const panel = document.getElementById('chat-panel');
  if (chatPanelOpen) {
    panel.classList.add('show');
    // Fetch existing messages
    authFetch('/api/chat/messages').then(r => r.json()).then(data => {
      if (data.messages) {
        chatMessagesData = data.messages;
        renderChatMessages();
      }
    }).catch(() => {});
  } else {
    panel.classList.remove('show');
  }
}

function handleChatMessage(msg) {
  chatMessagesData.push(msg);
  if (chatMessagesData.length > 100) chatMessagesData.shift();
  if (chatPanelOpen) renderChatMessages();
}

function renderChatMessages() {
  const container = document.getElementById('chat-msgs');
  const wasAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
  container.innerHTML = chatMessagesData.map(msg => {
    if (msg.system || msg.userId === 'system') {
      return `<div class="cp-msg system">${esc(msg.text)}</div>`;
    }
    const nameColor = msg.userId === myUserId ? '#53d8fb' : (getNameColor(msg.userId) || '#a78bfa');
    return `<div class="cp-msg"><span class="cp-name" style="color:${nameColor}">${esc(msg.name)}</span><span class="cp-text">${esc(msg.text)}</span></div>`;
  }).join('');
  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

function getNameColor(userId) {
  // Simple hash to assign color
  const colors = ['#53d8fb','#f472b6','#34d399','#fbbf24','#a78bfa','#f87171','#38bdf8','#fb923c'];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// Send chat message
function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  authFetch('/api/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: myUserId, name: myUserName, text })
  }).catch(() => {});
}

document.getElementById('chat-send').addEventListener('click', (e) => {
  e.stopPropagation();
  sendChatMessage();
});

const chatInput = document.getElementById('chat-input');
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});
chatInput.addEventListener('focus', () => { interactingWithOverlay = true; });
chatInput.addEventListener('blur', () => { interactingWithOverlay = false; });
chatInput.addEventListener('mousedown', (e) => e.stopPropagation());
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
// Enhanced fog for depth
scene.fog = new THREE.FogExp2(0x87ceeb, 0.006);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(25, 30, 35);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// Camera controls
let yaw = 0, pitch = -0.5;
let moveSpeed = 12;
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
let isDragging = false, dragStarted = false, lastMX = 0, lastMY = 0;

// Minion drag state
const dragRaycaster = new THREE.Raycaster();
let longPressTimer = null;
let longPressTarget = null;
let pressStartTime = 0;
let pressStartPos = { x: 0, y: 0 };
let isDraggingMinion = false;

// Focus management: track if user is interacting with a DOM overlay
let interactingWithOverlay = false;

// Seeded random for deterministic minion behavior across clients
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
// Get deterministic RNG for a session at the current time quantum (5s intervals)
function getMinionRng(sessionKey) {
  const quantum = Math.floor(Date.now() / 5000); // changes every 5 seconds
  return seededRandom(hashStr(sessionKey) + quantum);
}

// ===== Server State Persistence =====
let serverState = null; // loaded from /api/state on startup

// ===== Feature: Minion Hover Highlight =====
const hoverRaycaster = new THREE.Raycaster();
let hoveredMinion = null;
let lastHoverCheck = 0;
const HOVER_THROTTLE = 100; // ~10fps
// Create tooltip element
const hoverTooltip = document.createElement('div');
hoverTooltip.id = 'hover-tooltip';
hoverTooltip.className = 'hidden';
document.body.appendChild(hoverTooltip);

// ===== Feature: Follow Mode (Double-Click Tracking) =====
let followMinion = null; // minion being followed, or null
const FOLLOW_OFFSET = new THREE.Vector3(0, 4, 5); // above and behind

// ===== Feature: Screenshot Mode =====
let screenshotMode = false;

// ===== Feature: FPS Counter =====
let fpsFrames = 0, fpsLastTime = performance.now(), fpsValue = 0;

// ===== Feature: Number Key Camera Transition =====
let cameraTransition = null; // { startPos, endPos, progress, duration }

// ===== Feature: Spawn Effects =====
const spawnEffects = []; // { ring, life, maxLife }

function createSpawnEffect(x, z) {
  // Outer expanding ring
  const ringGeo = new THREE.RingGeometry(0.1, 0.3, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffd700, transparent: true, opacity: 0.8,
    side: THREE.DoubleSide, depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  scene.add(ring);

  // Inner glow ring
  const innerGeo = new THREE.RingGeometry(0.05, 0.15, 32);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.9,
    side: THREE.DoubleSide, depthWrite: false
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(x, 0.06, z);
  scene.add(inner);

  // Rising particles (small spheres)
  const particles = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const pGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const pMat = new THREE.MeshBasicMaterial({
      color: 0xffd700, transparent: true, opacity: 0.8
    });
    const p = new THREE.Mesh(pGeo, pMat);
    p.position.set(x + Math.cos(angle) * 0.3, 0.1, z + Math.sin(angle) * 0.3);
    p.userData = { angle, speed: 1.5 + Math.random() * 0.5, riseSpeed: 1 + Math.random() * 0.5 };
    scene.add(p);
    particles.push(p);
  }

  spawnEffects.push({ ring, inner, particles, life: 1.5, maxLife: 1.5 });
}

function updateSpawnEffects(dt) {
  for (let i = spawnEffects.length - 1; i >= 0; i--) {
    const se = spawnEffects[i];
    se.life -= dt;
    const progress = 1 - se.life / se.maxLife; // 0→1

    // Expand ring
    const scale = 1 + progress * 4;
    se.ring.scale.set(scale, scale, 1);
    se.ring.material.opacity = 0.8 * (1 - progress);

    // Inner ring
    const innerScale = 1 + progress * 2.5;
    se.inner.scale.set(innerScale, innerScale, 1);
    se.inner.material.opacity = 0.9 * (1 - progress);

    // Particles rise and spread
    for (const p of se.particles) {
      const ud = p.userData;
      const dist = progress * 1.5 * ud.speed;
      p.position.x = se.ring.position.x + Math.cos(ud.angle) * (0.3 + dist);
      p.position.z = se.ring.position.z + Math.sin(ud.angle) * (0.3 + dist);
      p.position.y = 0.1 + progress * 1.5 * ud.riseSpeed;
      p.material.opacity = 0.8 * (1 - progress);
    }

    if (se.life <= 0) {
      scene.remove(se.ring); se.ring.geometry.dispose(); se.ring.material.dispose();
      scene.remove(se.inner); se.inner.geometry.dispose(); se.inner.material.dispose();
      for (const p of se.particles) { scene.remove(p); p.geometry.dispose(); p.material.dispose(); }
      spawnEffects.splice(i, 1);
    }
  }
}

// ===== Feature: Seasonal Theme =====
const currentMonth = new Date().getMonth() + 1; // 1-12
const season = currentMonth >= 3 && currentMonth <= 5 ? 'spring' :
               currentMonth >= 6 && currentMonth <= 8 ? 'summer' :
               currentMonth >= 9 && currentMonth <= 11 ? 'autumn' : 'winter';

// ===== Feature: Snow particles (winter) =====
const snowParticles = [];
function initSnowSystem() {
  if (season !== 'winter') return;
  const snowGeo = new THREE.SphereGeometry(0.03, 4, 4);
  const snowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 150; i++) {
    const snow = new THREE.Mesh(snowGeo, snowMat.clone());
    snow.position.set(
      (Math.random() - 0.5) * 100,
      2 + Math.random() * 18,
      (Math.random() - 0.5) * 100
    );
    snow.userData = {
      speed: 0.3 + Math.random() * 0.4,
      wobble: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 0.3,
      _atmosphere: true,
    };
    scene.add(snow);
    snowParticles.push(snow);
  }
}

function updateSnow(dt, time) {
  for (const s of snowParticles) {
    const ud = s.userData;
    s.position.y -= ud.speed * dt;
    s.position.x += Math.sin(time * 0.8 + ud.wobble) * ud.drift * dt;
    s.position.z += Math.cos(time * 0.6 + ud.wobble) * ud.drift * dt * 0.5;
    if (s.position.y < 0) {
      s.position.y = 15 + Math.random() * 5;
      s.position.x = (Math.random() - 0.5) * 100;
      s.position.z = (Math.random() - 0.5) * 100;
    }
  }
}

function applySeasonalTheme() {
  // Apply seasonal color shifts to materials
  switch (season) {
    case 'spring':
      mat.grass.color.set(0x7ed984);       // lighter green
      mat.grassDark.color.set(0x5cb86a);
      mat.flowerPink.color.set(0xffb6c1);   // pinker flowers
      mat.flowerRed.color.set(0xff6b81);
      break;
    case 'summer':
      mat.grass.color.set(0x5ec269);        // bright colors (default)
      mat.grassDark.color.set(0x48a854);
      break;
    case 'autumn':
      mat.grass.color.set(0xc4a235);         // golden grass
      mat.grassDark.color.set(0xa68628);
      mat.leafGreen.color.set(0xd4880f);     // orange leaves
      mat.leafDark.color.set(0x8b5e14);
      mat.bushGreen.color.set(0xb87333);     // brown bushes
      mat.flowerRed.color.set(0xcc5500);     // autumn flowers
      mat.flowerPink.color.set(0xd4837a);
      break;
    case 'winter':
      mat.grass.color.set(0xd4dde6);         // white/blue tint
      mat.grassDark.color.set(0xb8c5d4);
      mat.leafGreen.color.set(0x8faabc);     // frosted leaves
      mat.leafDark.color.set(0x6d8a9e);
      mat.bushGreen.color.set(0x9ab0bf);
      break;
  }

  // Sky tint for seasons
  if (season === 'autumn') {
    scene.background = new THREE.Color(0xd4a574);
    scene.fog.color.set(0xd4a574);
  } else if (season === 'winter') {
    scene.background = new THREE.Color(0xb8cfe0);
    scene.fog.color.set(0xb8cfe0);
  }
}

// Seasonal theme will be applied after mat is defined (see below)
let _seasonalApplied = false;

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
  if (!isCanvasEvent(e)) return;

  // First: check if we're clicking on a minion (for long-press drag)
  pressStartTime = Date.now();
  pressStartPos = { x: e.clientX, y: e.clientY };

  const mouse = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  dragRaycaster.setFromCamera(mouse, camera);
  const hits = dragRaycaster.intersectObjects(clickables, true);
  longPressTarget = null;
  if (hits.length > 0) {
    let target = hits[0].object;
    while (target.parent && !target.userData.sessionKey) target = target.parent;
    if (target.userData.sessionKey) {
      longPressTarget = target;
      // Start long press timer (400ms → enter drag mode)
      longPressTimer = setTimeout(() => {
        if (longPressTarget && !isDraggingMinion) {
          isDraggingMinion = true;
          longPressTarget.userData.isDragging = true;
          longPressTarget.userData.velocityY = 1.5; // slight lift
          longPressTarget.userData.isGrounded = false;
          // Cancel camera drag
          isDragging = false;
          renderer.domElement.classList.remove('dragging');
          document.querySelectorAll('.bubble3d, .mcp-bubble').forEach(el => {
            el.style.pointerEvents = '';
          });
          renderer.domElement.style.cursor = 'grabbing';
        }
      }, 400);
    }
  }

  // Start camera drag (will be cancelled if long press triggers)
  isDragging = true; dragStarted = false;
  lastMX = e.clientX; lastMY = e.clientY;
  renderer.domElement.classList.add('dragging');
  document.querySelectorAll('.bubble3d, .mcp-bubble').forEach(el => {
    el.style.pointerEvents = 'none';
  });
  e.preventDefault();
});

// Double-click: follow minion
renderer.domElement.addEventListener('dblclick', e => {
  e.preventDefault();
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
      followMinion = target;
    }
  }
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
  // Escape: exit follow mode (works even when interacting with overlay)
  if (e.code === 'Escape') {
    if (followMinion) { followMinion = null; return; }
  }

  if (isInputFocused() || interactingWithOverlay) return;

  // F1: screenshot mode toggle
  if (e.code === 'F1') {
    e.preventDefault();
    screenshotMode = !screenshotMode;
    const els = ['drawer', 'toggle', 'hud', 'help'];
    els.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = screenshotMode ? 'none' : '';
    });
    const fpsEl = document.getElementById('fps-badge');
    if (fpsEl) fpsEl.style.display = screenshotMode ? 'none' : '';
    const minimap = document.getElementById('minimap');
    if (minimap) minimap.style.display = screenshotMode ? 'none' : '';
    // Toggle bubbles
    Object.values(bubbles).forEach(b => {
      if (screenshotMode) b.style.display = 'none';
      else b.style.display = '';
    });
    Object.values(mcpBubbles).forEach(b => {
      if (b) { if (screenshotMode) b.style.display = 'none'; else b.style.display = ''; }
    });
    return;
  }

  // Number keys 1-9: jump to continent
  if (e.code >= 'Digit1' && e.code <= 'Digit9') {
    const idx = parseInt(e.key) - 1;
    if (idx < agents.length) {
      const cols = Math.ceil(Math.sqrt(agents.length));
      const col = idx % cols, row = Math.floor(idx / cols);
      const W2 = 22, D = 22;
      const ox = col * (W2 + 6) - (cols - 1) * (W2 + 6) / 2;
      const oz = row * (D + 6) - (Math.ceil(agents.length / cols) - 1) * (D + 6) / 2;
      const cx = ox + W2 / 2, cz = oz + D / 2;
      cameraTransition = {
        startPos: camera.position.clone(),
        endPos: new THREE.Vector3(cx + 5, 20, cz + 15),
        progress: 0,
        duration: 0.8
      };
      // Exit follow mode when jumping
      followMinion = null;
    }
    return;
  }

  if (e.code === 'KeyW') keys.w = true;
  else if (e.code === 'KeyA') keys.a = true;
  else if (e.code === 'KeyS') keys.s = true;
  else if (e.code === 'KeyD') keys.d = true;
  else if (e.code === 'Space') { keys.space = true; e.preventDefault(); }
  else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;
  else if (e.code === 'KeyR') toggleRain();
  else if (e.code === 'KeyV') {
    const wasThirdPerson = thirdPerson;
    thirdPerson = !thirdPerson;
    if (!selfAvatar) createSelfAvatar();
    if (selfAvatar) selfAvatar.visible = thirdPerson;
    // walkPos.y stays as-is: first-person height becomes third-person orbit height
  }
  else if (e.code === 'KeyT') { e.preventDefault(); toggleChatPanel(); }
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

// ===== Enhanced Lighting System =====
// Ambient light - warm base
scene.add(new THREE.AmbientLight(0xffe4c4, 0.3));

// Extra ambient light to prevent dark shadows
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

// Hemisphere light - realistic sky/ground color bleeding
const hemiLight = new THREE.HemisphereLight(0xffeeb5, 0x4a7c4e, 0.8);
scene.add(hemiLight);

// Main directional light (sun) - warm golden hour
const sun = new THREE.DirectionalLight(0xffeedd, 1.8);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 200;
const sc = sun.shadow.camera;
sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);

// Fill light - softer, from opposite side
const fillLight = new THREE.DirectionalLight(0x9ecfff, 0.3);
fillLight.position.set(-20, 30, -10);
scene.add(fillLight);

// Rim light - creates nice edge highlights
const rimLight = new THREE.DirectionalLight(0xffccaa, 0.2);
rimLight.position.set(-30, 20, 30);
scene.add(rimLight);

// Visible sun sphere with glow effect
const sunSphere = new THREE.Mesh(
  new THREE.SphereGeometry(2, 32, 24),
  new THREE.MeshBasicMaterial({ color: 0xffee88 })
);
sunSphere.position.copy(sun.position);
sunSphere.userData._atmosphere = true;
scene.add(sunSphere);

// Sun glow layers for realistic bloom
const sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(4, 32, 24),
  new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.15 })
);
sunGlow.position.copy(sun.position);
sunGlow.userData._atmosphere = true;
scene.add(sunGlow);

// Outer glow
const sunOuterGlow = new THREE.Mesh(
  new THREE.SphereGeometry(8, 32, 24),
  new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.05 })
);
sunOuterGlow.position.copy(sun.position);
sunOuterGlow.userData._atmosphere = true;
scene.add(sunOuterGlow);

// ===== Procedural Texture Generator =====
function generateTextures() {
  function makeCanvas(size) {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    return c;
  }
  function makeTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  // --- Grass Texture ---
  const grassCanvas = makeCanvas(256);
  {
    const ctx = grassCanvas.getContext('2d');
    // Base green noise
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = Math.random();
        const g = Math.floor(130 + n * 50);
        const r = Math.floor(50 + n * 30);
        const b = Math.floor(40 + n * 20);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Small grass blades (short lines)
    ctx.strokeStyle = 'rgba(30,100,30,0.7)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 400; i++) {
      const bx = Math.random() * 256;
      const by = Math.random() * 256;
      const len = 4 + Math.random() * 6;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.8;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle) * len, by + Math.sin(angle) * len);
      ctx.stroke();
    }
  }

  // --- Dirt Texture ---
  const dirtCanvas = makeCanvas(256);
  {
    const ctx = dirtCanvas.getContext('2d');
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = Math.random();
        const r = Math.floor(150 + n * 50);
        const g = Math.floor(100 + n * 40);
        const b = Math.floor(50 + n * 20);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Dirt particles/pebbles
    for (let i = 0; i < 200; i++) {
      const px = Math.random() * 256;
      const py = Math.random() * 256;
      const r = 1 + Math.random() * 2;
      const dark = Math.random() > 0.5;
      ctx.fillStyle = dark ? 'rgba(80,50,20,0.5)' : 'rgba(200,160,90,0.4)';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Stone Texture ---
  const stoneCanvas = makeCanvas(256);
  {
    const ctx = stoneCanvas.getContext('2d');
    // Base grey noise
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = Math.random();
        const v = Math.floor(120 + n * 60);
        ctx.fillStyle = `rgb(${v},${v},${v - 5})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Crack lines (polygon boundaries)
    ctx.strokeStyle = 'rgba(60,60,70,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 18; i++) {
      const sx = Math.random() * 256, sy = Math.random() * 256;
      const pts = 3 + Math.floor(Math.random() * 3);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      for (let j = 0; j < pts; j++) {
        ctx.lineTo(sx + (Math.random() - 0.5) * 50, sy + (Math.random() - 0.5) * 50);
      }
      ctx.stroke();
    }
  }

  // --- Wood Texture ---
  const woodCanvas = makeCanvas(256);
  {
    const ctx = woodCanvas.getContext('2d');
    // Vertical grain stripes
    for (let x = 0; x < 256; x++) {
      const n = Math.sin(x * 0.3) * 0.5 + 0.5 + Math.random() * 0.1;
      const r = Math.floor(100 + n * 60);
      const g = Math.floor(60 + n * 40);
      const b = Math.floor(20 + n * 20);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, 1, 256);
    }
    // Grain lines
    ctx.strokeStyle = 'rgba(60,30,10,0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 20; i++) {
      const x = Math.random() * 256;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y < 256; y += 8) {
        ctx.lineTo(x + (Math.random() - 0.5) * 3, y);
      }
      ctx.stroke();
    }
  }

  // --- Water Texture ---
  const waterCanvas = makeCanvas(256);
  {
    const ctx = waterCanvas.getContext('2d');
    // Base blue
    ctx.fillStyle = '#4a9fca';
    ctx.fillRect(0, 0, 256, 256);
    // Concentric ripple rings
    for (let i = 0; i < 12; i++) {
      const cx = Math.random() * 256, cy = Math.random() * 256;
      for (let r = 5; r < 60; r += 10) {
        ctx.strokeStyle = `rgba(100,180,230,${0.4 - r / 150})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Horizontal shimmer lines
    ctx.strokeStyle = 'rgba(180,230,255,0.2)';
    ctx.lineWidth = 1;
    for (let y = 0; y < 256; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < 256; x += 8) {
        ctx.lineTo(x, y + (Math.random() - 0.5) * 2);
      }
      ctx.stroke();
    }
  }

  // --- Roof Tile Texture ---
  const roofCanvas = makeCanvas(256);
  {
    const ctx = roofCanvas.getContext('2d');
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, 256, 256);
    const tileW = 32, tileH = 20;
    for (let row = 0; row < 256 / tileH + 1; row++) {
      for (let col = 0; col < 256 / tileW + 1; col++) {
        const offsetX = (row % 2) * (tileW / 2);
        const x = col * tileW + offsetX;
        const y = row * tileH;
        const shade = 140 + Math.floor(Math.random() * 30);
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x + 1, y + 1, tileW - 2, tileH - 2);
        // Highlight top edge
        ctx.fillStyle = `rgba(255,255,255,0.15)`;
        ctx.fillRect(x + 1, y + 1, tileW - 2, 3);
        // Shadow bottom edge
        ctx.fillStyle = `rgba(0,0,0,0.2)`;
        ctx.fillRect(x + 1, y + tileH - 3, tileW - 2, 3);
      }
    }
  }

  // --- Brick Wall Texture ---
  const wallCanvas = makeCanvas(256);
  {
    const ctx = wallCanvas.getContext('2d');
    ctx.fillStyle = '#cccccc'; // mortar base
    ctx.fillRect(0, 0, 256, 256);
    const brickW = 40, brickH = 18;
    for (let row = 0; row < 256 / brickH + 1; row++) {
      for (let col = 0; col < 256 / brickW + 2; col++) {
        const offsetX = (row % 2) * (brickW / 2);
        const x = col * brickW - offsetX;
        const y = row * brickH;
        const n = Math.random();
        const shade = Math.floor(210 + n * 30);
        ctx.fillStyle = `rgb(${shade},${shade - 5},${shade - 10})`;
        ctx.fillRect(x + 2, y + 2, brickW - 4, brickH - 4);
      }
    }
  }

  return {
    grassTex: makeTexture(grassCanvas),
    dirtTex: makeTexture(dirtCanvas),
    stoneTex: makeTexture(stoneCanvas),
    woodTex: makeTexture(woodCanvas),
    waterTex: makeTexture(waterCanvas),
    roofTex: makeTexture(roofCanvas),
    wallTex: makeTexture(wallCanvas),
  };
}

const _textures = generateTextures();

// ===== Materials =====
const mat = {
  // Ground
  grass: new THREE.MeshStandardMaterial({ map: _textures.grassTex, roughness: 0.95 }),
  grassDark: new THREE.MeshStandardMaterial({ color: 0x48a854, map: _textures.grassTex, roughness: 0.95 }),
  dirt: new THREE.MeshStandardMaterial({ map: _textures.dirtTex, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ map: _textures.stoneTex, roughness: 0.8 }),
  cobblestone: new THREE.MeshStandardMaterial({ color: 0xa89078, map: _textures.stoneTex, roughness: 0.9 }),
  water: new THREE.MeshStandardMaterial({ map: _textures.waterTex, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 }),
  // House
  wallPink: new THREE.MeshStandardMaterial({ color: 0xfce4ec, map: _textures.wallTex, roughness: 0.8 }),
  wallBlue: new THREE.MeshStandardMaterial({ color: 0xe3f2fd, map: _textures.wallTex, roughness: 0.8 }),
  wallYellow: new THREE.MeshStandardMaterial({ color: 0xfff9c4, map: _textures.wallTex, roughness: 0.8 }),
  wallGreen: new THREE.MeshStandardMaterial({ color: 0xe8f5e9, map: _textures.wallTex, roughness: 0.8 }),
  doorWood: new THREE.MeshStandardMaterial({ map: _textures.woodTex, roughness: 0.7 }),
  windowGlass: new THREE.MeshStandardMaterial({ color: 0xbbdefb, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.6 }),
  chimney: new THREE.MeshStandardMaterial({ color: 0x795548, map: _textures.stoneTex, roughness: 0.9 }),
  // Decorations
  wood: new THREE.MeshStandardMaterial({ map: _textures.woodTex, roughness: 0.85 }),
  fencePost: new THREE.MeshStandardMaterial({ color: 0xd7ccc8, map: _textures.woodTex, roughness: 0.8 }),
  trunkBrown: new THREE.MeshStandardMaterial({ map: _textures.woodTex, roughness: 0.9 }),
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
  rock: new THREE.MeshStandardMaterial({ map: _textures.stoneTex, roughness: 0.95 }),
  // Minion
  minionYellow: new THREE.MeshStandardMaterial({ color: 0xf5d033, roughness: 0.3, metalness: 0.1 }),
  minionBlue: new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5 }),
  goggle: new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.1 }),
  eye: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
  pupil: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x222244, emissiveIntensity: 0.1 }),
  roofColors: [0x5c6bc0, 0xef5350, 0x66bb6a, 0xffa726, 0xab47bc, 0x26c6da, 0xec407a, 0xff7043],
  wallColors: null, // set below
  flowerColors: null, // set below
};
mat.wallColors = [mat.wallPink, mat.wallBlue, mat.wallYellow, mat.wallGreen];
mat.flowerColors = [mat.flowerRed, mat.flowerPink, mat.flowerYellow, mat.flowerPurple, mat.flowerWhite];

// Apply seasonal theme now that mat is defined
if (!_seasonalApplied) {
  _seasonalApplied = true;
  applySeasonalTheme();
  initSnowSystem();
}

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
    // Physics
    velocityY: 0, isGrounded: true,
    // Drag state
    isDragging: false, dragTargetX: 0, dragTargetZ: 0,
    // Continent position (for sitting/sleeping)
    continentIdx: -1, continentHx: 0, continentHz: 0, continentCx: 0, continentCz: 0,
    // Sitting behavior
    isSitting: false, sitTarget: null, sitTimer: 0,
    // Sleeping behavior
    isSleeping: false,
    // Greeting behavior
    isGreeting: false, greetingTimer: 0,
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

// ===== Thinking Indicator ("..." above head) =====
function createThinkingIndicator(minion) {
  // Remove existing
  const existing = minion.children.find(c => c.userData?.isThinkingIndicator);
  if (existing) minion.remove(existing);

  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  const hs = minion.userData.heightScale || 1;
  sprite.position.y = 2.5 * hs * 0.5 + 1.8;
  sprite.scale.set(0.8, 0.4, 1);
  sprite.userData.isThinkingIndicator = true;
  sprite.userData._tex = tex;
  sprite.userData._canvas = canvas;
  minion.add(sprite);
  return sprite;
}

function updateThinkingIndicator(minion, time) {
  const ud = minion.userData;
  let sprite = minion.children.find(c => c.userData?.isThinkingIndicator);

  if (ud.state !== 'thinking') {
    if (sprite) { minion.remove(sprite); sprite.material.dispose(); sprite.userData._tex.dispose(); }
    return;
  }

  if (!sprite) sprite = createThinkingIndicator(minion);

  // Animate dots: . → .. → ... → . every 0.6s
  const dotPhase = Math.floor(time / 0.6) % 4;
  const dots = '.'.repeat(dotPhase === 0 ? 3 : dotPhase);

  const canvas = sprite.userData._canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 64);

  // Background pill
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const pillW = 50, pillH = 32, pillX = (128 - pillW) / 2, pillY = 16;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Dots
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#666';
  ctx.fillText(dots, 64, 32);

  sprite.userData._tex.needsUpdate = true;

  // Bob slightly
  sprite.position.y = 2.5 * (ud.heightScale || 1) * 0.5 + 1.8 + Math.sin(time * 3) * 0.05;
}

// ===== Latest Message Mini Bubble (above head) =====
function createMiniBubble(minion) {
  const existing = minion.children.find(c => c.userData?.isMiniBubble);
  if (existing) { minion.remove(existing); existing.material.dispose(); existing.userData._tex.dispose(); }

  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 48;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  const hs = minion.userData.heightScale || 1;
  sprite.position.y = 2.5 * hs * 0.5 + 2.3;
  sprite.scale.set(2.5, 0.375, 1);
  sprite.userData.isMiniBubble = true;
  sprite.userData._tex = tex;
  sprite.userData._canvas = canvas;
  sprite.userData._lastText = '';
  sprite.userData._showTime = 0;
  minion.add(sprite);
  return sprite;
}

function updateMiniBubble(minion, time) {
  const ud = minion.userData;
  let sprite = minion.children.find(c => c.userData?.isMiniBubble);

  // Get the latest event text
  const log = ud.eventLog || [];
  let latestText = '';
  let latestType = '';
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === 'think' || log[i].type === 'tool_use' || log[i].type === 'tool_result') {
      latestText = log[i].text || '';
      latestType = log[i].type;
      break;
    }
  }

  // Only show during thinking state and if there's content
  if (ud.state !== 'thinking' || !latestText) {
    if (sprite) {
      sprite.material.opacity = Math.max(0, sprite.material.opacity - 0.05);
      if (sprite.material.opacity <= 0) { minion.remove(sprite); sprite.material.dispose(); sprite.userData._tex.dispose(); }
    }
    return;
  }

  if (!sprite) sprite = createMiniBubble(minion);

  // Update content if changed
  if (sprite.userData._lastText !== latestText) {
    sprite.userData._lastText = latestText;
    sprite.userData._showTime = time;

    const canvas = sprite.userData._canvas;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 320, 48);

    // Background
    const colors = { think: '#7c3aed', tool_use: '#b45309', tool_result: '#059669' };
    ctx.fillStyle = colors[latestType] || '#666';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(4, 4, 312, 40, 12);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Icon + text
    const icons = { think: '💭', tool_use: '🔧', tool_result: '📋' };
    ctx.font = '12px -apple-system, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const displayText = (icons[latestType] || '') + ' ' + latestText.slice(0, 30);
    ctx.fillText(displayText, 12, 24);

    sprite.userData._tex.needsUpdate = true;
  }

  // Fade in
  sprite.material.opacity = Math.min(0.95, sprite.material.opacity + 0.08);
}

// ===== Continent (Agent Area) =====
function createContinent(agentName, index) {
  const W = 22, D = 22;
  const cols = Math.ceil(Math.sqrt(agents.length));
  const col = index % cols, row = Math.floor(index / cols);
  const ox = col * (W + 6) - (cols - 1) * (W + 6) / 2;
  const oz = row * (D + 6) - (Math.ceil(agents.length / cols) - 1) * (D + 6) / 2;
  const cx = ox + W/2, cz = oz + D/2; // center

  // ===== Ground: Enhanced terrain with height variation =====
  // Create terrain with subtle height variations
  const groundGeo = new THREE.PlaneGeometry(W, D, 32, 32);
  groundGeo.rotateX(-Math.PI / 2);
  
  // Add height variations to vertices
  const posAttr = groundGeo.getAttribute('position');
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    // Create gentle rolling hills using multiple sine waves
    const height = 
      Math.sin(x * 0.3) * Math.cos(z * 0.3) * 0.15 +
      Math.sin(x * 0.7 + 1) * Math.cos(z * 0.5) * 0.08 +
      Math.sin(x * 0.2 + z * 0.4) * 0.05;
    posAttr.setY(i, height);
  }
  groundGeo.computeVertexNormals();
  
  if (mat.grass.map) mat.grass.map.repeat.set(8, 8);
  const ground = new THREE.Mesh(groundGeo, mat.grass);
  ground.position.set(cx, -0.05, cz);
  ground.receiveShadow = true;
  scene.add(ground);
  
  // Darker grass patches for depth
  const darkPatches = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.95, D * 0.95, 16, 16),
    mat.grassDark
  );
  darkPatches.rotation.x = -Math.PI / 2;
  darkPatches.position.set(cx, -0.02, cz);
  darkPatches.receiveShadow = true;
  scene.add(darkPatches);
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

  // ===== Enhanced House (Realistic Style) =====
  const houseW = 4.5, houseD = 4.5, houseH = 3.0;
  const roofColor = mat.roofColors[index % mat.roofColors.length];
  const wallMat = mat.wallColors[index % mat.wallColors.length];
  const hx = cx - 2, hz = cz - 2;
  
  // Foundation
  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(houseW + 0.3, 0.4, houseD + 0.3),
    mat.stone
  );
  foundation.position.set(hx, 0.2, hz);
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  scene.add(foundation);

  // Main walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(houseW, houseH, houseD), wallMat);
  walls.position.set(hx, houseH/2 + 0.4, hz);
  walls.castShadow = true;
  walls.receiveShadow = true;
  scene.add(walls);
  
  // Wall trim/bottom board
  const wallTrim = new THREE.Mesh(
    new THREE.BoxGeometry(houseW + 0.1, 0.15, houseD + 0.1),
    mat.doorWood
  );
  wallTrim.position.set(hx, 0.5, hz);
  scene.add(wallTrim);
  
  // Roof - more detailed
  const roofGeo = new THREE.ConeGeometry(houseW * 0.85, 2.5, 4);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ 
    color: roofColor,
    map: _textures.roofTex,
    roughness: 0.6,
    flatShading: true 
  }));
  roof.position.set(hx, houseH + 1.65, hz);
  roof.rotation.y = Math.PI/4;
  roof.castShadow = true;
  scene.add(roof);
  
  // Roof overhang
  const overhang = new THREE.Mesh(
    new THREE.ConeGeometry(houseW * 0.92, 0.3, 4),
    new THREE.MeshStandardMaterial({ color: roofColor, map: _textures.roofTex, roughness: 0.7 })
  );
  overhang.position.set(hx, houseH + 0.5, hz);
  overhang.rotation.y = Math.PI/4;
  scene.add(overhang);
  
  // Roof ridge beam
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, houseW * 1.2),
    mat.doorWood
  );
  ridge.position.set(hx, houseH + 2.9, hz);
  ridge.rotation.y = Math.PI/4;
  scene.add(ridge);

  // Door with frame
  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 1.8, 0.12),
    mat.doorWood
  );
  doorFrame.position.set(hx, 1.3, hz + houseD/2 + 0.06);
  scene.add(doorFrame);
  
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.6, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.7 })
  );
  door.position.set(hx, 1.2, hz + houseD/2 + 0.1);
  scene.add(door);
  
  // Door handle
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.2 })
  );
  knob.position.set(hx + 0.25, 1.0, hz + houseD/2 + 0.18);
  scene.add(knob);
  
  // Door step
  const step = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.15, 0.5),
    mat.stone
  );
  step.position.set(hx, 0.1, hz + houseD/2 + 0.5);
  scene.add(step);

  // Enhanced Windows with shutters
  [-1, 1].forEach(side => {
    // Window recess
    const recess = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.05),
      mat.doorWood
    );
    recess.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD/2 + 0.02);
    scene.add(recess);
    
    // Window glass with frame
    const winFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.85, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.8 })
    );
    winFrame.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD/2 + 0.05);
    scene.add(winFrame);
    
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.08),
      mat.windowGlass
    );
    win.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD/2 + 0.08);
    scene.add(win);
    
    // Window cross
    const crossH = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.04, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    crossH.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD/2 + 0.12);
    scene.add(crossH);
    
    const crossV = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.7, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    crossV.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD/2 + 0.12);
    scene.add(crossV);
    
    // Shutters
    const shutterMat = new THREE.MeshStandardMaterial({ color: 0x5d4e37, roughness: 0.8 });
    const leftShutter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.03), shutterMat);
    leftShutter.position.set(hx + side * 1.5 - 0.55, houseH * 0.55 + 0.4, hz + houseD/2 + 0.08);
    scene.add(leftShutter);
    
    const rightShutter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.03), shutterMat);
    rightShutter.position.set(hx + side * 1.5 + 0.55, houseH * 0.55 + 0.4, hz + houseD/2 + 0.08);
    scene.add(rightShutter);
  });

  // Enhanced Chimney with detail
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 2.0, 0.6),
    mat.chimney
  );
  chimney.position.set(hx + 1.2, houseH + 2.0, hz - 0.8);
  chimney.castShadow = true;
  scene.add(chimney);
  
  // Chimney cap
  const chimneyCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.15, 0.8),
    mat.stone
  );
  chimneyCap.position.set(hx + 1.2, houseH + 3.05, hz - 0.8);
  scene.add(chimneyCap);
  
  // Chimney bricks detail
  for (let i = 0; i < 5; i++) {
    const brickLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.02, 0.62),
      new THREE.MeshStandardMaterial({ color: 0x3d2817 })
    );
    brickLine.position.set(hx + 1.2, houseH + 1.2 + i * 0.4, hz - 0.8);
    scene.add(brickLine);
  }
  
  // House corner trim
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([dx, dz]) => {
    const corner = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, houseH + 0.2, 0.12),
      mat.doorWood
    );
    corner.position.set(
      hx + dx * (houseW/2 + 0.05),
      houseH/2 + 0.3,
      hz + dz * (houseD/2 + 0.05)
    );
    scene.add(corner);
  });
  
  // Flower box under windows
  [-1, 1].forEach(side => {
    const flowerBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.15, 0.2),
      mat.doorWood
    );
    flowerBox.position.set(hx + side * 1.5, houseH * 0.25 + 0.4, hz + houseD/2 + 0.15);
    scene.add(flowerBox);
    
    // Flowers in box
    for (let f = 0; f < 4; f++) {
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        mat.flowerColors[f % mat.flowerColors.length]
      );
      flower.position.set(
        hx + side * 1.5 - 0.3 + f * 0.2,
        houseH * 0.25 + 0.55,
        hz + houseD/2 + 0.15
      );
      scene.add(flower);
    }
  });

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

  // ===== Enhanced Trees (More Realistic) =====
  const canopyColors = [
    new THREE.Color(0x2d5a27), new THREE.Color(0x3d7a37),
    new THREE.Color(0x4a8c3f), new THREE.Color(0x357a2e),
  ];
  const treePositions = [
    [ox + 2, oz + 2], [ox + W - 2, oz + 2], [ox + 2, oz + D - 2], [ox + W - 2, oz + D - 2],
    [cx + 5, cz + 3], [cx - 6, cz - 4], [cx + 3, cz - 6],
  ];
  
  treePositions.forEach(([tx, tz], ti) => {
    const treeH = 2.0 + Math.random() * 1.5;
    const trunkR = 0.12 + Math.random() * 0.08;
    
    // Main trunk with taper
    const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, treeH, 12);
    const trunk = new THREE.Mesh(trunkGeo, mat.trunkBrown);
    trunk.position.set(tx, treeH/2, tz);
    trunk.rotation.z = (Math.random() - 0.5) * 0.05;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    scene.add(trunk);
    
    // Trunk texture rings
    for (let r = 0; r < 4; r++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(trunkR * (0.9 - r * 0.1), 0.01, 8, 12),
        new THREE.MeshStandardMaterial({ color: 0x5d4e37 })
      );
      ring.position.set(tx, 0.5 + r * (treeH / 5), tz);
      ring.rotation.x = Math.PI / 2;
      scene.add(ring);
    }
    
    // Main branches (more realistic)
    const branchCount = 3 + Math.floor(Math.random() * 3);
    for (let b = 0; b < branchCount; b++) {
      const bAngle = (b / branchCount) * Math.PI * 2 + Math.random() * 0.5;
      const bH = treeH * (0.3 + Math.random() * 0.4);
      const bLen = 0.6 + Math.random() * 0.4;
      
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.05, bLen, 6),
        mat.trunkBrown
      );
      branch.position.set(
        tx + Math.cos(bAngle) * 0.2,
        bH,
        tz + Math.sin(bAngle) * 0.2
      );
      branch.rotation.z = Math.cos(bAngle) * 0.8;
      branch.rotation.x = Math.sin(bAngle) * 0.8;
      branch.castShadow = true;
      scene.add(branch);
      
      // Sub-branches
      if (Math.random() > 0.5) {
        const subBranch = new THREE.Mesh(
          new THREE.CylinderGeometry(0.01, 0.02, 0.3, 4),
          mat.trunkBrown
        );
        subBranch.position.set(
          tx + Math.cos(bAngle) * 0.4,
          bH + 0.1,
          tz + Math.sin(bAngle) * 0.4
        );
        subBranch.rotation.z = Math.cos(bAngle) * 1.0;
        subBranch.rotation.x = Math.sin(bAngle) * 1.0;
        scene.add(subBranch);
      }
    }
    
    // Canopy - more varied shapes
    const canopyR = 1.2 + Math.random() * 0.6;
    const canopyColor = canopyColors[ti % canopyColors.length];
    
    // Create custom shader material for realistic leaves
    const canopyShaderMat = new THREE.ShaderMaterial({
      vertexShader: canopyVertexShader,
      fragmentShader: canopyFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 0.06 + Math.random() * 0.03 },
        uWindDir: { value: new THREE.Vector3(1, 0.2, 0.5).normalize() },
        uColor: { value: canopyColor },
        uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
      },
    });
    
    // Main canopy clusters - more natural shape
    const canopyShapes = [
      [0, 0, 0, 1.0],
      [0.35, 0.15, 0.25, 0.8],
      [-0.3, 0.2, -0.2, 0.85],
      [0.15, -0.15, 0.35, 0.7],
      [-0.25, 0.1, 0.3, 0.75],
      [0.2, 0.25, -0.15, 0.65],
    ];
    
    canopyShapes.forEach(([dx, dy, dz, scaleMod]) => {
      // Use icosahedron for more natural leaf shape
      const canopyGeo = new THREE.IcosahedronGeometry(canopyR * scaleMod, 1);
      const canopy = new THREE.Mesh(canopyGeo, canopyShaderMat);
      canopy.position.set(
        tx + dx,
        treeH + canopyR * 0.3 + dy,
        tz + dz
      );
      canopy.rotation.set(
        Math.random() * 0.3,
        Math.random() * Math.PI * 2,
        Math.random() * 0.3
      );
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      scene.add(canopy);
    });
    
    // Add some leaf clusters hanging down
    for (let l = 0; l < 3; l++) {
      const la = Math.random() * Math.PI * 2;
      const lr = canopyR * (0.6 + Math.random() * 0.4);
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.3 + Math.random() * 0.2, 8, 6),
        canopyShaderMat
      );
      leaf.position.set(
        tx + Math.cos(la) * lr,
        treeH - 0.2 - Math.random() * 0.5,
        tz + Math.sin(la) * lr
      );
      leaf.scale.y = 0.6;
      scene.add(leaf);
    }
    
    // Tree roots
    for (let r = 0; r < 4; r++) {
      const ra = (r / 4) * Math.PI * 2 + Math.random() * 0.3;
      const root = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.04, 0.4, 5),
        mat.trunkBrown
      );
      root.position.set(
        tx + Math.cos(ra) * trunkR * 1.5,
        0.05,
        tz + Math.sin(ra) * trunkR * 1.5
      );
      root.rotation.z = Math.cos(ra) * 0.8;
      root.rotation.x = Math.sin(ra) * 0.8;
      scene.add(root);
    }
    
    addObstacle(tx - 0.5, tx + 0.5, tz - 0.5, tz + 0.5, 'tree');
  });

  // ===== Dynamic Grass =====
  createGrassForContinent(ox, oz, W, D);

  // ===== Enhanced Flowers (More Realistic) =====
  const flowerColors = [mat.flowerRed, mat.flowerPink, mat.flowerYellow, mat.flowerPurple, mat.flowerWhite];
  const flowerCount = 20 + Math.floor(Math.random() * 10);
  
  for (let i = 0; i < flowerCount; i++) {
    const fx = ox + 1 + Math.random() * (W - 2);
    const fz = oz + 1 + Math.random() * (D - 2);
    
    // Skip if too close to house or trees
    if (Math.abs(fx - hx) < 3.5 && Math.abs(fz - hz) < 3.5) continue;
    
    // Check if too close to trees
    let tooCloseToTree = false;
    for (const [tx, tz] of treePositions) {
      if (Math.abs(fx - tx) < 1.5 && Math.abs(fz - tz) < 1.5) {
        tooCloseToTree = true;
        break;
      }
    }
    if (tooCloseToTree) continue;
    
    const flowerType = Math.floor(Math.random() * 3);
    const fColor = flowerColors[Math.floor(Math.random() * flowerColors.length)];
    const stemH = 0.2 + Math.random() * 0.15;
    
    // Stem with slight curve
    const stemGeo = new THREE.CylinderGeometry(0.015, 0.02, stemH, 6);
    const stem = new THREE.Mesh(stemGeo, mat.leafGreen);
    stem.position.set(fx, stemH/2, fz);
    stem.rotation.z = (Math.random() - 0.5) * 0.2;
    scene.add(stem);
    
    // Small leaves on stem
    if (Math.random() > 0.5) {
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 6, 4),
        mat.leafGreen
      );
      leaf.position.set(fx + 0.03, stemH * 0.4, fz);
      leaf.scale.set(1, 0.5, 0.3);
      scene.add(leaf);
    }
    
    if (flowerType === 0) {
      // Round flower
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.08 + Math.random() * 0.04, 10, 8),
        fColor
      );
      head.position.set(fx, stemH + 0.05, fz);
      scene.add(head);
      
      // Center
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xffeb3b })
      );
      center.position.set(fx, stemH + 0.08, fz + 0.05);
      scene.add(center);
    } else if (flowerType === 1) {
      // Petal flower
      const petalCount = 5 + Math.floor(Math.random() * 3);
      for (let p = 0; p < petalCount; p++) {
        const pa = (p / petalCount) * Math.PI * 2;
        const petal = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 8, 6),
          fColor
        );
        petal.position.set(
          fx + Math.cos(pa) * 0.06,
          stemH + 0.04,
          fz + Math.sin(pa) * 0.06
        );
        petal.scale.set(1, 0.6, 0.8);
        scene.add(petal);
      }
      
      // Center
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xffeb3b })
      );
      center.position.set(fx, stemH + 0.06, fz);
      scene.add(center);
    } else {
      // Tulip-like
      const tulip = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.12, 8),
        fColor
      );
      tulip.position.set(fx, stemH + 0.06, fz);
      tulip.rotation.x = Math.PI;
      scene.add(tulip);
    }
  }

  // ===== Enhanced Bushes =====
  const bushCount = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < bushCount; i++) {
    const bx = ox + 1.5 + Math.random() * (W - 3);
    const bz = oz + 1.5 + Math.random() * (D - 3);
    if (Math.abs(bx - hx) < 3 && Math.abs(bz - hz) < 3) continue;
    
    // Check if too close to trees
    let tooClose = false;
    for (const [tx, tz] of treePositions) {
      if (Math.abs(bx - tx) < 1.5 && Math.abs(bz - tz) < 1.5) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    
    // Create bush cluster
    const bushGroup = new THREE.Group();
    const clusterCount = 2 + Math.floor(Math.random() * 3);
    
    for (let c = 0; c < clusterCount; c++) {
      const bushSize = 0.3 + Math.random() * 0.3;
      const bush = new THREE.Mesh(
        new THREE.IcosahedronGeometry(bushSize, 1),
        mat.bushGreen
      );
      bush.position.set(
        (Math.random() - 0.5) * 0.4,
        bushSize * 0.5,
        (Math.random() - 0.5) * 0.4
      );
      bush.rotation.set(
        Math.random() * 0.3,
        Math.random() * Math.PI * 2,
        Math.random() * 0.3
      );
      bush.castShadow = true;
      bush.receiveShadow = true;
      bushGroup.add(bush);
    }
    
    bushGroup.position.set(bx, 0.05, bz);
    scene.add(bushGroup);
    
    // Add small flowers to some bushes
    if (Math.random() > 0.5) {
      const flowerCount = 2 + Math.floor(Math.random() * 3);
      for (let f = 0; f < flowerCount; f++) {
        const flower = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 6, 4),
          flowerColors[Math.floor(Math.random() * flowerColors.length)]
        );
        flower.position.set(
          bx + (Math.random() - 0.5) * 0.5,
          0.2 + Math.random() * 0.2,
          bz + (Math.random() - 0.5) * 0.5
        );
        scene.add(flower);
      }
    }
  }

  // ===== Enhanced Pond (More Realistic Water) =====
  const pondX = cx + 4, pondZ = cz + 4;
  const pondRadius = 2.2;
  
  // Pond basin (darker ground)
  const basin = new THREE.Mesh(
    new THREE.CircleGeometry(pondRadius + 0.3, 32),
    new THREE.MeshStandardMaterial({ color: 0x3d5c4a, roughness: 1 })
  );
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(pondX, -0.02, pondZ);
  basin.receiveShadow = true;
  scene.add(basin);
  
  // Water shader with better effects
  const waterShaderMat = new THREE.ShaderMaterial({
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x4db8d4) },
      uDeepColor: { value: new THREE.Color(0x1a6b8a) },
    },
    transparent: true,
    side: THREE.DoubleSide,
  });
  
  // More detailed pond shape
  const pondGeo = new THREE.CircleGeometry(pondRadius, 32);
  const pond = new THREE.Mesh(pondGeo, waterShaderMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(pondX, 0.02, pondZ);
  scene.add(pond);
  
  // Store for animation
  if (!window._waterMeshes) window._waterMeshes = [];
  window._waterMeshes.push(pond);
  
  // Pond edge - natural bank
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
    const r = pondRadius + (Math.random() - 0.5) * 0.2;
    const stoneSize = 0.1 + Math.random() * 0.15;
    const stone = new THREE.Mesh(
      new THREE.SphereGeometry(stoneSize, 8, 6),
      mat.rock
    );
    stone.position.set(
      pondX + Math.cos(a) * r,
      stoneSize * 0.4,
      pondZ + Math.sin(a) * r
    );
    stone.scale.y = 0.5 + Math.random() * 0.3;
    stone.rotation.set(
      Math.random() * 0.5,
      Math.random() * Math.PI * 2,
      Math.random() * 0.5
    );
    stone.castShadow = true;
    scene.add(stone);
  }

  // Lily pads with flowers
  for (let i = 0; i < 4; i++) {
    const la = Math.random() * Math.PI * 2;
    const lr = 0.4 + Math.random() * 1.0;
    
    // Lily pad
    const lily = new THREE.Mesh(
      new THREE.CircleGeometry(0.25, 12),
      new THREE.MeshStandardMaterial({
        color: 0x3d8c40,
        roughness: 0.7,
        side: THREE.DoubleSide
      })
    );
    lily.rotation.x = -Math.PI / 2;
    lily.position.set(
      pondX + Math.cos(la) * lr,
      0.04,
      pondZ + Math.sin(la) * lr
    );
    scene.add(lily);
    
    // Some lilies have flowers
    if (Math.random() > 0.5) {
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        new THREE.MeshStandardMaterial({
          color: Math.random() > 0.5 ? 0xff69b4 : 0xffffff,
          roughness: 0.6
        })
      );
      flower.position.set(
        pondX + Math.cos(la) * lr,
        0.08,
        pondZ + Math.sin(la) * lr
      );
      scene.add(flower);
    }
  }
  
  // Small fish (simple shapes swimming)
  for (let f = 0; f < 3; f++) {
    const fish = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.15, 4),
      new THREE.MeshStandardMaterial({ color: 0xffa500 })
    );
    fish.rotation.x = Math.PI / 2;
    fish.position.set(
      pondX + (Math.random() - 0.5) * pondRadius,
      -0.1,
      pondZ + (Math.random() - 0.5) * pondRadius
    );
    fish.userData = {
      angle: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.5,
      radius: 0.3 + Math.random() * 0.8,
      _fish: true
    };
    scene.add(fish);
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

// ===== Feature: Known session keys for spawn detection =====
const knownSessionKeys = new Set();

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

  // Merge server state for positions (server state used only if no local state)
  const ss = serverState;
  if (ss) {
    if (ss.positions) {
      for (const [sk, pos] of Object.entries(ss.positions)) {
        if (!savedPositions[sk] && pos) {
          savedPositions[sk] = { x: pos.x, z: pos.z, targetX: pos.x, targetZ: pos.z };
        }
      }
    }
    if (ss.states) {
      for (const [sk, st] of Object.entries(ss.states)) {
        if (!savedBubbles[sk] && st) {
          savedBubbles[sk] = {
            show: true, dismissed: false, collapsed: true,
            userMsg: st.userMsg || '', userName: st.userName || '',
            state: st.state || 'done', eventLog: st.eventLog || [],
            replyText: st.replyText || '', replyCount: st.replyCount || 0,
          };
        }
      }
    }
    // Restore fixed panel session
    if (ss.fixedPanelSession && !fixedPanelSession) {
      // Defer - will be opened after minions are created
      var _deferredFixedPanel = ss.fixedPanelSession;
    }
  }

  // Clear old scene objects (keep lights, camera, atmosphere, and user avatars)
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const c = scene.children[i];
    if (c.isLight) continue;
    if (c.userData?._atmosphere) continue;
    if (c === selfAvatar) continue; // protect self avatar
    // Check if it's a user avatar
    let isUserAvatar = false;
    for (const av of Object.values(userAvatars)) { if (av.mesh === c) { isUserAvatar = true; break; } }
    if (isUserAvatar) continue;
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
        authFetch('/api/minion-profiles', {
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
      // Store continent position for sitting/sleeping
      m.userData.continentIdx = ai;
      m.userData.continentHx = continent.hx;
      m.userData.continentHz = continent.hz;
      m.userData.continentCx = continent.ox + continent.W / 2;
      m.userData.continentCz = continent.oz + continent.D / 2;

      // Label
      const parsed = parseSessionKey(sess.key);
      const labelLine = `${parsed.icon} ${sess.label || parsed.label}`;
      addNameLabel(m, labelLine, profile.name);

      scene.add(m);
      minions.push(m);
      clickables.push(m);

      // Spawn effect for new minions
      if (!knownSessionKeys.has(sess.key)) {
        knownSessionKeys.add(sess.key);
        createSpawnEffect(m.position.x, m.position.z);
      }

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
        if (!sb.dismissed && sb.state === 'thinking') showBubble(m);
      }
    });
  });

  // Drawer: sessions
  const sessEl = document.getElementById('b-sessions');
  sessEl.innerHTML = agents.flatMap((a, ai) => a.sessions.map(s => {
    const p = parseSessionKey(s.key);
    const profile = s.profile || {};
    const searchText = `${s.label || p.label} ${s.key} ${profile.name || ''}`.replace(/"/g, '&quot;');
    return `<div class="row sess-row" data-agent-index="${ai}" data-search-text="${searchText}" style="cursor:pointer"><span>${p.icon} ${esc(s.label || p.label)}</span><span style="color:#556;font-size:7px">${esc(a.name)}</span></div>`;
  })).join('');

  // Add click handlers to session rows for teleport
  sessEl.querySelectorAll('.sess-row').forEach(row => {
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      const agentIdx = parseInt(row.dataset.agentIndex);
      teleportToContinent(agentIdx);
    });
  });

  // Re-add atmosphere elements (initWorld clears scene, so restore them)
  ensureAtmosphereElements();

  // Restore deferred fixed panel from server state
  if (typeof _deferredFixedPanel === 'string' && _deferredFixedPanel) {
    const mn = minions.find(m => m.userData.sessionKey === _deferredFixedPanel);
    if (mn) { openFixedPanel(_deferredFixedPanel); }
  }

  // Hide loading screen
  const lo = document.getElementById('loading-overlay');
  if (lo) { lo.classList.add('hidden'); setTimeout(() => lo.remove(), 600); }
}

function ensureAtmosphereElements() {
  // Re-add sun sphere and glow if they were cleared
  if (!scene.children.includes(sunSphere)) scene.add(sunSphere);
  if (!scene.children.includes(sunGlow)) scene.add(sunGlow);
  // Re-add clouds
  if (petals.length === 0) initPetals();
  if (typeof initClouds === 'function' && !scene.children.find(c => c.userData?.isCloud)) initCloudsFixed();
  // Re-add rain if it was active
  // Snow is already handled by initSnowSystem guard
}

// ===== Bubbles =====
function getOrCreateBubble(sessionKey) {
  let el = bubbles[sessionKey];
  if (el && !document.body.contains(el)) { delete bubbles[sessionKey]; el = null; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'bubble3d';
    const sk = sessionKey;
    el.innerHTML = `<div class="bub-hd"><span class="bub-avatar">🟡</span><span class="bub-user"></span><button class="bub-abort" title="终止思考">🛑</button><button class="bub-pin" title="固定到底部">📌</button><button class="bub-close">✕</button></div><div class="bub-msg"></div><div class="bub-acts collapsed"><div class="bub-acts-hd"><span class="bub-acts-tri">▶</span><span class="bub-acts-lbl">思考过程</span><span class="bub-acts-cnt">0</span></div><div class="bub-acts-body"></div></div><div class="bub-chat"><input class="bub-chat-in" placeholder="直接对话..." /></div><div class="bub-foot"></div>`;
    el._hasMore = true;
    el._loadingHistory = false;

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

    // Pin to bottom button
    const pinBtn = el.querySelector('.bub-pin');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFixedPanel(sk);
    });

    // Abort button — terminate active thinking run
    const abortBtn = el.querySelector('.bub-abort');
    abortBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      abortSession(sk);
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

    // Scroll-to-load-more: load older messages when scrolling to top
    const actsBody = el.querySelector('.bub-acts-body');
    actsBody.addEventListener('scroll', () => {
      if (actsBody.scrollTop <= 5 && !el._loadingHistory && el._hasMore !== false) {
        el._loadingHistory = true;
        const oldestTs = actsBody.querySelector('.bact')?.dataset?.timestamp;
        const url = oldestTs
          ? `/api/messages/${el._sessionId}?before=${encodeURIComponent(oldestTs)}&limit=20`
          : `/api/messages/${el._sessionId}?limit=20`;
        authFetch(url)
          .then(r => r.json())
          .then(data => {
            if (!data.messages || data.messages.length === 0) { el._hasMore = false; return; }
            const m = minions.find(mn => mn.userData.sessionId === el._sessionId);
            if (!m) return;
            // Build HTML for older messages
            const scrollH = actsBody.scrollHeight;
            const tempItems = [];
            for (const msg of data.messages) {
              const ts = msg.timestamp;
              if (msg.role === 'assistant') {
                if (msg.thinking) tempItems.push(`<div class="bact bact-think" data-full-text="${escAttr(msg.thinking)}" data-timestamp="${ts}"><span>💭</span><span>${esc(msg.thinking.slice(0,150))}${ts ? ' <em style="color:#999;font-size:9px">'+fmtTime(ts)+'</em>' : ''}</span></div>`);
                if (msg.toolCalls) for (const tc of msg.toolCalls) tempItems.push(`<div class="bact bact-tool" data-full-text="${escAttr(tc.name+'\n'+tc.args)}" data-timestamp="${ts}"><span>🔧</span><span>${esc(tc.name)} <em>${esc((tc.args||'').slice(0,100))}</em>${ts ? ' <em style="color:#999;font-size:9px">'+fmtTime(ts)+'</em>' : ''}</span></div>`);
                if (msg.texts?.length) tempItems.push(`<div class="bact bact-reply" data-full-text="${escAttr(msg.texts.join(' '))}" data-timestamp="${ts}"><span>💬</span><span>${esc(msg.texts.join(' ').slice(0,150))}${ts ? ' <em style="color:#999;font-size:9px">'+fmtTime(ts)+'</em>' : ''}</span></div>`);
              } else if (msg.role === 'toolResult') tempItems.push(`<div class="bact bact-result" data-full-text="${escAttr((msg.toolName||'?')+' ✓\n'+(msg.result||''))}" data-timestamp="${ts}"><span>📋</span><span>${esc((msg.toolName||'?')+' ✓')} <em>${esc((msg.result||'').slice(0,100))}</em>${ts ? ' <em style="color:#999;font-size:9px">'+fmtTime(ts)+'</em>' : ''}</span></div>`);
            }
            if (tempItems.length > 0) {
              const prepend = document.createElement('div');
              prepend.innerHTML = tempItems.join('');
              actsBody.insertBefore(prepend, actsBody.firstChild);
              // Maintain scroll position
              actsBody.scrollTop = actsBody.scrollHeight - scrollH;
            }
            el._hasMore = data.hasMore;
          })
          .catch(() => {})
          .finally(() => { el._loadingHistory = false; });
      }
    });

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
    // Store sessionId for history loading
    const minion = minions.find(m => m.userData.sessionKey === sessionKey);
    if (minion) el._sessionId = minion.userData.sessionId;
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
  const bubMsgEl = el.querySelector('.bub-msg');
  bubMsgEl.textContent = ud.userMsg || '';
  bubMsgEl.setAttribute('data-full-text', ud.userMsg || '');
  bubMsgEl.style.cursor = ud.userMsg ? 'pointer' : '';

  // Thinking/tools - interleaved from unified eventLog
  const actsBody = el.querySelector('.bub-acts-body');

  // Smart auto-scroll: only scroll to bottom if user is already near the bottom
  const wasAtBottom = actsBody.scrollHeight - actsBody.scrollTop - actsBody.clientHeight < 30;

  const items = [];
  const log = ud.eventLog || [];
  const hasFinalReply = !!ud.replyText;

  // Collect reply snippets for divider placement
  const replySnippetIdxs = [];
  for (let i = 0; i < log.length; i++) {
    if (log[i].type === 'reply_snippet') replySnippetIdxs.push(i);
  }
  const hasSnippets = replySnippetIdxs.length > 0;
  const lastSnippetIdx = hasSnippets ? replySnippetIdxs[replySnippetIdxs.length - 1] : -1;

  for (let i = 0; i < log.length; i++) {
    const evt = log[i];
    // Place exactly one divider before the last reply_snippet
    if (hasSnippets && i === lastSnippetIdx) {
      items.push('<div class="bact-divider"><span>── 回复 ──</span></div>');
    }
    if (evt.type === 'think') {
      items.push(`<div class="bact bact-think" data-full-text="${escAttr(evt.fullText || evt.text)}" data-timestamp="${evt.timestamp||''}"><span>💭</span><span>${escFull(evt.text)}${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ''}</span></div>`);
    } else if (evt.type === 'tool_use') {
      items.push(`<div class="bact bact-tool" data-full-text="${escAttr((evt.fullText || evt.text) + '\n' + (evt.fullDetail || evt.detail || ''))}" data-timestamp="${evt.timestamp||''}"><span>🔧</span><span>${escFull(evt.text)} <em>${escFull(evt.detail || '')}</em>${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ''}</span></div>`);
    } else if (evt.type === 'tool_result') {
      items.push(`<div class="bact bact-result" data-full-text="${escAttr((evt.fullText || evt.text) + '\n' + (evt.fullDetail || evt.detail || ''))}" data-timestamp="${evt.timestamp||''}"><span>📋</span><span>${escFull(evt.text)} <em>${escFull(evt.detail || '')}</em>${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ''}</span></div>`);
    } else if (evt.type === 'reply_snippet') {
      items.push(`<div class="bact bact-reply" data-full-text="${escAttr(evt.fullText || evt.text)}" data-timestamp="${evt.timestamp||''}"><span>💬</span><span>${esc(evt.text)}${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ''}</span></div>`);
    }
  }
  // No final reply in thinking panel — it's shown in the main message area above

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

  // Abort button: only visible during thinking
  const abortBtn = el.querySelector('.bub-abort');
  if (abortBtn) abortBtn.style.display = ud.state === 'thinking' ? '' : 'none';

  // Footer
  const tc = log.filter(e => e.type === 'think').length;
  const oc = log.filter(e => e.type === 'tool_use' || e.type === 'tool_result').length;
  el.querySelector('.bub-foot').textContent =
    ud.state === 'thinking' ? `🧠 思考中 (${tc}步, ${oc}工具)...` :
    ud.state === 'streaming' ? `✍️ 流式输出中...` :
    `✅ 思考了${tc}步 · 🔧${oc}工具 · 📤${ud.replyCount}条`;

  // Sync to fixed panel if open for this session
  if (fixedPanelSession === m.userData.sessionKey) {
    updateFixedPanelContent(m);
  }
}

// Unified bubble hide: cleans up focus, state, and refresh timer
function hideBubble(sessionKey) {
  const el = bubbles[sessionKey];
  if (!el) return;
  el.classList.remove('show');
  el.style.pointerEvents = 'none'; // prevent invisible bubble from capturing mouse
  el._dismissed = true;
  // Blur input to release focus
  const inputEl = el.querySelector('.bub-chat-in');
  if (inputEl) inputEl.blur();
  interactingWithOverlay = false;
  stopBubbleRefresh(sessionKey);
}

// ===== Fixed Bottom Panel =====
let fixedPanelSession = null;
let fixedPanelEl = null;
// Drag state (global, handlers registered once)
let fpDragging = false, fpStartX = 0, fpStartY = 0, fpOrigLeft = 0, fpOrigBottom = 0;

function clampPanelToViewport() {
  if (!fixedPanelEl) return;
  const rect = fixedPanelEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = rect.left, bottom = vh - rect.bottom;
  left = Math.max(-rect.width + 60, Math.min(vw - 60, left));
  bottom = Math.max(4, Math.min(vh - 60, bottom));
  fixedPanelEl.style.left = left + 'px';
  fixedPanelEl.style.bottom = bottom + 'px';
  fixedPanelEl.style.transform = 'none';
}

// Global mouse handlers for fixed panel drag (registered ONCE)
document.addEventListener('mousemove', (e) => {
  if (!fpDragging || !fixedPanelEl) return;
  const dx = e.clientX - fpStartX;
  const dy = e.clientY - fpStartY;
  fixedPanelEl.style.left = (fpOrigLeft + dx) + 'px';
  fixedPanelEl.style.bottom = (fpOrigBottom - dy) + 'px';
  fixedPanelEl.style.transform = 'none';
  clampPanelToViewport();
});
document.addEventListener('mouseup', () => {
  if (fpDragging) {
    fpDragging = false;
    if (fixedPanelEl) fixedPanelEl.style.transition = '';
  }
});
window.addEventListener('blur', () => {
  if (fpDragging) {
    fpDragging = false;
    if (fixedPanelEl) fixedPanelEl.style.transition = '';
  }
});

function toggleFixedPanel(sessionKey) {
  if (fixedPanelSession === sessionKey) closeFixedPanel();
  else { if (fixedPanelSession) closeFixedPanel(); openFixedPanel(sessionKey); }
}

function openFixedPanel(sessionKey) {
  fixedPanelSession = sessionKey;
  const bubEl = bubbles[sessionKey];
  if (bubEl) bubEl.classList.remove('show');
  const minion = minions.find(m => m.userData.sessionKey === sessionKey);
  if (!minion) return;
  if (!fixedPanelEl) {
    fixedPanelEl = document.createElement('div');
    fixedPanelEl.id = 'fixed-panel';
    fixedPanelEl.innerHTML = `<div class="fp-hd"><span class="fp-avatar">📌</span><span class="fp-user"></span><button class="fp-abort" title="终止思考">🛑</button><button class="fp-unpin" title="取消固定回气泡">📌</button><button class="fp-close">✕</button></div><div class="fp-body"><div class="fp-msg"></div><div class="fp-acts collapsed"><div class="fp-acts-hd"><span class="fp-acts-tri">▶</span><span class="fp-acts-lbl">思考过程</span><span class="fp-acts-cnt">0</span></div><div class="fp-acts-body"></div></div><div class="fp-chat"><input class="fp-chat-in" placeholder="直接对话..." /></div><div class="fp-foot"></div></div>`;
    document.body.appendChild(fixedPanelEl);
    fixedPanelEl.querySelector('.fp-close').addEventListener('click', (e) => { e.stopPropagation(); closeFixedPanel(); });
    fixedPanelEl.querySelector('.fp-unpin').addEventListener('click', (e) => { e.stopPropagation(); const sk = fixedPanelSession; closeFixedPanel(); if (sk && bubbles[sk]) { bubbles[sk]._dismissed = false; const mn = minions.find(m => m.userData.sessionKey === sk); if (mn) showBubble(mn); } });
    fixedPanelEl.querySelector('.fp-abort').addEventListener('click', (e) => { e.stopPropagation(); if (fixedPanelSession) abortSession(fixedPanelSession); });
    fixedPanelEl.querySelector('.fp-acts-hd').addEventListener('click', (e) => { e.stopPropagation(); fixedPanelEl.querySelector('.fp-acts').classList.toggle('collapsed'); setTimeout(clampPanelToViewport, 350); });
    const chatIn = fixedPanelEl.querySelector('.fp-chat-in');
    let isComposing = false;
    chatIn.addEventListener('compositionstart', () => { isComposing = true; });
    chatIn.addEventListener('compositionend', () => { isComposing = false; });
    chatIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !isComposing) { e.preventDefault(); sendDirectChat(fixedPanelSession, chatIn); } if (e.key === 'Escape') closeFixedPanel(); });
    chatIn.addEventListener('focus', () => { interactingWithOverlay = true; });
    chatIn.addEventListener('blur', () => { interactingWithOverlay = false; });
    chatIn.addEventListener('mousedown', (e) => e.stopPropagation());
    fixedPanelEl.addEventListener('mousedown', (e) => e.stopPropagation());
    fixedPanelEl.addEventListener('mouseup', (e) => e.stopPropagation());

    // Drag to move the fixed panel (mousedown sets global state, handlers are global)
    const fpHd = fixedPanelEl.querySelector('.fp-hd');
    fpHd.style.cursor = 'move';
    fpHd.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      fpDragging = true;
      fpStartX = e.clientX;
      fpStartY = e.clientY;
      const rect = fixedPanelEl.getBoundingClientRect();
      fpOrigLeft = rect.left;
      fpOrigBottom = window.innerHeight - rect.bottom;
      fixedPanelEl.style.transition = 'none';
      e.preventDefault();
      e.stopPropagation();
    });
    // Double-click header to reset position
    fpHd.addEventListener('dblclick', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      fixedPanelEl.style.transition = 'all 0.3s ease';
      fixedPanelEl.style.left = '50%';
      fixedPanelEl.style.bottom = '12px';
      fixedPanelEl.style.transform = 'translateX(-50%)';
    });
  }
  fixedPanelEl.style.display = '';
  // Reset position to centered bottom
  fixedPanelEl.style.left = '50%';
  fixedPanelEl.style.bottom = '12px';
  fixedPanelEl.style.transform = 'translateX(-50%)';
  updateFixedPanelContent(minion);
  startBubbleRefresh(minion);
}

function closeFixedPanel() {
  if (fixedPanelEl) fixedPanelEl.style.display = 'none';
  if (fixedPanelSession) stopBubbleRefresh(fixedPanelSession);
  fixedPanelSession = null;
  interactingWithOverlay = false;
}

function updateFixedPanelContent(minion) {
  if (!fixedPanelEl || fixedPanelSession !== minion.userData.sessionKey) return;
  const ud = minion.userData;
  fixedPanelEl.querySelector('.fp-avatar').textContent = ud.state === 'thinking' ? '🧠' : ud.state === 'streaming' ? '✍️' : '✅';
  fixedPanelEl.querySelector('.fp-user').textContent = ud.userName || ud.sessionLabel || 'Session';
  const fpMsgEl = fixedPanelEl.querySelector('.fp-msg');
  fpMsgEl.textContent = ud.userMsg || '';
  fpMsgEl.setAttribute('data-full-text', ud.userMsg || '');
  fpMsgEl.style.cursor = ud.userMsg ? 'pointer' : '';
  const actsBody = fixedPanelEl.querySelector('.fp-acts-body');
  const wasAtBottom = actsBody.scrollHeight - actsBody.scrollTop - actsBody.clientHeight < 30;
  const items = []; const log = ud.eventLog || [];
  const hasFinalReply = !!ud.replyText;
  const replySnippetIdxs = [];
  for (let i = 0; i < log.length; i++) { if (log[i].type === 'reply_snippet') replySnippetIdxs.push(i); }
  const hasSnippets = replySnippetIdxs.length > 0;
  const lastSnippetIdx = hasSnippets ? replySnippetIdxs[replySnippetIdxs.length - 1] : -1;
  for (let i = 0; i < log.length; i++) {
    const evt = log[i];
    if (hasSnippets && i === lastSnippetIdx) items.push('<div class="bact-divider"><span>── 回复 ──</span></div>');
    if (evt.type === 'think') items.push(`<div class="bact bact-think" data-full-text="${escAttr(evt.fullText || evt.text)}"><span>💭</span><span>${esc(evt.text)}${evt.time ? ' <em style="color:#999;font-size:9px">'+esc(evt.time)+'</em>' : ''}</span></div>`);
    else if (evt.type === 'tool_use') items.push(`<div class="bact bact-tool" data-full-text="${escAttr((evt.fullText || evt.text) + '\n' + (evt.fullDetail || evt.detail || ''))}"><span>🔧</span><span>${esc(evt.text)} <em>${esc(evt.detail||'')}</em>${evt.time ? ' <em style="color:#999;font-size:9px">'+esc(evt.time)+'</em>' : ''}</span></div>`);
    else if (evt.type === 'tool_result') items.push(`<div class="bact bact-result" data-full-text="${escAttr((evt.fullText || evt.text) + '\n' + (evt.fullDetail || evt.detail || ''))}"><span>📋</span><span>${esc(evt.text)} <em>${esc(evt.detail||'')}</em>${evt.time ? ' <em style="color:#999;font-size:9px">'+esc(evt.time)+'</em>' : ''}</span></div>`);
    else if (evt.type === 'reply_snippet') items.push(`<div class="bact bact-reply" data-full-text="${escAttr(evt.fullText || evt.text)}"><span>💬</span><span>${esc(evt.text)}${evt.time ? ' <em style="color:#999;font-size:9px">'+esc(evt.time)+'</em>' : ''}</span></div>`);
  }
  // No final reply in thinking panel — it's shown in the main message area above
  actsBody.innerHTML = items.slice(-50).join('');
  if (wasAtBottom) actsBody.scrollTop = actsBody.scrollHeight;
  const tc = log.filter(e => e.type === 'think').length;
  const oc = log.filter(e => e.type === 'tool_use' || e.type === 'tool_result').length;
  fixedPanelEl.querySelector('.fp-acts-cnt').textContent = tc + oc;
  fixedPanelEl.querySelector('.fp-foot').textContent = ud.state === 'thinking' ? `🧠 思考中 (${tc}步, ${oc}工具)...` : ud.state === 'streaming' ? '✍️ 流式输出中...' : `✅ 思考了${tc}步 · 🔧${oc}工具 · 📤${ud.replyCount}条`;

  // Abort button: only visible during thinking
  const fpAbortBtn = fixedPanelEl.querySelector('.fp-abort');
  if (fpAbortBtn) fpAbortBtn.style.display = ud.state === 'thinking' ? '' : 'none';
}

function showBubble(m) {
  const sk = m.userData.sessionKey;
  // Don't show floating bubble if this session is in fixed panel mode
  if (fixedPanelSession === sk) {
    updateBubbleContent(m);
    return;
  }
  const el = getOrCreateBubble(sk);
  updateBubbleContent(m);
  // Only auto-show if thinking; 'done' and 'idle' stay hidden unless user clicks
  if (!el._dismissed && m.userData.state === 'thinking') {
    el.classList.add('show');
    el.style.pointerEvents = 'auto';
  }
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
  const sseUrl = '/api/events';
  eventSource = new EventSource(sseUrl);
  eventSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'init') {
        initWorld(msg.data);
      } else if (msg.type === 'event') {
        handleEvent(msg.data);
      } else if (msg.type === 'control') {
        handleControl(msg.data);
      } else if (msg.type === 'users') {
        handleUsersUpdate(msg.data);
      } else if (msg.type === 'chat') {
        handleChatMessage(msg.data.chat);
      }
    } catch {}
  };
  eventSource.onerror = () => { setTimeout(connectSSE, 3000); };
}

// ===== Bubble Auto-Refresh (polling fallback for SSE gaps) =====
const bubbleRefreshTimers = {}; // sessionKey -> intervalId
const REFRESH_INTERVAL_MS = 1500; // refresh every 1.5s when bubble is active

function startBubbleRefresh(minion) {
  const sk = minion.userData.sessionKey;
  if (bubbleRefreshTimers[sk]) return; // already running

  // Immediate first refresh - use server-side processing
  authFetch(`/api/session-state/${minion.userData.sessionId}`)
    .then(r => r.json())
    .then(data => {
      if (!data.eventLog && !data.userMsg) return;
      applySessionState(minion, data);
      updateBubbleContent(minion);
      // Also update fixed panel if open
      if (fixedPanelSession === sk) updateFixedPanelContent(minion);
    })
    .catch(() => {});

  // Then periodic refresh
  bubbleRefreshTimers[sk] = setInterval(() => {
    const el = bubbles[sk];
    if (!el || !el.classList.contains('show') || el._dismissed) {
      stopBubbleRefresh(sk);
      return;
    }
    // Fetch latest state and update bubble
    authFetch(`/api/session-state/${minion.userData.sessionId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.eventLog && !data.userMsg) return;
        applySessionState(minion, data);
        updateBubbleContent(minion);
        if (fixedPanelSession === sk) updateFixedPanelContent(minion);
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

// ===== Background State Sync =====
// Reconcile minion states every 10s — catches missed SSE events
setInterval(() => {
  for (const m of minions) {
    const ud = m.userData;
    if (ud.state !== 'thinking' || !ud.sessionId) continue;
    // Skip if bubble polling is already handling it
    if (bubbleRefreshTimers[ud.sessionKey]) continue;
    authFetch(`/api/session-state/${ud.sessionId}`)
      .then(r => r.json())
      .then(data => {
        if (!data.eventLog && !data.userMsg) return;
        const prevState = ud.state;
        applySessionState(m, data);
        // If state changed, update UI
        if (ud.state !== prevState) {
          updateBubbleContent(m);
          if (fixedPanelSession === ud.sessionKey) updateFixedPanelContent(m);
        }
      })
      .catch(() => {});
  }
}, 10000);

// Format timestamp to HH:MM:SS
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toTimeString().slice(0, 8);
}

// Build a single eventLog item with truncated display text + full text for preview
function mkEvt(type, text, detail, ts) {
  const maxText = 150;
  const maxDetail = 100;
  const item = { type };
  item.fullText = text || '';
  item.text = (text || '').slice(0, maxText);
  if (detail) {
    item.fullDetail = detail;
    item.detail = detail.slice(0, maxDetail);
  }
  if (ts) {
    item.time = fmtTime(ts);
    item.timestamp = ts; // raw timestamp for history loading
  }
  return item;
}

// Apply pre-computed session state from server (no client-side processing)
function applySessionState(minion, data) {
  const ud = minion.userData;
  
  // Update user message
  if (data.userMsg) ud.userMsg = data.userMsg;
  if (data.userName) ud.userName = data.userName;
  
  // Update event log (already computed server-side)
  if (data.eventLog && data.eventLog.length > 0) {
    ud.eventLog = data.eventLog.map(item => mkEvt(item.type, item.text, item.args || item.result || null, item.ts));
  }
  
  // Update state
  if (data.state) ud.state = data.state;
  
  // Update reply text
  if (data.replyText) ud.replyText = data.replyText;
}

// Apply parsed messages from API to minion userData (rebuild eventLog)
function applyMessagesToMinion(minion, messages) {
  const ud = minion.userData;
  const last = messages.filter(m => m.role === 'user').pop();
  if (last) ud.userMsg = last.text || '';

  // Build eventLog from recent messages — with timestamps + full text
  const histLog = [];
  const recent = messages.slice(-30);
  for (const msg of recent) {
    const ts = msg.timestamp;
    if (msg.role === 'assistant') {
      if (msg.thinking) histLog.push(mkEvt('think', msg.thinking, null, ts));
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          histLog.push(mkEvt('tool_use', tc.name, tc.args || '', ts));
        }
      }
      if (msg.texts?.length) histLog.push(mkEvt('reply_snippet', msg.texts.join(' '), null, ts));
    } else if (msg.role === 'toolResult') {
      histLog.push(mkEvt('tool_result', (msg.toolName || '?') + ' ✓', msg.result || '', ts));
    }
  }
  // Only update if we got new data
  if (histLog.length > 0) {
    ud.eventLog = histLog;
    const lastReply = recent.filter(m => m.role === 'assistant' && m.texts?.length).pop();
    if (lastReply) ud.replyText = lastReply.texts.join(' ');
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
    // Show notification box (unless this session is already in fixed panel)
    if (fixedPanelSession !== ud.sessionKey) {
      showNotifyBox(ud.sessionKey, ud.userName, ev.msg || '', ud.chineseName || ud.sessionLabel);
    }
  } else if (ev.type === 'thinking') {
    ud.state = 'thinking'; ud.lastEventTime = Date.now();
    if (!ud.eventLog) ud.eventLog = [];
    ud.eventLog.push(mkEvt('think', ev.thinking || '', null, ev.ts));
    const b = bubbles[ud.sessionKey]; if (b) b._dismissed = false;
    showBubble(m);
    startBubbleRefresh(m); // ensure polling is active
  } else if (ev.type === 'tool_use') {
    ud.state = 'thinking'; ud.lastEventTime = Date.now();
    if (!ud.eventLog) ud.eventLog = [];
    ud.eventLog.push(mkEvt('tool_use', ev.tool || '?', ev.args || '', ev.ts));
    showBubble(m);
  } else if (ev.type === 'tool_result') {
    ud.lastEventTime = Date.now();
    if (!ud.eventLog) ud.eventLog = [];
    ud.eventLog.push(mkEvt('tool_result', (ev.tool || '?') + ' ✓', ev.result || '', ev.ts));
    showBubble(m);
    startBubbleRefresh(m); // tool_result usually precedes a reply
  } else if (ev.type === 'reply_intermediate') {
    ud.replyText = ev.text || '';
    ud.state = 'thinking'; ud.lastEventTime = Date.now();
    showBubble(m);
  } else if (ev.type === 'reply_text') {
    ud.replyText = ev.text || '';
    ud.replyCount++;
    ud.state = 'done'; ud.lastEventTime = Date.now();
    showBubble(m);
    clearNotification(m);
    // Show completion notification
    if (fixedPanelSession !== ud.sessionKey) {
      showNotifyBox(ud.sessionKey, ud.userName, '✅ 完成: ' + (ev.text || '').slice(0, 50), ud.chineseName || ud.sessionLabel);
    }
    // Do one final refresh after 2s to catch any trailing data
    setTimeout(() => {
      authFetch(`/api/session-state/${m.userData.sessionId}`)
        .then(r => r.json())
        .then(data => { if (data.eventLog || data.userMsg) { applySessionState(m, data); updateBubbleContent(m); } })
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
  authFetch('/api/minions/positions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions })
  }).catch(() => {});
}

// ===== Drag Target Update & Drop =====
// Ground plane for raycasting drag positions
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// Update drag target position on mousemove (when dragging a minion)
window.addEventListener('mousemove', (e) => {
  if (!isDraggingMinion || !longPressTarget) return;
  const mouse = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  dragRaycaster.setFromCamera(mouse, camera);
  const intersection = new THREE.Vector3();
  dragRaycaster.ray.intersectPlane(groundPlane, intersection);
  if (intersection) {
    const ud = longPressTarget.userData;
    if (ud.bounds) {
      intersection.x = Math.max(ud.bounds.minX, Math.min(ud.bounds.maxX, intersection.x));
      intersection.z = Math.max(ud.bounds.minZ, Math.min(ud.bounds.maxZ, intersection.z));
    }
    ud.dragTargetX = intersection.x;
    ud.dragTargetZ = intersection.z;
  }
});

// End drag on mouseup
window.addEventListener('mouseup', () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (isDraggingMinion && longPressTarget) {
    longPressTarget.userData.isDragging = false;
    // Drop: give slight upward velocity for bounce effect
    longPressTarget.userData.velocityY = 0;
    longPressTarget.userData.isGrounded = false;
    isDraggingMinion = false;
    longPressTarget = null;
    renderer.domElement.style.cursor = '';
  }
});

// Cancel long press if mouse moves too far (but not during actual drag)
window.addEventListener('mousemove', (e) => {
  if (longPressTimer && !isDraggingMinion && !isDragging) {
    const dx = e.clientX - pressStartPos.x;
    const dy = e.clientY - pressStartPos.y;
    if (dx * dx + dy * dy > 25) { // >5px movement cancels long press
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressTarget = null;
    }
  }
});

// Hover raycasting (throttled to ~10fps)
window.addEventListener('mousemove', (e) => {
  const now = Date.now();
  if (now - lastHoverCheck < HOVER_THROTTLE) return;
  lastHoverCheck = now;
  if (isDragging || isDraggingMinion) {
    if (hoveredMinion) { clearHover(); }
    return;
  }
  const mouse = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  hoverRaycaster.setFromCamera(mouse, camera);
  const hits = hoverRaycaster.intersectObjects(clickables, true);
  let found = null;
  if (hits.length > 0) {
    let target = hits[0].object;
    while (target.parent && !target.userData.sessionKey) target = target.parent;
    if (target.userData.sessionKey) found = target;
  }
  if (found !== hoveredMinion) {
    if (hoveredMinion) clearHover();
    if (found) showHover(found, e.clientX, e.clientY);
  } else if (found) {
    updateHoverPosition(e.clientX, e.clientY);
  }
});

// ===== Click Detection =====
window.addEventListener('click', (e) => {
  // Don't process clicks that were part of a drag, or on DOM overlays
  if (isDragging || dragStarted || isDraggingMinion) return;
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
        // Load session state from server-side API
        authFetch(`/api/session-state/${target.userData.sessionId}`).then(r => r.json()).then(data => {
          if (data.eventLog || data.userMsg) {
            applySessionState(target, data);
          }
          const b2 = getOrCreateBubble(target.userData.sessionKey);
          b2._dismissed = false;
          // Force show on user click (regardless of state)
          b2.classList.add('show');
          b2.style.pointerEvents = 'auto';
          updateBubbleContent(target);
          interactingWithOverlay = false;
        }).catch(() => {
          const b2 = getOrCreateBubble(target.userData.sessionKey);
          b2._dismissed = false;
          b2.classList.add('show');
          b2.style.pointerEvents = 'auto';
          updateBubbleContent(target);
        });
      }
    }
  }
});

// ===== Feature: Minion Expressions =====
function updateMinionExpressions() {
  for (const m of minions) {
    const ud = m.userData;
    // Find pupil meshes (they use mat.pupil material)
    m.children.forEach(child => {
      if (child.material === mat.pupil) {
        switch (ud.state) {
          case 'thinking':
            // Pupils slightly larger, looking up
            child.scale.set(1.2, 1.2, 1.2);
            child.position.y += 0; // position.y already set; adjust relative via userData
            // Offset pupil upward slightly
            child.userData._baseY = child.userData._baseY || child.position.y;
            child.position.y = child.userData._baseY + 0.01;
            break;
          case 'done':
            // Normal size, slight smile effect via slightly wider pupils
            child.scale.set(1.0, 0.9, 1.0);
            child.userData._baseY = child.userData._baseY || child.position.y;
            child.position.y = child.userData._baseY;
            break;
          case 'streaming':
            child.scale.set(1.15, 1.15, 1.15);
            child.userData._baseY = child.userData._baseY || child.position.y;
            child.position.y = child.userData._baseY + 0.005;
            break;
          default: // idle
            child.scale.set(1.0, 1.0, 1.0);
            child.userData._baseY = child.userData._baseY || child.position.y;
            child.position.y = child.userData._baseY;
            break;
        }
      }
    });
  }
}

// ===== Minion Greeting System =====
function checkMinionGreetings(dt) {
  for (let i = 0; i < minions.length; i++) {
    const a = minions[i];
    if (a.userData.isSitting || a.userData.isSleeping || a.userData.isDragging || a.userData.isGreeting) continue;
    // Decrement greeting timer
    if (a.userData.greetingTimer > 0) {
      a.userData.greetingTimer -= dt;
      if (a.userData.greetingTimer <= 0) a.userData.isGreeting = false;
      continue;
    }
    for (let j = i + 1; j < minions.length; j++) {
      const b = minions[j];
      if (b.userData.isSitting || b.userData.isSleeping || b.userData.isDragging || b.userData.isGreeting) continue;
      const dx = a.position.x - b.position.x;
      const dz = a.position.z - b.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 3 && dist > 0.3 && Math.random() < 0.15 * dt) {
        // A looks at B briefly
        a.userData.isGreeting = true;
        a.userData.greetingTimer = 1 + getMinionRng(a.userData.sessionKey)();
        a.rotation.y = Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z);
        break;
      }
    }
  }
}

// ===== Hover Helper Functions =====
function showHover(minion, cx, cy) {
  hoveredMinion = minion;
  renderer.domElement.style.cursor = 'pointer';
  // Highlight: scale up slightly
  minion.scale.set(1.05, 1.05, 1.05);
  // Show tooltip
  const ud = minion.userData;
  const parsed = parseSessionKey(ud.sessionKey);
  const stateLabel = ud.state === 'thinking' ? '💭 思考中' : ud.state === 'streaming' ? '✍️ 输出中' : ud.state === 'done' ? '✅ 完成' : '💤 空闲';
  hoverTooltip.innerHTML = `<div class="tt-name">${ud.chineseName || '小黄人'}</div><div class="tt-type">${parsed.icon} ${ud.sessionLabel || parsed.label}</div><div class="tt-state">${stateLabel}</div>`;
  hoverTooltip.classList.remove('hidden');
  updateHoverPosition(cx, cy);
}

function clearHover() {
  if (hoveredMinion) {
    hoveredMinion.scale.set(1, 1, 1);
    hoveredMinion = null;
  }
  renderer.domElement.style.cursor = '';
  hoverTooltip.classList.add('hidden');
}

function updateHoverPosition(cx, cy) {
  hoverTooltip.style.left = (cx + 14) + 'px';
  hoverTooltip.style.top = (cy - 10) + 'px';
}

// ===== Animation Loop =====
function animate() {
  requestAnimationFrame(animate);
  try {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.getElapsedTime();

  // WASD movement (move walkPos, not camera directly)
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const speed = moveSpeed * dt;
  if (keys.w) walkPos.addScaledVector(forward, speed);
  if (keys.s) walkPos.addScaledVector(forward, -speed);
  if (keys.a) walkPos.addScaledVector(right, -speed);
  if (keys.d) walkPos.addScaledVector(right, speed);
  if (keys.space) walkPos.y += speed;
  if (keys.shift) walkPos.y -= speed;

  // Set camera based on mode
  if (thirdPerson && selfAvatar) {
    // Third-person: avatar on ground (y=0), camera orbits at walkPos.y height
    // walkPos.y preserves the user's chosen viewing height (set before toggle or by Space/Shift)
    selfAvatar.position.set(walkPos.x, 0, walkPos.z);
    selfAvatar.rotation.y = yaw;
    selfAvatar.visible = true;
    // Camera orbits behind and above avatar, at walkPos.y height
    const dist = 5;
    const camX = walkPos.x - Math.sin(yaw) * dist * Math.cos(pitch);
    const camY = walkPos.y + Math.sin(-pitch) * dist * 0.3; // walkPos.y is the orbit height, pitch adjusts slightly
    const camZ = walkPos.z - Math.cos(yaw) * dist * Math.cos(pitch);
    camera.position.set(camX, camY, camZ);
    // Eye tracking: pupils follow camera (both X and Y)
    const lookDirX = Math.sin(yaw);
    const lookDirY = Math.sin(pitch);
    selfAvatar.children.forEach(c => {
      if (c.userData?._isPupil) {
        const side = c.position.x > 0 ? 1 : -1;
        c.position.x = side * 0.08 + lookDirX * 0.015;
        c.position.y = 0.78 + lookDirY * 0.015;
        c.position.z = 0.2 + Math.cos(yaw) * 0.015;
      }
    });
  } else {
    // First-person: camera at walkPos
    if (selfAvatar) selfAvatar.visible = false;
    camera.position.copy(walkPos);
  }

  // Camera rotation (always use yaw/pitch for look direction)
  const lookTarget = camera.position.clone().add(new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)
  ));
  camera.lookAt(lookTarget);

  // In third-person, optionally look at avatar when pitch is very low (looking down)
  // This gives a "zoomed out overview" feel when looking straight down

  // Stale thinking detection: reset minions stuck in 'thinking' for > 3 minutes
  const STALE_THRESHOLD = 3 * 60 * 1000;
  const staleNow = Date.now();
  for (const m of minions) {
    const ud = m.userData;
    if (ud.state === 'thinking' && ud.lastEventTime && (staleNow - ud.lastEventTime > STALE_THRESHOLD)) {
      ud.state = 'done';
      if (!ud.eventLog) ud.eventLog = [];
      ud.eventLog.push(mkEvt('think', '⏳ 会话可能已中断（无新活动超过3分钟）', null, new Date().toISOString()));
      updateBubbleContent(m);
      if (fixedPanelSession === ud.sessionKey) updateFixedPanelContent(m);
    }
  }

  // Minion animations
  minions.forEach(m => {
    const ud = m.userData;

    // Smart pathfinding: walk to points of interest
    // End sitting state
    if (ud.isSitting) {
      ud.sitTimer -= dt;
      if (ud.sitTimer <= 0) {
        ud.isSitting = false;
        ud.sitTarget = null;
        ud.idleTimer = 0;
      }
    }
    // Wake up when sun is bright
    if (ud.isSleeping && sun.intensity > 0.6) {
      ud.isSleeping = false;
      ud.idleTimer = 0;
    }
    ud.idleTimer -= dt;
    if (ud.idleTimer <= 0 && !ud.isSitting && !ud.isSleeping) {
      const rng = getMinionRng(ud.sessionKey);
      // Sitting: 30% chance when picking 'stand'
      if (rng() < 0.3 && ud.continentIdx >= 0) {
        const chairTargets = [
          [ud.continentHx - 1.5 - 1.1, ud.continentHz + 1],
          [ud.continentHx - 1.5 + 1.1, ud.continentHz + 1],
          [ud.continentCx - 5, ud.continentCz + 1],
        ];
        const pick = chairTargets[Math.floor(rng() * chairTargets.length)];
        ud.targetX = pick[0]; ud.targetZ = pick[1];
        ud.idleAction = 'walk'; ud.idleTimer = 8;
        ud.sitTarget = { x: pick[0], z: pick[1] };
        return;
      }
      // Sleeping: at night (deterministic check based on gameTime)
      const isNight = gameTime > 80/120 * 120 || gameTime < 10/120 * 120; // 80-120s or 0-10s of 120s cycle
      if (isNight && rng() < 0.4 && ud.continentIdx >= 0) {
        ud.targetX = ud.continentHx + 1.5;
        ud.targetZ = ud.continentHz - 0.8;
        ud.idleAction = 'walk'; ud.idleTimer = 10;
        ud.isSleeping = true;
        return;
      }
      // Normal behavior
      const roll = rng();
      if (roll < 0.4 && ud.bounds) {
        const cx2 = (ud.bounds.minX + ud.bounds.maxX) / 2;
        const cz2 = (ud.bounds.minZ + ud.bounds.maxZ) / 2;
        // POI targets - ALL outside house (house is at cx-2, cz-2, size 4.5x4.5)
        const targets = [
          [cx2 - 3, cz2 + 2],   // table area (outside)
          [cx2 + 4, cz2 + 4],   // pond
          [cx2 - 5, cz2 + 1],   // bench
          [ud.bounds.minX + 2, ud.bounds.minZ + 2],  // corner
          [ud.bounds.maxX - 2, ud.bounds.minZ + 2],  // corner
          [cx2 + 5, cz2 - 2],   // house side (outside)
          [cx2 - 2, cz2 + 5],   // front yard
          [cx2 + 3, cz2 + 6],   // open area
        ];
        const pick = targets[Math.floor(rng() * targets.length)];
        ud.targetX = pick[0] + (rng() - 0.5) * 2;
        ud.targetZ = pick[1] + (rng() - 0.5) * 2;
        ud.idleAction = 'walk'; ud.idleTimer = 4 + rng() * 6;
      } else if (roll < 0.7 && ud.bounds) {
        ud.targetX = m.position.x + (rng() - 0.5) * 4;
        ud.targetZ = m.position.z + (rng() - 0.5) * 4;
        ud.idleAction = 'walk'; ud.idleTimer = 2 + rng() * 4;
      } else {
        ud.idleAction = 'stand'; ud.idleTimer = 3 + rng() * 5;
      }
      if (ud.bounds) {
        ud.targetX = Math.max(ud.bounds.minX + 1, Math.min(ud.bounds.maxX - 1, ud.targetX));
        ud.targetZ = Math.max(ud.bounds.minZ + 1, Math.min(ud.bounds.maxZ - 1, ud.targetZ));
      }
    }
    // Check arrival at sit target
    if (ud.sitTarget && !ud.isSitting && ud.idleAction === 'walk') {
      const sdx = ud.sitTarget.x - m.position.x;
      const sdz = ud.sitTarget.z - m.position.z;
      if (Math.sqrt(sdx * sdx + sdz * sdz) < 0.5) {
        ud.isSitting = true;
        ud.sitTimer = 5 + getMinionRng(ud.sessionKey)() * 5;
        ud.idleAction = 'stand';
      }
    }
    // Check arrival at bed (for sleeping)
    if (ud.isSleeping && ud.idleAction === 'walk') {
      const bdx = (ud.continentHx + 1.5) - m.position.x;
      const bdz = (ud.continentHz - 0.8) - m.position.z;
      if (Math.sqrt(bdx * bdx + bdz * bdz) < 0.5) {
        ud.idleAction = 'stand';
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

    // No constant bob - only animate when needed
    let yOff = 0;
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

    // Physics: gravity + ground collision (simplified, reliable)
    const GRAVITY = -20;
    if (m.position.y > 0.01 || ud.velocityY !== 0) {
      ud.velocityY += GRAVITY * dt;
      m.position.y += ud.velocityY * dt;
      ud.isGrounded = false;
      if (m.position.y <= 0) {
        m.position.y = 0;
        ud.velocityY = 0;
        ud.isGrounded = true;
      }
    } else {
      m.position.y = 0;
      ud.velocityY = 0;
      ud.isGrounded = true;
    }
    // Bob only when grounded and not being dragged
    if (ud.isGrounded && !ud.isDragging) {
      m.position.y += yOff;
    }

    // Drag: move toward drag target
    if (ud.isDragging) {
      const dx = ud.dragTargetX - m.position.x;
      const dz = ud.dragTargetZ - m.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist > 0.05) {
        m.position.x += (dx / dist) * Math.min(dist, 8 * dt);
        m.position.z += (dz / dist) * Math.min(dist, 8 * dt);
      }
      // Lift minion slightly while dragging
      m.position.y = Math.max(m.position.y, 0.3);
      ud.isGrounded = false;
    }

    // Walking animation: leg and arm swing (skip when sitting/sleeping)
    const isMoving = ud.idleAction === 'walk' && !ud.isSitting && !ud.isSleeping;
    const dxWalk = ud.targetX - m.position.x;
    const dzWalk = ud.targetZ - m.position.z;
    const distToTarget = Math.sqrt(dxWalk * dxWalk + dzWalk * dzWalk);
    if (isMoving && distToTarget > 0.2 && ud.isGrounded && !ud.isDragging && !anim) {
      const walkSpeed = Math.min(1, (ud._mcpSpeed || 0.8) * 3);
      const legSwing = Math.sin(time * 8) * 0.26 * walkSpeed; // ±15 degrees
      const armSwingAnim = Math.sin(time * 8) * 0.17 * walkSpeed; // ±10 degrees
      m.children.forEach(c => {
        if (c.geometry?.type === 'CylinderGeometry') {
          const r = c.geometry.parameters;
          if (r && r.radiusTop === 0.065 && r.radiusBottom === 0.055) {
            const side = c.position.x > 0 ? 1 : -1;
            c.rotation.x = legSwing * side;
          }
        }
        if (c.userData?.isArm && (!anim || (anim.type !== 'wave' && anim.type !== 'clap'))) {
          c.rotation.x = armSwingAnim * -c.userData.side;
        }
      });
    } else if (!anim && !ud.isSitting && !ud.isSleeping) {
      // Arm swing (default subtle when idle, animations override via switch above)
      m.children.forEach(c => {
        if (c.userData?.isArm) {
          c.rotation.x = Math.sin(time * 2 + ud.bobPhase + (c.userData.side > 0 ? 0 : Math.PI)) * 0.15;
          c.rotation.z = 0;
        }
        // Reset legs to default when idle
        if (c.geometry?.type === 'CylinderGeometry') {
          const r = c.geometry.parameters;
          if (r && r.radiusTop === 0.065 && r.radiusBottom === 0.055) {
            c.rotation.x = 0;
          }
        }
      });
    }

    // Sitting pose (skip during MCP animations)
    if (ud.isSitting && !anim) {
      m.rotation.x = -0.15; // lean back slightly
      m.children.forEach(c => {
        if (c.geometry?.type === 'CylinderGeometry') {
          const r = c.geometry.parameters;
          if (r && r.radiusTop === 0.065 && r.radiusBottom === 0.055) {
            c.rotation.x = 0.6; // legs forward
          }
        }
      });
    }
    // Sleeping pose (skip during MCP animations)
    if (ud.isSleeping && ud.idleAction !== 'walk' && !anim) {
      m.rotation.x = 0.3; // body tilted
      m.rotation.z = 0.15;
      // Close eyes (tiny pupils)
      m.children.forEach(c => {
        if (c.material === mat.pupil) c.scale.set(1, 0.15, 1);
      });
    }

    // Notification indicator bob
    if (ud.notificationSprite) {
      ud.notificationSprite.position.y = 2.5 * (ud.heightScale || 1) * 0.5 + 1.8 + Math.sin(time * 3 + ud.bobPhase) * 0.1;
    }

    // Update MCP bubble positions
    const mcpBub = mcpBubbles[ud.sessionKey];
    if (mcpBub && mcpBub._updatePos) mcpBub._updatePos();

    // Thinking indicator + mini bubble above head
    updateThinkingIndicator(m, time);
    updateMiniBubble(m, time);

    // Update bubble position
    updateBubblePosition(m, time);
  });

  // Interpolate remote user avatars (game-quality buffer interpolation)
  interpolateAvatars();

  // Report positions to server periodically
  reportPositions();

  // Report my camera position to server (for multi-user)
  if (Date.now() - lastUserPosReport > 50) { // every 50ms (20Hz)
    lastUserPosReport = Date.now();
    reportMyPosition();
  }

  // ===== Feature: Follow Mode Camera =====
  if (followMinion) {
    const targetPos = new THREE.Vector3(
      followMinion.position.x + FOLLOW_OFFSET.x,
      followMinion.position.y + FOLLOW_OFFSET.y,
      followMinion.position.z + FOLLOW_OFFSET.z
    );
    camera.position.lerp(targetPos, 0.05);
    const lookAt = new THREE.Vector3(followMinion.position.x, followMinion.position.y + 1, followMinion.position.z);
    camera.lookAt(lookAt);
    // Update yaw/pitch to match
    const dir = new THREE.Vector3().subVectors(lookAt, camera.position).normalize();
    yaw = Math.atan2(dir.x, dir.z);
    pitch = Math.asin(dir.y);

    // Show pin indicator on followed minion label (only once)
    if (!followMinion.userData._hasPin) {
      followMinion.userData._hasPin = true;
      const parsed = parseSessionKey(followMinion.userData.sessionKey);
      const labelLine = `📌 ${parsed.icon} ${followMinion.userData.sessionLabel || parsed.label}`;
      addNameLabel(followMinion, labelLine, followMinion.userData.chineseName);
    }
  } else if (minions.some(m => m.userData._hasPin)) {
    // Remove pin from any minion that had it
    for (const m of minions) {
      if (m.userData._hasPin) {
        m.userData._hasPin = false;
        const parsed = parseSessionKey(m.userData.sessionKey);
        const labelLine = `${parsed.icon} ${m.userData.sessionLabel || parsed.label}`;
        addNameLabel(m, labelLine, m.userData.chineseName);
      }
    }
  }

  // ===== Feature: Camera Transition (number keys) =====
  if (cameraTransition) {
    cameraTransition.progress += dt / cameraTransition.duration;
    if (cameraTransition.progress >= 1) {
      walkPos.copy(cameraTransition.endPos);
      cameraTransition = null;
    } else {
      const t = cameraTransition.progress;
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      walkPos.lerpVectors(cameraTransition.startPos, cameraTransition.endPos, ease);
    }
  }

  // ===== Feature: Spawn Effects =====
  updateSpawnEffects(dt);

  // ===== Feature: Snow =====
  if (season === 'winter') updateSnow(dt, time);

  // ===== Feature: FPS Counter =====
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLastTime >= 500) {
    fpsValue = Math.round(fpsFrames / ((now - fpsLastTime) / 1000));
    fpsFrames = 0;
    fpsLastTime = now;
    const fpsEl = document.getElementById('fps-badge');
    if (fpsEl) fpsEl.textContent = fpsValue + ' FPS';
  }

  // ===== Feature: Minion Expressions =====
  updateMinionExpressions();

  // Update floating petals
  updatePetals(dt, time);
  
  // Update fireflies
  updateFireflies(dt, time);

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

  // Minion greetings
  checkMinionGreetings(dt);

  // Rain system
  updateRain(dt);

  // State persistence
  updateSaveStateTimer(dt);
  maybeSaveServerState(dt);

  // Update dynamic grass wind (with LOD)
  updateGrassWithLOD(time);

  // Water texture animation
  if (mat.water.map) {
    mat.water.map.offset.x += 0.0002;
    mat.water.map.offset.y += 0.0001;
  }

  // Update water shader
  if (window._waterMeshes) {
    for (const w of window._waterMeshes) {
      if (w.material.uniforms?.uTime) w.material.uniforms.uTime.value = time;
    }
  }
  
  // Update fish swimming
  scene.traverse(obj => {
    if (obj.userData?._fish) {
      const ud = obj.userData;
      ud.angle += ud.speed * dt;
      obj.position.x = ud.baseX + Math.cos(ud.angle) * ud.radius;
      obj.position.z = ud.baseZ + Math.sin(ud.angle) * ud.radius;
      obj.rotation.y = ud.angle + Math.PI / 2;
    }
  });

  // Update canopy shader time uniforms
  scene.traverse(obj => {
    if (obj.material?.uniforms?.uTime && obj.material !== grassInstances[0]?.mat && !window._waterMeshes?.includes(obj)) {
      obj.material.uniforms.uTime.value = time;
    }
  });

  // Seasonal sky override (reapply in case day/night changed it)
  if (season === 'autumn' || season === 'winter') {
    // Blend seasonal tint with day/night cycle
    const seasonTint = season === 'autumn' ? new THREE.Color(0xd4a574) : season === 'winter' ? new THREE.Color(0xc8d8e8) : null;
    if (seasonTint) {
      scene.background.lerp(seasonTint, 0.15);
      scene.fog.color.lerp(seasonTint, 0.15);
    }
  }

  renderer.render(scene, camera);
  } catch (err) {
    console.error('Animate error:', err.message, err.stack?.split('\n')[1]);
    try { renderer.render(scene, camera); } catch(e2) { console.error('Render error:', e2.message); }
  }
}

// ===== Session Search Filter =====
function filterSessions(query) {
  const sessEl = document.getElementById('b-sessions');
  if (!sessEl) return;
  if (!query) {
    // Show all
    sessEl.querySelectorAll('.sess-row').forEach(r => r.style.display = '');
    return;
  }
  sessEl.querySelectorAll('.sess-row').forEach(r => {
    const searchText = (r.dataset.searchText || '').toLowerCase();
    r.style.display = searchText.includes(query) ? '' : 'none';
  });
}

function teleportToContinent(agentIndex) {
  if (agentIndex < 0 || agentIndex >= agents.length) return;
  const cols = Math.ceil(Math.sqrt(agents.length));
  const col = agentIndex % cols, row = Math.floor(agentIndex / cols);
  const W2 = 22, D = 22;
  const ox = col * (W2 + 6) - (cols - 1) * (W2 + 6) / 2;
  const oz = row * (D + 6) - (Math.ceil(agents.length / cols) - 1) * (D + 6) / 2;
  const cx = ox + W2 / 2, cz = oz + D / 2;
  cameraTransition = {
    startPos: camera.position.clone(),
    endPos: new THREE.Vector3(cx + 5, 20, cz + 15),
    progress: 0,
    duration: 0.8
  };
  followMinion = null;
}

// ===== CLI =====
window.runCmd = function() {
  const inp = document.getElementById('cmd-in');
  const out = document.getElementById('cmd-out');
  const cmd = inp.value.trim();
  if (!cmd) return;
  out.style.display = 'block'; out.textContent = 'Running...';
  authFetch('/api/cli', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd })
  }).then(r => r.json()).then(d => { out.textContent = d.output || d.error || 'No output'; })
    .catch(e => { out.textContent = 'Error: ' + e.message; });
};

// ===== Helper =====
// ===== Direct Chat =====
// Abort a session's active run
window.abortSession = function(sessionKey) {
  const minion = minions.find(m => m.userData.sessionKey === sessionKey);
  if (!minion) return;
  const sessionId = minion.userData.sessionId;
  const ud = minion.userData;

  // Only abort if currently thinking
  if (ud.state !== 'thinking') return;

  authFetch(`/api/sessions/${sessionId}/abort`, { method: 'POST' })
    .then(r => r.json())
    .then(result => {
      if (result.ok) {
        ud.state = 'done';
        if (!ud.eventLog) ud.eventLog = [];
        ud.eventLog.push({ type: 'think', text: '🛑 用户手动终止了思考' });
        updateBubbleContent(minion);
      }
    })
    .catch(e => console.error('Abort error:', e));
};

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
  authFetch(`/api/chat/${sessionId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  }).catch(e => console.error('Chat error:', e));
};

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function escFull(s) { return esc(s); } // for full untruncated text display
function escAttr(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

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
  drawer.classList.add('shut'); // default closed

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

  // Session search filter
  const searchInput = document.getElementById('session-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      filterSessions(searchInput.value.trim().toLowerCase());
    });
    searchInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { searchInput.blur(); }
    });
    searchInput.addEventListener('focus', () => { interactingWithOverlay = true; });
    searchInput.addEventListener('blur', () => { interactingWithOverlay = false; });
    searchInput.addEventListener('mousedown', (e) => e.stopPropagation());
  }
})();

// ===== Enhanced Clouds (More Realistic) =====
function initClouds() {
  // Multiple cloud materials for variety
  const cloudMats = [
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    new THREE.MeshBasicMaterial({ color: 0xf5f5f5, transparent: true, opacity: 0.85 }),
    new THREE.MeshBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.8 }),
  ];
  
  for (let i = 0; i < 20; i++) {
    const cloud = new THREE.Group();
    const count = 5 + Math.floor(Math.random() * 6);
    const cloudMat = cloudMats[Math.floor(Math.random() * cloudMats.length)];
    
    // Create cloud with varying puff sizes
    for (let j = 0; j < count; j++) {
      const r = 1.5 + Math.random() * 4;
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(r, 12, 8),
        cloudMat
      );
      puff.position.set(
        j * 2.2 - count * 1.1,
        Math.random() * 1.5,
        Math.random() * 2 - 1
      );
      puff.scale.y = 0.3 + Math.random() * 0.2;
      cloud.add(puff);
    }
    
    // Add some smaller detail puffs
    for (let d = 0; d < 3; d++) {
      const detail = new THREE.Mesh(
        new THREE.SphereGeometry(0.8 + Math.random() * 1, 8, 6),
        cloudMat
      );
      detail.position.set(
        (Math.random() - 0.5) * count * 2,
        Math.random() * 0.5,
        (Math.random() - 0.5) * 2
      );
      detail.scale.y = 0.25;
      cloud.add(detail);
    }
    
    cloud.position.set(
      (Math.random() - 0.5) * 150,
      22 + Math.random() * 15,
      (Math.random() - 0.5) * 150
    );
    cloud.userData = {
      speed: 0.15 + Math.random() * 0.25,
      dir: Math.random() > 0.5 ? 1 : -1,
      _atmosphere: true,
      isCloud: true
    };
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
      _atmosphere: true,
    };
    scene.add(petal);
    petals.push(petal);
  }
}
initPetals();
initFireflies();
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

// ===== Fireflies (Night Atmosphere) =====
const fireflies = [];
const FIREFLY_COUNT = 40;

function initFireflies() {
  const fireflyGeo = new THREE.SphereGeometry(0.06, 8, 6);
  
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const fireflyMat = new THREE.MeshBasicMaterial({
      color: 0xffff88,
      transparent: true,
      opacity: 0.8,
    });
    
    const firefly = new THREE.Mesh(fireflyGeo, fireflyMat);
    firefly.position.set(
      (Math.random() - 0.5) * 80,
      0.5 + Math.random() * 3,
      (Math.random() - 0.5) * 80
    );
    
    firefly.userData = {
      baseX: firefly.position.x,
      baseY: firefly.position.y,
      baseZ: firefly.position.z,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.0,
      radius: 1 + Math.random() * 2,
      blinkPhase: Math.random() * Math.PI * 2,
      blinkSpeed: 2 + Math.random() * 3,
      _atmosphere: true,
    };
    
    scene.add(firefly);
    fireflies.push(firefly);
  }
}

function updateFireflies(dt, time) {
  // Only show fireflies at night
  const dayProgress = (gameTime % DAY_CYCLE) / DAY_CYCLE;
  const isNight = dayProgress > 0.7 || dayProgress < 0.2;
  
  for (const ff of fireflies) {
    const ud = ff.userData;
    
    // Floating motion
    ff.position.x = ud.baseX + Math.sin(time * ud.speed + ud.phase) * ud.radius;
    ff.position.y = ud.baseY + Math.sin(time * ud.speed * 0.7 + ud.phase) * 0.5;
    ff.position.z = ud.baseZ + Math.cos(time * ud.speed * 0.5 + ud.phase) * ud.radius;
    
    // Blinking effect
    const blink = Math.sin(time * ud.blinkSpeed + ud.blinkPhase);
    ff.material.opacity = isNight ? (0.3 + blink * 0.5) : 0;
    
    // Glow size variation
    const scale = 0.8 + blink * 0.4;
    ff.scale.setScalar(scale);
  }
}

// ===== Day/Night Cycle =====
function updateDayNightCycle(dt) {
  gameTime = (gameTime + dt) % DAY_CYCLE;
  const t = gameTime / DAY_CYCLE; // 0-1

  // Smooth interpolation between phases (no hard jumps)
  let skyColor, fogColor, sunIntensity, sunAngle;

  // Define key points: [time, sky, sunIntensity, sunAngle]
  const phases = [
    { t: 0.00, sky: new THREE.Color(0x6a8caf), sun: 0.35, angle: 0.0 },         // pre-dawn
    { t: 0.12, sky: new THREE.Color(0xffa07a), sun: 0.5,  angle: 0.2 },          // dawn
    { t: 0.20, sky: new THREE.Color(0x87ceeb), sun: 0.9,  angle: 0.35 },         // morning
    { t: 0.40, sky: new THREE.Color(0x7ec8e3), sun: 1.0,  angle: 0.5 },          // noon
    { t: 0.55, sky: new THREE.Color(0x87ceeb), sun: 0.85, angle: 0.65 },         // afternoon
    { t: 0.65, sky: new THREE.Color(0xe8835a), sun: 0.55, angle: 0.75 },         // dusk
    { t: 0.75, sky: new THREE.Color(0x6a5acd), sun: 0.35, angle: 0.85 },         // evening
    { t: 0.85, sky: new THREE.Color(0x3a5070), sun: 0.4,  angle: 0.95 },         // night (brighter)
    { t: 0.95, sky: new THREE.Color(0x4a6080), sun: 0.45, angle: 0.98 },         // late night
    { t: 1.00, sky: new THREE.Color(0x6a8caf), sun: 0.35, angle: 1.0 },          // back to pre-dawn
  ];

  // Find the two phases to interpolate between
  let lo = phases[0], hi = phases[phases.length - 1];
  for (let i = 0; i < phases.length - 1; i++) {
    if (t >= phases[i].t && t < phases[i + 1].t) {
      lo = phases[i]; hi = phases[i + 1]; break;
    }
  }
  const range = hi.t - lo.t || 1;
  const p = (t - lo.t) / range;
  // Smooth step for nicer transitions
  const smooth = p * p * (3 - 2 * p);

  skyColor = lo.sky.clone().lerp(hi.sky, smooth);
  sunIntensity = lo.sun + (hi.sun - lo.sun) * smooth;
  sunAngle = lo.angle + (hi.angle - lo.angle) * smooth;
  fogColor = skyColor.clone();

  scene.background = skyColor;
  scene.fog.color = fogColor;
  sun.intensity = sunIntensity;
  sun.color.set(0xffeedd).lerp(skyColor, 0.3);
  sun.position.set(
    Math.cos(sunAngle * Math.PI * 2) * 40,
    20 + Math.sin(sunAngle * Math.PI * 2) * 30,
    Math.sin(sunAngle * Math.PI * 2) * 30
  );
  // Update visible sun sphere position + opacity
  sunSphere.position.copy(sun.position);
  sunGlow.position.copy(sun.position);
  const sunVis = Math.max(0, sunIntensity);
  sunSphere.material.opacity = sunVis;
  sunSphere.material.transparent = true;
  sunGlow.material.opacity = sunVis * 0.25;
  // Sun color: warm at dawn/dusk, bright at noon
  const sunColor = new THREE.Color(0xffee88).lerp(new THREE.Color(0xfff8e0), sunIntensity);
  sunSphere.material.color.copy(sunColor);
  sunGlow.material.color.copy(sunColor);

  // Lamp posts: on at night, off during day
  const isNight = sunIntensity < 0.4;
  scene.traverse(obj => {
    if (obj.isPointLight && obj.color.getHex() === 0xffee58) {
      obj.intensity = isNight ? 0.6 + (1 - sunIntensity / 0.4) * 0.4 : 0;
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
  // Update floating emojis (always, even if no new interactions)
  for (let i = floatingEmojis.length - 1; i >= 0; i--) {
    const fe = floatingEmojis[i];
    fe.life -= dt;
    fe.sprite.position.y += dt * 0.5;
    fe.sprite.material.opacity = Math.max(0, fe.life / fe.maxLife);
    if (fe.life <= 0) {
      scene.remove(fe.sprite);
      fe.sprite.material.dispose();
      floatingEmojis.splice(i, 1);
    }
  }

  // Check minion interactions (reduced frequency - only 1% chance per second)
  for (let i = 0; i < minions.length; i++) {
    for (let j = i + 1; j < minions.length; j++) {
      const a = minions[i], b = minions[j];
      const dx = a.position.x - b.position.x;
      const dz = a.position.z - b.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Must be close (1.5 units), both grounded, and not sitting/sleeping/greeting
      if (dist < 1.5 && dist > 0.3 && a.userData.isGrounded && b.userData.isGrounded
        && !a.userData.isSitting && !b.userData.isSitting
        && !a.userData.isSleeping && !b.userData.isSleeping
        && !a.userData.isGreeting && !b.userData.isGreeting) {
        // Only 1% chance per second (much less frequent)
        if (Math.random() < 0.01 * dt) {
          const target = Math.random() > 0.5 ? a : b;
          // Don't trigger if already animating
          const sk = target.userData.sessionKey;
          if (!activeAnimations[sk]) {
            triggerAnimation(target, 'wave', 1.2);
            const emoji = minionEmojis[Math.floor(Math.random() * minionEmojis.length)];
            const midX = (a.position.x + b.position.x) / 2;
            const midZ = (a.position.z + b.position.z) / 2;
            showFloatingEmoji(emoji, midX, Math.max(a.position.y, b.position.y) + 1.2, midZ);
          }
        }
      }
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
    drop.userData._atmosphere = true;
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
      x: walkPos.x,
      y: walkPos.y,
      z: walkPos.z,
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
      walkPos.set(state.camera.x || 25, state.camera.y || 30, state.camera.z || 35);
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

// Restore state on load (called after walkPos is initialized)
// restoreSceneState();

// ===== Notification Box System =====
const MAX_NOTIFY_BOXES = 5;
const notifyBoxes = []; // { el, sessionKey, timer }

function showNotifyBox(sessionKey, userName, message, minionName) {
  // Remove oldest if at max
  while (notifyBoxes.length >= MAX_NOTIFY_BOXES) {
    const old = notifyBoxes.shift();
    removeNotifyBox(old);
  }

  // Don't duplicate for same session
  const existing = notifyBoxes.find(n => n.sessionKey === sessionKey);
  if (existing) {
    // Update existing
    const msgEl = existing.el.querySelector('.nb-msg');
    if (msgEl) msgEl.textContent = message.slice(0, 60);
    resetNotifyTimer(existing);
    return;
  }

  const el = document.createElement('div');
  el.className = 'notify-box';
  el.innerHTML = `
    <div class="nb-hd">
      <span class="nb-icon">🟡</span>
      <span class="nb-name">${esc(minionName || '小黄人')}</span>
      <span class="nb-user">${esc(userName || '')}</span>
      <button class="nb-close">✕</button>
    </div>
    <div class="nb-msg">${esc(message.slice(0, 60))}</div>
    <div class="nb-bar"><div class="nb-bar-fill"></div></div>
  `;

  // Click to open fixed panel
  el.addEventListener('click', (e) => {
    if (e.target.classList.contains('nb-close')) return;
    e.stopPropagation();
    // Open fixed panel for this session
    if (fixedPanelSession) closeFixedPanel();
    openFixedPanel(sessionKey);
    // Remove this notify box
    const idx = notifyBoxes.findIndex(n => n.sessionKey === sessionKey);
    if (idx >= 0) {
      removeNotifyBox(notifyBoxes[idx]);
      notifyBoxes.splice(idx, 1);
    }
  });

  // Close button
  el.querySelector('.nb-close').addEventListener('click', (e) => {
    e.stopPropagation();
    const idx = notifyBoxes.findIndex(n => n.el === el);
    if (idx >= 0) {
      removeNotifyBox(notifyBoxes[idx]);
      notifyBoxes.splice(idx, 1);
    }
  });

  el.addEventListener('mousedown', (e) => e.stopPropagation());

  document.body.appendChild(el);

  // Animate in
  requestAnimationFrame(() => el.classList.add('show'));

  const box = { el, sessionKey, timer: null };
  resetNotifyTimer(box);
  notifyBoxes.push(box);

  updateNotifyBoxPositions();
}

function resetNotifyTimer(box) {
  if (box.timer) clearTimeout(box.timer);
  const fill = box.el.querySelector('.nb-bar-fill');
  if (fill) {
    fill.style.transition = 'none';
    fill.style.width = '100%';
    requestAnimationFrame(() => {
      fill.style.transition = 'width 15s linear';
      fill.style.width = '0%';
    });
  }
  box.timer = setTimeout(() => {
    const idx = notifyBoxes.indexOf(box);
    if (idx >= 0) {
      removeNotifyBox(box);
      notifyBoxes.splice(idx, 1);
    }
  }, 15000); // auto-dismiss after 15s
}

function removeNotifyBox(box) {
  if (box.timer) clearTimeout(box.timer);
  box.el.classList.remove('show');
  setTimeout(() => box.el.remove(), 300);
}

function updateNotifyBoxPositions() {
  const topStart = 60; // below HUD
  notifyBoxes.forEach((box, i) => {
    box.el.style.top = (topStart + i * 72) + 'px';
  });
}

// Hook into handleEvent to show notify boxes
const _origHandleEvent = handleEvent;
// Actually, let's patch the user_msg handler directly by watching for state changes

// ===== Detail Popup (click .bact to expand) =====
const detailPopup = document.createElement('div');
detailPopup.id = 'detail-popup';
detailPopup.innerHTML = '<div class="dp-card"><button class="dp-close">✕</button><div class="dp-body"></div></div>';
document.body.appendChild(detailPopup);

detailPopup.querySelector('.dp-close').addEventListener('click', (e) => { e.stopPropagation(); hideDetailPopup(); });
detailPopup.addEventListener('mousedown', (e) => { if (e.target === detailPopup) { e.stopPropagation(); hideDetailPopup(); } });
detailPopup.addEventListener('click', (e) => { if (e.target === detailPopup) hideDetailPopup(); });

// Click handler for .bact, .bub-msg, .fp-msg to show detail popup
// Click handler for detail popup (catches .bact AND .bub-msg/.fp-msg)
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-full-text]');
  if (!el) return;
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
  const fullText = el.getAttribute('data-full-text');
  if (fullText && fullText.length > 0) {
    e.stopPropagation();
    showDetailPopup(el);
  }
});

function renderMarkdown(text) {
  if (!text) return '';
  let html = esc(text);
  // Code blocks ```...```
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // Headers
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<strong class="md-h">$1</strong>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Bullet lists
  html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

function isMarkdown(text) {
  return /[#*`\-\[\]]/.test(text || '');
}

function showDetailPopup(bactEl) {
  const fullText = bactEl.getAttribute('data-full-text');
  if (!fullText) return;
  const body = detailPopup.querySelector('.dp-body');
  body.innerHTML = isMarkdown(fullText) ? renderMarkdown(fullText) : esc(fullText).replace(/\n/g, '<br>');
  // Position: center on screen
  detailPopup.style.display = 'flex';
  detailPopup.classList.add('show');
  interactingWithOverlay = true;
}

function hideDetailPopup() {
  detailPopup.classList.remove('show');
  detailPopup.style.display = 'none';
  interactingWithOverlay = false;
}

// ===== Multi-User Avatars =====
let myUserId = localStorage.getItem('monitor-userId') || ('user-' + Math.random().toString(36).slice(2, 8));
let myUserName = localStorage.getItem('monitor-userName') || '访客' + myUserId.slice(-3);
localStorage.setItem('monitor-userId', myUserId);

// Bind to auth user after login
function bindAuthUser(user) {
  if (!user) return;
  myUserId = user.id;
  myUserName = user.username;
}

// ===== Third-Person Camera =====
let thirdPerson = false;
let selfAvatar = null;
const walkPos = new THREE.Vector3(25, 30, 35); // avatar/walking position (separate from camera in 3rd person)

// Build a cute robot avatar (shared by self and remote users)
function buildRobotAvatar(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eyePupil = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x333333 });

  // Body (cylinder)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.6, 12), mat);
  body.position.y = 0.3; body.castShadow = true;
  group.add(body);

  // Head (sphere)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat);
  head.position.y = 0.75; head.castShadow = true;
  group.add(head);

  // Eyes (white spheres with black pupils) — pupils are separate for tracking
  [-1, 1].forEach(side => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), eyeWhite);
    eye.position.set(side * 0.08, 0.78, 0.16);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyePupil);
    pupil.position.set(side * 0.08, 0.78, 0.2);
    pupil.userData._isPupil = true;
    group.add(pupil);
  });

  // Antenna
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.15, 6), darkMat);
  antenna.position.y = 0.95;
  group.add(antenna);
  const antennaBall = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color }));
  antennaBall.position.y = 1.05;
  group.add(antennaBall);

  // Arms
  [-1, 1].forEach(side => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.35, 6), mat);
    arm.position.set(side * 0.28, 0.35, 0);
    arm.userData._isArm = true;
    arm.userData.side = side;
    group.add(arm);
  });

  // Legs
  [-1, 1].forEach(side => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.2, 6), darkMat);
    leg.position.set(side * 0.1, 0.1, 0);
    group.add(leg);
  });

  return group;
}

function createUserAvatar(userId, color) {
  const group = buildRobotAvatar(color || '#53d8fb');

  // Name label
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 32;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  label.position.y = 1.3;
  label.scale.set(1.5, 0.375, 1);
  label.userData._canvas = canvas;
  label.userData._tex = tex;
  group.add(label);
  group.userData._label = label;
  scene.add(group);
  return group;
}

function createSelfAvatar() {
  if (selfAvatar) return;
  const group = buildRobotAvatar(0xffd700); // golden for self

  // Glow ring under avatar
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  group.visible = false;
  scene.add(group);
  selfAvatar = group;
}

createSelfAvatar();

const userAvatars = {}; // userId -> { mesh, posBuffer: [{x,y,z,time}], velocity, lastUpdate }
let lastUserPosReport = 0;

// Time sync: calibrate client-server clock offset
let serverTimeOffset = 0;
async function calibrateTime() {
  try {
    const t1 = Date.now();
    const resp = await fetch('/api/time');
    const data = await resp.json();
    const t2 = Date.now();
    const rtt = t2 - t1;
    serverTimeOffset = data.serverTime - (t1 + rtt / 2);
  } catch {}
}
calibrateTime();
setInterval(calibrateTime, 30000); // recalibrate every 30s

function serverNow() { return Date.now() + serverTimeOffset; }

// Interpolation delay: render 50ms in the past for smooth interpolation (reduced from 100ms)
const INTERP_DELAY = 50;

// Create avatar mesh for a remote user

function updateAvatarLabel(avatar, name) {
  const label = avatar.userData._label;
  if (!label) return;
  const canvas = label.userData._canvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 32);
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.strokeText(name, 64, 22);
  ctx.fillText(name, 64, 22);
  label.userData._tex.needsUpdate = true;
}

// Handle user position updates from SSE
function handleUsersUpdate(usersData) {
  const now = serverNow();
  for (const [userId, data] of Object.entries(usersData)) {
    if (userId === myUserId) continue;
    if (!userAvatars[userId]) {
      userAvatars[userId] = { mesh: createUserAvatar(userId, data.color), posBuffer: [], lastUpdate: now };
    }
    const avatar = userAvatars[userId];
    avatar.lastUpdate = now;
    // Push new position to buffer (max 10)
    avatar.posBuffer.push({ x: data.x || 0, y: data.y || 0, z: data.z || 0, yaw: data.yaw || 0, time: now });
    if (avatar.posBuffer.length > 10) avatar.posBuffer.shift();
    updateAvatarLabel(avatar.mesh, data.name || userId);
  }
  // Remove stale avatars
  for (const [userId, avatar] of Object.entries(userAvatars)) {
    if (now - avatar.lastUpdate > 8000) {
      scene.remove(avatar.mesh);
      delete userAvatars[userId];
    }
  }
}

// Game-quality position interpolation (called every frame)
function interpolateAvatars() {
  const renderTime = serverNow() - INTERP_DELAY;
  for (const [uid, av] of Object.entries(userAvatars)) {
    const buf = av.posBuffer;
    if (buf.length === 0) continue;
    if (buf.length === 1) {
      av.mesh.position.set(buf[0].x, buf[0].y, buf[0].z);
      av.mesh.rotation.y = buf[0].yaw;
      continue;
    }
    // Find bracketing samples
    let before = buf[0], after = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].time <= renderTime && buf[i + 1].time >= renderTime) {
        before = buf[i]; after = buf[i + 1]; break;
      }
    }
    if (renderTime > after.time) before = after;
    if (renderTime < before.time) after = before;
    const range = after.time - before.time;
    const t = range > 0 ? Math.max(0, Math.min(1, (renderTime - before.time) / range)) : 0;
    av.mesh.position.set(
      before.x + (after.x - before.x) * t,
      before.y + (after.y - before.y) * t,
      before.z + (after.z - before.z) * t
    );
    av.mesh.rotation.y = before.yaw + (after.yaw - before.yaw) * t;
  }
}


// ===== WebSocket Connection for Position Sync =====
let ws = null;
let wsConnected = false;

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);
  
  ws.onopen = () => {
    wsConnected = true;
    console.log('WebSocket connected');
  };
  
  ws.onclose = () => {
    wsConnected = false;
    console.log('WebSocket disconnected, reconnecting...');
    setTimeout(connectWS, 2000);
  };
  
  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    wsConnected = false;
  };
}

// Report my camera position to server via WebSocket (fallback to HTTP)
function reportMyPosition() {
  if (wsConnected && ws && ws.readyState === 1) {
    // Use WebSocket - much more efficient
    ws.send(JSON.stringify({
      type: 'position',
      userId: myUserId,
      x: walkPos.x, y: walkPos.y, z: walkPos.z,
      yaw, pitch,
      name: myUserName,
    }));
  } else {
    // Fallback to HTTP
    authFetch('/api/users/position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: myUserId,
        x: walkPos.x, y: walkPos.y, z: walkPos.z,
        yaw, pitch,
        name: myUserName,
      })
    }).catch(() => {});
  }
}

// ===== Start =====
// Loading screen timeout fallback (3s)
setTimeout(() => {
  const lo = document.getElementById('loading-overlay');
  if (lo) { lo.classList.add('hidden'); setTimeout(() => lo.remove(), 600); }
}, 3000);

// Check auth, then fetch state and connect
checkAuth().then(authOk => {
  if (!authOk) return; // login overlay shown
  bindAuthUser(window._currentUser); // bind user identity for chat/position
  restoreSceneState(); // restore camera position from localStorage
  authFetch('/api/state').then(r => {
    if (r.status === 401) { location.href = '/login.html'; return null; }
    return r.json();
  }).then(s => { if (s) serverState = s; }).catch(() => {}).finally(() => {
    connectSSE();
    connectWS(); // Connect WebSocket for efficient position sync
  });
});

// Periodic server state save (every 5s)
let lastServerSave = 0;
function maybeSaveServerState(dt) {
  lastServerSave += dt;
  if (lastServerSave < 5) return;
  lastServerSave = 0;
  const positions = {};
  const states = {};
  for (const m of minions) {
    const sk = m.userData.sessionKey;
    if (!sk) continue;
    positions[sk] = { x: m.position.x, y: m.position.y, z: m.position.z };
    states[sk] = {
      state: m.userData.state || 'idle',
      eventLog: (m.userData.eventLog || []).slice(-20),
      userMsg: m.userData.userMsg || '',
      userName: m.userData.userName || '',
      replyText: m.userData.replyText || '',
      replyCount: m.userData.replyCount || 0,
    };
  }
  const openBubbles = [];
  for (const sk in bubbles) {
    const el = bubbles[sk];
    if (el && el.classList.contains('show') && !el._dismissed) openBubbles.push(sk);
  }
  authFetch('/api/state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions, states, openBubbles, fixedPanelSession }),
  }).catch(() => {});
}

// Save state on page unload
window.addEventListener('beforeunload', () => {
  const positions = {};
  const states = {};
  for (const m of minions) {
    const sk = m.userData.sessionKey;
    if (!sk) continue;
    positions[sk] = { x: m.position.x, y: m.position.y, z: m.position.z };
    states[sk] = {
      state: m.userData.state || 'idle',
      eventLog: (m.userData.eventLog || []).slice(-20),
      userMsg: m.userData.userMsg || '',
      userName: m.userData.userName || '',
      replyText: m.userData.replyText || '',
      replyCount: m.userData.replyCount || 0,
    };
  }
  const openBubbles = [];
  for (const sk in bubbles) {
    const el = bubbles[sk];
    if (el && el.classList.contains('show') && !el._dismissed) openBubbles.push(sk);
  }
  const data = JSON.stringify({ positions, states, openBubbles, fixedPanelSession });
  const beaconUrl = '/api/state';
  navigator.sendBeacon(beaconUrl, new Blob([data], { type: 'application/json' }));
});

animate();
