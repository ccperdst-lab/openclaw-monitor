// app.js
import * as THREE from "three";
var container = document.getElementById("scene3d");
function authFetch(url, options = {}) {
  return fetch(url, options);
}
async function checkAuth() {
  try {
    const res = await fetch("/api/auth/status");
    const d = await res.json();
    if (!d.authenticated) {
      location.href = "/login.html";
      return false;
    }
    window._currentUser = d.user;
    return true;
  } catch {
    return true;
  }
}
var loginTokenEl = document.getElementById("login-token");
if (loginTokenEl) {
  loginTokenEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("login-btn")?.click();
  });
}
var chatPanelOpen = false;
var chatMessagesData = [];
document.getElementById("chat-close")?.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleChatPanel();
});
document.getElementById("chat-panel")?.addEventListener("mousedown", (e) => e.stopPropagation());
function toggleChatPanel() {
  chatPanelOpen = !chatPanelOpen;
  const panel = document.getElementById("chat-panel");
  if (chatPanelOpen) {
    panel.classList.add("show");
    authFetch("/api/chat/messages").then((r) => r.json()).then((data) => {
      if (data.messages) {
        chatMessagesData = data.messages;
        renderChatMessages();
      }
    }).catch(() => {
    });
  } else {
    panel.classList.remove("show");
  }
}
function handleChatMessage(msg) {
  chatMessagesData.push(msg);
  if (chatMessagesData.length > 100) chatMessagesData.shift();
  if (chatPanelOpen) renderChatMessages();
}
function renderChatMessages() {
  const container2 = document.getElementById("chat-msgs");
  const wasAtBottom = container2.scrollHeight - container2.scrollTop - container2.clientHeight < 40;
  container2.innerHTML = chatMessagesData.map((msg) => {
    if (msg.system || msg.userId === "system") {
      return `<div class="cp-msg system">${esc(msg.text)}</div>`;
    }
    const nameColor = msg.userId === myUserId ? "#53d8fb" : getNameColor(msg.userId) || "#a78bfa";
    return `<div class="cp-msg"><span class="cp-name" style="color:${nameColor}">${esc(msg.name)}</span><span class="cp-text">${esc(msg.text)}</span></div>`;
  }).join("");
  if (wasAtBottom) container2.scrollTop = container2.scrollHeight;
}
function getNameColor(userId) {
  const colors = ["#53d8fb", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#f87171", "#38bdf8", "#fb923c"];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash << 5) - hash + userId.charCodeAt(i) | 0;
  return colors[Math.abs(hash) % colors.length];
}
function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  authFetch("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: myUserId, name: myUserName, text })
  }).catch(() => {
  });
}
document.getElementById("chat-send").addEventListener("click", (e) => {
  e.stopPropagation();
  sendChatMessage();
});
var chatInput = document.getElementById("chat-input");
chatInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") {
    e.preventDefault();
    sendChatMessage();
  }
});
chatInput.addEventListener("focus", () => {
  interactingWithOverlay = true;
});
chatInput.addEventListener("blur", () => {
  interactingWithOverlay = false;
});
chatInput.addEventListener("mousedown", (e) => e.stopPropagation());
var scene = new THREE.Scene();
scene.background = new THREE.Color(8900331);
scene.fog = new THREE.FogExp2(8900331, 6e-3);
var camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(25, 30, 35);
var renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);
var yaw = 0;
var pitch = -0.5;
var moveSpeed = 12;
var keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
var isDragging = false;
var dragStarted = false;
var lastMX = 0;
var lastMY = 0;
var dragRaycaster = new THREE.Raycaster();
var longPressTimer = null;
var longPressTarget = null;
var pressStartTime = 0;
var pressStartPos = { x: 0, y: 0 };
var isDraggingMinion = false;
var interactingWithOverlay = false;
function seededRandom(seed) {
  let s = seed;
  return function() {
    s = s * 1103515245 + 12345 & 2147483647;
    return s / 2147483647;
  };
}
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return Math.abs(h);
}
function getMinionRng(sessionKey) {
  const quantum = Math.floor(Date.now() / 5e3);
  return seededRandom(hashStr(sessionKey) + quantum);
}
var serverState = null;
var hoverRaycaster = new THREE.Raycaster();
var hoveredMinion = null;
var lastHoverCheck = 0;
var HOVER_THROTTLE = 100;
var hoverTooltip = document.createElement("div");
hoverTooltip.id = "hover-tooltip";
hoverTooltip.className = "hidden";
document.body.appendChild(hoverTooltip);
var followMinion = null;
var FOLLOW_OFFSET = new THREE.Vector3(0, 4, 5);
var screenshotMode = false;
var fpsFrames = 0;
var fpsLastTime = performance.now();
var fpsValue = 0;
var cameraTransition = null;
var spawnEffects = [];
function createSpawnEffect(x, z) {
  const ringGeo2 = new THREE.RingGeometry(0.1, 0.3, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 16766720,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo2, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  scene.add(ring);
  const innerGeo = new THREE.RingGeometry(0.05, 0.15, 32);
  const innerMat = new THREE.MeshBasicMaterial({
    color: 16777215,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.position.set(x, 0.06, z);
  scene.add(inner);
  const particles = [];
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * Math.PI * 2;
    const pGeo = new THREE.SphereGeometry(0.04, 6, 6);
    const pMat = new THREE.MeshBasicMaterial({
      color: 16766720,
      transparent: true,
      opacity: 0.8
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
    const progress = 1 - se.life / se.maxLife;
    const scale = 1 + progress * 4;
    se.ring.scale.set(scale, scale, 1);
    se.ring.material.opacity = 0.8 * (1 - progress);
    const innerScale = 1 + progress * 2.5;
    se.inner.scale.set(innerScale, innerScale, 1);
    se.inner.material.opacity = 0.9 * (1 - progress);
    for (const p of se.particles) {
      const ud = p.userData;
      const dist = progress * 1.5 * ud.speed;
      p.position.x = se.ring.position.x + Math.cos(ud.angle) * (0.3 + dist);
      p.position.z = se.ring.position.z + Math.sin(ud.angle) * (0.3 + dist);
      p.position.y = 0.1 + progress * 1.5 * ud.riseSpeed;
      p.material.opacity = 0.8 * (1 - progress);
    }
    if (se.life <= 0) {
      scene.remove(se.ring);
      se.ring.geometry.dispose();
      se.ring.material.dispose();
      scene.remove(se.inner);
      se.inner.geometry.dispose();
      se.inner.material.dispose();
      for (const p of se.particles) {
        scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
      }
      spawnEffects.splice(i, 1);
    }
  }
}
var currentMonth = (/* @__PURE__ */ new Date()).getMonth() + 1;
var season = currentMonth >= 3 && currentMonth <= 5 ? "spring" : currentMonth >= 6 && currentMonth <= 8 ? "summer" : currentMonth >= 9 && currentMonth <= 11 ? "autumn" : "winter";
var snowParticles = [];
function initSnowSystem() {
  if (season !== "winter") return;
  const snowGeo = new THREE.SphereGeometry(0.03, 4, 4);
  const snowMat = new THREE.MeshBasicMaterial({ color: 16777215, transparent: true, opacity: 0.7 });
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
      _atmosphere: true
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
  switch (season) {
    case "spring":
      mat.grass.color.set(8313220);
      mat.grassDark.color.set(6076522);
      mat.flowerPink.color.set(16758465);
      mat.flowerRed.color.set(16739201);
      break;
    case "summer":
      mat.grass.color.set(6210153);
      mat.grassDark.color.set(4761684);
      break;
    case "autumn":
      mat.grass.color.set(12886581);
      mat.grassDark.color.set(10913320);
      mat.leafGreen.color.set(13928463);
      mat.leafDark.color.set(9133588);
      mat.bushGreen.color.set(12088115);
      mat.flowerRed.color.set(13391104);
      mat.flowerPink.color.set(13927290);
      break;
    case "winter":
      mat.grass.color.set(13950438);
      mat.grassDark.color.set(12109268);
      mat.leafGreen.color.set(9415356);
      mat.leafDark.color.set(7178910);
      mat.bushGreen.color.set(10137791);
      break;
  }
  if (season === "autumn") {
    scene.background = new THREE.Color(13935988);
    scene.fog.color.set(13935988);
  } else if (season === "winter") {
    scene.background = new THREE.Color(12111840);
    scene.fog.color.set(12111840);
  }
}
var _seasonalApplied = false;
var gameTime = 0;
var DAY_CYCLE = 120;
var isRaining = false;
var rainDrops = [];
var rainSplashParticles = [];
var RAIN_COUNT = 200;
var lastStateSave = 0;
function isCanvasEvent(e) {
  return e.target === renderer.domElement;
}
function isBubbleEvent(e) {
  return !!e.target.closest(".bubble3d") || !!e.target.closest(".mcp-bubble");
}
renderer.domElement.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!isCanvasEvent(e)) return;
  pressStartTime = Date.now();
  pressStartPos = { x: e.clientX, y: e.clientY };
  const mouse = new THREE.Vector2(
    e.clientX / window.innerWidth * 2 - 1,
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
      longPressTimer = setTimeout(() => {
        if (longPressTarget && !isDraggingMinion) {
          isDraggingMinion = true;
          longPressTarget.userData.isDragging = true;
          longPressTarget.userData.velocityY = 1.5;
          longPressTarget.userData.isGrounded = false;
          isDragging = false;
          renderer.domElement.classList.remove("dragging");
          document.querySelectorAll(".bubble3d, .mcp-bubble").forEach((el) => {
            el.style.pointerEvents = "";
          });
          renderer.domElement.style.cursor = "grabbing";
        }
      }, 400);
    }
  }
  isDragging = true;
  dragStarted = false;
  lastMX = e.clientX;
  lastMY = e.clientY;
  renderer.domElement.classList.add("dragging");
  document.querySelectorAll(".bubble3d, .mcp-bubble").forEach((el) => {
    el.style.pointerEvents = "none";
  });
  e.preventDefault();
});
renderer.domElement.addEventListener("dblclick", (e) => {
  e.preventDefault();
  const mouse = new THREE.Vector2(
    e.clientX / window.innerWidth * 2 - 1,
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
window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragStarted = true;
  yaw -= dx * 3e-3;
  pitch -= dy * 3e-3;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  lastMX = e.clientX;
  lastMY = e.clientY;
});
window.addEventListener("mouseup", () => {
  if (isDragging) {
    isDragging = false;
    renderer.domElement.classList.remove("dragging");
    document.querySelectorAll(".bubble3d, .mcp-bubble").forEach((el) => {
      el.style.pointerEvents = "";
    });
  }
});
function isInputFocused() {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    if (agentDrawer && agentDrawer.classList.contains("open")) {
      closeAgentDrawer();
      return;
    }
    if (followMinion) {
      followMinion = null;
      return;
    }
  }
  if (isInputFocused() || interactingWithOverlay) return;
  if (e.code === "F1") {
    e.preventDefault();
    screenshotMode = !screenshotMode;
    const els = ["drawer", "toggle", "hud", "help"];
    els.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = screenshotMode ? "none" : "";
    });
    const fpsEl = document.getElementById("fps-badge");
    if (fpsEl) fpsEl.style.display = screenshotMode ? "none" : "";
    const minimap = document.getElementById("minimap");
    if (minimap) minimap.style.display = screenshotMode ? "none" : "";
    Object.values(bubbles).forEach((b) => {
      if (screenshotMode) b.style.display = "none";
      else b.style.display = "";
    });
    Object.values(mcpBubbles).forEach((b) => {
      if (b) {
        if (screenshotMode) b.style.display = "none";
        else b.style.display = "";
      }
    });
    return;
  }
  if (e.code >= "Digit1" && e.code <= "Digit9") {
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
      followMinion = null;
    }
    return;
  }
  if (e.code === "KeyW") keys.w = true;
  else if (e.code === "KeyA") keys.a = true;
  else if (e.code === "KeyS") keys.s = true;
  else if (e.code === "KeyD") keys.d = true;
  else if (e.code === "Space") {
    keys.space = true;
    e.preventDefault();
  } else if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.shift = true;
  else if (e.code === "KeyR") toggleRain();
  else if (e.code === "KeyV") {
    const wasThirdPerson = thirdPerson;
    thirdPerson = !thirdPerson;
    if (!selfAvatar) createSelfAvatar();
    if (selfAvatar) selfAvatar.visible = thirdPerson;
  } else if (e.code === "KeyT") {
    e.preventDefault();
    toggleChatPanel();
  }
});
window.addEventListener("keyup", (e) => {
  if (isInputFocused() || interactingWithOverlay) return;
  if (e.code === "KeyW") keys.w = false;
  else if (e.code === "KeyA") keys.a = false;
  else if (e.code === "KeyS") keys.s = false;
  else if (e.code === "KeyD") keys.d = false;
  else if (e.code === "Space") keys.space = false;
  else if (e.code === "ShiftLeft" || e.code === "ShiftRight") keys.shift = false;
});
window.addEventListener("wheel", (e) => {
  moveSpeed = Math.max(4, Math.min(30, moveSpeed - e.deltaY * 0.01));
}, { passive: true });
scene.add(new THREE.AmbientLight(16770244, 0.3));
scene.add(new THREE.AmbientLight(16777215, 0.4));
var hemiLight = new THREE.HemisphereLight(16772789, 4881486, 0.8);
scene.add(hemiLight);
var sun = new THREE.DirectionalLight(16772829, 1.8);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 200;
var sc = sun.shadow.camera;
sc.left = -60;
sc.right = 60;
sc.top = 60;
sc.bottom = -60;
sun.shadow.bias = -5e-4;
sun.shadow.normalBias = 0.02;
scene.add(sun);
var fillLight = new THREE.DirectionalLight(10407935, 0.3);
fillLight.position.set(-20, 30, -10);
scene.add(fillLight);
var rimLight = new THREE.DirectionalLight(16764074, 0.2);
rimLight.position.set(-30, 20, 30);
scene.add(rimLight);
var sunSphere = new THREE.Mesh(
  new THREE.SphereGeometry(2, 32, 24),
  new THREE.MeshBasicMaterial({ color: 16772744 })
);
sunSphere.position.copy(sun.position);
sunSphere.userData._atmosphere = true;
scene.add(sunSphere);
var sunGlow = new THREE.Mesh(
  new THREE.SphereGeometry(4, 32, 24),
  new THREE.MeshBasicMaterial({ color: 16772744, transparent: true, opacity: 0.15 })
);
sunGlow.position.copy(sun.position);
sunGlow.userData._atmosphere = true;
scene.add(sunGlow);
var sunOuterGlow = new THREE.Mesh(
  new THREE.SphereGeometry(8, 32, 24),
  new THREE.MeshBasicMaterial({ color: 16768392, transparent: true, opacity: 0.05 })
);
sunOuterGlow.position.copy(sun.position);
sunOuterGlow.userData._atmosphere = true;
scene.add(sunOuterGlow);
var STAR_COUNT = 2500;
var STAR_BRIGHT_COUNT = 180;
var SKY_RADIUS = 280;
function makeStarField() {
  const starCanvas = document.createElement("canvas");
  starCanvas.width = 64;
  starCanvas.height = 64;
  const sctx = starCanvas.getContext("2d");
  const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(200,220,255,0.9)");
  grad.addColorStop(0.6, "rgba(150,180,255,0.3)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  sctx.fillStyle = grad;
  sctx.beginPath();
  sctx.arc(32, 32, 32, 0, Math.PI * 2);
  sctx.fill();
  const starTex = new THREE.CanvasTexture(starCanvas);
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  for (let i = 0; i < STAR_COUNT; i++) {
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = SKY_RADIUS + (Math.random() - 0.5) * 10;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = 0.8 + Math.random() * 2.5;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  const mat2 = new THREE.PointsMaterial({
    size: 1.8,
    map: starTex,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: false,
    color: 13689087
  });
  const stars = new THREE.Points(geo, mat2);
  stars.userData._stars = true;
  stars.renderOrder = -1;
  scene.add(stars);
  return stars;
}
function makeBrightStars() {
  const brightCanvas = document.createElement("canvas");
  brightCanvas.width = 128;
  brightCanvas.height = 128;
  const bctx = brightCanvas.getContext("2d");
  const bg = bctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  bg.addColorStop(0, "rgba(255,255,255,1)");
  bg.addColorStop(0.15, "rgba(220,235,255,1)");
  bg.addColorStop(0.4, "rgba(180,200,255,0.5)");
  bg.addColorStop(0.7, "rgba(120,150,255,0.15)");
  bg.addColorStop(1, "rgba(0,0,0,0)");
  bctx.fillStyle = bg;
  bctx.beginPath();
  bctx.arc(64, 64, 64, 0, Math.PI * 2);
  bctx.fill();
  const brightTex = new THREE.CanvasTexture(brightCanvas);
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(STAR_BRIGHT_COUNT * 3);
  const colors = new Float32Array(STAR_BRIGHT_COUNT * 3);
  const palette = [
    [1, 1, 1],
    [1, 0.97, 0.9],
    [0.9, 0.93, 1],
    [1, 1, 0.85],
    [0.85, 0.9, 1],
    [1, 0.95, 0.8],
    [0.8, 0.85, 1],
    [1, 0.9, 0.85],
    [0.9, 1, 0.9]
  ];
  for (let i = 0; i < STAR_BRIGHT_COUNT; i++) {
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = SKY_RADIUS - 5;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const col = palette[Math.floor(Math.random() * palette.length)];
    colors[i * 3] = col[0];
    colors[i * 3 + 1] = col[1];
    colors[i * 3 + 2] = col[2];
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat2 = new THREE.PointsMaterial({
    size: 4,
    map: brightTex,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true
  });
  const brightStars = new THREE.Points(geo, mat2);
  brightStars.userData._stars = true;
  brightStars.renderOrder = -1;
  scene.add(brightStars);
  return brightStars;
}
function makeMoon() {
  const moonCanvas = document.createElement("canvas");
  moonCanvas.width = 256;
  moonCanvas.height = 256;
  const mctx = moonCanvas.getContext("2d");
  const mg = mctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  mg.addColorStop(0, "#fffff0");
  mg.addColorStop(0.5, "#e8ecd8");
  mg.addColorStop(0.85, "#c8d0b8");
  mg.addColorStop(1, "rgba(180,190,160,0)");
  mctx.fillStyle = mg;
  mctx.beginPath();
  mctx.arc(128, 128, 128, 0, Math.PI * 2);
  mctx.fill();
  const craters = [
    [90, 80, 18],
    [150, 110, 12],
    [70, 150, 10],
    [160, 160, 8],
    [110, 140, 6],
    [130, 80, 7]
  ];
  for (const [cx, cy, cr] of craters) {
    const cg = mctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    cg.addColorStop(0, "rgba(160,168,140,0.5)");
    cg.addColorStop(0.6, "rgba(180,188,158,0.2)");
    cg.addColorStop(1, "rgba(200,208,178,0)");
    mctx.fillStyle = cg;
    mctx.beginPath();
    mctx.arc(cx, cy, cr, 0, Math.PI * 2);
    mctx.fill();
  }
  const moonTex = new THREE.CanvasTexture(moonCanvas);
  const moonMesh2 = new THREE.Mesh(
    new THREE.SphereGeometry(5, 32, 32),
    new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, opacity: 0, depthWrite: false })
  );
  moonMesh2.userData._moon = true;
  moonMesh2.renderOrder = -1;
  scene.add(moonMesh2);
  const moonGlow2 = new THREE.Mesh(
    new THREE.SphereGeometry(8, 24, 24),
    new THREE.MeshBasicMaterial({ color: 14215935, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  moonGlow2.userData._moon = true;
  moonGlow2.renderOrder = -1;
  scene.add(moonGlow2);
  return { moonMesh: moonMesh2, moonGlow: moonGlow2 };
}
var starField = makeStarField();
var brightStarField = makeBrightStars();
var { moonMesh, moonGlow } = makeMoon();
function makeMilkyWay() {
  const mwGeo = new THREE.BufferGeometry();
  const MW_COUNT = 1200;
  const positions = new Float32Array(MW_COUNT * 3);
  const BAND_TILT = 0.5;
  for (let i = 0; i < MW_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const spread = (Math.random() + Math.random() - 1) * 0.35;
    const phi = Math.PI / 2 + spread + Math.sin(theta) * BAND_TILT;
    const r = SKY_RADIUS - 15 + Math.random() * 5;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  mwGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mwMat = new THREE.PointsMaterial({
    size: 1.2,
    color: 13161727,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
  });
  const mw = new THREE.Points(mwGeo, mwMat);
  mw.userData._stars = true;
  mw.renderOrder = -1;
  scene.add(mw);
  return mw;
}
var milkyWay = makeMilkyWay();
var _starTwinklePhase = Array.from({ length: STAR_BRIGHT_COUNT }, () => Math.random() * Math.PI * 2);
var _starTwinkleTime = 0;
function generateTextures() {
  function makeCanvas(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    return c;
  }
  function makeTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }
  const grassCanvas = makeCanvas(256);
  {
    const ctx = grassCanvas.getContext("2d");
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
    ctx.strokeStyle = "rgba(30,100,30,0.7)";
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
  const dirtCanvas = makeCanvas(256);
  {
    const ctx = dirtCanvas.getContext("2d");
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
    for (let i = 0; i < 200; i++) {
      const px = Math.random() * 256;
      const py = Math.random() * 256;
      const r = 1 + Math.random() * 2;
      const dark = Math.random() > 0.5;
      ctx.fillStyle = dark ? "rgba(80,50,20,0.5)" : "rgba(200,160,90,0.4)";
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const stoneCanvas = makeCanvas(256);
  {
    const ctx = stoneCanvas.getContext("2d");
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = Math.random();
        const v = Math.floor(120 + n * 60);
        ctx.fillStyle = `rgb(${v},${v},${v - 5})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.strokeStyle = "rgba(60,60,70,0.6)";
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
  const woodCanvas = makeCanvas(256);
  {
    const ctx = woodCanvas.getContext("2d");
    for (let x = 0; x < 256; x++) {
      const n = Math.sin(x * 0.3) * 0.5 + 0.5 + Math.random() * 0.1;
      const r = Math.floor(100 + n * 60);
      const g = Math.floor(60 + n * 40);
      const b = Math.floor(20 + n * 20);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, 1, 256);
    }
    ctx.strokeStyle = "rgba(60,30,10,0.3)";
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
  const waterCanvas = makeCanvas(256);
  {
    const ctx = waterCanvas.getContext("2d");
    ctx.fillStyle = "#4a9fca";
    ctx.fillRect(0, 0, 256, 256);
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
    ctx.strokeStyle = "rgba(180,230,255,0.2)";
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
  const roofCanvas = makeCanvas(256);
  {
    const ctx = roofCanvas.getContext("2d");
    ctx.fillStyle = "#888888";
    ctx.fillRect(0, 0, 256, 256);
    const tileW = 32, tileH = 20;
    for (let row = 0; row < 256 / tileH + 1; row++) {
      for (let col = 0; col < 256 / tileW + 1; col++) {
        const offsetX = row % 2 * (tileW / 2);
        const x = col * tileW + offsetX;
        const y = row * tileH;
        const shade = 140 + Math.floor(Math.random() * 30);
        ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
        ctx.fillRect(x + 1, y + 1, tileW - 2, tileH - 2);
        ctx.fillStyle = `rgba(255,255,255,0.15)`;
        ctx.fillRect(x + 1, y + 1, tileW - 2, 3);
        ctx.fillStyle = `rgba(0,0,0,0.2)`;
        ctx.fillRect(x + 1, y + tileH - 3, tileW - 2, 3);
      }
    }
  }
  const wallCanvas = makeCanvas(256);
  {
    const ctx = wallCanvas.getContext("2d");
    ctx.fillStyle = "#cccccc";
    ctx.fillRect(0, 0, 256, 256);
    const brickW = 40, brickH = 18;
    for (let row = 0; row < 256 / brickH + 1; row++) {
      for (let col = 0; col < 256 / brickW + 2; col++) {
        const offsetX = row % 2 * (brickW / 2);
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
    wallTex: makeTexture(wallCanvas)
  };
}
var _textures = generateTextures();
var mat = {
  // Ground
  grass: new THREE.MeshStandardMaterial({ map: _textures.grassTex, roughness: 0.95 }),
  grassDark: new THREE.MeshStandardMaterial({ color: 4761684, map: _textures.grassTex, roughness: 0.95 }),
  dirt: new THREE.MeshStandardMaterial({ map: _textures.dirtTex, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ map: _textures.stoneTex, roughness: 0.8 }),
  cobblestone: new THREE.MeshStandardMaterial({ color: 11047032, map: _textures.stoneTex, roughness: 0.9 }),
  water: new THREE.MeshStandardMaterial({ map: _textures.waterTex, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 }),
  // House
  wallPink: new THREE.MeshStandardMaterial({ color: 16573676, map: _textures.wallTex, roughness: 0.8 }),
  wallBlue: new THREE.MeshStandardMaterial({ color: 14938877, map: _textures.wallTex, roughness: 0.8 }),
  wallYellow: new THREE.MeshStandardMaterial({ color: 16775620, map: _textures.wallTex, roughness: 0.8 }),
  wallGreen: new THREE.MeshStandardMaterial({ color: 15267305, map: _textures.wallTex, roughness: 0.8 }),
  doorWood: new THREE.MeshStandardMaterial({ map: _textures.woodTex, roughness: 0.7 }),
  windowGlass: new THREE.MeshStandardMaterial({ color: 12312315, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.6 }),
  chimney: new THREE.MeshStandardMaterial({ color: 7951688, map: _textures.stoneTex, roughness: 0.9 }),
  // Decorations
  wood: new THREE.MeshStandardMaterial({ map: _textures.woodTex, roughness: 0.85 }),
  fencePost: new THREE.MeshStandardMaterial({ color: 14142664, map: _textures.woodTex, roughness: 0.8 }),
  trunkBrown: new THREE.MeshStandardMaterial({ map: _textures.woodTex, roughness: 0.9 }),
  leafGreen: new THREE.MeshStandardMaterial({ color: 6732650, roughness: 0.8 }),
  leafDark: new THREE.MeshStandardMaterial({ color: 3706428, roughness: 0.8 }),
  flowerRed: new THREE.MeshStandardMaterial({ color: 15684432, roughness: 0.6 }),
  flowerPink: new THREE.MeshStandardMaterial({ color: 16027569, roughness: 0.6 }),
  flowerYellow: new THREE.MeshStandardMaterial({ color: 16773494, roughness: 0.6 }),
  flowerPurple: new THREE.MeshStandardMaterial({ color: 13538264, roughness: 0.6 }),
  flowerWhite: new THREE.MeshStandardMaterial({ color: 16119285, roughness: 0.6 }),
  bushGreen: new THREE.MeshStandardMaterial({ color: 5025616, roughness: 0.85 }),
  lampPost: new THREE.MeshStandardMaterial({ color: 5592405, roughness: 0.4, metalness: 0.6 }),
  lampGlow: new THREE.MeshStandardMaterial({ color: 16772696, emissive: 16772696, emissiveIntensity: 0.6 }),
  rock: new THREE.MeshStandardMaterial({ map: _textures.stoneTex, roughness: 0.95 }),
  // Minion
  minionYellow: new THREE.MeshStandardMaterial({ color: 16109619, roughness: 0.3, metalness: 0.1 }),
  minionBlue: new THREE.MeshStandardMaterial({ color: 3900150, roughness: 0.5 }),
  goggle: new THREE.MeshStandardMaterial({ color: 8947848, metalness: 0.9, roughness: 0.1 }),
  eye: new THREE.MeshStandardMaterial({ color: 16777215, roughness: 0.3 }),
  pupil: new THREE.MeshStandardMaterial({ color: 1118481, emissive: 2236996, emissiveIntensity: 0.1 }),
  roofColors: [6056896, 15684432, 6732650, 16754470, 11225020, 2541274, 15483002, 16740419],
  wallColors: null,
  // set below
  flowerColors: null
  // set below
};
mat.wallColors = [mat.wallPink, mat.wallBlue, mat.wallYellow, mat.wallGreen];
mat.flowerColors = [mat.flowerRed, mat.flowerPink, mat.flowerYellow, mat.flowerPurple, mat.flowerWhite];
if (!_seasonalApplied) {
  _seasonalApplied = true;
  applySeasonalTheme();
  initSnowSystem();
}
var MINION_NAMES = [
  "\u5C0F\u660E",
  "\u963F\u82B1",
  "\u5927\u58EE",
  "\u5C0F\u7F8E",
  "\u963F\u798F",
  "\u5C0F\u9F99",
  "\u5927\u5B9D",
  "\u5C0F\u96EA",
  "\u963F\u6770",
  "\u5C0F\u82B3",
  "\u963F\u5F3A",
  "\u5C0F\u7EA2",
  "\u5927\u4F1F",
  "\u5C0F\u73B2",
  "\u963F\u4EAE",
  "\u5C0F\u9752",
  "\u5927\u5175",
  "\u5C0F\u6708",
  "\u963F\u6D9B",
  "\u5C0F\u71D5",
  "\u963F\u98DE",
  "\u5C0F\u4E91",
  "\u5927\u5C71",
  "\u5C0F\u96E8",
  "\u963F\u519B",
  "\u5C0F\u661F",
  "\u5927\u9F99",
  "\u5C0F\u971E",
  "\u963F\u5CF0",
  "\u5C0F\u7389",
  "\u963F\u6587",
  "\u5C0F\u5170",
  "\u5927\u6D77",
  "\u5C0F\u51E4",
  "\u963F\u52C7",
  "\u5C0F\u83B2",
  "\u5927\u9E4F",
  "\u5C0F\u7434",
  "\u963F\u534E",
  "\u5C0F\u83CA"
];
var usedMinionNames = /* @__PURE__ */ new Set();
function getRandomName() {
  const avail = MINION_NAMES.filter((n2) => !usedMinionNames.has(n2));
  const pool = avail.length > 0 ? avail : MINION_NAMES;
  const n = pool[Math.floor(Math.random() * pool.length)];
  usedMinionNames.add(n);
  return n;
}
var agents = [];
var minions = [];
var bubbles = {};
var obstacles = [];
var clock = new THREE.Clock();
var raycaster = new THREE.Raycaster();
var clickables = [];
var MINION_RADIUS = 0.4;
function addObstacle(minX, maxX, minZ, maxZ, label) {
  obstacles.push({ minX, maxX, minZ, maxZ, label: label || "" });
}
function collidesAABB(ax, az, ar, box) {
  const closestX = Math.max(box.minX, Math.min(ax, box.maxX));
  const closestZ = Math.max(box.minZ, Math.min(az, box.maxZ));
  const dx = ax - closestX, dz = az - closestZ;
  return dx * dx + dz * dz < ar * ar;
}
function collidesWithObstacles(x, z) {
  for (const obs of obstacles) {
    if (collidesAABB(x, z, MINION_RADIUS, obs)) return true;
  }
  return false;
}
function createMinion(profile) {
  const p = profile || {};
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: p.color || 16109619, roughness: 0.5 });
  const hs = p.heightScale || 0.8 + Math.random() * 0.4;
  const ws2 = p.widthScale || 0.9 + Math.random() * 0.2;
  const br = 0.35 * ws2, bh = 1.2 * hs;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(br, br * 1.08, bh, 16), bodyMat);
  body.position.y = 0.5 + bh / 2;
  body.castShadow = true;
  group.add(body);
  const overalls = new THREE.Mesh(new THREE.CylinderGeometry(br * 1.05, br * 1.1, bh * 0.4, 16), mat.minionBlue);
  overalls.position.y = 0.5 + bh * 0.2;
  group.add(overalls);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(br * 1.02, 0.04, 8, 32), mat.goggle);
  strap.position.y = 0.5 + bh * 0.72;
  strap.rotation.x = Math.PI / 2;
  group.add(strap);
  const hr = br * 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(hr, 16, 12), bodyMat);
  head.position.y = 0.5 + bh + hr * 0.5;
  head.castShadow = true;
  group.add(head);
  const eyeCount = Math.random() > 0.3 ? 2 : 1;
  const eyeR = br * 0.22, pupilR = eyeR * 0.55;
  const eyeY = 0.5 + bh + hr * 0.65;
  const eyeSpacing = br * 0.32;
  for (let i = 0; i < eyeCount; i++) {
    const ex = eyeCount === 1 ? 0 : i === 0 ? -eyeSpacing : eyeSpacing;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 8, 8), mat.eye);
    eye.position.set(ex, eyeY, br * 0.85);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(pupilR, 8, 8), mat.pupil);
    pupil.position.set(ex, eyeY, br * 0.85 + eyeR * 0.5);
    group.add(pupil);
    const goggleFrame = new THREE.Mesh(
      new THREE.TorusGeometry(eyeR * 1.15, eyeR * 0.18, 8, 20),
      new THREE.MeshStandardMaterial({ color: 3355443, metalness: 0.7, roughness: 0.2 })
    );
    goggleFrame.position.set(ex, eyeY, br * 0.87);
    group.add(goggleFrame);
  }
  const hairCount = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < hairCount; i++) {
    const angle = i / hairCount * Math.PI * 2;
    const hair = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.15 + Math.random() * 0.1, 6), bodyMat);
    hair.position.set(Math.cos(angle) * br * 0.5, 0.5 + bh + hr * 1.3, Math.sin(angle) * br * 0.5);
    hair.rotation.x = Math.cos(angle) * 0.4;
    hair.rotation.z = Math.sin(angle) * 0.4;
    group.add(hair);
  }
  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.55 * hs, 8), bodyMat);
    arm.position.set(side * (br + 0.12), 0.5 + bh * 0.6, 0);
    arm.userData.isArm = true;
    arm.userData.side = side;
    group.add(arm);
  });
  [-1, 1].forEach((side) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.38 * hs, 8), mat.minionBlue);
    leg.position.set(side * br * 0.45, 0.19 * hs, 0);
    group.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 3355443 }));
    shoe.position.set(side * br * 0.45, 0.04, 0.04);
    group.add(shoe);
  });
  group.userData = {
    state: "idle",
    targetX: 0,
    targetZ: 0,
    speed: 0,
    bobPhase: Math.random() * Math.PI * 2,
    heightScale: hs,
    widthScale: ws2,
    // Session info
    sessionKey: "",
    sessionId: "",
    sessionType: "",
    sessionLabel: "",
    agentName: "",
    // Bubble state
    userMsg: "",
    userName: "",
    eventLog: [],
    replyText: "",
    replyCount: 0,
    // eventLog: [{ type: 'think'|'tool_use'|'tool_result'|'reply_snippet', icon, text, detail, time }]
    lastEventTime: 0,
    // Saved chat input (preserved across bubble close/open)
    savedInput: "",
    // Notification: "!" indicator when conversation ends and bubble is closed
    hasNotification: false,
    notificationSprite: null,
    // Movement
    idleTimer: 0,
    idleAction: "stand",
    idleActionTimer: 0,
    bounds: null,
    chineseName: p.name || "",
    // Physics
    velocityY: 0,
    isGrounded: true,
    // Drag state
    isDragging: false,
    dragTargetX: 0,
    dragTargetZ: 0,
    // Continent position (for sitting/sleeping)
    continentIdx: -1,
    continentHx: 0,
    continentHz: 0,
    continentCx: 0,
    continentCz: 0,
    // Sitting behavior
    isSitting: false,
    sitTarget: null,
    sitTimer: 0,
    // Sleeping behavior
    isSleeping: false,
    // Greeting behavior
    isGreeting: false,
    greetingTimer: 0
  };
  return group;
}
function clearNotification(minion) {
  if (minion.userData.notificationSprite) {
    minion.remove(minion.userData.notificationSprite);
    minion.userData.notificationSprite = null;
  }
  minion.userData.hasNotification = false;
  const sk = minion.userData.sessionKey;
  if (activeAnimations[sk]) {
    clearTimeout(activeAnimations[sk].timer);
    if (activeAnimations[sk].ring) scene.remove(activeAnimations[sk].ring);
    delete activeAnimations[sk];
    minion.scale.set(1, 1, 1);
    minion.rotation.x = 0;
  }
}
function addNameLabel(minion, line1, line2) {
  const old = minion.children.find((c) => c.userData?.isNameLabel);
  if (old) minion.remove(old);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 512, 128);
  ctx.font = "bold 28px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 3;
  ctx.strokeText(line1 || "", 256, 45);
  ctx.fillText(line1 || "", 256, 45);
  if (line2) {
    ctx.font = "22px -apple-system, sans-serif";
    ctx.fillStyle = "#ffd700";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2.5;
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
function createThinkingIndicator(minion) {
  const existing = minion.children.find((c) => c.userData?.isThinkingIndicator);
  if (existing) minion.remove(existing);
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat2 = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat2);
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
  let sprite = minion.children.find((c) => c.userData?.isThinkingIndicator);
  if (ud.state !== "thinking") {
    if (sprite) {
      minion.remove(sprite);
      sprite.material.dispose();
      sprite.userData._tex.dispose();
    }
    return;
  }
  if (!sprite) sprite = createThinkingIndicator(minion);
  const dotPhase = Math.floor(time / 0.6) % 4;
  const dots = ".".repeat(dotPhase === 0 ? 3 : dotPhase);
  const canvas = sprite.userData._canvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 64);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  const pillW = 50, pillH = 32, pillX = (128 - pillW) / 2, pillY = 16;
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, pillH, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#666";
  ctx.fillText(dots, 64, 32);
  sprite.userData._tex.needsUpdate = true;
  sprite.position.y = 2.5 * (ud.heightScale || 1) * 0.5 + 1.8 + Math.sin(time * 3) * 0.05;
}
function createMiniBubble(minion) {
  const existing = minion.children.find((c) => c.userData?.isMiniBubble);
  if (existing) {
    minion.remove(existing);
    existing.material.dispose();
    existing.userData._tex.dispose();
  }
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 48;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat2 = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat2);
  const hs = minion.userData.heightScale || 1;
  sprite.position.y = 2.5 * hs * 0.5 + 2.3;
  sprite.scale.set(2.5, 0.375, 1);
  sprite.userData.isMiniBubble = true;
  sprite.userData._tex = tex;
  sprite.userData._canvas = canvas;
  sprite.userData._lastText = "";
  sprite.userData._showTime = 0;
  minion.add(sprite);
  return sprite;
}
function updateMiniBubble(minion, time) {
  const ud = minion.userData;
  let sprite = minion.children.find((c) => c.userData?.isMiniBubble);
  const log = ud.eventLog || [];
  let latestText = "";
  let latestType = "";
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].type === "think" || log[i].type === "tool_use" || log[i].type === "tool_result") {
      latestText = log[i].text || "";
      latestType = log[i].type;
      break;
    }
  }
  if (ud.state !== "thinking" || !latestText) {
    if (sprite) {
      sprite.material.opacity = Math.max(0, sprite.material.opacity - 0.05);
      if (sprite.material.opacity <= 0) {
        minion.remove(sprite);
        sprite.material.dispose();
        sprite.userData._tex.dispose();
      }
    }
    return;
  }
  if (!sprite) sprite = createMiniBubble(minion);
  if (sprite.userData._lastText !== latestText) {
    sprite.userData._lastText = latestText;
    sprite.userData._showTime = time;
    const canvas = sprite.userData._canvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 320, 48);
    const colors = { think: "#7c3aed", tool_use: "#b45309", tool_result: "#059669" };
    ctx.fillStyle = colors[latestType] || "#666";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(4, 4, 312, 40, 12);
    ctx.fill();
    ctx.globalAlpha = 1;
    const icons = { think: "\u{1F4AD}", tool_use: "\u{1F527}", tool_result: "\u{1F4CB}" };
    ctx.font = "12px -apple-system, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const displayText = (icons[latestType] || "") + " " + latestText.slice(0, 30);
    ctx.fillText(displayText, 12, 24);
    sprite.userData._tex.needsUpdate = true;
  }
  sprite.material.opacity = Math.min(0.95, sprite.material.opacity + 0.08);
}
function createContinent(agentName, index) {
  const W = 22, D = 22;
  const cols = Math.ceil(Math.sqrt(agents.length));
  const col = index % cols, row = Math.floor(index / cols);
  const ox = col * (W + 6) - (cols - 1) * (W + 6) / 2;
  const oz = row * (D + 6) - (Math.ceil(agents.length / cols) - 1) * (D + 6) / 2;
  const cx = ox + W / 2, cz = oz + D / 2;
  const groundGeo = new THREE.PlaneGeometry(W, D, 32, 32);
  groundGeo.rotateX(-Math.PI / 2);
  const posAttr = groundGeo.getAttribute("position");
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const height = Math.sin(x * 0.3) * Math.cos(z * 0.3) * 0.15 + Math.sin(x * 0.7 + 1) * Math.cos(z * 0.5) * 0.08 + Math.sin(x * 0.2 + z * 0.4) * 0.05;
    posAttr.setY(i, height);
  }
  groundGeo.computeVertexNormals();
  if (mat.grass.map) mat.grass.map.repeat.set(8, 8);
  const ground = new THREE.Mesh(groundGeo, mat.grass);
  ground.position.set(cx, -0.05, cz);
  ground.receiveShadow = true;
  scene.add(ground);
  const darkPatches = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.95, D * 0.95, 16, 16),
    mat.grassDark
  );
  darkPatches.rotation.x = -Math.PI / 2;
  darkPatches.position.set(cx, -0.02, cz);
  darkPatches.receiveShadow = true;
  scene.add(darkPatches);
  for (let i = 0; i < 6; i++) {
    const px = ox + 2 + Math.random() * (W - 4), pz = oz + 2 + Math.random() * (D - 4);
    const sz = 1.5 + Math.random() * 2.5;
    const patch = new THREE.Mesh(new THREE.CircleGeometry(sz, 16), mat.grassDark);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(px, 0.01, pz);
    scene.add(patch);
  }
  const pathMat = mat.cobblestone;
  for (let i = 0; i < 8; i++) {
    const stone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3 + Math.random() * 0.2, 0.35 + Math.random() * 0.15, 0.06, 6),
      pathMat
    );
    stone.position.set(cx - 0.5 + Math.random(), 0.03, oz + 2 + i * 2.2);
    stone.rotation.y = Math.random() * Math.PI;
    scene.add(stone);
  }
  const houseW = 4.5, houseD = 4.5, houseH = 3;
  const roofColor = mat.roofColors[index % mat.roofColors.length];
  const wallMat = mat.wallColors[index % mat.wallColors.length];
  const hx = cx - 2, hz = cz - 2;
  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(houseW + 0.3, 0.4, houseD + 0.3),
    mat.stone
  );
  foundation.position.set(hx, 0.2, hz);
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  scene.add(foundation);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(houseW, houseH, houseD), wallMat);
  walls.position.set(hx, houseH / 2 + 0.4, hz);
  walls.castShadow = true;
  walls.receiveShadow = true;
  scene.add(walls);
  const wallTrim = new THREE.Mesh(
    new THREE.BoxGeometry(houseW + 0.1, 0.15, houseD + 0.1),
    mat.doorWood
  );
  wallTrim.position.set(hx, 0.5, hz);
  scene.add(wallTrim);
  const roofGeo = new THREE.ConeGeometry(houseW * 0.85, 2.5, 4);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({
    color: roofColor,
    map: _textures.roofTex,
    roughness: 0.6,
    flatShading: true
  }));
  roof.position.set(hx, houseH + 1.65, hz);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  scene.add(roof);
  const overhang = new THREE.Mesh(
    new THREE.ConeGeometry(houseW * 0.92, 0.3, 4),
    new THREE.MeshStandardMaterial({ color: roofColor, map: _textures.roofTex, roughness: 0.7 })
  );
  overhang.position.set(hx, houseH + 0.5, hz);
  overhang.rotation.y = Math.PI / 4;
  scene.add(overhang);
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.15, houseW * 1.2),
    mat.doorWood
  );
  ridge.position.set(hx, houseH + 2.9, hz);
  ridge.rotation.y = Math.PI / 4;
  scene.add(ridge);
  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1.8, 0.12),
    mat.doorWood
  );
  doorFrame.position.set(hx, 1.3, hz + houseD / 2 + 0.06);
  scene.add(doorFrame);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 1.6, 0.08),
    new THREE.MeshStandardMaterial({ color: 9127187, roughness: 0.7 })
  );
  door.position.set(hx, 1.2, hz + houseD / 2 + 0.1);
  scene.add(door);
  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 8),
    new THREE.MeshStandardMaterial({ color: 16766720, metalness: 0.9, roughness: 0.2 })
  );
  knob.position.set(hx + 0.25, 1, hz + houseD / 2 + 0.18);
  scene.add(knob);
  const step = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.15, 0.5),
    mat.stone
  );
  step.position.set(hx, 0.1, hz + houseD / 2 + 0.5);
  scene.add(step);
  [-1, 1].forEach((side) => {
    const recess = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.05),
      mat.doorWood
    );
    recess.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD / 2 + 0.02);
    scene.add(recess);
    const winFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.85, 0.06),
      new THREE.MeshStandardMaterial({ color: 9139029, roughness: 0.8 })
    );
    winFrame.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD / 2 + 0.05);
    scene.add(winFrame);
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.08),
      mat.windowGlass
    );
    win.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD / 2 + 0.08);
    scene.add(win);
    const crossH = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.04, 0.02),
      new THREE.MeshStandardMaterial({ color: 16777215 })
    );
    crossH.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD / 2 + 0.12);
    scene.add(crossH);
    const crossV = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.7, 0.02),
      new THREE.MeshStandardMaterial({ color: 16777215 })
    );
    crossV.position.set(hx + side * 1.5, houseH * 0.55 + 0.4, hz + houseD / 2 + 0.12);
    scene.add(crossV);
    const shutterMat = new THREE.MeshStandardMaterial({ color: 6114871, roughness: 0.8 });
    const leftShutter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.03), shutterMat);
    leftShutter.position.set(hx + side * 1.5 - 0.55, houseH * 0.55 + 0.4, hz + houseD / 2 + 0.08);
    scene.add(leftShutter);
    const rightShutter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.03), shutterMat);
    rightShutter.position.set(hx + side * 1.5 + 0.55, houseH * 0.55 + 0.4, hz + houseD / 2 + 0.08);
    scene.add(rightShutter);
  });
  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 2, 0.6),
    mat.chimney
  );
  chimney.position.set(hx + 1.2, houseH + 2, hz - 0.8);
  chimney.castShadow = true;
  scene.add(chimney);
  const chimneyCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.15, 0.8),
    mat.stone
  );
  chimneyCap.position.set(hx + 1.2, houseH + 3.05, hz - 0.8);
  scene.add(chimneyCap);
  for (let i = 0; i < 5; i++) {
    const brickLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.02, 0.62),
      new THREE.MeshStandardMaterial({ color: 4007959 })
    );
    brickLine.position.set(hx + 1.2, houseH + 1.2 + i * 0.4, hz - 0.8);
    scene.add(brickLine);
  }
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([dx, dz]) => {
    const corner = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, houseH + 0.2, 0.12),
      mat.doorWood
    );
    corner.position.set(
      hx + dx * (houseW / 2 + 0.05),
      houseH / 2 + 0.3,
      hz + dz * (houseD / 2 + 0.05)
    );
    scene.add(corner);
  });
  [-1, 1].forEach((side) => {
    const flowerBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.15, 0.2),
      mat.doorWood
    );
    flowerBox.position.set(hx + side * 1.5, houseH * 0.25 + 0.4, hz + houseD / 2 + 0.15);
    scene.add(flowerBox);
    for (let f = 0; f < 4; f++) {
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        mat.flowerColors[f % mat.flowerColors.length]
      );
      flower.position.set(
        hx + side * 1.5 - 0.3 + f * 0.2,
        houseH * 0.25 + 0.55,
        hz + houseD / 2 + 0.15
      );
      scene.add(flower);
    }
  });
  const signCanvas = document.createElement("canvas");
  signCanvas.width = 256;
  signCanvas.height = 64;
  const sctx = signCanvas.getContext("2d");
  sctx.fillStyle = "#2d1b00";
  sctx.fillRect(0, 0, 256, 64);
  sctx.strokeStyle = "#8d6e63";
  sctx.lineWidth = 4;
  sctx.strokeRect(2, 2, 252, 60);
  sctx.font = "bold 22px sans-serif";
  sctx.textAlign = "center";
  sctx.fillStyle = "#ffcc02";
  sctx.fillText(agentName, 128, 42);
  const signTex = new THREE.CanvasTexture(signCanvas);
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, transparent: true }));
  sign.position.set(hx, houseH + 3.8, hz);
  sign.scale.set(3.5, 0.875, 1);
  scene.add(sign);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.7), mat.wood);
  table.position.set(hx - 1.5, 0.72, hz + 1);
  scene.add(table);
  [-0.55, 0.55].forEach((xo) => [-0.25, 0.25].forEach((zo) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), mat.wood);
    leg.position.set(hx - 1.5 + xo, 0.35, hz + 1 + zo);
    scene.add(leg);
  }));
  [-1, 1].forEach((side) => {
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), mat.doorWood);
    chair.position.set(hx - 1.5 + side * 1.1, 0.22, hz + 1);
    scene.add(chair);
  });
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.25, 2.2), new THREE.MeshStandardMaterial({ color: 9489145, roughness: 0.7 }));
  bed.position.set(hx + 1.5, 0.12, hz - 0.8);
  scene.add(bed);
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.1, 0.45), new THREE.MeshStandardMaterial({ color: 16777215, roughness: 0.5 }));
  pillow.position.set(hx + 1.5, 0.3, hz - 1.7);
  scene.add(pillow);
  const canopyColors = [
    new THREE.Color(2972199),
    new THREE.Color(4028983),
    new THREE.Color(4885567),
    new THREE.Color(3504686)
  ];
  const treePositions = [
    [ox + 2, oz + 2],
    [ox + W - 2, oz + 2],
    [ox + 2, oz + D - 2],
    [ox + W - 2, oz + D - 2],
    [cx + 5, cz + 3],
    [cx - 6, cz - 4],
    [cx + 3, cz - 6]
  ];
  treePositions.forEach(([tx, tz], ti) => {
    const treeH = 2 + Math.random() * 1.5;
    const trunkR = 0.12 + Math.random() * 0.08;
    const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, treeH, 12);
    const trunk = new THREE.Mesh(trunkGeo, mat.trunkBrown);
    trunk.position.set(tx, treeH / 2, tz);
    trunk.rotation.z = (Math.random() - 0.5) * 0.05;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    scene.add(trunk);
    for (let r = 0; r < 4; r++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(trunkR * (0.9 - r * 0.1), 0.01, 8, 12),
        new THREE.MeshStandardMaterial({ color: 6114871 })
      );
      ring.position.set(tx, 0.5 + r * (treeH / 5), tz);
      ring.rotation.x = Math.PI / 2;
      scene.add(ring);
    }
    const branchCount = 3 + Math.floor(Math.random() * 3);
    for (let b = 0; b < branchCount; b++) {
      const bAngle = b / branchCount * Math.PI * 2 + Math.random() * 0.5;
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
        subBranch.rotation.z = Math.cos(bAngle) * 1;
        subBranch.rotation.x = Math.sin(bAngle) * 1;
        scene.add(subBranch);
      }
    }
    const canopyR = 1.2 + Math.random() * 0.6;
    const canopyColor = canopyColors[ti % canopyColors.length];
    const canopyShaderMat = new THREE.ShaderMaterial({
      vertexShader: canopyVertexShader,
      fragmentShader: canopyFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: 0.06 + Math.random() * 0.03 },
        uWindDir: { value: new THREE.Vector3(1, 0.2, 0.5).normalize() },
        uColor: { value: canopyColor },
        uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() }
      }
    });
    const canopyShapes = [
      [0, 0, 0, 1],
      [0.35, 0.15, 0.25, 0.8],
      [-0.3, 0.2, -0.2, 0.85],
      [0.15, -0.15, 0.35, 0.7],
      [-0.25, 0.1, 0.3, 0.75],
      [0.2, 0.25, -0.15, 0.65]
    ];
    canopyShapes.forEach(([dx, dy, dz, scaleMod]) => {
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
    for (let r = 0; r < 4; r++) {
      const ra = r / 4 * Math.PI * 2 + Math.random() * 0.3;
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
    addObstacle(tx - 0.5, tx + 0.5, tz - 0.5, tz + 0.5, "tree");
  });
  createGrassForContinent(ox, oz, W, D);
  const flowerColors = [mat.flowerRed, mat.flowerPink, mat.flowerYellow, mat.flowerPurple, mat.flowerWhite];
  const flowerCount = 20 + Math.floor(Math.random() * 10);
  for (let i = 0; i < flowerCount; i++) {
    const fx = ox + 1 + Math.random() * (W - 2);
    const fz = oz + 1 + Math.random() * (D - 2);
    if (Math.abs(fx - hx) < 3.5 && Math.abs(fz - hz) < 3.5) continue;
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
    const stemGeo = new THREE.CylinderGeometry(0.015, 0.02, stemH, 6);
    const stem = new THREE.Mesh(stemGeo, mat.leafGreen);
    stem.position.set(fx, stemH / 2, fz);
    stem.rotation.z = (Math.random() - 0.5) * 0.2;
    scene.add(stem);
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
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.08 + Math.random() * 0.04, 10, 8),
        fColor
      );
      head.position.set(fx, stemH + 0.05, fz);
      scene.add(head);
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 6),
        new THREE.MeshStandardMaterial({ color: 16771899 })
      );
      center.position.set(fx, stemH + 0.08, fz + 0.05);
      scene.add(center);
    } else if (flowerType === 1) {
      const petalCount = 5 + Math.floor(Math.random() * 3);
      for (let p = 0; p < petalCount; p++) {
        const pa = p / petalCount * Math.PI * 2;
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
      const center = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 8, 6),
        new THREE.MeshStandardMaterial({ color: 16771899 })
      );
      center.position.set(fx, stemH + 0.06, fz);
      scene.add(center);
    } else {
      const tulip = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.12, 8),
        fColor
      );
      tulip.position.set(fx, stemH + 0.06, fz);
      tulip.rotation.x = Math.PI;
      scene.add(tulip);
    }
  }
  const bushCount = 6 + Math.floor(Math.random() * 4);
  for (let i = 0; i < bushCount; i++) {
    const bx = ox + 1.5 + Math.random() * (W - 3);
    const bz = oz + 1.5 + Math.random() * (D - 3);
    if (Math.abs(bx - hx) < 3 && Math.abs(bz - hz) < 3) continue;
    let tooClose = false;
    for (const [tx, tz] of treePositions) {
      if (Math.abs(bx - tx) < 1.5 && Math.abs(bz - tz) < 1.5) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
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
    if (Math.random() > 0.5) {
      const flowerCount2 = 2 + Math.floor(Math.random() * 3);
      for (let f = 0; f < flowerCount2; f++) {
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
  const pondX = cx + 4, pondZ = cz + 4;
  const pondRadius = 2.2;
  const basin = new THREE.Mesh(
    new THREE.CircleGeometry(pondRadius + 0.3, 32),
    new THREE.MeshStandardMaterial({ color: 4021322, roughness: 1 })
  );
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(pondX, -0.02, pondZ);
  basin.receiveShadow = true;
  scene.add(basin);
  const waterShaderMat = new THREE.ShaderMaterial({
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(5093588) },
      uDeepColor: { value: new THREE.Color(1731466) }
    },
    transparent: true,
    side: THREE.DoubleSide
  });
  const pondGeo = new THREE.CircleGeometry(pondRadius, 32);
  const pond = new THREE.Mesh(pondGeo, waterShaderMat);
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(pondX, 0.02, pondZ);
  scene.add(pond);
  if (!window._waterMeshes) window._waterMeshes = [];
  window._waterMeshes.push(pond);
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
  for (let i = 0; i < 4; i++) {
    const la = Math.random() * Math.PI * 2;
    const lr = 0.4 + Math.random() * 1;
    const lily = new THREE.Mesh(
      new THREE.CircleGeometry(0.25, 12),
      new THREE.MeshStandardMaterial({
        color: 4033600,
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
    if (Math.random() > 0.5) {
      const flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 6),
        new THREE.MeshStandardMaterial({
          color: Math.random() > 0.5 ? 16738740 : 16777215,
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
  for (let f = 0; f < 3; f++) {
    const fish = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 0.15, 4),
      new THREE.MeshStandardMaterial({ color: 16753920 })
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
    rock.scale.y = 0.7;
    scene.add(rock);
  }
  const fenceYard = { x1: hx - 3.5, x2: hx + 3.5, z1: hz + houseD / 2 + 0.5, z2: hz + houseD / 2 + 4 };
  for (let fx = fenceYard.x1; fx <= fenceYard.x2; fx += 0.8) {
    [fenceYard.z1, fenceYard.z2].forEach((fz) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), mat.fencePost);
      post.position.set(fx, 0.3, fz);
      scene.add(post);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 4), mat.fencePost);
      cap.position.set(fx, 0.66, fz);
      scene.add(cap);
    });
  }
  [fenceYard.z1, fenceYard.z2].forEach((fz) => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(fenceYard.x2 - fenceYard.x1, 0.05, 0.05), mat.fencePost);
    rail.position.set((fenceYard.x1 + fenceYard.x2) / 2, 0.45, fz);
    scene.add(rail);
  });
  const lmpx = hx + houseW / 2 + 1.5, lmpz = hz + houseD / 2 + 1;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.2, 8), mat.lampPost);
  pole.position.set(lmpx, 1.1, lmpz);
  scene.add(pole);
  const lampHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), mat.lampGlow);
  lampHead.position.set(lmpx, 2.3, lmpz);
  scene.add(lampHead);
  const lampLight = new THREE.PointLight(16772696, 0.4, 8);
  lampLight.position.set(lmpx, 2.2, lmpz);
  scene.add(lampLight);
  const benchX = cx - 5, benchZ = cz + 1;
  const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.4), mat.wood);
  benchSeat.position.set(benchX, 0.45, benchZ);
  scene.add(benchSeat);
  const benchBack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.06), mat.wood);
  benchBack.position.set(benchX, 0.7, benchZ - 0.18);
  scene.add(benchBack);
  [-0.5, 0.5].forEach((xo) => {
    const bLeg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 0.35), mat.doorWood);
    bLeg.position.set(benchX + xo, 0.22, benchZ);
    scene.add(bLeg);
  });
  const pad = 0.3;
  addObstacle(hx - houseW / 2 - pad, hx + houseW / 2 + pad, hz - houseD / 2 - pad, hz + houseD / 2 + pad, "house");
  addObstacle(hx - 1.5 - 0.7 - pad, hx - 1.5 + 0.7 + pad, hz + 1 - 0.35 - pad, hz + 1 + 0.35 + pad, "table");
  [-1, 1].forEach((side) => {
    const ccx = hx - 1.5 + side * 1.1;
    addObstacle(ccx - 0.22 - pad, ccx + 0.22 + pad, hz + 1 - 0.22 - pad, hz + 1 + 0.22 + pad, "chair");
  });
  addObstacle(hx + 1.5 - 0.7 - pad, hx + 1.5 + 0.7 + pad, hz - 0.8 - 1.1 - pad, hz - 0.8 + 1.1 + pad, "bed");
  addObstacle(lmpx - 0.2, lmpx + 0.2, lmpz - 0.2, lmpz + 0.2, "lamp");
  addObstacle(benchX - 0.7, benchX + 0.7, benchZ - 0.3, benchZ + 0.3, "bench");
  addObstacle(pondX - 2, pondX + 2, pondZ - 2, pondZ + 2, "pond");
  addObstacle(ox - 1, ox + 0.3, oz - 1, oz + D + 1, "wall_west");
  addObstacle(ox + W - 0.3, ox + W + 1, oz - 1, oz + D + 1, "wall_east");
  addObstacle(ox - 1, ox + W + 1, oz - 1, oz + 0.3, "wall_north");
  addObstacle(ox - 1, ox + W + 1, oz + D - 0.3, oz + D + 1, "wall_south");
  return { ox, oz, W, D, hx, hz, houseH };
}
function parseSessionKey(key) {
  const parts = key.split(":");
  if (parts[0] !== "agent") return { type: "unknown", label: key.slice(0, 30), icon: "\u2753" };
  if (parts[2] === "main" && parts.length === 3) return { type: "main", label: "\u4E3B\u4F1A\u8BDD", icon: "\u{1F3E0}" };
  if (parts[2] === "feishu" && parts[3] === "group") {
    const gid = parts.slice(4).join(":");
    return { type: "group", label: gid.length > 16 ? gid.slice(0, 16) + "\u2026" : gid, icon: "\u{1F4AC}" };
  }
  if (parts[2] === "feishu" && parts[3] === "dm") {
    const uid = parts.slice(4).join(":");
    return { type: "dm", label: uid.length > 16 ? uid.slice(0, 16) + "\u2026" : uid, icon: "\u{1F4E9}" };
  }
  if (parts[2] === "cron") return { type: "cron", label: "\u5B9A\u65F6\u4EFB\u52A1", icon: "\u23F0" };
  if (parts[2] === "subagent") return { type: "subagent", label: "\u5B50\u4EE3\u7406", icon: "\u{1F916}" };
  return { type: parts[2] || "session", label: key.slice(0, 30), icon: "\u2753" };
}
var knownSessionKeys = /* @__PURE__ */ new Set();
function initWorld(worldData) {
  const savedPositions = {};
  const savedBubbles = {};
  for (const m of minions) {
    const sk = m.userData.sessionKey;
    if (!sk) continue;
    savedPositions[sk] = {
      x: m.position.x,
      z: m.position.z,
      targetX: m.userData.targetX,
      targetZ: m.userData.targetZ
    };
    const bub = bubbles[sk];
    if (bub) {
      const actsEl = bub.querySelector(".bub-acts");
      savedBubbles[sk] = {
        show: bub.classList.contains("show"),
        dismissed: bub._dismissed,
        collapsed: actsEl ? actsEl.classList.contains("collapsed") : true,
        userMsg: m.userData.userMsg,
        userName: m.userData.userName,
        state: m.userData.state,
        eventLog: m.userData.eventLog,
        replyText: m.userData.replyText,
        replyCount: m.userData.replyCount
      };
    }
  }
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
            show: true,
            dismissed: false,
            collapsed: true,
            userMsg: st.userMsg || "",
            userName: st.userName || "",
            state: st.state || "done",
            eventLog: st.eventLog || [],
            replyText: st.replyText || "",
            replyCount: st.replyCount || 0
          };
        }
      }
    }
    if (ss.fixedPanelSession && !fixedPanelSession) {
      var _deferredFixedPanel = ss.fixedPanelSession;
    }
  }
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const c = scene.children[i];
    if (c.isLight) continue;
    if (c.userData?._atmosphere) continue;
    if (c === selfAvatar) continue;
    let isUserAvatar = false;
    for (const av of Object.values(userAvatars)) {
      if (av.mesh === c) {
        isUserAvatar = true;
        break;
      }
    }
    if (isUserAvatar) continue;
    scene.remove(c);
  }
  Object.values(bubbles).forEach((el) => el.remove());
  Object.keys(bubbles).forEach((k) => delete bubbles[k]);
  minions.length = 0;
  clickables.length = 0;
  obstacles.length = 0;
  agents = worldData.agents || [];
  document.getElementById("h-agents").textContent = `Agents: ${agents.length}`;
  let totalSess = 0;
  agents.forEach((a) => totalSess += a.sessions.length);
  document.getElementById("h-sess").textContent = `Sessions: ${totalSess}`;
  const agentsEl = document.getElementById("b-agents");
  agentsEl.innerHTML = agents.map((a) => `<div class="row"><span><span class="dot on"></span>${esc(a.name)}</span><span>${a.sessions.length} sessions</span></div>`).join("");
  agents.forEach((agent, ai) => {
    const continent = createContinent(agent.name, ai);
    agent.sessions.forEach((sess, si) => {
      const profile = sess.profile || {};
      if (!profile.name) {
        profile.name = getRandomName();
        if (!profile.color) profile.color = [16109619, 16739179, 5164484, 16770669, 11069135][Math.floor(Math.random() * 5)];
        if (!profile.heightScale) profile.heightScale = 0.8 + Math.random() * 0.4;
        if (!profile.widthScale) profile.widthScale = 0.9 + Math.random() * 0.2;
        authFetch("/api/minion-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [sess.key]: profile })
        }).catch(() => {
        });
      }
      const m = createMinion(profile);
      const cols = Math.ceil(Math.sqrt(agent.sessions.length));
      const col = si % cols, row = Math.floor(si / cols);
      const totalCols = cols;
      const totalRows = Math.ceil(agent.sessions.length / cols);
      const spacingX = Math.min(3.5, (continent.W - 4) / Math.max(totalCols, 1));
      const spacingZ = Math.min(3.5, (continent.D - 4) / Math.max(totalRows, 1));
      const gridStartX = continent.ox + continent.W / 2 - (totalCols - 1) * spacingX / 2;
      const gridStartZ = continent.oz + continent.D / 2 - (totalRows - 1) * spacingZ / 2;
      const defaultPx = gridStartX + col * spacingX;
      const defaultPz = gridStartZ + row * spacingZ;
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
        minX: continent.ox + 1,
        maxX: continent.ox + continent.W - 1,
        minZ: continent.oz + 1,
        maxZ: continent.oz + continent.D - 1
      };
      m.userData.continentIdx = ai;
      m.userData.continentHx = continent.hx;
      m.userData.continentHz = continent.hz;
      m.userData.continentCx = continent.ox + continent.W / 2;
      m.userData.continentCz = continent.oz + continent.D / 2;
      const parsed = parseSessionKey(sess.key);
      const labelLine = `${parsed.icon} ${sess.label || parsed.label}`;
      addNameLabel(m, labelLine, profile.name);
      scene.add(m);
      minions.push(m);
      clickables.push(m);
      if (!knownSessionKeys.has(sess.key)) {
        knownSessionKeys.add(sess.key);
        createSpawnEffect(m.position.x, m.position.z);
      }
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
        if (sb.collapsed !== void 0) {
          const acts = el.querySelector(".bub-acts");
          if (acts) {
            if (sb.collapsed) acts.classList.add("collapsed");
            else acts.classList.remove("collapsed");
          }
        }
        if (!sb.dismissed && sb.state === "thinking") showBubble(m);
      }
    });
  });
  const sessEl = document.getElementById("b-sessions");
  sessEl.innerHTML = agents.flatMap((a, ai) => a.sessions.map((s) => {
    const p = parseSessionKey(s.key);
    const profile = s.profile || {};
    const searchText = `${s.label || p.label} ${s.key} ${profile.name || ""}`.replace(/"/g, "&quot;");
    return `<div class="row sess-row" data-agent-index="${ai}" data-search-text="${searchText}" style="cursor:pointer"><span>${p.icon} ${esc(s.label || p.label)}</span><span style="color:#556;font-size:7px">${esc(a.name)}</span></div>`;
  })).join("");
  sessEl.querySelectorAll(".sess-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const agentIdx = parseInt(row.dataset.agentIndex);
      teleportToContinent(agentIdx);
    });
  });
  ensureAtmosphereElements();
  if (typeof _deferredFixedPanel === "string" && _deferredFixedPanel) {
    const mn = minions.find((m) => m.userData.sessionKey === _deferredFixedPanel);
    if (mn) {
      openFixedPanel(_deferredFixedPanel);
    }
  }
  const lo = document.getElementById("loading-overlay");
  if (lo) {
    lo.classList.add("hidden");
    setTimeout(() => lo.remove(), 600);
  }
}
function ensureAtmosphereElements() {
  if (!scene.children.includes(sunSphere)) scene.add(sunSphere);
  if (!scene.children.includes(sunGlow)) scene.add(sunGlow);
  if (petals.length === 0) initPetals();
  if (typeof initClouds === "function" && !scene.children.find((c) => c.userData?.isCloud)) initCloudsFixed();
}
function getOrCreateBubble(sessionKey) {
  let el = bubbles[sessionKey];
  if (el && !document.body.contains(el)) {
    delete bubbles[sessionKey];
    el = null;
  }
  if (!el) {
    el = document.createElement("div");
    el.className = "bubble3d";
    const sk = sessionKey;
    el.innerHTML = `<div class="bub-hd"><span class="bub-avatar">\u{1F7E1}</span><span class="bub-user"></span><button class="bub-detail" title="\u67E5\u770B\u8BE6\u60C5">\u{1F50D}</button><button class="bub-abort" title="\u7EC8\u6B62\u601D\u8003">\u{1F6D1}</button><button class="bub-pin" title="\u56FA\u5B9A\u5230\u5E95\u90E8">\u{1F4CC}</button><button class="bub-close">\u2715</button></div><div class="bub-msg"></div><div class="bub-acts collapsed"><div class="bub-acts-hd"><span class="bub-acts-tri">\u25B6</span><span class="bub-acts-lbl">\u601D\u8003\u8FC7\u7A0B</span><span class="bub-acts-cnt">0</span></div><div class="bub-acts-body"></div></div><div class="bub-chat"><input class="bub-chat-in" placeholder="\u76F4\u63A5\u5BF9\u8BDD..." /></div><div class="bub-foot"></div>`;
    el._hasMore = true;
    el._loadingHistory = false;
    el.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    el.addEventListener("mouseup", (e) => {
      e.stopPropagation();
    });
    el.addEventListener("mousemove", (e) => {
      e.stopPropagation();
    });
    const closeBtn = el.querySelector(".bub-close");
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      hideBubble(sk);
    });
    const pinBtn = el.querySelector(".bub-pin");
    pinBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFixedPanel(sk);
    });
    const detailBtn = el.querySelector(".bub-detail");
    detailBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const mn = minions.find((m) => m.userData.sessionKey === sk);
      if (mn) openAgentDrawer(mn.userData.sessionId, sk, mn);
    });
    const abortBtn = el.querySelector(".bub-abort");
    abortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      abortSession(sk);
    });
    const actsEl = el.querySelector(".bub-acts");
    const actsHd = el.querySelector(".bub-acts-hd");
    actsHd.addEventListener("click", (e) => {
      e.stopPropagation();
      actsEl.classList.toggle("collapsed");
    });
    actsEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    const actsBody = el.querySelector(".bub-acts-body");
    actsBody.addEventListener("scroll", () => {
      if (actsBody.scrollTop <= 5 && !el._loadingHistory && el._hasMore !== false) {
        el._loadingHistory = true;
        const oldestTs = actsBody.querySelector(".bact")?.dataset?.timestamp;
        const url = oldestTs ? `/api/messages/${el._sessionId}?before=${encodeURIComponent(oldestTs)}&limit=20` : `/api/messages/${el._sessionId}?limit=20`;
        authFetch(url).then((r) => r.json()).then((data) => {
          if (!data.messages || data.messages.length === 0) {
            el._hasMore = false;
            return;
          }
          const m = minions.find((mn) => mn.userData.sessionId === el._sessionId);
          if (!m) return;
          const scrollH = actsBody.scrollHeight;
          const tempItems = [];
          for (const msg of data.messages) {
            const ts = msg.timestamp;
            if (msg.role === "assistant") {
              if (msg.thinking) tempItems.push(`<div class="bact bact-think" data-full-text="${escAttr(msg.thinking)}" data-timestamp="${ts}"><span>\u{1F4AD}</span><span>${esc(msg.thinking.slice(0, 150))}${ts ? ' <em style="color:#999;font-size:9px">' + fmtTime(ts) + "</em>" : ""}</span></div>`);
              if (msg.toolCalls) for (const tc of msg.toolCalls) tempItems.push(`<div class="bact bact-tool" data-full-text="${escAttr(tc.name + "\n" + tc.args)}" data-timestamp="${ts}"><span>\u{1F527}</span><span>${esc(tc.name)} <em>${esc((tc.args || "").slice(0, 100))}</em>${ts ? ' <em style="color:#999;font-size:9px">' + fmtTime(ts) + "</em>" : ""}</span></div>`);
              if (msg.texts?.length) tempItems.push(`<div class="bact bact-reply" data-full-text="${escAttr(msg.texts.join(" "))}" data-timestamp="${ts}"><span>\u{1F4AC}</span><span>${esc(msg.texts.join(" ").slice(0, 150))}${ts ? ' <em style="color:#999;font-size:9px">' + fmtTime(ts) + "</em>" : ""}</span></div>`);
            } else if (msg.role === "toolResult") tempItems.push(`<div class="bact bact-result" data-full-text="${escAttr((msg.toolName || "?") + " \u2713\n" + (msg.result || ""))}" data-timestamp="${ts}"><span>\u{1F4CB}</span><span>${esc((msg.toolName || "?") + " \u2713")} <em>${esc((msg.result || "").slice(0, 100))}</em>${ts ? ' <em style="color:#999;font-size:9px">' + fmtTime(ts) + "</em>" : ""}</span></div>`);
          }
          if (tempItems.length > 0) {
            const prepend = document.createElement("div");
            prepend.innerHTML = tempItems.join("");
            actsBody.insertBefore(prepend, actsBody.firstChild);
            actsBody.scrollTop = actsBody.scrollHeight - scrollH;
          }
          el._hasMore = data.hasMore;
        }).catch(() => {
        }).finally(() => {
          el._loadingHistory = false;
        });
      }
    });
    const inputEl = el.querySelector(".bub-chat-in");
    let isComposing = false;
    inputEl.addEventListener("compositionstart", () => {
      isComposing = true;
    });
    inputEl.addEventListener("compositionend", () => {
      isComposing = false;
    });
    inputEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !isComposing) {
        e.preventDefault();
        sendDirectChat(sk, inputEl);
      }
      if (e.key === "Escape") {
        hideBubble(sk);
        inputEl.blur();
        inputEl.blur();
      }
    });
    inputEl.addEventListener("focus", () => {
      interactingWithOverlay = true;
    });
    inputEl.addEventListener("blur", () => {
      interactingWithOverlay = false;
    });
    inputEl.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    document.body.appendChild(el);
    bubbles[sessionKey] = el;
    const minion = minions.find((m) => m.userData.sessionKey === sessionKey);
    if (minion) el._sessionId = minion.userData.sessionId;
  }
  return el;
}
function updateBubblePosition(m, time) {
  const el = bubbles[m.userData.sessionKey];
  if (!el || !el.classList.contains("show")) return;
  const pos = new THREE.Vector3(m.position.x, m.position.y + 2.2, m.position.z);
  const sp = pos.clone().project(camera);
  if (sp.z > 1) {
    el.classList.remove("show");
    return;
  }
  const x = (sp.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-sp.y * 0.5 + 0.5) * window.innerHeight;
  el.style.left = x - 30 + "px";
  el.style.top = y - el.offsetHeight - 15 + "px";
}
function updateBubbleContent(m) {
  const el = bubbles[m.userData.sessionKey];
  if (!el) return;
  const ud = m.userData;
  const avatar = el.querySelector(".bub-avatar");
  avatar.textContent = ud.state === "thinking" ? "\u{1F9E0}" : ud.state === "streaming" ? "\u270D\uFE0F" : "\u2705";
  el.querySelector(".bub-user").textContent = ud.userName || ud.sessionLabel || "Session";
  const bubMsgEl = el.querySelector(".bub-msg");
  bubMsgEl.textContent = ud.userMsg || "";
  bubMsgEl.setAttribute("data-full-text", ud.userMsg || "");
  bubMsgEl.style.cursor = ud.userMsg ? "pointer" : "";
  const actsBody = el.querySelector(".bub-acts-body");
  const wasAtBottom = actsBody.scrollHeight - actsBody.scrollTop - actsBody.clientHeight < 30;
  const items = [];
  const log = ud.eventLog || [];
  const hasFinalReply = !!ud.replyText;
  const replySnippetIdxs = [];
  for (let i = 0; i < log.length; i++) {
    if (log[i].type === "reply_snippet") replySnippetIdxs.push(i);
  }
  const hasSnippets = replySnippetIdxs.length > 0;
  const lastSnippetIdx = hasSnippets ? replySnippetIdxs[replySnippetIdxs.length - 1] : -1;
  for (let i = 0; i < log.length; i++) {
    const evt = log[i];
    if (hasSnippets && i === lastSnippetIdx) {
      items.push('<div class="bact-divider"><span>\u2500\u2500 \u56DE\u590D \u2500\u2500</span></div>');
    }
    if (evt.type === "think") {
      items.push(`<div class="bact bact-think" data-full-text="${escAttr(evt.fullText || evt.text)}" data-timestamp="${evt.timestamp || ""}"><span>\u{1F4AD}</span><span>${escFull(evt.text)}${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ""}</span></div>`);
    } else if (evt.type === "tool_use") {
      items.push(`<div class="bact bact-tool" data-full-text="${escAttr((evt.fullText || evt.text) + "\n" + (evt.fullDetail || evt.detail || ""))}" data-timestamp="${evt.timestamp || ""}"><span>\u{1F527}</span><span>${escFull(evt.text)} <em>${escFull(evt.detail || "")}</em>${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ""}</span></div>`);
    } else if (evt.type === "tool_result") {
      items.push(`<div class="bact bact-result" data-full-text="${escAttr((evt.fullText || evt.text) + "\n" + (evt.fullDetail || evt.detail || ""))}" data-timestamp="${evt.timestamp || ""}"><span>\u{1F4CB}</span><span>${escFull(evt.text)} <em>${escFull(evt.detail || "")}</em>${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ""}</span></div>`);
    } else if (evt.type === "reply_snippet") {
      items.push(`<div class="bact bact-reply" data-full-text="${escAttr(evt.fullText || evt.text)}" data-timestamp="${evt.timestamp || ""}"><span>\u{1F4AC}</span><span>${esc(evt.text)}${evt.time ? ` <em style="color:#999;font-size:9px">${esc(evt.time)}</em>` : ""}</span></div>`);
    }
  }
  actsBody.innerHTML = items.slice(-30).join("");
  if (wasAtBottom) {
    actsBody.scrollTop = actsBody.scrollHeight;
  }
  const thinkCount = log.filter((e) => e.type === "think").length;
  const toolCount = log.filter((e) => e.type === "tool_use" || e.type === "tool_result").length;
  el.querySelector(".bub-acts-cnt").textContent = thinkCount + toolCount;
  el.classList.remove("s-think", "s-stream", "s-done", "s-error");
  if (ud.state === "thinking") el.classList.add("s-think");
  else if (ud.state === "streaming") el.classList.add("s-stream");
  else el.classList.add("s-done");
  const abortBtn = el.querySelector(".bub-abort");
  if (abortBtn) abortBtn.style.display = ud.state === "thinking" ? "" : "none";
  const tc = ud._gwThinkCount !== void 0 ? ud._gwThinkCount : log.filter((e) => e.type === "think").length;
  const oc = ud._gwToolCount !== void 0 ? ud._gwToolCount : log.filter((e) => e.type === "tool_use" || e.type === "tool_result").length;
  el.querySelector(".bub-foot").textContent = ud.state === "thinking" ? `\u{1F9E0} \u601D\u8003\u4E2D (${tc}\u6B65, ${oc}\u5DE5\u5177)...` : ud.state === "streaming" ? `\u270D\uFE0F \u6D41\u5F0F\u8F93\u51FA\u4E2D...` : `\u2705 \u601D\u8003\u4E86${tc}\u6B65 \xB7 \u{1F527}${oc}\u5DE5\u5177 \xB7 \u{1F4E4}${ud.replyCount}\u6761`;
  if (fixedPanelSession === m.userData.sessionKey) {
    updateFixedPanelContent(m);
  }
}
function hideBubble(sessionKey) {
  const el = bubbles[sessionKey];
  if (!el) return;
  el.classList.remove("show");
  el.style.pointerEvents = "none";
  el._dismissed = true;
  const inputEl = el.querySelector(".bub-chat-in");
  if (inputEl) inputEl.blur();
  interactingWithOverlay = false;
  stopBubbleRefresh(sessionKey);
}
var fixedPanelSession = null;
var fixedPanelEl = null;
var fpDragging = false;
var fpStartX = 0;
var fpStartY = 0;
var fpOrigLeft = 0;
var fpOrigBottom = 0;
function clampPanelToViewport() {
  if (!fixedPanelEl) return;
  const rect = fixedPanelEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = rect.left, bottom = vh - rect.bottom;
  left = Math.max(-rect.width + 60, Math.min(vw - 60, left));
  bottom = Math.max(4, Math.min(vh - 60, bottom));
  fixedPanelEl.style.left = left + "px";
  fixedPanelEl.style.bottom = bottom + "px";
  fixedPanelEl.style.transform = "none";
}
document.addEventListener("mousemove", (e) => {
  if (!fpDragging || !fixedPanelEl) return;
  const dx = e.clientX - fpStartX;
  const dy = e.clientY - fpStartY;
  fixedPanelEl.style.left = fpOrigLeft + dx + "px";
  fixedPanelEl.style.bottom = fpOrigBottom - dy + "px";
  fixedPanelEl.style.transform = "none";
  clampPanelToViewport();
});
document.addEventListener("mouseup", () => {
  if (fpDragging) {
    fpDragging = false;
    if (fixedPanelEl) fixedPanelEl.style.transition = "";
  }
});
window.addEventListener("blur", () => {
  if (fpDragging) {
    fpDragging = false;
    if (fixedPanelEl) fixedPanelEl.style.transition = "";
  }
});
function toggleFixedPanel(sessionKey) {
  if (fixedPanelSession === sessionKey) closeFixedPanel();
  else {
    if (fixedPanelSession) closeFixedPanel();
    openFixedPanel(sessionKey);
  }
}
function openFixedPanel(sessionKey) {
  fixedPanelSession = sessionKey;
  const bubEl = bubbles[sessionKey];
  if (bubEl) bubEl.classList.remove("show");
  const minion = minions.find((m) => m.userData.sessionKey === sessionKey);
  if (!minion) return;
  if (!fixedPanelEl) {
    fixedPanelEl = document.createElement("div");
    fixedPanelEl.id = "fixed-panel";
    fixedPanelEl.innerHTML = `<div class="fp-hd"><span class="fp-avatar">\u{1F4CC}</span><span class="fp-user"></span><button class="fp-detail" title="\u67E5\u770B\u8BE6\u60C5">\u{1F50D}</button><button class="fp-traj" title="\u67E5\u770B\u5386\u53F2\u8F68\u8FF9">\u{1F4CD}</button><button class="fp-abort" title="\u7EC8\u6B62\u601D\u8003">\u{1F6D1}</button><button class="fp-unpin" title="\u53D6\u6D88\u56FA\u5B9A\u56DE\u6C14\u6CE1">\u{1F4CC}</button><button class="fp-close">\u2715</button></div><div class="fp-body"><div class="fp-msg"></div><div class="fp-acts collapsed"><div class="fp-acts-hd"><span class="fp-acts-tri">\u25B6</span><span class="fp-acts-lbl">\u601D\u8003\u8FC7\u7A0B</span><span class="fp-acts-cnt">0</span></div><div class="fp-acts-body"></div></div><div class="fp-chat"><input class="fp-chat-in" placeholder="\u76F4\u63A5\u5BF9\u8BDD..." /></div><div class="fp-foot"></div></div>`;
    document.body.appendChild(fixedPanelEl);
    fixedPanelEl.querySelector(".fp-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeFixedPanel();
    });
    fixedPanelEl.querySelector(".fp-unpin").addEventListener("click", (e) => {
      e.stopPropagation();
      const sk = fixedPanelSession;
      closeFixedPanel();
      if (sk && bubbles[sk]) {
        bubbles[sk]._dismissed = false;
        const mn = minions.find((m) => m.userData.sessionKey === sk);
        if (mn) showBubble(mn);
      }
    });
    fixedPanelEl.querySelector(".fp-abort").addEventListener("click", (e) => {
      e.stopPropagation();
      if (fixedPanelSession) abortSession(fixedPanelSession);
    });
    fixedPanelEl.querySelector(".fp-traj").addEventListener("click", (e) => {
      e.stopPropagation();
      if (fixedPanelSession) {
        const mn = minions.find((m) => m.userData.sessionKey === fixedPanelSession);
        const name = mn ? mn.userData.userName || mn.userData.sessionLabel || fixedPanelSession : fixedPanelSession;
        openTrajPanel(fixedPanelSession, name);
      }
    });
    fixedPanelEl.querySelector(".fp-detail").addEventListener("click", (e) => {
      e.stopPropagation();
      if (fixedPanelSession) {
        const mn = minions.find((m) => m.userData.sessionKey === fixedPanelSession);
        if (mn) openAgentDrawer(mn.userData.sessionId, fixedPanelSession, mn);
      }
    });
    fixedPanelEl.querySelector(".fp-acts-hd").addEventListener("click", (e) => {
      e.stopPropagation();
      fixedPanelEl.querySelector(".fp-acts").classList.toggle("collapsed");
      setTimeout(clampPanelToViewport, 350);
    });
    const chatIn = fixedPanelEl.querySelector(".fp-chat-in");
    let isComposing = false;
    chatIn.addEventListener("compositionstart", () => {
      isComposing = true;
    });
    chatIn.addEventListener("compositionend", () => {
      isComposing = false;
    });
    chatIn.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !isComposing) {
        e.preventDefault();
        sendDirectChat(fixedPanelSession, chatIn);
      }
      if (e.key === "Escape") closeFixedPanel();
    });
    chatIn.addEventListener("focus", () => {
      interactingWithOverlay = true;
    });
    chatIn.addEventListener("blur", () => {
      interactingWithOverlay = false;
    });
    chatIn.addEventListener("mousedown", (e) => e.stopPropagation());
    fixedPanelEl.addEventListener("mousedown", (e) => e.stopPropagation());
    fixedPanelEl.addEventListener("mouseup", (e) => e.stopPropagation());
    const fpHd = fixedPanelEl.querySelector(".fp-hd");
    fpHd.style.cursor = "move";
    fpHd.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      fpDragging = true;
      fpStartX = e.clientX;
      fpStartY = e.clientY;
      const rect = fixedPanelEl.getBoundingClientRect();
      fpOrigLeft = rect.left;
      fpOrigBottom = window.innerHeight - rect.bottom;
      fixedPanelEl.style.transition = "none";
      e.preventDefault();
      e.stopPropagation();
    });
    fpHd.addEventListener("dblclick", (e) => {
      if (e.target.tagName === "BUTTON") return;
      fixedPanelEl.style.transition = "all 0.3s ease";
      fixedPanelEl.style.left = "50%";
      fixedPanelEl.style.bottom = "12px";
      fixedPanelEl.style.transform = "translateX(-50%)";
    });
  }
  fixedPanelEl.style.display = "";
  fixedPanelEl.style.left = "50%";
  fixedPanelEl.style.bottom = "12px";
  fixedPanelEl.style.transform = "translateX(-50%)";
  updateFixedPanelContent(minion);
  startBubbleRefresh(minion);
}
function closeFixedPanel() {
  if (fixedPanelEl) fixedPanelEl.style.display = "none";
  if (fixedPanelSession) stopBubbleRefresh(fixedPanelSession);
  fixedPanelSession = null;
  interactingWithOverlay = false;
}
function updateFixedPanelContent(minion) {
  if (!fixedPanelEl || fixedPanelSession !== minion.userData.sessionKey) return;
  const ud = minion.userData;
  fixedPanelEl.querySelector(".fp-avatar").textContent = ud.state === "thinking" ? "\u{1F9E0}" : ud.state === "streaming" ? "\u270D\uFE0F" : "\u2705";
  fixedPanelEl.querySelector(".fp-user").textContent = ud.userName || ud.sessionLabel || "Session";
  const fpMsgEl = fixedPanelEl.querySelector(".fp-msg");
  fpMsgEl.textContent = ud.userMsg || "";
  fpMsgEl.setAttribute("data-full-text", ud.userMsg || "");
  fpMsgEl.style.cursor = ud.userMsg ? "pointer" : "";
  const actsBody = fixedPanelEl.querySelector(".fp-acts-body");
  const wasAtBottom = actsBody.scrollHeight - actsBody.scrollTop - actsBody.clientHeight < 30;
  const items = [];
  const log = ud.eventLog || [];
  const hasFinalReply = !!ud.replyText;
  const replySnippetIdxs = [];
  for (let i = 0; i < log.length; i++) {
    if (log[i].type === "reply_snippet") replySnippetIdxs.push(i);
  }
  const hasSnippets = replySnippetIdxs.length > 0;
  const lastSnippetIdx = hasSnippets ? replySnippetIdxs[replySnippetIdxs.length - 1] : -1;
  for (let i = 0; i < log.length; i++) {
    const evt = log[i];
    if (hasSnippets && i === lastSnippetIdx) items.push('<div class="bact-divider"><span>\u2500\u2500 \u56DE\u590D \u2500\u2500</span></div>');
    if (evt.type === "think") items.push(`<div class="bact bact-think" data-full-text="${escAttr(evt.fullText || evt.text)}"><span>\u{1F4AD}</span><span>${esc(evt.text)}${evt.time ? ' <em style="color:#999;font-size:9px">' + esc(evt.time) + "</em>" : ""}</span></div>`);
    else if (evt.type === "tool_use") items.push(`<div class="bact bact-tool" data-full-text="${escAttr((evt.fullText || evt.text) + "\n" + (evt.fullDetail || evt.detail || ""))}"><span>\u{1F527}</span><span>${esc(evt.text)} <em>${esc(evt.detail || "")}</em>${evt.time ? ' <em style="color:#999;font-size:9px">' + esc(evt.time) + "</em>" : ""}</span></div>`);
    else if (evt.type === "tool_result") items.push(`<div class="bact bact-result" data-full-text="${escAttr((evt.fullText || evt.text) + "\n" + (evt.fullDetail || evt.detail || ""))}"><span>\u{1F4CB}</span><span>${esc(evt.text)} <em>${esc(evt.detail || "")}</em>${evt.time ? ' <em style="color:#999;font-size:9px">' + esc(evt.time) + "</em>" : ""}</span></div>`);
    else if (evt.type === "reply_snippet") items.push(`<div class="bact bact-reply" data-full-text="${escAttr(evt.fullText || evt.text)}"><span>\u{1F4AC}</span><span>${esc(evt.text)}${evt.time ? ' <em style="color:#999;font-size:9px">' + esc(evt.time) + "</em>" : ""}</span></div>`);
  }
  actsBody.innerHTML = items.slice(-50).join("");
  if (wasAtBottom) actsBody.scrollTop = actsBody.scrollHeight;
  const tc = ud._gwThinkCount !== void 0 ? ud._gwThinkCount : log.filter((e) => e.type === "think").length;
  const oc = ud._gwToolCount !== void 0 ? ud._gwToolCount : log.filter((e) => e.type === "tool_use" || e.type === "tool_result").length;
  fixedPanelEl.querySelector(".fp-acts-cnt").textContent = tc + oc;
  fixedPanelEl.querySelector(".fp-foot").textContent = ud.state === "thinking" ? `\u{1F9E0} \u601D\u8003\u4E2D (${tc}\u6B65, ${oc}\u5DE5\u5177)...` : ud.state === "streaming" ? "\u270D\uFE0F \u6D41\u5F0F\u8F93\u51FA\u4E2D..." : `\u2705 \u601D\u8003\u4E86${tc}\u6B65 \xB7 \u{1F527}${oc}\u5DE5\u5177 \xB7 \u{1F4E4}${ud.replyCount}\u6761`;
  const fpAbortBtn = fixedPanelEl.querySelector(".fp-abort");
  if (fpAbortBtn) fpAbortBtn.style.display = ud.state === "thinking" ? "" : "none";
}
function showBubble(m) {
  const sk = m.userData.sessionKey;
  if (fixedPanelSession === sk) {
    updateBubbleContent(m);
    return;
  }
  const el = getOrCreateBubble(sk);
  updateBubbleContent(m);
  if (!el._dismissed && m.userData.state === "thinking") {
    el.classList.add("show");
    el.style.pointerEvents = "auto";
  }
  if (m.userData.savedInput) {
    const inputEl = el.querySelector(".bub-chat-in");
    if (inputEl && !inputEl.value) {
      inputEl.value = m.userData.savedInput;
      m.userData.savedInput = "";
    }
  }
  clearNotification(m);
  updateBubblePosition(m, 0);
}
var eventSource = null;
function connectSSE() {
  if (eventSource) eventSource.close();
  const sseUrl = "/api/events";
  eventSource = new EventSource(sseUrl);
  eventSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        initWorld(msg.data);
      } else if (msg.type === "event") {
        handleEvent(msg.data);
      } else if (msg.type === "control") {
        handleControl(msg.data);
      } else if (msg.type === "users") {
        handleUsersUpdate(msg.data);
      } else if (msg.type === "chat") {
        handleChatMessage(msg.data.chat);
      }
    } catch {
    }
  };
  eventSource.onerror = () => {
    setTimeout(connectSSE, 3e3);
  };
}
var bubbleRefreshTimers = {};
var REFRESH_INTERVAL_MS = 1500;
function startBubbleRefresh(minion) {
  const sk = minion.userData.sessionKey;
  if (bubbleRefreshTimers[sk]) return;
  authFetch(`/api/session-state/${minion.userData.sessionId}`).then((r) => r.json()).then((data) => {
    if (!data.eventLog && !data.userMsg) return;
    applySessionState(minion, data);
    updateBubbleContent(minion);
    if (fixedPanelSession === sk) updateFixedPanelContent(minion);
  }).catch(() => {
  });
  bubbleRefreshTimers[sk] = setInterval(() => {
    const el = bubbles[sk];
    if (!el || !el.classList.contains("show") || el._dismissed) {
      stopBubbleRefresh(sk);
      return;
    }
    authFetch(`/api/session-state/${minion.userData.sessionId}`).then((r) => r.json()).then((data) => {
      if (!data.eventLog && !data.userMsg) return;
      applySessionState(minion, data);
      updateBubbleContent(minion);
      if (fixedPanelSession === sk) updateFixedPanelContent(minion);
    }).catch(() => {
    });
  }, REFRESH_INTERVAL_MS);
}
function stopBubbleRefresh(sk) {
  if (bubbleRefreshTimers[sk]) {
    clearInterval(bubbleRefreshTimers[sk]);
    delete bubbleRefreshTimers[sk];
  }
}
setInterval(() => {
  for (const m of minions) {
    const ud = m.userData;
    if (ud.state !== "thinking" || !ud.sessionId) continue;
    if (bubbleRefreshTimers[ud.sessionKey]) continue;
    authFetch(`/api/session-state/${ud.sessionId}`).then((r) => r.json()).then((data) => {
      if (!data.eventLog && !data.userMsg) return;
      const prevState = ud.state;
      applySessionState(m, data);
      if (ud.state !== prevState) {
        updateBubbleContent(m);
        if (fixedPanelSession === ud.sessionKey) updateFixedPanelContent(m);
      }
    }).catch(() => {
    });
  }
}, 1e4);
function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 8);
}
function mkEvt(type, text, detail, ts) {
  const maxText = 150;
  const maxDetail = 100;
  const item = { type };
  item.fullText = text || "";
  item.text = (text || "").slice(0, maxText);
  if (detail) {
    item.fullDetail = detail;
    item.detail = detail.slice(0, maxDetail);
  }
  if (ts) {
    item.time = fmtTime(ts);
    item.timestamp = ts;
  }
  return item;
}
function applySessionState(minion, data) {
  const ud = minion.userData;
  if (data.userMsg) ud.userMsg = data.userMsg;
  if (data.userName) ud.userName = data.userName;
  if (data.eventLog && data.eventLog.length > 0) {
    ud.eventLog = data.eventLog.map((item) => mkEvt(item.type, item.text, item.args || item.result || null, item.ts));
  }
  if (data.state) ud.state = data.state;
  if (data.replyText) ud.replyText = data.replyText;
}
function handleEvent(ev) {
  const m = minions.find((mn) => mn.userData.sessionKey === ev.session);
  if (!m) return;
  const ud = m.userData;
  addLog(ev);
  if (ev.type === "user_msg") {
    ud.userMsg = ev.msg || "";
    ud.userName = ev.userName || "";
    ud.eventLog = [];
    ud.replyText = "";
    ud.replyCount = 0;
    ud.state = "thinking";
    ud.lastEventTime = Date.now();
    const b = bubbles[ud.sessionKey];
    if (b) b._dismissed = false;
    showBubble(m);
    const bubEl = bubbles[ud.sessionKey];
    if (bubEl) {
      const acts = bubEl.querySelector(".bub-acts");
      if (acts) acts.classList.remove("collapsed");
    }
    startBubbleRefresh(m);
    if (fixedPanelSession !== ud.sessionKey) {
      showNotifyBox(ud.sessionKey, ud.userName, ev.msg || "", ud.chineseName || ud.sessionLabel);
    }
  } else if (ev.type === "session_update") {
    if (ev.state) {
      ud.state = ev.state;
      ud.lastEventTime = Date.now();
    }
    if (ev.thinkCount !== void 0) ud._gwThinkCount = ev.thinkCount;
    if (ev.toolCount !== void 0) ud._gwToolCount = ev.toolCount;
    if (ev.lastTool) {
      if (!ud.eventLog) ud.eventLog = [];
      ud.eventLog.push(mkEvt("tool_use", ev.lastTool, "", ev.ts));
    }
    showBubble(m);
    if (ev.state === "thinking") startBubbleRefresh(m);
  } else if (ev.type === "thinking") {
    ud.state = "thinking";
    ud.lastEventTime = Date.now();
    if (!ud.eventLog) ud.eventLog = [];
    ud.eventLog.push(mkEvt("think", ev.thinking || "", null, ev.ts));
    const b = bubbles[ud.sessionKey];
    if (b) b._dismissed = false;
    showBubble(m);
    startBubbleRefresh(m);
  } else if (ev.type === "tool_use") {
    ud.state = "thinking";
    ud.lastEventTime = Date.now();
    if (!ud.eventLog) ud.eventLog = [];
    ud.eventLog.push(mkEvt("tool_use", ev.tool || "?", ev.args || "", ev.ts));
    showBubble(m);
  } else if (ev.type === "tool_result") {
    ud.lastEventTime = Date.now();
    if (!ud.eventLog) ud.eventLog = [];
    ud.eventLog.push(mkEvt("tool_result", (ev.tool || "?") + " \u2713", ev.result || "", ev.ts));
    showBubble(m);
    startBubbleRefresh(m);
  } else if (ev.type === "reply_intermediate") {
    ud.replyText = ev.text || "";
    ud.state = "thinking";
    ud.lastEventTime = Date.now();
    showBubble(m);
  } else if (ev.type === "reply_text") {
    ud.replyText = ev.text || "";
    ud.replyCount++;
    ud.state = "done";
    ud.lastEventTime = Date.now();
    showBubble(m);
    clearNotification(m);
    if (fixedPanelSession !== ud.sessionKey) {
      showNotifyBox(ud.sessionKey, ud.userName, "\u2705 \u5B8C\u6210: " + (ev.text || "").slice(0, 50), ud.chineseName || ud.sessionLabel);
    }
    setTimeout(() => {
      authFetch(`/api/session-state/${m.userData.sessionId}`).then((r) => r.json()).then((data) => {
        if (data.eventLog || data.userMsg) {
          applySessionState(m, data);
          updateBubbleContent(m);
        }
      }).catch(() => {
      });
    }, 2e3);
    setTimeout(() => stopBubbleRefresh(ud.sessionKey), 5e3);
    setTimeout(() => {
      if (Date.now() - ud.lastEventTime > 29500) {
        const b2 = bubbles[ud.sessionKey];
        if (b2 && b2.classList.contains("show")) {
          const inputEl = b2.querySelector(".bub-chat-in");
          if (inputEl && inputEl.value) ud.savedInput = inputEl.value;
          if (document.activeElement === inputEl && inputEl.value.trim()) return;
          hideBubble(ud.sessionKey);
          ud.state = "idle";
        }
      }
    }, 3e4);
  }
}
function addLog(ev) {
  const el = document.getElementById("b-logs");
  if (!el) return;
  const cls = `t_${ev.type}`;
  const icon = { user_msg: "\u{1F464}", thinking: "\u{1F4AD}", tool_use: "\u{1F527}", tool_result: "\u{1F4CB}", reply_text: "\u{1F4AC}", reply_intermediate: "\u{1F4AC}" }[ev.type] || "\u{1F4E1}";
  const text = ev.msg || ev.thinking || ev.text || ev.tool || "";
  const div = document.createElement("div");
  div.className = `log ${cls}`;
  div.textContent = `${icon} ${text.slice(0, 120)}`;
  el.appendChild(div);
  if (el.children.length > 80) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function handleControl(data) {
  const m = minions.find((mn) => mn.userData.sessionKey === data.sessionKey);
  if (!m && data.action !== "batch") {
    console.warn("Control: minion not found", data.sessionKey);
    return;
  }
  const ud = m?.userData;
  switch (data.action) {
    case "move": {
      if (!m) break;
      let tx = data.x, tz = data.z;
      if (ud.bounds) {
        tx = Math.max(ud.bounds.minX, Math.min(ud.bounds.maxX, tx));
        tz = Math.max(ud.bounds.minZ, Math.min(ud.bounds.maxZ, tz));
      }
      ud.targetX = tx;
      ud.targetZ = tz;
      ud.idleAction = "walk";
      ud.idleTimer = 10;
      if (data.speed) ud._mcpSpeed = data.speed;
      break;
    }
    case "move_to_minion": {
      if (!m) break;
      const target = minions.find((mn) => mn.userData.sessionKey === data.targetKey);
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
      ud.idleAction = "walk";
      ud.idleTimer = 10;
      break;
    }
    case "teleport": {
      if (!m) break;
      let tx = data.x, tz = data.z;
      if (ud.bounds) {
        tx = Math.max(ud.bounds.minX, Math.min(ud.bounds.maxX, tx));
        tz = Math.max(ud.bounds.minZ, Math.min(ud.bounds.maxZ, tz));
      }
      m.position.set(tx, 0.5, tz);
      ud.targetX = tx;
      ud.targetZ = tz;
      m.scale.set(1.3, 1.3, 1.3);
      setTimeout(() => {
        m.scale.set(1, 1, 1);
      }, 300);
      break;
    }
    case "animate": {
      if (!m) break;
      triggerAnimation(m, data.animation, data.duration || 2);
      break;
    }
    case "say": {
      if (!m) break;
      showMcpBubble(m, data.text, data.duration || 5, data.sender || "\u{1F916} MCP");
      break;
    }
  }
}
var activeAnimations = {};
var ringGeo = null;
var ringColors = {
  jump: 2282478,
  // cyan
  wave: 10980346,
  // purple
  dance: 16020150,
  // pink
  spin: 16498468,
  // amber
  nod: 6333946,
  // blue
  shake: 15680580,
  // red
  bow: 3462041,
  // green
  clap: 16096779,
  // orange
  think: 8490232,
  // indigo
  celebrate: 16007006
  // rose
};
function triggerAnimation(minion, animType, duration) {
  const sk = minion.userData.sessionKey;
  if (activeAnimations[sk]) {
    clearTimeout(activeAnimations[sk].timer);
    if (activeAnimations[sk].ring) scene.remove(activeAnimations[sk].ring);
  }
  if (!ringGeo) ringGeo = new THREE.RingGeometry(0.6, 0.9, 32);
  const ringColor = ringColors[animType] || 2282478;
  const ringMat = new THREE.MeshBasicMaterial({
    color: ringColor,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(minion.position.x, 0.02, minion.position.z);
  scene.add(ring);
  const endTime = Date.now() + duration * 1e3;
  activeAnimations[sk] = { type: animType, endTime, duration, timer: null, ring };
  activeAnimations[sk].timer = setTimeout(() => {
    if (activeAnimations[sk]?.ring) scene.remove(activeAnimations[sk].ring);
    delete activeAnimations[sk];
    minion.scale.set(1, 1, 1);
    minion.rotation.x = 0;
    minion.children.forEach((c) => {
      if (c.userData?.isArm || c.geometry?.type === "SphereGeometry") {
        c.rotation.x = 0;
        c.rotation.z = 0;
      }
    });
  }, duration * 1e3);
}
var mcpBubbles = {};
function showMcpBubble(minion, text, duration, sender) {
  const sk = minion.userData.sessionKey;
  if (mcpBubbles[sk]) {
    mcpBubbles[sk].remove();
    delete mcpBubbles[sk];
  }
  const el = document.createElement("div");
  el.className = "mcp-bubble";
  el.innerHTML = `<div class="mcp-bub-hd">${esc(sender)}</div><div class="mcp-bub-text">${esc(text)}</div>`;
  el.addEventListener("mousedown", (e) => e.stopPropagation());
  el.addEventListener("click", (e) => e.stopPropagation());
  document.body.appendChild(el);
  mcpBubbles[sk] = el;
  function updatePos() {
    if (!mcpBubbles[sk]) return;
    const pos = new THREE.Vector3(minion.position.x, minion.position.y + 3.2, minion.position.z);
    const sp = pos.clone().project(camera);
    if (sp.z > 1) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    const x = (sp.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-sp.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = x - 40 + "px";
    el.style.top = y - el.offsetHeight - 10 + "px";
  }
  el._updatePos = updatePos;
  updatePos();
  setTimeout(() => {
    if (mcpBubbles[sk] === el) {
      el.style.opacity = "0";
      el.style.transform = "translateY(-10px) scale(0.9)";
      setTimeout(() => {
        el.remove();
        delete mcpBubbles[sk];
      }, 300);
    }
  }, duration * 1e3);
}
var lastPosReport = 0;
function reportPositions() {
  const now = Date.now();
  if (now - lastPosReport < 2e3) return;
  lastPosReport = now;
  const positions = {};
  for (const m of minions) {
    const ud = m.userData;
    if (!ud.sessionKey) continue;
    positions[ud.sessionKey] = {
      x: m.position.x,
      y: m.position.y,
      z: m.position.z,
      state: ud.state,
      bounds: ud.bounds
    };
  }
  authFetch("/api/minions/positions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positions })
  }).catch(() => {
  });
}
var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
window.addEventListener("mousemove", (e) => {
  if (!isDraggingMinion || !longPressTarget) return;
  const mouse = new THREE.Vector2(
    e.clientX / window.innerWidth * 2 - 1,
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
window.addEventListener("mouseup", () => {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  if (isDraggingMinion && longPressTarget) {
    longPressTarget.userData.isDragging = false;
    longPressTarget.userData.velocityY = 0;
    longPressTarget.userData.isGrounded = false;
    isDraggingMinion = false;
    longPressTarget = null;
    renderer.domElement.style.cursor = "";
  }
});
window.addEventListener("mousemove", (e) => {
  if (longPressTimer && !isDraggingMinion && !isDragging) {
    const dx = e.clientX - pressStartPos.x;
    const dy = e.clientY - pressStartPos.y;
    if (dx * dx + dy * dy > 25) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressTarget = null;
    }
  }
});
window.addEventListener("mousemove", (e) => {
  const now = Date.now();
  if (now - lastHoverCheck < HOVER_THROTTLE) return;
  lastHoverCheck = now;
  if (isDragging || isDraggingMinion) {
    if (hoveredMinion) {
      clearHover();
    }
    return;
  }
  const mouse = new THREE.Vector2(
    e.clientX / window.innerWidth * 2 - 1,
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
window.addEventListener("click", (e) => {
  if (isDragging || dragStarted || isDraggingMinion) return;
  if (isBubbleEvent(e)) return;
  const mouse = new THREE.Vector2(
    e.clientX / window.innerWidth * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(clickables, true);
  if (hits.length > 0) {
    let target = hits[0].object;
    while (target.parent && !target.userData.sessionKey) target = target.parent;
    if (target.userData.sessionKey) {
      const b = bubbles[target.userData.sessionKey];
      if (b && b.classList.contains("show")) {
        hideBubble(target.userData.sessionKey);
      } else {
        authFetch(`/api/session-state/${target.userData.sessionId}`).then((r) => r.json()).then((data) => {
          if (data.eventLog || data.userMsg) {
            applySessionState(target, data);
          }
          const b2 = getOrCreateBubble(target.userData.sessionKey);
          b2._dismissed = false;
          b2.classList.add("show");
          b2.style.pointerEvents = "auto";
          updateBubbleContent(target);
          interactingWithOverlay = false;
        }).catch(() => {
          const b2 = getOrCreateBubble(target.userData.sessionKey);
          b2._dismissed = false;
          b2.classList.add("show");
          b2.style.pointerEvents = "auto";
          updateBubbleContent(target);
        });
      }
    }
  }
});
function updateMinionExpressions() {
  for (const m of minions) {
    const ud = m.userData;
    m.children.forEach((child) => {
      if (child.material === mat.pupil) {
        switch (ud.state) {
          case "thinking":
            child.scale.set(1.2, 1.2, 1.2);
            child.position.y += 0;
            child.userData._baseY = child.userData._baseY || child.position.y;
            child.position.y = child.userData._baseY + 0.01;
            break;
          case "done":
            child.scale.set(1, 0.9, 1);
            child.userData._baseY = child.userData._baseY || child.position.y;
            child.position.y = child.userData._baseY;
            break;
          case "streaming":
            child.scale.set(1.15, 1.15, 1.15);
            child.userData._baseY = child.userData._baseY || child.position.y;
            child.position.y = child.userData._baseY + 5e-3;
            break;
          default:
            child.scale.set(1, 1, 1);
            child.userData._baseY = child.userData._baseY || child.position.y;
            child.position.y = child.userData._baseY;
            break;
        }
      }
    });
  }
}
function checkMinionGreetings(dt) {
  for (let i = 0; i < minions.length; i++) {
    const a = minions[i];
    if (a.userData.isSitting || a.userData.isSleeping || a.userData.isDragging || a.userData.isGreeting) continue;
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
        a.userData.isGreeting = true;
        a.userData.greetingTimer = 1 + getMinionRng(a.userData.sessionKey)();
        a.rotation.y = Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z);
        break;
      }
    }
  }
}
function showHover(minion, cx, cy) {
  hoveredMinion = minion;
  renderer.domElement.style.cursor = "pointer";
  minion.scale.set(1.05, 1.05, 1.05);
  const ud = minion.userData;
  const parsed = parseSessionKey(ud.sessionKey);
  const stateLabel = ud.state === "thinking" ? "\u{1F4AD} \u601D\u8003\u4E2D" : ud.state === "streaming" ? "\u270D\uFE0F \u8F93\u51FA\u4E2D" : ud.state === "done" ? "\u2705 \u5B8C\u6210" : "\u{1F4A4} \u7A7A\u95F2";
  hoverTooltip.innerHTML = `<div class="tt-name">${ud.chineseName || "\u5C0F\u9EC4\u4EBA"}</div><div class="tt-type">${parsed.icon} ${ud.sessionLabel || parsed.label}</div><div class="tt-state">${stateLabel}</div>`;
  hoverTooltip.classList.remove("hidden");
  updateHoverPosition(cx, cy);
}
function clearHover() {
  if (hoveredMinion) {
    hoveredMinion.scale.set(1, 1, 1);
    hoveredMinion = null;
  }
  renderer.domElement.style.cursor = "";
  hoverTooltip.classList.add("hidden");
}
function updateHoverPosition(cx, cy) {
  hoverTooltip.style.left = cx + 14 + "px";
  hoverTooltip.style.top = cy - 10 + "px";
}
function animate() {
  requestAnimationFrame(animate);
  try {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.getElapsedTime();
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const speed = moveSpeed * dt;
    if (keys.w) walkPos.addScaledVector(forward, speed);
    if (keys.s) walkPos.addScaledVector(forward, -speed);
    if (keys.a) walkPos.addScaledVector(right, -speed);
    if (keys.d) walkPos.addScaledVector(right, speed);
    if (keys.space) walkPos.y += speed;
    if (keys.shift) walkPos.y -= speed;
    if (thirdPerson && selfAvatar) {
      selfAvatar.position.set(walkPos.x, 0, walkPos.z);
      selfAvatar.rotation.y = yaw;
      selfAvatar.visible = true;
      const dist = 5;
      const camX = walkPos.x - Math.sin(yaw) * dist * Math.cos(pitch);
      const camY = walkPos.y + Math.sin(-pitch) * dist * 0.3;
      const camZ = walkPos.z - Math.cos(yaw) * dist * Math.cos(pitch);
      camera.position.set(camX, camY, camZ);
      const lookDirX = Math.sin(yaw);
      const lookDirY = Math.sin(pitch);
      selfAvatar.children.forEach((c) => {
        if (c.userData?._isPupil) {
          const side = c.position.x > 0 ? 1 : -1;
          c.position.x = side * 0.08 + lookDirX * 0.015;
          c.position.y = 0.78 + lookDirY * 0.015;
          c.position.z = 0.2 + Math.cos(yaw) * 0.015;
        }
      });
    } else {
      if (selfAvatar) selfAvatar.visible = false;
      camera.position.copy(walkPos);
    }
    const lookTarget = camera.position.clone().add(new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ));
    camera.lookAt(lookTarget);
    const STALE_THRESHOLD = 3 * 60 * 1e3;
    const staleNow = Date.now();
    for (const m of minions) {
      const ud = m.userData;
      if (ud.state === "thinking" && ud.lastEventTime && staleNow - ud.lastEventTime > STALE_THRESHOLD) {
        ud.state = "done";
        if (!ud.eventLog) ud.eventLog = [];
        ud.eventLog.push(mkEvt("think", "\u23F3 \u4F1A\u8BDD\u53EF\u80FD\u5DF2\u4E2D\u65AD\uFF08\u65E0\u65B0\u6D3B\u52A8\u8D85\u8FC73\u5206\u949F\uFF09", null, (/* @__PURE__ */ new Date()).toISOString()));
        updateBubbleContent(m);
        if (fixedPanelSession === ud.sessionKey) updateFixedPanelContent(m);
      }
    }
    minions.forEach((m) => {
      const ud = m.userData;
      if (ud.isSitting) {
        ud.sitTimer -= dt;
        if (ud.sitTimer <= 0) {
          ud.isSitting = false;
          ud.sitTarget = null;
          ud.idleTimer = 0;
        }
      }
      if (ud.isSleeping && sun.intensity > 0.6) {
        ud.isSleeping = false;
        ud.idleTimer = 0;
      }
      ud.idleTimer -= dt;
      if (ud.idleTimer <= 0 && !ud.isSitting && !ud.isSleeping) {
        const rng = getMinionRng(ud.sessionKey);
        if (rng() < 0.3 && ud.continentIdx >= 0) {
          const chairTargets = [
            [ud.continentHx - 1.5 - 1.1, ud.continentHz + 1],
            [ud.continentHx - 1.5 + 1.1, ud.continentHz + 1],
            [ud.continentCx - 5, ud.continentCz + 1]
          ];
          const pick = chairTargets[Math.floor(rng() * chairTargets.length)];
          ud.targetX = pick[0];
          ud.targetZ = pick[1];
          ud.idleAction = "walk";
          ud.idleTimer = 8;
          ud.sitTarget = { x: pick[0], z: pick[1] };
          return;
        }
        const isNight = gameTime > 80 / 120 * 120 || gameTime < 10 / 120 * 120;
        if (isNight && rng() < 0.4 && ud.continentIdx >= 0) {
          ud.targetX = ud.continentHx + 1.5;
          ud.targetZ = ud.continentHz - 0.8;
          ud.idleAction = "walk";
          ud.idleTimer = 10;
          ud.isSleeping = true;
          return;
        }
        const roll = rng();
        if (roll < 0.4 && ud.bounds) {
          const cx2 = (ud.bounds.minX + ud.bounds.maxX) / 2;
          const cz2 = (ud.bounds.minZ + ud.bounds.maxZ) / 2;
          const targets = [
            [cx2 - 3, cz2 + 2],
            [cx2 + 4, cz2 + 4],
            [cx2 - 5, cz2 + 1],
            [ud.bounds.minX + 2, ud.bounds.minZ + 2],
            [ud.bounds.maxX - 2, ud.bounds.minZ + 2],
            [cx2 + 5, cz2 - 2],
            [cx2 - 2, cz2 + 5],
            [cx2 + 3, cz2 + 6],
            [ud.bounds.maxX - 2, cz2 + 3],
            [cx2, ud.bounds.minZ + 2],
            [ud.bounds.minX + 3, cz2]
          ];
          const pick = targets[Math.floor(rng() * targets.length)];
          ud.targetX = pick[0] + (rng() - 0.5) * 3.5;
          ud.targetZ = pick[1] + (rng() - 0.5) * 3.5;
          ud.idleAction = "walk";
          ud.idleTimer = 4 + rng() * 6;
        } else if (roll < 0.75 && ud.bounds) {
          const wanderR = 3 + rng() * 5;
          const wanderAngle = rng() * Math.PI * 2;
          ud.targetX = m.position.x + Math.cos(wanderAngle) * wanderR;
          ud.targetZ = m.position.z + Math.sin(wanderAngle) * wanderR;
          ud.idleAction = "walk";
          ud.idleTimer = 2 + rng() * 5;
        } else {
          ud.idleAction = "stand";
          ud.idleTimer = 2 + rng() * 4;
        }
        if (ud.bounds) {
          ud.targetX = Math.max(ud.bounds.minX + 1.2, Math.min(ud.bounds.maxX - 1.2, ud.targetX));
          ud.targetZ = Math.max(ud.bounds.minZ + 1.2, Math.min(ud.bounds.maxZ - 1.2, ud.targetZ));
        }
      }
      if (ud.sitTarget && !ud.isSitting && ud.idleAction === "walk") {
        const sdx = ud.sitTarget.x - m.position.x;
        const sdz = ud.sitTarget.z - m.position.z;
        if (Math.sqrt(sdx * sdx + sdz * sdz) < 0.5) {
          ud.isSitting = true;
          ud.sitTimer = 5 + getMinionRng(ud.sessionKey)() * 5;
          ud.idleAction = "stand";
        }
      }
      if (ud.isSleeping && ud.idleAction === "walk") {
        const bdx = ud.continentHx + 1.5 - m.position.x;
        const bdz = ud.continentHz - 0.8 - m.position.z;
        if (Math.sqrt(bdx * bdx + bdz * bdz) < 0.5) {
          ud.idleAction = "stand";
        }
      }
      if (ud.bounds) {
        const dx = ud.targetX - m.position.x, dz = ud.targetZ - m.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        let sepX = 0, sepZ = 0;
        const SEP_RADIUS = 1.2;
        const SEP_FORCE = 1.4;
        for (const other of minions) {
          if (other === m) continue;
          const ox = m.position.x - other.position.x;
          const oz = m.position.z - other.position.z;
          const d2 = ox * ox + oz * oz;
          if (d2 < SEP_RADIUS * SEP_RADIUS && d2 > 1e-4) {
            const d = Math.sqrt(d2);
            const strength = (SEP_RADIUS - d) / SEP_RADIUS;
            sepX += ox / d * strength * SEP_FORCE;
            sepZ += oz / d * strength * SEP_FORCE;
          }
        }
        if (dist > 0.12) {
          const baseSpd = 0.8;
          const spd = (ud._mcpSpeed || baseSpd) * dt;
          delete ud._mcpSpeed;
          let moveX = dx / dist * spd + sepX * dt;
          let moveZ = dz / dist * spd + sepZ * dt;
          const stepLen = Math.sqrt(moveX * moveX + moveZ * moveZ);
          const maxStep = baseSpd * 2 * dt;
          if (stepLen > maxStep) {
            moveX = moveX / stepLen * maxStep;
            moveZ = moveZ / stepLen * maxStep;
          }
          const nx = m.position.x + moveX;
          const nz = m.position.z + moveZ;
          if (!collidesWithObstacles(nx, nz)) {
            m.position.x = nx;
            m.position.z = nz;
          } else if (!collidesWithObstacles(nx, m.position.z)) {
            m.position.x = nx;
          } else if (!collidesWithObstacles(m.position.x, nz)) {
            m.position.z = nz;
          } else {
            if (!ud._stuckTimer) ud._stuckTimer = 0;
            ud._stuckTimer += dt;
            if (ud._stuckTimer > 1.2) {
              ud.idleTimer = 0;
              ud._stuckTimer = 0;
            }
          }
          if (dist > 0.3) m.rotation.y = Math.atan2(dx, dz);
        } else if (sepX !== 0 || sepZ !== 0) {
          const nx = m.position.x + sepX * dt * 0.6;
          const nz = m.position.z + sepZ * dt * 0.6;
          if (!collidesWithObstacles(nx, nz)) {
            m.position.x = nx;
            m.position.z = nz;
          }
        }
        m.position.x = Math.max(ud.bounds.minX + 0.4, Math.min(ud.bounds.maxX - 0.4, m.position.x));
        m.position.z = Math.max(ud.bounds.minZ + 0.4, Math.min(ud.bounds.maxZ - 0.4, m.position.z));
      }
      let yOff = 0;
      let extraRotY = 0;
      let extraRotX = 0;
      let pulseScale = 1;
      const anim = activeAnimations[ud.sessionKey];
      if (anim && Date.now() < anim.endTime) {
        const remaining = (anim.endTime - Date.now()) / 1e3;
        const progress = 1 - remaining / anim.duration;
        switch (anim.type) {
          case "jump":
            yOff += Math.abs(Math.sin(time * 6)) * 0.6;
            pulseScale = 1 + Math.sin(time * 8) * 0.08;
            break;
          case "dance":
            extraRotY = Math.sin(time * 5) * 0.4;
            extraRotX = Math.sin(time * 7) * 0.1;
            yOff += Math.abs(Math.sin(time * 4)) * 0.3;
            pulseScale = 1 + Math.sin(time * 6) * 0.05;
            break;
          case "spin":
            extraRotY = dt * 12;
            yOff += 0.15;
            pulseScale = 1 + Math.sin(time * 10) * 0.06;
            break;
          case "nod":
            m.children.forEach((c) => {
              if (c.geometry?.type === "SphereGeometry") {
                c.rotation.x = Math.sin(time * 6) * 0.4;
              }
            });
            yOff += Math.abs(Math.sin(time * 3)) * 0.1;
            break;
          case "shake":
            m.position.x += Math.sin(time * 20) * 0.08;
            m.position.z += Math.cos(time * 20) * 0.04;
            pulseScale = 1 + Math.sin(time * 15) * 0.04;
            break;
          case "bow":
            const bowAngle = Math.sin(Math.min(1, progress * 2) * Math.PI) * 0.5;
            extraRotX = bowAngle;
            yOff -= Math.abs(bowAngle) * 0.3;
            break;
          case "clap":
            m.children.forEach((c) => {
              if (c.userData?.isArm) {
                c.rotation.x = -1 + Math.sin(time * 12) * 0.5;
                c.rotation.z = c.userData.side * (0.5 + Math.sin(time * 12) * 0.3);
              }
            });
            yOff += Math.abs(Math.sin(time * 4)) * 0.15;
            break;
          case "celebrate":
            yOff += Math.abs(Math.sin(time * 5)) * 0.55;
            extraRotY = Math.sin(time * 4) * 0.3;
            pulseScale = 1 + Math.sin(time * 8) * 0.1;
            break;
          case "wave":
            m.children.forEach((c) => {
              if (c.userData?.isArm && c.userData.side > 0) {
                c.rotation.x = Math.sin(time * 8) * 0.6 - 0.9;
              }
            });
            yOff += 0.08;
            break;
          case "think":
            extraRotY = Math.sin(time * 1.5) * 0.15;
            m.children.forEach((c) => {
              if (c.geometry?.type === "SphereGeometry") {
                c.rotation.z = 0.2;
              }
            });
            yOff += Math.sin(time * 2) * 0.05;
            break;
        }
        if (anim.ring) {
          anim.ring.position.set(m.position.x, 0.02, m.position.z);
          anim.ring.material.opacity = 0.4 + Math.sin(time * 8) * 0.2;
          anim.ring.rotation.z = time * 2;
          const ringScale = 1 + Math.sin(time * 6) * 0.2;
          anim.ring.scale.set(ringScale, ringScale, 1);
        }
        m.scale.set(pulseScale, pulseScale, pulseScale);
      } else {
        m.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
      }
      m.rotation.y += extraRotY;
      m.rotation.x = extraRotX;
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
      if (ud.isGrounded && !ud.isDragging) {
        m.position.y += yOff;
      }
      if (ud.isDragging) {
        const dx = ud.dragTargetX - m.position.x;
        const dz = ud.dragTargetZ - m.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.05) {
          m.position.x += dx / dist * Math.min(dist, 8 * dt);
          m.position.z += dz / dist * Math.min(dist, 8 * dt);
        }
        m.position.y = Math.max(m.position.y, 0.3);
        ud.isGrounded = false;
      }
      const isMoving = ud.idleAction === "walk" && !ud.isSitting && !ud.isSleeping;
      const dxWalk = ud.targetX - m.position.x;
      const dzWalk = ud.targetZ - m.position.z;
      const distToTarget = Math.sqrt(dxWalk * dxWalk + dzWalk * dzWalk);
      if (isMoving && distToTarget > 0.2 && ud.isGrounded && !ud.isDragging && !anim) {
        const walkSpeed = Math.min(1, (ud._mcpSpeed || 0.8) * 3);
        const legSwing = Math.sin(time * 8) * 0.26 * walkSpeed;
        const armSwingAnim = Math.sin(time * 8) * 0.17 * walkSpeed;
        m.children.forEach((c) => {
          if (c.geometry?.type === "CylinderGeometry") {
            const r = c.geometry.parameters;
            if (r && r.radiusTop === 0.065 && r.radiusBottom === 0.055) {
              const side = c.position.x > 0 ? 1 : -1;
              c.rotation.x = legSwing * side;
            }
          }
          if (c.userData?.isArm && (!anim || anim.type !== "wave" && anim.type !== "clap")) {
            c.rotation.x = armSwingAnim * -c.userData.side;
          }
        });
      } else if (!anim && !ud.isSitting && !ud.isSleeping) {
        m.children.forEach((c) => {
          if (c.userData?.isArm) {
            c.rotation.x = Math.sin(time * 2 + ud.bobPhase + (c.userData.side > 0 ? 0 : Math.PI)) * 0.15;
            c.rotation.z = 0;
          }
          if (c.geometry?.type === "CylinderGeometry") {
            const r = c.geometry.parameters;
            if (r && r.radiusTop === 0.065 && r.radiusBottom === 0.055) {
              c.rotation.x = 0;
            }
          }
        });
      }
      if (ud.isSitting && !anim) {
        m.rotation.x = -0.15;
        m.children.forEach((c) => {
          if (c.geometry?.type === "CylinderGeometry") {
            const r = c.geometry.parameters;
            if (r && r.radiusTop === 0.065 && r.radiusBottom === 0.055) {
              c.rotation.x = 0.6;
            }
          }
        });
      }
      if (ud.isSleeping && ud.idleAction !== "walk" && !anim) {
        m.rotation.x = 0.3;
        m.rotation.z = 0.15;
        m.children.forEach((c) => {
          if (c.material === mat.pupil) c.scale.set(1, 0.15, 1);
        });
      }
      if (ud.notificationSprite) {
        ud.notificationSprite.position.y = 2.5 * (ud.heightScale || 1) * 0.5 + 1.8 + Math.sin(time * 3 + ud.bobPhase) * 0.1;
      }
      const mcpBub = mcpBubbles[ud.sessionKey];
      if (mcpBub && mcpBub._updatePos) mcpBub._updatePos();
      updateThinkingIndicator(m, time);
      updateMiniBubble(m, time);
      updateBubblePosition(m, time);
    });
    interpolateAvatars();
    reportPositions();
    if (Date.now() - lastUserPosReport > 50) {
      lastUserPosReport = Date.now();
      reportMyPosition();
    }
    if (followMinion) {
      const targetPos = new THREE.Vector3(
        followMinion.position.x + FOLLOW_OFFSET.x,
        followMinion.position.y + FOLLOW_OFFSET.y,
        followMinion.position.z + FOLLOW_OFFSET.z
      );
      camera.position.lerp(targetPos, 0.05);
      const lookAt = new THREE.Vector3(followMinion.position.x, followMinion.position.y + 1, followMinion.position.z);
      camera.lookAt(lookAt);
      const dir = new THREE.Vector3().subVectors(lookAt, camera.position).normalize();
      yaw = Math.atan2(dir.x, dir.z);
      pitch = Math.asin(dir.y);
      if (!followMinion.userData._hasPin) {
        followMinion.userData._hasPin = true;
        const parsed = parseSessionKey(followMinion.userData.sessionKey);
        const labelLine = `\u{1F4CC} ${parsed.icon} ${followMinion.userData.sessionLabel || parsed.label}`;
        addNameLabel(followMinion, labelLine, followMinion.userData.chineseName);
      }
    } else if (minions.some((m) => m.userData._hasPin)) {
      for (const m of minions) {
        if (m.userData._hasPin) {
          m.userData._hasPin = false;
          const parsed = parseSessionKey(m.userData.sessionKey);
          const labelLine = `${parsed.icon} ${m.userData.sessionLabel || parsed.label}`;
          addNameLabel(m, labelLine, m.userData.chineseName);
        }
      }
    }
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
    updateSpawnEffects(dt);
    if (season === "winter") updateSnow(dt, time);
    fpsFrames++;
    const now = performance.now();
    if (now - fpsLastTime >= 500) {
      fpsValue = Math.round(fpsFrames / ((now - fpsLastTime) / 1e3));
      fpsFrames = 0;
      fpsLastTime = now;
      const fpsEl = document.getElementById("fps-badge");
      if (fpsEl) fpsEl.textContent = fpsValue + " FPS";
    }
    updateMinionExpressions();
    updatePetals(dt, time);
    updateFireflies(dt, time);
    updateDayNightCycle(dt);
    drawMinimap();
    if (Math.floor(time * 0.5) !== Math.floor((time - dt) * 0.5)) {
      updateAgentDashboard();
    }
    updateMinionInteraction(dt);
    checkMinionGreetings(dt);
    updateRain(dt);
    updateSaveStateTimer(dt);
    maybeSaveServerState(dt);
    updateGrassWithLOD(time);
    if (mat.water.map) {
      mat.water.map.offset.x += 2e-4;
      mat.water.map.offset.y += 1e-4;
    }
    if (window._waterMeshes) {
      for (const w of window._waterMeshes) {
        if (w.material.uniforms?.uTime) w.material.uniforms.uTime.value = time;
      }
    }
    scene.traverse((obj) => {
      if (obj.userData?._fish) {
        const ud = obj.userData;
        ud.angle += ud.speed * dt;
        obj.position.x = ud.baseX + Math.cos(ud.angle) * ud.radius;
        obj.position.z = ud.baseZ + Math.sin(ud.angle) * ud.radius;
        obj.rotation.y = ud.angle + Math.PI / 2;
      }
    });
    scene.traverse((obj) => {
      if (obj.material?.uniforms?.uTime && obj.material !== grassInstances[0]?.mat && !window._waterMeshes?.includes(obj)) {
        obj.material.uniforms.uTime.value = time;
      }
    });
    const dayT = gameTime % DAY_CYCLE / DAY_CYCLE;
    const isDayTime = dayT >= 0.18 && dayT < 0.65;
    if (isDayTime && (season === "autumn" || season === "winter")) {
      const seasonTint = season === "autumn" ? new THREE.Color(13935988) : season === "winter" ? new THREE.Color(13162728) : null;
      if (seasonTint) {
        scene.background.lerp(seasonTint, 0.15);
        scene.fog.color.lerp(seasonTint, 0.15);
      }
    }
    renderer.render(scene, camera);
  } catch (err) {
    console.error("Animate error:", err.message, err.stack?.split("\n")[1]);
    try {
      renderer.render(scene, camera);
    } catch (e2) {
      console.error("Render error:", e2.message);
    }
  }
}
function filterSessions(query) {
  const sessEl = document.getElementById("b-sessions");
  if (!sessEl) return;
  if (!query) {
    sessEl.querySelectorAll(".sess-row").forEach((r) => r.style.display = "");
    return;
  }
  sessEl.querySelectorAll(".sess-row").forEach((r) => {
    const searchText = (r.dataset.searchText || "").toLowerCase();
    r.style.display = searchText.includes(query) ? "" : "none";
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
window.runCmd = function() {
  const inp = document.getElementById("cmd-in");
  const out = document.getElementById("cmd-out");
  const cmd = inp.value.trim();
  if (!cmd) return;
  out.style.display = "block";
  out.textContent = "Running...";
  authFetch("/api/cli", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd })
  }).then((r) => r.json()).then((d) => {
    out.textContent = d.output || d.error || "No output";
  }).catch((e) => {
    out.textContent = "Error: " + e.message;
  });
};
window.abortSession = function(sessionKey) {
  const minion = minions.find((m) => m.userData.sessionKey === sessionKey);
  if (!minion) return;
  const sessionId = minion.userData.sessionId;
  const ud = minion.userData;
  if (ud.state !== "thinking") return;
  authFetch(`/api/sessions/${sessionId}/abort`, { method: "POST" }).then((r) => r.json()).then((result) => {
    if (result.ok) {
      ud.state = "done";
      if (!ud.eventLog) ud.eventLog = [];
      ud.eventLog.push({ type: "think", text: "\u{1F6D1} \u7528\u6237\u624B\u52A8\u7EC8\u6B62\u4E86\u601D\u8003" });
      updateBubbleContent(minion);
    }
  }).catch((e) => console.error("Abort error:", e));
};
window.sendDirectChat = function(sessionKey, inputEl) {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";
  const minion = minions.find((m) => m.userData.sessionKey === sessionKey);
  if (!minion) return;
  const sessionId = minion.userData.sessionId;
  const ud = minion.userData;
  ud.userMsg = text;
  ud.userName = "\u{1F5A5}\uFE0F Monitor";
  ud.eventLog = [];
  ud.replyText = "";
  ud.state = "thinking";
  ud.lastEventTime = Date.now();
  showBubble(minion);
  authFetch(`/api/chat/${sessionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  }).catch((e) => console.error("Chat error:", e));
};
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}
function escFull(s) {
  return esc(s);
}
function escAttr(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
(function initDrawer() {
  const drawer = document.getElementById("drawer");
  const toggle = document.getElementById("toggle");
  drawer.classList.add("shut");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    drawer.classList.toggle("shut");
  });
  toggle.addEventListener("mousedown", (e) => e.stopPropagation());
  document.querySelectorAll(".sec-h").forEach((hd) => {
    hd.addEventListener("click", (e) => {
      e.stopPropagation();
      hd.parentElement.classList.toggle("off");
    });
  });
  const cmdIn = document.getElementById("cmd-in");
  if (cmdIn) {
    cmdIn.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        window.runCmd();
      }
      if (e.key === "Escape") {
        cmdIn.blur();
      }
    });
    cmdIn.addEventListener("focus", () => {
      interactingWithOverlay = true;
    });
    cmdIn.addEventListener("blur", () => {
      interactingWithOverlay = false;
    });
    cmdIn.addEventListener("mousedown", (e) => e.stopPropagation());
  }
  drawer.addEventListener("mousedown", (e) => e.stopPropagation());
  drawer.addEventListener("mouseup", (e) => e.stopPropagation());
  const searchInput = document.getElementById("session-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      filterSessions(searchInput.value.trim().toLowerCase());
    });
    searchInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        searchInput.blur();
      }
    });
    searchInput.addEventListener("focus", () => {
      interactingWithOverlay = true;
    });
    searchInput.addEventListener("blur", () => {
      interactingWithOverlay = false;
    });
    searchInput.addEventListener("mousedown", (e) => e.stopPropagation());
  }
})();
function initClouds() {
  const cloudMats = [
    new THREE.MeshBasicMaterial({ color: 16777215, transparent: true, opacity: 0.9 }),
    new THREE.MeshBasicMaterial({ color: 16119285, transparent: true, opacity: 0.85 }),
    new THREE.MeshBasicMaterial({ color: 15263976, transparent: true, opacity: 0.8 })
  ];
  for (let i = 0; i < 20; i++) {
    const cloud = new THREE.Group();
    const count = 5 + Math.floor(Math.random() * 6);
    const cloudMat = cloudMats[Math.floor(Math.random() * cloudMats.length)];
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
var grassInstances = [];
var grassVertexShader = `
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
var grassFragmentShader = `
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
  const posAttr = grassBladeGeo.getAttribute("position");
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
      uColorBottom: { value: new THREE.Color(2980410) },
      uColorTop: { value: new THREE.Color(6737006) }
    },
    side: THREE.DoubleSide
  });
  const density = 12;
  const count = Math.floor(W * D * density / 4);
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
var canopyVertexShader = `
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
var canopyFragmentShader = `
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
var waterVertexShader = `
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
var waterFragmentShader = `
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
var petals = [];
var petalColors = [16761035, 16758725, 16773365, 16770273, 16573676, 15267305];
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
      _atmosphere: true
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
    if (p.position.y < 0) {
      p.position.y = 12 + Math.random() * 5;
      p.position.x = (Math.random() - 0.5) * 100;
      p.position.z = (Math.random() - 0.5) * 100;
    }
  }
}
var fireflies = [];
var FIREFLY_COUNT = 40;
function initFireflies() {
  const fireflyGeo = new THREE.SphereGeometry(0.06, 8, 6);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const fireflyMat = new THREE.MeshBasicMaterial({
      color: 16777096,
      transparent: true,
      opacity: 0.8
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
      speed: 0.5 + Math.random() * 1,
      radius: 1 + Math.random() * 2,
      blinkPhase: Math.random() * Math.PI * 2,
      blinkSpeed: 2 + Math.random() * 3,
      _atmosphere: true
    };
    scene.add(firefly);
    fireflies.push(firefly);
  }
}
function updateFireflies(dt, time) {
  const dayProgress = gameTime % DAY_CYCLE / DAY_CYCLE;
  const isNight = dayProgress > 0.7 || dayProgress < 0.2;
  for (const ff of fireflies) {
    const ud = ff.userData;
    ff.position.x = ud.baseX + Math.sin(time * ud.speed + ud.phase) * ud.radius;
    ff.position.y = ud.baseY + Math.sin(time * ud.speed * 0.7 + ud.phase) * 0.5;
    ff.position.z = ud.baseZ + Math.cos(time * ud.speed * 0.5 + ud.phase) * ud.radius;
    const blink = Math.sin(time * ud.blinkSpeed + ud.blinkPhase);
    ff.material.opacity = isNight ? 0.3 + blink * 0.5 : 0;
    const scale = 0.8 + blink * 0.4;
    ff.scale.setScalar(scale);
  }
}
function updateDayNightCycle(dt) {
  gameTime = (gameTime + dt) % DAY_CYCLE;
  const t = gameTime / DAY_CYCLE;
  let skyColor, fogColor, sunIntensity, sunAngle;
  const phases = [
    { t: 0, sky: new THREE.Color(395546), sun: 0.25, angle: 0 },
    // deep night
    { t: 0.08, sky: new THREE.Color(857139), sun: 0.2, angle: 0.08 },
    // pre-dawn dark
    { t: 0.14, sky: new THREE.Color(6963264), sun: 0.35, angle: 0.15 },
    // pre-dawn glow
    { t: 0.18, sky: new THREE.Color(16744528), sun: 0.5, angle: 0.22 },
    // dawn
    { t: 0.24, sky: new THREE.Color(8900331), sun: 0.9, angle: 0.32 },
    // morning
    { t: 0.4, sky: new THREE.Color(4898280), sun: 1, angle: 0.5 },
    // noon (vivid blue)
    { t: 0.56, sky: new THREE.Color(8900331), sun: 0.85, angle: 0.65 },
    // afternoon
    { t: 0.65, sky: new THREE.Color(16740416), sun: 0.55, angle: 0.75 },
    // dusk
    { t: 0.72, sky: new THREE.Color(4206752), sun: 0.3, angle: 0.82 },
    // twilight
    { t: 0.8, sky: new THREE.Color(527650), sun: 0.15, angle: 0.9 },
    // night
    { t: 0.9, sky: new THREE.Color(264210), sun: 0.12, angle: 0.96 },
    // deep night
    { t: 1, sky: new THREE.Color(395546), sun: 0.25, angle: 1 }
    // back to deep night
  ];
  let lo = phases[0], hi = phases[phases.length - 1];
  for (let i = 0; i < phases.length - 1; i++) {
    if (t >= phases[i].t && t < phases[i + 1].t) {
      lo = phases[i];
      hi = phases[i + 1];
      break;
    }
  }
  const range = hi.t - lo.t || 1;
  const p = (t - lo.t) / range;
  const smooth = p * p * (3 - 2 * p);
  skyColor = lo.sky.clone().lerp(hi.sky, smooth);
  sunIntensity = lo.sun + (hi.sun - lo.sun) * smooth;
  sunAngle = lo.angle + (hi.angle - lo.angle) * smooth;
  fogColor = skyColor.clone();
  scene.background = skyColor;
  scene.fog.color = fogColor;
  sun.intensity = sunIntensity;
  sun.color.set(16772829).lerp(skyColor, 0.3);
  sun.position.set(
    Math.cos(sunAngle * Math.PI * 2) * 40,
    20 + Math.sin(sunAngle * Math.PI * 2) * 30,
    Math.sin(sunAngle * Math.PI * 2) * 30
  );
  sunSphere.position.copy(sun.position);
  sunGlow.position.copy(sun.position);
  const sunVis = Math.max(0, Math.min(1, (sunIntensity - 0.25) / 0.65));
  sunSphere.material.opacity = sunVis;
  sunSphere.material.transparent = true;
  sunGlow.material.opacity = sunVis * 0.25;
  const sunColor = new THREE.Color(16772744).lerp(new THREE.Color(16775392), sunIntensity);
  sunSphere.material.color.copy(sunColor);
  sunGlow.material.color.copy(sunColor);
  let nightFactor = 0;
  if (t >= 0.18 && t < 0.65) {
    nightFactor = 0;
  } else if (t >= 0.65 && t < 0.8) {
    nightFactor = (t - 0.65) / 0.15;
  } else if (t >= 0.8 || t < 0.08) {
    nightFactor = 1;
  } else if (t >= 0.08 && t < 0.18) {
    nightFactor = 1 - (t - 0.08) / 0.1;
  }
  const starAlpha = Math.min(1, nightFactor * nightFactor);
  const brightAlpha = Math.min(1, nightFactor);
  _starTwinkleTime += dt;
  if (brightStarField) {
    const sizeAttr = brightStarField.geometry.attributes.size;
    let twinkleOpacity = brightAlpha;
    for (let i = 0; i < _starTwinklePhase.length; i++) {
      _starTwinklePhase[i] += 1e-4;
    }
    brightStarField.material.opacity = twinkleOpacity;
    brightStarField.material.size = 4 + Math.sin(_starTwinkleTime * 0.8) * 0.5;
  }
  if (starField) {
    starField.material.opacity = starAlpha * 0.85;
  }
  if (milkyWay) {
    milkyWay.material.opacity = Math.max(0, (nightFactor - 0.4) / 0.6) * 0.45;
  }
  const starRotation = gameTime / DAY_CYCLE * Math.PI * 2 * 0.1;
  if (starField) starField.rotation.y = starRotation;
  if (brightStarField) brightStarField.rotation.y = starRotation * 1.02;
  if (milkyWay) milkyWay.rotation.y = starRotation * 0.98;
  const moonAngle = sunAngle + 0.5;
  const moonX = Math.cos(moonAngle * Math.PI * 2) * 200;
  const moonY = 20 + Math.sin(moonAngle * Math.PI * 2) * 160;
  const moonZ = Math.sin(moonAngle * Math.PI * 2) * 150;
  const moonOpacity = brightAlpha;
  if (moonMesh) {
    moonMesh.position.set(moonX, moonY, moonZ);
    moonMesh.material.opacity = moonOpacity;
    moonGlow.position.set(moonX, moonY, moonZ);
    moonGlow.material.opacity = moonOpacity * 0.18;
    moonMesh.lookAt(camera.position);
    moonGlow.lookAt(camera.position);
  }
  const isNight = sunIntensity < 0.4;
  scene.traverse((obj) => {
    if (obj.isPointLight && obj.color.getHex() === 16772696) {
      obj.intensity = isNight ? 0.6 + (1 - sunIntensity / 0.4) * 0.4 : 0;
    }
  });
}
function drawMinimap() {
  const canvas = document.getElementById("minimap");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = 200, H = 200;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(8, 8, 24, 0.85)";
  ctx.fillRect(0, 0, W, H);
  const worldSize = 120;
  const scale = W / worldSize;
  const offsetX = W / 2;
  const offsetZ = H / 2;
  agents.forEach((agent, ai) => {
    const cols = Math.ceil(Math.sqrt(agents.length));
    const col = ai % cols, row = Math.floor(ai / cols);
    const W2 = 22, D = 22;
    const ox = col * (W2 + 6) - (cols - 1) * (W2 + 6) / 2;
    const oz = row * (D + 6) - (Math.ceil(agents.length / cols) - 1) * (D + 6) / 2;
    const mx = offsetX + ox * scale;
    const mz = offsetZ + oz * scale;
    ctx.fillStyle = "rgba(34, 197, 94, 0.5)";
    ctx.fillRect(mx, mz, W2 * scale, D * scale);
    const hx = ox + W2 / 2 - 2, hz = oz + D / 2 - 2;
    ctx.fillStyle = "#a16207";
    ctx.beginPath();
    ctx.arc(offsetX + hx * scale, offsetZ + hz * scale, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  for (const m of minions) {
    const mx = offsetX + m.position.x * scale;
    const mz = offsetZ + m.position.z * scale;
    const color = "#" + (m.userData.sessionKey ? "f5d033" : "888888");
    ctx.fillStyle = m.userData.state === "thinking" ? "#a78bfa" : m.userData.state === "streaming" ? "#3b82f6" : m.userData.state === "done" ? "#10b981" : "#f5d033";
    ctx.beginPath();
    ctx.arc(mx, mz, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const camX = offsetX + camera.position.x * scale;
  const camZ = offsetZ + camera.position.z * scale;
  ctx.strokeStyle = "#53d8fb";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(camX - 5, camZ);
  ctx.lineTo(camX + 5, camZ);
  ctx.moveTo(camX, camZ - 5);
  ctx.lineTo(camX, camZ + 5);
  ctx.stroke();
  const dirX = Math.sin(yaw) * 8;
  const dirZ = Math.cos(yaw) * 8;
  ctx.fillStyle = "#53d8fb";
  ctx.beginPath();
  ctx.moveTo(camX + dirX, camZ + dirZ);
  ctx.lineTo(camX - dirZ * 0.4, camZ + dirX * 0.4);
  ctx.lineTo(camX + dirZ * 0.4, camZ - dirX * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(83, 216, 251, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, W, H);
}
(function initMinimapClick() {
  const canvas = document.getElementById("minimap");
  if (!canvas) return;
  canvas.addEventListener("click", (e) => {
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
  canvas.addEventListener("mousedown", (e) => e.stopPropagation());
})();
function updateAgentDashboard() {
  const now = Date.now();
  const FIVE_MIN = 5 * 60 * 1e3;
  agents.forEach((agent) => {
    let activeCount = 0;
    agent.sessions.forEach((sess) => {
      const m = minions.find((mn) => mn.userData.sessionKey === sess.key);
      if (m && m.userData.lastEventTime && now - m.userData.lastEventTime < FIVE_MIN) {
        activeCount++;
      }
    });
    agent._activeCount = activeCount;
  });
  const totalActive = agents.reduce((sum, a) => sum + (a._activeCount || 0), 0);
  const hudEl = document.getElementById("h-sess");
  if (hudEl) {
    let totalSess = 0;
    agents.forEach((a) => totalSess += a.sessions.length);
    hudEl.textContent = `Sessions: ${totalSess} (${totalActive} active)`;
  }
  const agentsEl = document.getElementById("b-agents");
  if (agentsEl) {
    agentsEl.innerHTML = agents.map(
      (a) => `<div class="row"><span><span class="dot ${a._activeCount > 0 ? "on" : "off"}"></span>${esc(a.name)}</span><span>${a._activeCount || 0}/${a.sessions.length} active</span></div>`
    ).join("");
  }
}
var minionEmojis = ["\u{1F49A}", "\u{1F4AC}"];
var floatingEmojis = [];
function updateMinionInteraction(dt) {
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
  for (let i = 0; i < minions.length; i++) {
    for (let j = i + 1; j < minions.length; j++) {
      const a = minions[i], b = minions[j];
      const dx = a.position.x - b.position.x;
      const dz = a.position.z - b.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1.5 && dist > 0.3 && a.userData.isGrounded && b.userData.isGrounded && !a.userData.isSitting && !b.userData.isSitting && !a.userData.isSleeping && !b.userData.isSleeping && !a.userData.isGreeting && !b.userData.isGreeting) {
        if (Math.random() < 0.01 * dt) {
          const target = Math.random() > 0.5 ? a : b;
          const sk = target.userData.sessionKey;
          if (!activeAnimations[sk]) {
            triggerAnimation(target, "wave", 1.2);
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
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "48px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 32, 36);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat2 = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat2);
  sprite.position.set(x, y, z);
  sprite.scale.set(0.8, 0.8, 1);
  scene.add(sprite);
  floatingEmojis.push({ sprite, life: 2, maxLife: 2 });
}
function initRainSystem() {
  const rainGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4);
  const rainMat = new THREE.MeshBasicMaterial({ color: 11193599, transparent: true, opacity: 0.4 });
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
  const splashGeo = new THREE.SphereGeometry(0.03, 4, 4);
  const splashMat = new THREE.MeshBasicMaterial({ color: 11193599, transparent: true, opacity: 0.3 });
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
  sun.intensity = Math.max(0.15, sun.intensity * 0.7);
  for (const drop of rainDrops) {
    drop.position.y -= 15 * dt;
    drop.position.x += Math.sin(drop.position.z * 0.1) * dt * 0.5;
    if (drop.position.y < 0) {
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
    splash.userData.vy -= 5 * dt;
    splash.material.opacity = splash.userData.life / 0.3 * 0.3;
  }
}
function updateGrassWithLOD(time) {
  const camPos = camera.position;
  for (const g of grassInstances) {
    let windStrength = 0.04;
    const mat4 = new THREE.Matrix4();
    g.mesh.getMatrixAt(0, mat4);
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(mat4);
    const dist = camPos.distanceTo(pos);
    if (dist > 60) {
      g.mesh.visible = false;
    } else if (dist > 30) {
      g.mesh.visible = true;
      windStrength = 0.01;
    } else {
      g.mesh.visible = true;
      windStrength = 0.04;
    }
    g.mat.uniforms.uTime.value = time;
    g.mat.uniforms.uWindStrength.value = windStrength;
  }
}
function saveSceneState() {
  const state = {
    camera: {
      x: walkPos.x,
      y: walkPos.y,
      z: walkPos.z,
      yaw,
      pitch
    },
    openBubbles: []
  };
  for (const sk in bubbles) {
    const el = bubbles[sk];
    if (el && el.classList.contains("show") && !el._dismissed) {
      state.openBubbles.push(sk);
    }
  }
  try {
    localStorage.setItem("openclaw-monitor-state", JSON.stringify(state));
  } catch {
  }
}
function restoreSceneState() {
  try {
    const raw = localStorage.getItem("openclaw-monitor-state");
    if (!raw) return;
    const state = JSON.parse(raw);
    if (state.camera) {
      walkPos.set(state.camera.x || 25, state.camera.y || 30, state.camera.z || 35);
      yaw = state.camera.yaw || 0;
      pitch = state.camera.pitch || -0.5;
    }
  } catch {
  }
}
function updateSaveStateTimer(dt) {
  lastStateSave += dt;
  if (lastStateSave >= 5) {
    lastStateSave = 0;
    saveSceneState();
  }
}
var MAX_NOTIFY_BOXES = 5;
var notifyBoxes = [];
function showNotifyBox(sessionKey, userName, message, minionName) {
  while (notifyBoxes.length >= MAX_NOTIFY_BOXES) {
    const old = notifyBoxes.shift();
    removeNotifyBox(old);
  }
  const existing = notifyBoxes.find((n) => n.sessionKey === sessionKey);
  if (existing) {
    const msgEl = existing.el.querySelector(".nb-msg");
    if (msgEl) msgEl.textContent = message.slice(0, 60);
    resetNotifyTimer(existing);
    return;
  }
  const el = document.createElement("div");
  el.className = "notify-box";
  el.innerHTML = `
    <div class="nb-hd">
      <span class="nb-icon">\u{1F7E1}</span>
      <span class="nb-name">${esc(minionName || "\u5C0F\u9EC4\u4EBA")}</span>
      <span class="nb-user">${esc(userName || "")}</span>
      <button class="nb-close">\u2715</button>
    </div>
    <div class="nb-msg">${esc(message.slice(0, 60))}</div>
    <div class="nb-bar"><div class="nb-bar-fill"></div></div>
  `;
  el.addEventListener("click", (e) => {
    if (e.target.classList.contains("nb-close")) return;
    e.stopPropagation();
    if (fixedPanelSession) closeFixedPanel();
    openFixedPanel(sessionKey);
    const idx = notifyBoxes.findIndex((n) => n.sessionKey === sessionKey);
    if (idx >= 0) {
      removeNotifyBox(notifyBoxes[idx]);
      notifyBoxes.splice(idx, 1);
    }
  });
  el.querySelector(".nb-close").addEventListener("click", (e) => {
    e.stopPropagation();
    const idx = notifyBoxes.findIndex((n) => n.el === el);
    if (idx >= 0) {
      removeNotifyBox(notifyBoxes[idx]);
      notifyBoxes.splice(idx, 1);
    }
  });
  el.addEventListener("mousedown", (e) => e.stopPropagation());
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const box = { el, sessionKey, timer: null };
  resetNotifyTimer(box);
  notifyBoxes.push(box);
  updateNotifyBoxPositions();
}
function resetNotifyTimer(box) {
  if (box.timer) clearTimeout(box.timer);
  const fill = box.el.querySelector(".nb-bar-fill");
  if (fill) {
    fill.style.transition = "none";
    fill.style.width = "100%";
    requestAnimationFrame(() => {
      fill.style.transition = "width 15s linear";
      fill.style.width = "0%";
    });
  }
  box.timer = setTimeout(() => {
    const idx = notifyBoxes.indexOf(box);
    if (idx >= 0) {
      removeNotifyBox(box);
      notifyBoxes.splice(idx, 1);
    }
  }, 15e3);
}
function removeNotifyBox(box) {
  if (box.timer) clearTimeout(box.timer);
  box.el.classList.remove("show");
  setTimeout(() => box.el.remove(), 300);
}
function updateNotifyBoxPositions() {
  const topStart = 60;
  notifyBoxes.forEach((box, i) => {
    box.el.style.top = topStart + i * 72 + "px";
  });
}
var detailPopup = document.createElement("div");
detailPopup.id = "detail-popup";
detailPopup.innerHTML = '<div class="dp-card"><button class="dp-close">\u2715</button><div class="dp-body"></div></div>';
document.body.appendChild(detailPopup);
detailPopup.querySelector(".dp-close").addEventListener("click", (e) => {
  e.stopPropagation();
  hideDetailPopup();
});
detailPopup.addEventListener("mousedown", (e) => {
  if (e.target === detailPopup) {
    e.stopPropagation();
    hideDetailPopup();
  }
});
detailPopup.addEventListener("click", (e) => {
  if (e.target === detailPopup) hideDetailPopup();
});
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-full-text]");
  if (!el) return;
  if (e.target.tagName === "BUTTON" || e.target.tagName === "A") return;
  const fullText = el.getAttribute("data-full-text");
  if (fullText && fullText.length > 0) {
    e.stopPropagation();
    showDetailPopup(el);
  }
});
function renderMarkdown(text) {
  if (!text) return "";
  let html = esc(text);
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  html = html.replace(/^#{1,6}\s+(.+)$/gm, '<strong class="md-h">$1</strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/^[\-\*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");
  html = html.replace(/\n/g, "<br>");
  return html;
}
function isMarkdown(text) {
  return /[#*`\-\[\]]/.test(text || "");
}
function showDetailPopup(bactEl) {
  const fullText = bactEl.getAttribute("data-full-text");
  if (!fullText) return;
  const body = detailPopup.querySelector(".dp-body");
  body.innerHTML = isMarkdown(fullText) ? renderMarkdown(fullText) : esc(fullText).replace(/\n/g, "<br>");
  detailPopup.style.display = "flex";
  detailPopup.classList.add("show");
  interactingWithOverlay = true;
}
function hideDetailPopup() {
  detailPopup.classList.remove("show");
  detailPopup.style.display = "none";
  interactingWithOverlay = false;
}
var myUserId = localStorage.getItem("monitor-userId") || "user-" + Math.random().toString(36).slice(2, 8);
var myUserName = localStorage.getItem("monitor-userName") || "\u8BBF\u5BA2" + myUserId.slice(-3);
localStorage.setItem("monitor-userId", myUserId);
function bindAuthUser(user) {
  if (!user) return;
  myUserId = user.id;
  myUserName = user.username;
}
var thirdPerson = false;
var selfAvatar = null;
var walkPos = new THREE.Vector3(25, 30, 35);
function buildRobotAvatar(color) {
  const group = new THREE.Group();
  const mat2 = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 16777215, roughness: 0.3 });
  const eyePupil = new THREE.MeshStandardMaterial({ color: 1118481 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 3355443 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.6, 12), mat2);
  body.position.y = 0.3;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat2);
  head.position.y = 0.75;
  head.castShadow = true;
  group.add(head);
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), eyeWhite);
    eye.position.set(side * 0.08, 0.78, 0.16);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyePupil);
    pupil.position.set(side * 0.08, 0.78, 0.2);
    pupil.userData._isPupil = true;
    group.add(pupil);
  });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.15, 6), darkMat);
  antenna.position.y = 0.95;
  group.add(antenna);
  const antennaBall = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color }));
  antennaBall.position.y = 1.05;
  group.add(antennaBall);
  [-1, 1].forEach((side) => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.35, 6), mat2);
    arm.position.set(side * 0.28, 0.35, 0);
    arm.userData._isArm = true;
    arm.userData.side = side;
    group.add(arm);
  });
  [-1, 1].forEach((side) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.2, 6), darkMat);
    leg.position.set(side * 0.1, 0.1, 0);
    group.add(leg);
  });
  return group;
}
function createUserAvatar(userId, color) {
  const group = buildRobotAvatar(color || "#53d8fb");
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
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
  const group = buildRobotAvatar(16766720);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: 16766720, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);
  group.visible = false;
  scene.add(group);
  selfAvatar = group;
}
createSelfAvatar();
var userAvatars = {};
var lastUserPosReport = 0;
var serverTimeOffset = 0;
async function calibrateTime() {
  try {
    const t1 = Date.now();
    const resp = await fetch("/api/time");
    const data = await resp.json();
    const t2 = Date.now();
    const rtt = t2 - t1;
    serverTimeOffset = data.serverTime - (t1 + rtt / 2);
  } catch {
  }
}
calibrateTime();
setInterval(calibrateTime, 3e4);
function serverNow() {
  return Date.now() + serverTimeOffset;
}
var INTERP_DELAY = 50;
function updateAvatarLabel(avatar, name) {
  const label = avatar.userData._label;
  if (!label) return;
  const canvas = label.userData._canvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 32);
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 2;
  ctx.strokeText(name, 64, 22);
  ctx.fillText(name, 64, 22);
  label.userData._tex.needsUpdate = true;
}
function handleUsersUpdate(usersData) {
  const now = serverNow();
  for (const [userId, data] of Object.entries(usersData)) {
    if (userId === myUserId) continue;
    if (!userAvatars[userId]) {
      userAvatars[userId] = { mesh: createUserAvatar(userId, data.color), posBuffer: [], lastUpdate: now };
    }
    const avatar = userAvatars[userId];
    avatar.lastUpdate = now;
    avatar.posBuffer.push({ x: data.x || 0, y: data.y || 0, z: data.z || 0, yaw: data.yaw || 0, time: now });
    if (avatar.posBuffer.length > 10) avatar.posBuffer.shift();
    updateAvatarLabel(avatar.mesh, data.name || userId);
  }
  for (const [userId, avatar] of Object.entries(userAvatars)) {
    if (now - avatar.lastUpdate > 8e3) {
      scene.remove(avatar.mesh);
      delete userAvatars[userId];
    }
  }
}
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
    let before = buf[0], after = buf[buf.length - 1];
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i].time <= renderTime && buf[i + 1].time >= renderTime) {
        before = buf[i];
        after = buf[i + 1];
        break;
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
var ws = null;
var wsConnected = false;
function connectWS() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onopen = () => {
    wsConnected = true;
    console.log("WebSocket connected");
  };
  ws.onclose = () => {
    wsConnected = false;
    console.log("WebSocket disconnected, reconnecting...");
    setTimeout(connectWS, 2e3);
  };
  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    wsConnected = false;
  };
}
function reportMyPosition() {
  if (wsConnected && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: "position",
      userId: myUserId,
      x: walkPos.x,
      y: walkPos.y,
      z: walkPos.z,
      yaw,
      pitch,
      name: myUserName
    }));
  } else {
    authFetch("/api/users/position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: myUserId,
        x: walkPos.x,
        y: walkPos.y,
        z: walkPos.z,
        yaw,
        pitch,
        name: myUserName
      })
    }).catch(() => {
    });
  }
}
setTimeout(() => {
  const lo = document.getElementById("loading-overlay");
  if (lo) {
    lo.classList.add("hidden");
    setTimeout(() => lo.remove(), 600);
  }
}, 3e3);
checkAuth().then((authOk) => {
  if (!authOk) return;
  bindAuthUser(window._currentUser);
  restoreSceneState();
  authFetch("/api/state").then((r) => {
    if (r.status === 401) {
      location.href = "/login.html";
      return null;
    }
    return r.json();
  }).then((s) => {
    if (s) serverState = s;
  }).catch(() => {
  }).finally(() => {
    connectSSE();
    connectWS();
  });
});
var lastServerSave = 0;
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
      state: m.userData.state || "idle",
      eventLog: (m.userData.eventLog || []).slice(-20),
      userMsg: m.userData.userMsg || "",
      userName: m.userData.userName || "",
      replyText: m.userData.replyText || "",
      replyCount: m.userData.replyCount || 0
    };
  }
  const openBubbles = [];
  for (const sk in bubbles) {
    const el = bubbles[sk];
    if (el && el.classList.contains("show") && !el._dismissed) openBubbles.push(sk);
  }
  authFetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positions, states, openBubbles, fixedPanelSession })
  }).catch(() => {
  });
}
window.addEventListener("beforeunload", () => {
  const positions = {};
  const states = {};
  for (const m of minions) {
    const sk = m.userData.sessionKey;
    if (!sk) continue;
    positions[sk] = { x: m.position.x, y: m.position.y, z: m.position.z };
    states[sk] = {
      state: m.userData.state || "idle",
      eventLog: (m.userData.eventLog || []).slice(-20),
      userMsg: m.userData.userMsg || "",
      userName: m.userData.userName || "",
      replyText: m.userData.replyText || "",
      replyCount: m.userData.replyCount || 0
    };
  }
  const openBubbles = [];
  for (const sk in bubbles) {
    const el = bubbles[sk];
    if (el && el.classList.contains("show") && !el._dismissed) openBubbles.push(sk);
  }
  const data = JSON.stringify({ positions, states, openBubbles, fixedPanelSession });
  const beaconUrl = "/api/state";
  navigator.sendBeacon(beaconUrl, new Blob([data], { type: "application/json" }));
});
var agentDrawer = document.getElementById("agent-drawer");
var drawerSessionId = null;
var drawerSessionKey = null;
var drawerActiveTab = "current";
var drawerHistoryBefore = null;
var drawerHistoryAll = [];
document.getElementById("ad-close").addEventListener("click", closeAgentDrawer);
agentDrawer.addEventListener("mousedown", (e) => e.stopPropagation());
agentDrawer.addEventListener("mouseup", (e) => e.stopPropagation());
agentDrawer.querySelectorAll(".ad-tab").forEach((tab) => {
  tab.addEventListener("click", (e) => {
    e.stopPropagation();
    const pane = tab.dataset.pane;
    agentDrawer.querySelectorAll(".ad-tab").forEach((t) => t.classList.remove("active"));
    agentDrawer.querySelectorAll(".ad-pane").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("ad-pane-" + pane).classList.add("active");
    drawerActiveTab = pane;
    if (pane === "history" && drawerHistoryAll.length === 0) loadDrawerHistory();
    if (pane === "stats") loadDrawerStats();
  });
});
function openAgentDrawer(sessionId, sessionKey, minion) {
  drawerSessionId = sessionId;
  drawerSessionKey = sessionKey;
  drawerHistoryBefore = null;
  drawerHistoryAll = [];
  drawerActiveTab = "current";
  agentDrawer.querySelectorAll(".ad-tab").forEach((t) => t.classList.remove("active"));
  agentDrawer.querySelectorAll(".ad-pane").forEach((p) => p.classList.remove("active"));
  agentDrawer.querySelector('[data-pane="current"]').classList.add("active");
  document.getElementById("ad-pane-current").classList.add("active");
  const ud = minion ? minion.userData : {};
  const stateEmoji = ud.state === "thinking" ? "\u{1F9E0}" : ud.state === "done" ? "\u2705" : "\u{1F916}";
  document.getElementById("ad-avatar").textContent = stateEmoji;
  document.getElementById("ad-name").textContent = ud.userName || ud.sessionLabel || sessionKey.slice(0, 30);
  document.getElementById("ad-meta").textContent = (ud.sessionType || "") + (ud.channel ? " \xB7 " + ud.channel : "") + " \xB7 " + sessionId.slice(0, 8);
  agentDrawer.classList.add("open");
  loadDrawerCurrent();
}
function closeAgentDrawer() {
  agentDrawer.classList.remove("open");
  drawerSessionId = null;
  drawerSessionKey = null;
}
function loadDrawerCurrent() {
  if (!drawerSessionId) return;
  const pane = document.getElementById("ad-pane-current");
  pane.innerHTML = '<div class="ad-empty">\u52A0\u8F7D\u4E2D...</div>';
  authFetch("/api/session-state/" + encodeURIComponent(drawerSessionId)).then((r) => r.json()).then((data) => {
    const mn = minions.find((m) => m.userData.sessionId === drawerSessionId);
    if (mn) {
      document.getElementById("ad-avatar").textContent = data.state === "thinking" ? "\u{1F9E0}" : data.state === "done" ? "\u2705" : "\u{1F916}";
      document.getElementById("ad-name").textContent = mn.userData.userName || mn.userData.sessionLabel || drawerSessionKey.slice(0, 30);
    }
    const stateLabel = data.state === "thinking" ? "\u{1F9E0} \u601D\u8003\u4E2D" : data.state === "done" ? "\u2705 \u5DF2\u5B8C\u6210" : "\u{1F4A4} \u7A7A\u95F2";
    const stateClass = data.state === "thinking" ? "thinking" : data.state === "done" ? "done" : "idle";
    const eventLog = data.eventLog || [];
    let html = '<div class="ad-state-badge ' + stateClass + '">' + stateLabel + "</div>";
    if (data.userMsg) {
      html += '<div class="ad-section"><div class="ad-section-title">\u{1F4E8} \u6700\u65B0\u8BF7\u6C42</div><div class="ad-msg-box">' + esc(data.userMsg) + "</div></div>";
    }
    if (data.replyText) {
      html += '<div class="ad-section"><div class="ad-section-title">\u{1F4AC} \u6700\u65B0\u56DE\u590D</div><div class="ad-msg-box" style="color:#a7f3d0">' + esc(data.replyText.slice(0, 500)) + "</div></div>";
    }
    if (eventLog.length > 0) {
      html += '<div class="ad-section"><div class="ad-section-title">\u2699\uFE0F \u5F53\u524D\u52A8\u4F5C</div>';
      for (const ev of eventLog.slice(-8)) {
        const icon = ev.type === "think" ? "\u{1F4AD}" : ev.type === "tool_use" ? "\u{1F527}" : ev.type === "tool_result" ? "\u2705" : "\u{1F4AC}";
        const name = ev.type === "tool_use" ? ev.text || "?" : (ev.text || "").slice(0, 60);
        const timeStr = ev.ts ? new Date(ev.ts).toLocaleTimeString() : "";
        html += '<div class="ad-tool-row"><span class="ad-tool-icon">' + icon + '</span><span class="ad-tool-name">' + esc(name) + '</span><span class="ad-tool-time">' + esc(timeStr) + "</span></div>";
      }
      html += "</div>";
    }
    if (!data.userMsg && !data.replyText && eventLog.length === 0) {
      html += '<div class="ad-empty">\u6682\u65E0\u6D3B\u52A8</div>';
    }
    html += `<div style="margin-top:10px"><button onclick="openTrajPanel('` + escAttr(drawerSessionKey) + "','" + escAttr(document.getElementById("ad-name").textContent) + `')" style="width:100%;padding:8px;background:rgba(83,216,251,0.07);border:1px solid rgba(83,216,251,0.15);border-radius:8px;color:#53d8fb;font-size:8px;cursor:pointer;font-family:'Press Start 2P',monospace">\u{1F4CD} \u67E5\u770B\u5386\u53F2\u8F68\u8FF9</button></div>`;
    pane.innerHTML = html;
  }).catch(() => {
    pane.innerHTML = '<div class="ad-empty">\u274C \u52A0\u8F7D\u5931\u8D25</div>';
  });
}
function loadDrawerHistory(append = false) {
  if (!drawerSessionId) return;
  const pane = document.getElementById("ad-pane-history");
  if (!append) {
    pane.innerHTML = '<div class="ad-empty">\u52A0\u8F7D\u4E2D...</div>';
  }
  const url = "/api/messages/" + encodeURIComponent(drawerSessionId) + "?limit=20" + (drawerHistoryBefore ? "&before=" + encodeURIComponent(drawerHistoryBefore) : "");
  authFetch(url).then((r) => r.json()).then((data) => {
    const msgs = data.messages || [];
    if (!append) drawerHistoryAll = msgs;
    else drawerHistoryAll = [...msgs, ...drawerHistoryAll];
    if (drawerHistoryAll.length === 0) {
      pane.innerHTML = '<div class="ad-empty">\u6682\u65E0\u5386\u53F2\u8BB0\u5F55</div>';
      return;
    }
    let html = "";
    for (const msg of drawerHistoryAll) {
      const role = msg.role;
      const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "";
      let icon, preview, fullText;
      if (role === "user") {
        icon = "\u{1F464}";
        preview = esc((msg.text || "").slice(0, 80));
        fullText = esc(msg.text || "");
      } else if (role === "assistant") {
        const texts = msg.texts || [];
        const tcs = msg.toolCalls || [];
        icon = tcs.length ? "\u{1F527}" : "\u{1F916}";
        preview = tcs.length ? esc(tcs.map((t) => t.name).join(", ").slice(0, 80)) : esc(texts.join(" ").slice(0, 80));
        fullText = esc((texts.join("\n") + (tcs.length ? "\n\u5DE5\u5177: " + tcs.map((t) => t.name + "(" + t.args + ")").join(", ") : "") + (msg.thinking ? "\n\u601D\u8003: " + msg.thinking.slice(0, 300) : "")).trim());
      } else if (role === "toolResult") {
        icon = "\u{1F4CB}";
        preview = esc(((msg.toolName || "?") + ": " + (msg.result || "")).slice(0, 80));
        fullText = esc((msg.result || "").slice(0, 2e3));
      } else {
        icon = "\u2753";
        preview = esc(role);
        fullText = "";
      }
      html += `<div class="ad-turn"><div class="ad-turn-hd" onclick="this.closest('.ad-turn').classList.toggle('expanded')"><span class="ad-turn-role">` + icon + '</span><span class="ad-turn-text">' + preview + '</span><span class="ad-turn-ts">' + esc(ts) + '</span></div><div class="ad-turn-body">' + fullText + "</div></div>";
    }
    if (data.hasMore) {
      const oldest = msgs.length ? msgs[0].timestamp : null;
      html += `<button class="ad-load-more" onclick="loadMoreDrawerHistory('` + escAttr(oldest || "") + `')">\u2B06 \u52A0\u8F7D\u66F4\u591A</button>`;
    }
    pane.innerHTML = html;
  }).catch(() => {
    if (!append) pane.innerHTML = '<div class="ad-empty">\u274C \u52A0\u8F7D\u5931\u8D25</div>';
  });
}
function loadMoreDrawerHistory(before) {
  drawerHistoryBefore = before;
  loadDrawerHistory(true);
}
function loadDrawerStats() {
  if (!drawerSessionId) return;
  const pane = document.getElementById("ad-pane-stats");
  pane.innerHTML = '<div class="ad-empty">\u7EDF\u8BA1\u4E2D...</div>';
  authFetch("/api/agent-stats/" + encodeURIComponent(drawerSessionId)).then((r) => r.json()).then((data) => {
    const s = data.stats;
    if (!s) {
      pane.innerHTML = '<div class="ad-empty">\u6682\u65E0\u6570\u636E</div>';
      return;
    }
    const durStr = s.durationMs ? formatDrawerDuration(s.durationMs) : "-";
    const latStr = s.avgLatencyMs ? s.avgLatencyMs > 1e3 ? (s.avgLatencyMs / 1e3).toFixed(1) + "s" : s.avgLatencyMs + "ms" : "-";
    const charsStr = s.totalChars > 1e3 ? (s.totalChars / 1e3).toFixed(1) + "k" : String(s.totalChars);
    let html = '<div class="ad-stat-grid">';
    html += '<div class="ad-stat-card"><div class="ad-stat-val">' + s.userTurns + '</div><div class="ad-stat-lbl">\u7528\u6237\u8F6E\u6B21</div></div>';
    html += '<div class="ad-stat-card"><div class="ad-stat-val">' + s.toolCalls + '</div><div class="ad-stat-lbl">\u5DE5\u5177\u8C03\u7528</div></div>';
    html += '<div class="ad-stat-card"><div class="ad-stat-val">' + latStr + '</div><div class="ad-stat-lbl">\u5E73\u5747\u54CD\u5E94</div></div>';
    html += '<div class="ad-stat-card"><div class="ad-stat-val">' + charsStr + '</div><div class="ad-stat-lbl">\u8F93\u51FA\u5B57\u7B26</div></div>';
    html += "</div>";
    html += '<div class="ad-section-title">\u4F1A\u8BDD\u65F6\u957F: ' + durStr + "</div>";
    if (s.topTools && s.topTools.length > 0) {
      html += '<div class="ad-section"><div class="ad-section-title">\u{1F527} Top \u5DE5\u5177</div>';
      for (const t of s.topTools) {
        const pct = Math.round(t.cnt / s.toolCalls * 100);
        html += '<div class="ad-tool-row"><span class="ad-tool-icon">\u{1F527}</span><span class="ad-tool-name">' + esc(t.name) + '</span><span class="ad-tool-time">' + t.cnt + "\u6B21 (" + pct + "%)</span></div>";
      }
      html += "</div>";
    }
    if (s.timeline && s.timeline.length > 0) {
      html += '<div class="ad-section"><div class="ad-section-title">\u{1F4C5} \u6D3B\u52A8\u65F6\u95F4\u8F74</div>';
      for (const ev of s.timeline) {
        const evColors = { user_msg: "user_msg", thinking: "thinking", tool_use: "tool_use", tool_result: "tool_result", reply_text: "reply_text" };
        const timeStr = ev.ts ? new Date(ev.ts).toLocaleTimeString() : "";
        html += '<div class="ad-tl-row"><div class="ad-tl-dot ' + (evColors[ev.type] || "tool_use") + '"></div><span class="ad-tl-label">' + esc(ev.label.slice(0, 50)) + '</span><span class="ad-tl-time">' + esc(timeStr) + "</span></div>";
      }
      html += "</div>";
    }
    pane.innerHTML = html;
  }).catch(() => {
    pane.innerHTML = '<div class="ad-empty">\u274C \u52A0\u8F7D\u5931\u8D25</div>';
  });
}
function formatDrawerDuration(ms) {
  const secs = Math.round(ms / 1e3);
  if (secs < 60) return secs + "s";
  const mins = Math.floor(secs / 60), s = secs % 60;
  if (mins < 60) return mins + "m" + s + "s";
  const hrs = Math.floor(mins / 60), m = mins % 60;
  return hrs + "h" + m + "m";
}
window.openAgentDrawer = openAgentDrawer;
window.loadMoreDrawerHistory = loadMoreDrawerHistory;
var trajData = null;
var trajSessionKey = null;
var trajSessionName = "";
var trajPlaying = false;
var trajPlayIdx = 0;
var trajPlayTimer = null;
var trajGhostMesh = null;
var trajPathLine = null;
var trajPanel = document.getElementById("traj-panel");
var trajTimeline = document.getElementById("tp-timeline");
var trajFill = document.getElementById("tp-fill");
var trajThumb = document.getElementById("tp-thumb");
var trajEventDots = document.getElementById("tp-event-dots");
var trajTimeDisplay = document.getElementById("tp-time-display");
var trajEventInfo = document.getElementById("tp-event-info");
var trajPathInfo = document.getElementById("tp-path-info");
var trajSessName = document.getElementById("tp-sess-name");
var trajMinimap = document.getElementById("traj-minimap");
document.getElementById("tp-close").addEventListener("click", closeTrajPanel);
document.getElementById("tp-play").addEventListener("click", () => {
  if (trajPlaying) pauseTrajPlayback();
  else startTrajPlayback();
});
document.getElementById("tp-stop").addEventListener("click", stopTrajPlayback);
trajPanel.addEventListener("mousedown", (e) => e.stopPropagation());
trajPanel.addEventListener("mouseup", (e) => e.stopPropagation());
function openTrajPanel(sessionKey, displayName) {
  trajSessionKey = sessionKey;
  trajSessionName = displayName || sessionKey;
  trajSessName.textContent = trajSessionName;
  trajData = null;
  trajPlayIdx = 0;
  trajPlaying = false;
  clearInterval(trajPlayTimer);
  trajPanel.classList.add("show");
  trajEventInfo.textContent = "\u23F3 \u52A0\u8F7D\u8F68\u8FF9\u6570\u636E...";
  authFetch("/api/trajectory/" + encodeURIComponent(sessionKey)).then((r) => r.json()).then((data) => {
    trajData = data.points || [];
    if (trajData.length === 0) {
      trajEventInfo.textContent = "\u{1F6AB} \u6682\u65E0\u8F68\u8FF9\u6570\u636E\uFF08\u79FB\u52A8\u540E\u91CD\u8BD5\uFF09";
      return;
    }
    trajEventInfo.textContent = "\u{1F4CD} \u5171 " + trajData.length + " \u4E2A\u8F68\u8FF9\u70B9";
    renderTrajTimeline();
    setTrajIndex(trajData.length - 1);
  }).catch(() => {
    trajEventInfo.textContent = "\u274C \u52A0\u8F7D\u5931\u8D25";
  });
}
function closeTrajPanel() {
  trajPanel.classList.remove("show");
  if (trajMinimap) trajMinimap.classList.remove("show");
  stopTrajPlayback();
  removeTrajGhost();
  trajData = null;
  trajSessionKey = null;
}
function renderTrajTimeline() {
  if (!trajData || trajData.length === 0) return;
  const minTs = trajData[0].ts, maxTs = trajData[trajData.length - 1].ts, span = maxTs - minTs || 1;
  let dotsHtml = "";
  for (const pt of trajData) {
    if (!pt.event) continue;
    const pct = (pt.ts - minTs) / span * 100;
    dotsHtml += '<div class="tp-event-dot ' + (pt.event.type || "tool_use") + '" style="left:' + pct.toFixed(2) + '%" title="' + escAttr(pt.event.label || "") + '"></div>';
  }
  trajEventDots.innerHTML = dotsHtml;
}
function setTrajIndex(idx) {
  if (!trajData || trajData.length === 0) return;
  idx = Math.max(0, Math.min(trajData.length - 1, idx));
  trajPlayIdx = idx;
  const pt = trajData[idx];
  const minTs = trajData[0].ts, maxTs = trajData[trajData.length - 1].ts, span = maxTs - minTs || 1;
  const pct = (pt.ts - minTs) / span * 100;
  trajFill.style.width = pct.toFixed(2) + "%";
  trajThumb.style.left = pct.toFixed(2) + "%";
  const elapsed = Math.round((pt.ts - minTs) / 1e3), total = Math.round(span / 1e3);
  trajTimeDisplay.textContent = formatTrajSecs(elapsed) + " / " + formatTrajSecs(total);
  if (pt.event) {
    trajEventInfo.textContent = "\u{1F535} " + (pt.event.label || pt.event.type) + "  @  " + new Date(pt.ts).toLocaleTimeString();
  } else {
    trajEventInfo.textContent = "\u{1F4CD} \u4F4D\u7F6E (" + pt.x + ", " + pt.z + ")  @  " + new Date(pt.ts).toLocaleTimeString();
  }
  trajPathInfo.textContent = "x:" + pt.x + " z:" + pt.z + " | " + pt.state;
  moveTrajGhost(pt);
  drawTrajMinimap(idx);
}
function formatTrajSecs(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
}
function startTrajPlayback() {
  if (!trajData || trajData.length === 0) return;
  trajPlaying = true;
  document.getElementById("tp-play").textContent = "\u23F8 \u6682\u505C";
  document.getElementById("tp-play").classList.add("active");
  if (trajPlayIdx >= trajData.length - 1) trajPlayIdx = 0;
  const speed = parseFloat(document.getElementById("tp-speed").value) || 5;
  const stepMs = Math.max(50, 1e3 / speed);
  clearInterval(trajPlayTimer);
  trajPlayTimer = setInterval(() => {
    if (trajPlayIdx >= trajData.length - 1) {
      pauseTrajPlayback();
      return;
    }
    setTrajIndex(trajPlayIdx + 1);
  }, stepMs);
}
function pauseTrajPlayback() {
  trajPlaying = false;
  clearInterval(trajPlayTimer);
  document.getElementById("tp-play").textContent = "\u25B6 \u64AD\u653E";
  document.getElementById("tp-play").classList.remove("active");
}
function stopTrajPlayback() {
  pauseTrajPlayback();
  if (trajData && trajData.length > 0) setTrajIndex(0);
}
function getOrCreateTrajGhost() {
  if (trajGhostMesh) return trajGhostMesh;
  const geo = new THREE.SphereGeometry(0.35, 12, 12);
  const mat2 = new THREE.MeshBasicMaterial({ color: 5495035, transparent: true, opacity: 0.55 });
  trajGhostMesh = new THREE.Mesh(geo, mat2);
  scene.add(trajGhostMesh);
  const lineGeo = new THREE.BufferGeometry();
  const lineMat = new THREE.LineBasicMaterial({ color: 5495035, transparent: true, opacity: 0.3 });
  trajPathLine = new THREE.Line(lineGeo, lineMat);
  scene.add(trajPathLine);
  return trajGhostMesh;
}
function moveTrajGhost(pt) {
  const ghost = getOrCreateTrajGhost();
  ghost.position.set(pt.x, 1.2, pt.z);
  if (trajData && trajPathLine) {
    const pts = trajData.slice(0, trajPlayIdx + 1).map((p) => new THREE.Vector3(p.x, 0.5, p.z));
    if (pts.length >= 2) {
      trajPathLine.geometry.setFromPoints(pts);
    }
  }
}
function removeTrajGhost() {
  if (trajGhostMesh) {
    scene.remove(trajGhostMesh);
    trajGhostMesh = null;
  }
  if (trajPathLine) {
    scene.remove(trajPathLine);
    trajPathLine = null;
  }
}
function drawTrajMinimap(upToIdx) {
  if (!trajData || trajData.length === 0 || !trajMinimap) return;
  trajMinimap.classList.add("show");
  const ctx = trajMinimap.getContext("2d");
  const W = trajMinimap.width, H = trajMinimap.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(8,8,24,0.75)";
  ctx.fillRect(0, 0, W, H);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of trajData) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const pad = 18, rangeX = maxX - minX || 1, rangeZ = maxZ - minZ || 1;
  const sc2 = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeZ);
  const toS = (p) => ({ x: pad + (p.x - minX) * sc2, y: pad + (p.z - minZ) * sc2 });
  ctx.strokeStyle = "rgba(83,216,251,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  trajData.forEach((p, i) => {
    const s = toS(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
  ctx.strokeStyle = "rgba(83,216,251,0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  trajData.slice(0, upToIdx + 1).forEach((p, i) => {
    const s = toS(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
  const evColors = { user_msg: "#34d399", thinking: "#a78bfa", tool_use: "#f97316", tool_result: "#f59e0b", reply_text: "#60a5fa" };
  for (const pt of trajData) {
    if (!pt.event) continue;
    const s = toS(pt);
    ctx.fillStyle = evColors[pt.event.type] || "#fff";
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  if (trajData[upToIdx]) {
    const s = toS(trajData[upToIdx]);
    ctx.fillStyle = "#53d8fb";
    ctx.shadowColor = "#53d8fb";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  const s0 = toS(trajData[0]);
  ctx.fillStyle = "#4ade80";
  ctx.beginPath();
  ctx.arc(s0.x, s0.y, 4, 0, Math.PI * 2);
  ctx.fill();
}
var trajScrubbing = false;
trajTimeline.addEventListener("mousedown", (e) => {
  trajScrubbing = true;
  seekTrajByMouseX(e);
  e.stopPropagation();
});
window.addEventListener("mousemove", (e) => {
  if (trajScrubbing) seekTrajByMouseX(e);
});
window.addEventListener("mouseup", () => {
  trajScrubbing = false;
});
trajTimeline.addEventListener("touchstart", (e) => {
  trajScrubbing = true;
  seekTrajByTouch(e);
  e.stopPropagation();
}, { passive: false });
window.addEventListener("touchmove", (e) => {
  if (trajScrubbing) seekTrajByTouch(e);
}, { passive: false });
window.addEventListener("touchend", () => {
  trajScrubbing = false;
});
function seekTrajByMouseX(e) {
  if (!trajData || trajData.length === 0) return;
  const rect = trajTimeline.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  setTrajIndex(Math.round(pct * (trajData.length - 1)));
}
function seekTrajByTouch(e) {
  if (!e.touches.length) return;
  const rect = trajTimeline.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
  setTrajIndex(Math.round(pct * (trajData.length - 1)));
}
window.openTrajPanel = openTrajPanel;
animate();
