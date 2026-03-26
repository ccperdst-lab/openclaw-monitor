# OpenClaw Monitor 3D - AI 上下文文档

## 项目概述
实时3D可视化仪表盘，将OpenClaw的AI Agent和Session展示为3D世界中的大陆和小黄人。

---

## 1. 数据源：OpenClaw 文件系统

### 目录结构
```
~/.openclaw/
├── agents/
│   ├── main/                    # Agent名称
│   │   └── sessions/
│   │       ├── sessions.json    # 所有会话的元信息
│   │       ├── {sessionId}.jsonl # 每个会话的实时消息日志
│   │       └── ...
│   ├── xiaohong/
│   │   └── sessions/
│   └── xiaolan/
│       └── sessions/
```

### sessions.json 格式
```json
{
  "agent:main:feishu:group:oc_e785f48d5df0065f1db1e99ef0d6c730": {
    "sessionId": "7461d057-c1f7-4056-b1c0-9550d926e154",
    "displayName": "OpenClaw开发群",
    "updatedAt": 1774549219230
  },
  "agent:main:cron:6ae68f9e-9d3b-45cf-ba85-ed0b85e33419": {
    "sessionId": "b32acddc-914f-48f5-ae71-8b12b919253b"
  }
}
```

### Session Key 格式（重要！）
- `agent:main:main` → 主会话
- `agent:main:feishu:group:{groupId}` → 飞书群组会话
- `agent:main:feishu:dm:{userId}` → 飞书私信会话
- `agent:main:cron:{cronId}` → 定时任务会话
- `agent:main:subagent:{subagentId}` → 子代理会话

### JSONL 消息格式（每行一条）
```json
{
  "type": "message",
  "id": "db1d98c4",
  "parentId": "a6c6274e",
  "timestamp": "2026-03-24T05:06:21.490Z",
  "message": {
    "role": "user|assistant|toolResult",
    "content": [...]
  }
}
```

### 消息角色类型
1. **user** - 用户消息
   - `content`: 字符串或数组
   - 飞书格式: `[message_id: om_xxx]\n发送者: 消息内容`

2. **assistant** - AI回复
   - `content`: 数组，包含多种类型:
     - `{type: "thinking", thinking: "..."}` - 思考过程
     - `{type: "toolCall", name: "工具名", arguments: {...}}` - 工具调用
     - `{type: "text", text: "回复文本"}` - 最终回复

3. **toolResult** - 工具返回结果
   - `toolName`: 工具名称
   - `content`: 数组，包含 `{type: "text", text: "结果"}`

---

## 2. 服务端架构 (server.js)

### 配置 (config.yaml)
```yaml
openclawRoot: ~/.openclaw    # OpenClaw根目录
server:
  port: 7777
  host: '0.0.0.0'
auth:
  enabled: true              # 是否启用token认证
display:
  showCron: false            # 是否显示定时任务
  showSubagent: false        # 是否显示子代理
  recentMinutes: 10          # 显示最近多少分钟的消息
```

### 核心功能模块

#### Agent发现 (`discoverAgents()`)
- 扫描 `~/.openclaw/agents/` 目录
- 读取每个agent的 `sessions.json`
- 构建 `agentState` 全局对象

#### Session文件监听 (`watchSessionFile()`)
- 使用 `chokidar` 监听 `.jsonl` 文件变化
- 文件增长时读取新增行
- 解析消息并通过 `processLine()` 广播事件

#### 事件处理 (`processLine()`)
- 解析JSONL行
- 根据消息角色创建不同事件:
  - `user_msg` - 用户发送消息
  - `thinking` - AI思考中
  - `tool_use` - AI调用工具
  - `tool_result` - 工具返回结果
  - `reply_text` / `reply_intermediate` - AI回复

### API接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/world` | GET | 获取世界状态（agents、sessions） |
| `/api/config` | GET | 获取配置 |
| `/api/events` | GET | SSE事件流 |
| `/api/messages/:sessionId` | GET | 获取会话原始消息（支持分页） |
| `/api/session-state/:sessionId` | GET | 获取预计算的会话状态 |
| `/api/users/position` | POST | 更新用户位置（HTTP） |
| `/api/minions/positions` | POST | 更新小黄人位置 |
| `/api/chat/send` | POST | 发送世界聊天 |
| `/api/auth/verify` | GET | 验证token |

### 通信方式

1. **SSE (Server-Sent Events)** - 服务端推送
   - 连接: `GET /api/events`
   - 事件类型: `init`, `event`, `users`, `chat`, `control`

