# 🟢 OpenClaw Monitor 3D

A real-time 3D visualization dashboard for [OpenClaw](https://github.com/openclaw/openclaw) agents and sessions. Each OpenClaw agent is a continent in a 3D world, each session is a cute minion walking around. Click a minion to see its live conversation, or send messages directly from the monitor.

![Three.js](https://img.shields.io/badge/Three.js-3D-green) ![Node.js](https://img.shields.io/badge/Node.js-Server-blue) ![MCP](https://img.shields.io/badge/MCP-AI_Control-purple)

## Features

### 🌍 3D World
- **Pokemon-style continents** — Each agent gets a vibrant village with cute houses, trees, flowers, ponds, fences, lamp posts, and benches
- **Dynamic grass** — InstancedMesh with custom vertex shader for wind-swaying grass (600+ blades per continent)
- **Dynamic trees** — Shader-based canopy with wind animation, multiple overlapping spheres for fluffy look
- **Animated water** — Custom shader with ripples, sparkles, and lily pads
- **Floating petals** — 30 cherry blossom petals drifting in the wind
- **Clouds** — 15 volumetric clouds floating in the sky

### 🟡 Minions
- **Unique appearance** — Randomized height, width, color, eye count, hair
- **Chinese names** — Each minion gets a random Chinese name (小明, 阿花, 大壮...)
- **Physics** — Gravity system, minions fall when lifted, ground collision
- **Smart pathfinding** — Walk to points of interest (house, table, pond, bench) instead of random wandering
- **Collision** — AABB collision prevents walking through walls, furniture, and each other
- **Expressions** — Pupils change size/position based on state (thinking, done, idle)
- **Thinking indicator** — Animated "..." above head during thinking, plus mini speech bubble showing latest tool call
- **Interaction** — Nearby minions occasionally wave at each other with floating emoji

### 💬 Conversation Bubbles
- **Live updates** — Real-time thinking process, tool calls, and replies via SSE + polling fallback
- **Smart auto-scroll** — Only scrolls to bottom if user is already at the bottom
- **Reply divider** — Visual separator between thinking process and final reply
- **Direct chat** — Send messages to the agent from the bubble input
- **📌 Fixed panel mode** — Pin a bubble to the bottom of the screen (draggable, with viewport clamping)
- **Auto-expand** — Thinking panel auto-expands on new conversation
- **Auto-hide** — Bubble auto-hides after 30s of inactivity

### 🎮 Controls & Navigation
- **WASD** — Move camera
- **Mouse drag** — Rotate view (drag through bubbles without stutter)
- **Scroll wheel** — Zoom
- **1-9 keys** — Jump to corresponding continent
- **Double-click minion** — Follow mode (camera tracks minion)
- **Long-press minion (400ms)** — Drag minion to a new position
- **R key** — Toggle rain
- **F1** — Screenshot mode (hide all UI)
- **Escape** — Exit follow mode

### 🌅 Atmosphere
- **Day/night cycle** — 120s cycle with smooth sky transitions, visible sun sphere, auto lamp posts
- **Seasonal themes** — Spring/summer/autumn/winter color shifts based on real month
- **Rain system** — 200 rain particles with ground splashes, dimmed lighting
- **Snow (winter)** — 150 snow particles

### 🔌 MCP Server
- **9 AI tools** — minion_list, move, move_to, teleport, animate (10 types), say, info, batch, agent_action
- **stdIO transport** — Standard MCP protocol for AI agent integration

### 📊 UI
- **Minimap** — 2D overview of all continents with minion positions, click to teleport
- **Agent dashboard** — Active session count per agent
- **FPS counter** — Real-time frame rate
- **Session search** — Filter sessions in sidebar
- **Drawer sidebar** — Agents, sessions, event log, CLI

### 💾 Persistence
- **Scene state** — Camera position and open bubbles saved to localStorage
- **Minion profiles** — Name, color, size persisted across restarts

## Architecture

```
┌─────────────┐     SSE      ┌──────────────┐     chokidar    ┌─────────────────┐
│   Browser   │◄─────────────│  Monitor API │◄───────────────│ OpenClaw JSONL  │
│  (Three.js) │   /api/events│  (Express)   │  watch .jsonl  │  session files  │
└─────────────┘              └──────────────┘                 └─────────────────┘
       │                           │
       │ click minion              │ POST /api/chat/:sessionId
       │ → show bubble             │ → `openclaw agent --session-id`
       │                           │
       ▼                           ▼
┌─────────────┐              ┌──────────────┐
│  Bubble UI  │              │ OpenClaw     │
│  (DOM)      │              │ Gateway API  │
└─────────────┘              └──────────────┘
```

### Data Flow

1. **Server** reads `~/.openclaw/agents/*/sessions/sessions.json` to discover agents and sessions
2. **Chokidar** watches each session's `.jsonl` file for new messages
3. **Server** parses JSONL entries (`user`, `assistant`, `toolResult`) and broadcasts via SSE
4. **Browser** renders minions, updates bubbles in real-time
5. **Direct Chat** sends messages through `openclaw agent` CLI → Gateway → agent processes → writes to JSONL → SSE update

## Quick Start

### Prerequisites

- Node.js 18+
- OpenClaw installed and configured (`~/.openclaw`)
- A running OpenClaw Gateway

### Install

```bash
git clone https://github.com/ccperdst-lab/openclaw-monitor.git
cd openclaw-monitor
./install.sh install
```

This will:
- Install npm dependencies
- Build the JS bundle (via esbuild)
- Create a systemd user service
- Start the monitor on the configured port

### Manual Run

```bash
npm install
cd /tmp && mkdir -p esbuild-fix
cp public/monitor-app.js esbuild-fix/app.js
cd esbuild-fix && npx esbuild app.js --bundle --format=esm --outfile=../public/bundle.js
cd ../.. && node server.js
```

## Configuration

Edit `config.yaml`:

```yaml
openclawRoot: ~/.openclaw    # Path to OpenClaw state directory

server:
  port: 7777                  # Monitor server port
  host: 0.0.0.0               # Bind address

display:
  showCron: false             # Show cron session minions
  showSubagent: false         # Show subagent session minions
  recentMinutes: 10           # Show thinking/tool messages from last N minutes
```

## Controls

| Input | Action |
|-------|--------|
| WASD | Move camera |
| Mouse drag | Rotate view |
| Scroll wheel | Zoom in/out |
| Space / Shift | Up / Down |
| Click minion | Toggle conversation bubble |
| Bubble input + Enter | Send direct message to agent |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/world` | Full world state (agents, sessions) |
| GET | `/api/events` | SSE stream for real-time events |
| GET | `/api/messages/:sessionId` | Recent messages from session JSONL |
| POST | `/api/chat/:sessionId` | Send direct message to agent |
| GET | `/api/config` | Current server config |
| GET | `/api/resolve/:id` | Resolve Feishu user/group ID to name |
| GET | `/api/minion-profiles` | Minion profiles (name, color, size) |
| POST | `/api/minion-profiles` | Update minion profiles |

### MCP Control Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/minions` | List all minions with positions and states |
| GET | `/api/minions/:sessionKey` | Get detailed info about a specific minion |
| POST | `/api/minions/:sessionKey/move` | Walk minion to coordinates `{x, z}` |
| POST | `/api/minions/:sessionKey/move-to/:targetKey` | Walk minion toward another minion |
| POST | `/api/minions/:sessionKey/teleport` | Instantly move minion `{x, z}` |
| POST | `/api/minions/:sessionKey/animate` | Play animation `{animation, duration}` |
| POST | `/api/minions/:sessionKey/say` | Show speech bubble `{text, duration, sender}` |
| POST | `/api/minions/batch` | Execute multiple commands at once |
| POST | `/api/agents/:agentName/action` | Group action for all minions of an agent |
| POST | `/api/minions/positions` | Client reports minion positions (internal) |

## MCP Server (AI Control)

The monitor includes an MCP server that lets AI agents control minions in the 3D world.

### Available Tools

| Tool | Description |
|------|-------------|
| `minion_list` | List all minions with positions and states |
| `minion_move` | Walk a minion to coordinates |
| `minion_move_to` | Walk a minion toward another minion |
| `minion_teleport` | Instantly teleport a minion |
| `minion_animate` | Play an animation (jump, wave, dance, spin, nod, shake, bow, clap, think, celebrate) |
| `minion_say` | Show a speech bubble above a minion |
| `minion_info` | Get detailed info about a minion |
| `minion_batch` | Execute multiple commands at once |
| `agent_action` | Group action (celebrate, gather, animate, say) |

### Configuration

Add to your OpenClaw MCP config:

```json
{
  "mcpServers": {
    "openclaw-monitor": {
      "command": "node",
      "args": ["/root/openclaw-monitor/mcp-server.js"],
      "env": {
        "MONITOR_HOST": "127.0.0.1",
        "MONITOR_PORT": "7777"
      }
    }
  }
}
```

### Testing

```bash
# List minions
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | \
  awk '{printf "Content-Length: %d\r\n\r\n%s", length($0), $0}' | \
  cat - <(echo -n '{"jsonrpc":"2.0","method":"notifications/initialized"}' | awk '{printf "Content-Length: %d\r\n\r\n%s", length($0), $0}') \
  <(echo -n '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"minion_list","arguments":{}}}' | awk '{printf "Content-Length: %d\r\n\r\n%s", length($0), $0}') | \
  node mcp-server.js
```

## Service Management

```bash
# Status
./install.sh status
# or: systemctl --user status openclaw-monitor

# Restart
./install.sh restart
# or: systemctl --user restart openclaw-monitor

# Logs
journalctl --user -u openclaw-monitor -f

# Uninstall
./install.sh uninstall
```

## Session Types

Minions are labeled based on their session key:

| Session Key Pattern | Type | Label |
|---------------------|------|-------|
| `agent:main:main` | Main session | 🏠 主会话 |
| `agent:main:feishu:group:oc_xxx` | Feishu group | 💬 飞书群 |
| `agent:main:feishu:dm:ou_xxx` | Feishu DM | 📩 飞书私信 |
| `agent:main:cron:uuid` | Cron job | ⏰ 定时任务 |
| `agent:main:subagent:uuid` | Subagent | 🤖 子代理 |

## Tech Stack

- **Frontend**: Three.js (3D rendering), vanilla JS (DOM bubbles), SSE (real-time events)
- **Backend**: Express.js, chokidar (file watching), yaml (config)
- **Build**: esbuild (bundle)
- **Runtime**: OpenClaw CLI (`openclaw agent`) for direct chat delivery

## License

MIT
