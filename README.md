# 🟢 OpenClaw Monitor 3D

**Real-time 3D visualization dashboard for [OpenClaw](https://github.com/openclaw/openclaw) AI agents.**

> Watch your AI agents come alive in a vibrant 3D world — each agent is a continent, each session is a minion walking around. Click to see live conversations, send messages, and monitor your entire agent fleet in real-time.

[![GitHub Stars](https://img.shields.io/github/stars/ccperdst-lab/openclaw-monitor?style=social)](https://github.com/ccperdst-lab/openclaw-monitor/stargazers)
[![Three.js](https://img.shields.io/badge/Three.js-3D-green)](https://threejs.org)
[![Node.js](https://img.shields.io/badge/Node.js-Server-blue)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![Demo](https://raw.githubusercontent.com/ccperdst-lab/openclaw-monitor/main/demo.gif)

## ✨ Why OpenClaw Monitor?

| Problem | Solution |
|---------|----------|
| "What is my agent doing right now?" | 🟡 Minions with live thinking bubbles |
| "Which session is active?" | 🌍 Each session = a minion on its continent |
| "I want to talk to my agent directly" | 💬 Click any minion to open a chat bubble |
| "Agent dashboards are boring" | 🎮 Pokémon-style 3D world with physics |

---

## 🌍 3D World

- **Agent Continents** — Each OpenClaw agent gets a procedurally-generated village with houses, trees, flowers, ponds, fences, lamp posts, and benches
- **Dynamic Nature** — Wind-swaying grass (600+ blades), fluffy animated trees, rippling water with lily pads, floating cherry blossom petals
- **Clouds & Sky** — Volumetric clouds, dynamic lighting
- **Weather Effects** — Toggleable rain system
- **Draggable Minions** — Pick up any minion and drop them anywhere in the world

---

## 🟡 Minions (Sessions)

Each active OpenClaw session spawns a unique minion character:

- **Unique Characters** — Randomized height, width, body color, eye count (1 or 2), hair style, goggles, arms, legs
- **Detailed 3D Model** — Capsule body, goggle frames, overalls, shoes — all built from Three.js primitives
- **Chinese Names** — Each minion gets a random name (小明, 阿花, 大壮...)
- **Physics System** — Gravity, ground collision, drag & drop with falling animation
- **Smart Pathfinding** — Walk to points of interest: house, table, pond, bench
- **AABB Collision** — No walking through walls, furniture, or other minions
- **Live Expressions** — Eyes change based on state (thinking 💛, done ✅, idle)
- **Thinking Bubbles** — Animated "..." + mini speech bubble showing latest activity

---

## 💬 Conversation Bubbles

Click any minion to open its conversation bubble — a live window into the agent's mind:

| Section | What it shows |
|---------|---------------|
| 💭 Thinking | Extended reasoning content (if model supports it) |
| 🔧 Tool calls | Tool name + arguments |
| 📋 Tool results | Execution output (truncated) |
| 💬 Final reply | The actual response sent to the user |

**Features:**
- **Real-time SSE** — Updates stream in as the agent works
- **Expandable history** — Scroll up to load older messages
- **Collapsible panel** — Click header to show/hide activity log
- **Two view modes** — Floating bubble (default) or pinned panel (📌)
- **Auto-scroll** — Follows new activity while respecting manual scroll
- **Direct chat** — Type in the bubble to send a message to that session
- **Abort button** — 🛑 Terminate an active thinking run from the bubble

---

## 🌐 World Chat

Press `T` to open the world chat panel — broadcast a message to all agents at once, or watch the live feed of all agent activity across every session.

---

## 🛡️ Admin Panel

Accessible at a secret randomized URL (printed in server logs on startup, also linked from the main UI):

- **User Management** — Create, delete, and manage user accounts with role-based access
- **Roles** — `admin` (full), `user` (view + chat), `viewer` (read-only)
- **Agents Overview** — See all agents, their session counts, and recent activity
- **Sessions Table** — Browse all active sessions with agent, channel, type, and status

---

## 🛠️ Quick Start

```bash
git clone https://github.com/ccperdst-lab/openclaw-monitor.git
cd openclaw-monitor
npm install
npm start
# Open http://localhost:7777
```

Requires [OpenClaw](https://github.com/openclaw/openclaw) to be installed and running on the same machine.

---

## ⚙️ Configuration

Create `config.yaml` in the project root:

```yaml
openclawRoot: ~/.openclaw  # Path to OpenClaw root (auto-detected if omitted)
port: 7777                 # Server port

auth:
  enabled: false           # Set true to require login

display:
  showCron: true           # Show cron sessions as minions
  showSubagent: true       # Show subagent sessions as minions
  recentMinutes: 10        # Only show sessions active in last N minutes
```

---

## 🔐 Auth & Access Control

**`auth.enabled: true`:**
- First user to register becomes admin
- Admin panel at a secret randomized URL (persisted across restarts)
- Fine-grained roles: admin / user / viewer

**`auth.enabled: false` (default):**
- No login required — open to anyone with port access

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `W / A / S / D` or Arrow Keys | Move camera |
| Mouse drag | Rotate view |
| Scroll | Zoom |
| `T` | Toggle world chat panel |
| `R` | Toggle rain |
| `F1` | Screenshot mode (hide UI) |
| Click minion | Open conversation bubble |
| Drag minion | Pick up and relocate |

---

## 🏗️ Architecture

```
┌─────────────────┐     SSE      ┌──────────────┐
│  OpenClaw       │ ──────────▶  │  Monitor     │
│  Gateway        │              │  Server      │
│  ~/.openclaw/   │ ◀──────────  │  (Express)   │
└─────────────────┘   REST API   └──────┬───────┘
                                        │  WebSocket
                                   ┌────▼────────┐
                                   │  Three.js   │
                                   │  3D World   │
                                   └─────────────┘
```

The monitor server tails OpenClaw's session JSONL files and broadcasts events to all connected browsers via SSE. No modification to OpenClaw is required.

---

## 🔥 Similar Projects

| Project | Difference |
|---------|------------|
| [openclaw-office](https://github.com/WW-AI-Lab/openclaw-office) | Isometric view, no physics |
| [Divan](https://github.com/talhaorak/divan) | Room-based, no minions |
| [agent-monitor](https://github.com/ruiqili2/agent-monitor) | Pixel art style |

**Our edge:** Full 3D physics world + per-session minion characters + live thinking bubbles + direct chat + admin panel.

---

## 🤝 Contributing

PRs welcome! Check [Issues](https://github.com/ccperdst-lab/openclaw-monitor/issues) for open tasks.

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ccperdst-lab/openclaw-monitor&type=Date)](https://star-history.com/#ccperdst-lab/openclaw-monitor&Date)

## 📝 License

MIT