2. **WebSocket** - 双向通信（位置同步）
   - 客户端发送: `{type: "position", userId, x, y, z, yaw, pitch, name}`
   - 服务端广播: 用户位置更新

3. **HTTP REST** - 请求/响应
   - 获取数据、发送消息等

---

## 3. 前端架构 (monitor-app.js)

### 3D场景结构

```
Scene
├── Lights (环境光、太阳光、补光、边缘光)
├── Atmosphere (太阳、云朵、萤火虫、花瓣)
├── Continents[] (每个Agent一个大陆)
│   ├── Ground (地形)
│   ├── House (房子+装饰)
│   ├── Trees[] (树木)
│   ├── Flowers[] (花朵)
│   ├── Bushes[] (灌木)
│   ├── Pond (池塘)
│   ├── Furniture (桌椅、床)
│   ├── Fence (围栏)
│   ├── LampPost (路灯)
│   └── Bench (长椅)
├── Minions[] (每个Session一个小黄人)
│   ├── Body (身体)
│   ├── Head (头)
│   ├── Eyes (眼睛)
│   ├── Arms (手臂)
│   ├── Legs (腿)
│   └── Label (名称标签)
└── UserAvatars[] (其他在线用户)
```

### 关键函数

| 函数 | 说明 |
|------|------|
| `initWorld(worldData)` | 初始化世界，创建所有大陆和小黄人 |
| `createContinent(agentName, index)` | 创建一个Agent的大陆 |
| `createMinion(profile)` | 创建一个小黄人 |
| `animateMinions(dt, time)` | 更新小黄人动画 |
| `applySessionState(minion, data)` | 应用服务端预计算的状态 |
| `updateBubbleContent(m)` | 更新气泡显示内容 |
| `connectSSE()` | 连接SSE事件流 |
| `connectWS()` | 连接WebSocket |

### 小黄人状态机

```
idle → thinking → done
  ↑        ↓
  └────────┘
```

- `idle` - 空闲，无对话
- `thinking` - 正在处理用户消息
- `done` - 已回复用户

### 气泡(Bubble)系统

每个小黄人有一个气泡，显示:
- 顶部: 用户消息 + 发送者名字
- 中间: 思考过程事件列表
- 底部: AI回复（如果有）

### 事件日志 (eventLog)

```javascript
{
  type: 'think|tool_use|tool_result',
  text: '显示文本',        // 截断后的文本
  fullText: '完整文本',    // 完整内容，点击预览用
  args: '工具参数',        // 仅tool_use
  result: '结果',          // 仅tool_result
  ts: '时间戳'
}
```

---

## 4. 关键配置项

### config.yaml
```yaml
openclawRoot: ~/.openclaw
server:
  port: 7777
auth:
  enabled: true
display:
  showCron: false
  showSubagent: false
  recentMinutes: 10
```

---

## 5. 部署流程

### 开发环境
```bash
# 代码位置
/root/.openclaw/workspace-xiaohong/openclaw-monitor

# 开发分支
git checkout -b feature/xxx
# ... 修改代码 ...
git add -A && git commit -m "xxx"
git push origin feature/xxx
```

### 合并到主分支
```bash
git checkout main
git pull origin main
git merge feature/xxx --no-edit
git push origin main
```

### 生产部署
```bash
# 生产代码位置
/root/openclaw-monitor

# 拉取最新代码
cd /root/openclaw-monitor && git pull origin main

# 重启服务
systemctl --user restart openclaw-monitor

# 查看状态
systemctl --user status openclaw-monitor
```

### 重建Bundle（如修改了前端）
```bash
cd /tmp/esbuild-fix
cp /root/openclaw-monitor/public/monitor-app.js app.js
npx esbuild app.js --bundle --format=esm --outfile=/root/openclaw-monitor/public/bundle.js
```

---

## 6. 多Agent协作注意事项

1. **不要直接修改其他代理的代码**
2. **提交前先pull最新主分支**
3. **检查冲突再合并**
4. **每个代理在独立分支开发**
5. **合并后重启生产服务**

---

## 7. 常见问题

### Q: 小黄人状态不更新？
A: 检查SSE连接是否正常，或通过 `/api/session-state/:sessionId` 获取最新状态

### Q: 大陆不显示？
A: 检查 `config.yaml` 中 `showCron` 和 `showSubagent` 配置

### Q: 认证失败？
A: 检查 `config.yaml` 中 `auth.enabled` 配置，token在 `/tmp/openclaw/auth-token.txt`

### Q: 端口被占用？
A: `fuser -k 7777/tcp` 或使用systemd管理
