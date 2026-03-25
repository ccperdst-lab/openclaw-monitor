# 🟢 OpenClaw Monitor 3D

**Real-time 3D visualization dashboard for [OpenClaw](https://github.com/openclaw/openclaw) AI agents.**

> Watch your AI agents come alive in a vibrant 3D world — each agent is a continent, each session is a cute minion walking around. Click to see live conversations, send messages, and monitor your agent army in real-time.

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
| "I want to talk to my agent directly" | 💬 Click any minion to chat |
| "Agent dashboards are boring" | 🎮 Pokemon-style 3D world with physics |

## 🌍 3D World

- **Agent Continents** — Each OpenClaw agent gets a vibrant village with houses, trees, flowers, ponds, fences, lamp posts, and benches
- **Dynamic Nature** — Wind-swaying grass (600+ blades), fluffy animated trees, rippling water with lily pads, floating cherry blossom petals
- **Clouds & Sky** — Volumetric clouds, dynamic lighting

## 🟡 Minions (Sessions)

- **Unique Characters** — Randomized height, width, color, eye count, hair style
- **Chinese Names** — Each minion gets a random name (小明, 阿花, 大壮...)
- **Physics System** — Gravity, ground collision, drag & drop with falling
- **Smart Pathfinding** — Walk to points of interest (house, table, pond, bench)
- **AABB Collision** — No walking through walls, furniture, or other minions
- **Live Expressions** — Eyes change based on state (thinking, done, idle)
- **Thinking Bubbles** — Animated "..." + mini speech bubble showing latest tool call

## 💬 Conversation Bubbles

- **Real-time Updates** — Live thinking process, tool calls, and replies via SSE
- **Expandable Content** — Thinking blocks are collapsible for long conversations
- **Two View Modes** — Floating bubble (default) or fixed panel (pinned to bottom)
- **Auto-scroll** — Smart scroll that respects user position

## 🛠️ Quick Start

```bash
# Clone the repo
git clone https://github.com/ccperdst-lab/openclaw-monitor.git
cd openclaw-monitor

# Install dependencies
npm install

# Start the server
npm start

# Open in browser
open http://localhost:7777
```

## ⚙️ Configuration

The monitor auto-detects your OpenClaw installation at `~/.openclaw`. You can customize via `config.yaml`:

```yaml
openclawRoot: ~/.openclaw  # Path to OpenClaw root
port: 7777                 # Server port
```

## 🏗️ Architecture

```
┌─────────────────┐     SSE      ┌──────────────┐
│  OpenClaw       │ ──────────▶  │  Monitor     │
│  Gateway        │              │  Server      │
│  (agents/)      │ ◀──────────  │  (Express)   │
└─────────────────┘   WebSocket  └──────┬───────┘
                                        │
                                   ┌────▼────┐
                                   │ Three.js │
                                   │ 3D World │
                                   └─────────┘
```

## 🔥 Similar Projects

| Project | Difference |
|---------|------------|
| [openclaw-office](https://github.com/WW-AI-Lab/openclaw-office) | Isometric view, no physics |
| [Divan](https://github.com/talhaorak/divan) | Room-based, no minions |
| [agent-monitor](https://github.com/ruiqili2/agent-monitor) | Pixel art style |

**Our edge:** Full 3D world + physics + per-session minions + direct chat.

## 🤝 Contributing

Contributions welcome! Please check [Issues](https://github.com/ccperdst-lab/openclaw-monitor/issues) for what needs work.

## ⭐ Star History

If this project helps you, please give it a star! It helps others discover it.

[![Star History Chart](https://api.star-history.com/svg?repos=ccperdst-lab/openclaw-monitor&type=Date)](https://star-history.com/#ccperdst-lab/openclaw-monitor&Date)

## 📝 License

MIT
