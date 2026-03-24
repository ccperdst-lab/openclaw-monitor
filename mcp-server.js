#!/usr/bin/env node
/**
 * OpenClaw Monitor MCP Server
 * 
 * Exposes tools for AI agents to control minions in the 3D monitor.
 * Communicates via stdio (MCP protocol).
 * 
 * Usage: node mcp-server.js
 * Or configure in OpenClaw MCP settings.
 */

const http = require('http');

// ===== Config =====
const MONITOR_HOST = process.env.MONITOR_HOST || '127.0.0.1';
const MONITOR_PORT = parseInt(process.env.MONITOR_PORT || '7777');
const MONITOR_BASE = `http://${MONITOR_HOST}:${MONITOR_PORT}`;

// ===== HTTP Helper =====
function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, MONITOR_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ===== MCP Protocol =====
const TOOLS = [
  {
    name: 'minion_list',
    description: '列出所有小黄人（minion），包括位置、状态、所属 agent、会话类型等信息。用于了解当前 3D 场景中有哪些小黄人。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'minion_move',
    description: '让一个小黄人走到指定坐标位置。小黄人会以步行方式移动，遇到障碍物会绕行。用于控制小黄人在场景中移动。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: {
          type: 'string',
          description: '小黄人的 sessionKey，可通过 minion_list 获取。例: "agent:main:feishu:group:oc_xxx"',
        },
        x: { type: 'number', description: '目标 X 坐标' },
        z: { type: 'number', description: '目标 Z 坐标' },
        speed: {
          type: 'number',
          description: '移动速度倍率（可选，默认 1.0，范围 0.5-3.0）',
        },
      },
      required: ['sessionKey', 'x', 'z'],
    },
  },
  {
    name: 'minion_move_to',
    description: '让一个小黄人走向另一个小黄人。自动在目标旁边找一个位置走过去。用于让两个小黄人靠近、对话等场景。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: {
          type: 'string',
          description: '要移动的小黄人的 sessionKey',
        },
        targetKey: {
          type: 'string',
          description: '目标小黄人的 sessionKey',
        },
        offsetDistance: {
          type: 'number',
          description: '停在目标旁边的距离（可选，默认 1.5 单位）',
        },
      },
      required: ['sessionKey', 'targetKey'],
    },
  },
  {
    name: 'minion_teleport',
    description: '瞬移小黄人到指定坐标。与 move 不同，这是立即生效的，没有移动过程。有视觉特效反馈。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: '小黄人的 sessionKey' },
        x: { type: 'number', description: '目标 X 坐标' },
        z: { type: 'number', description: '目标 Z 坐标' },
      },
      required: ['sessionKey', 'x', 'z'],
    },
  },
  {
    name: 'minion_animate',
    description: '让小黄人播放一段动画。可用于表达情绪、引起注意等。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: '小黄人的 sessionKey' },
        animation: {
          type: 'string',
          description: '动画类型',
          enum: ['jump', 'wave', 'dance', 'spin', 'nod', 'shake', 'bow', 'clap', 'think', 'celebrate'],
        },
        duration: {
          type: 'number',
          description: '动画持续时间（秒，默认 2.0）',
        },
      },
      required: ['sessionKey', 'animation'],
    },
  },
  {
    name: 'minion_say',
    description: '在小黄人头顶显示一个聊天气泡，展示指定的文字内容。用于让小黄人"说话"。气泡会在指定时间后自动消失。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: '小黄人的 sessionKey' },
        text: { type: 'string', description: '要显示的文字内容（最长 500 字）' },
        duration: {
          type: 'number',
          description: '气泡显示时长（秒，默认 5.0）',
        },
        sender: {
          type: 'string',
          description: '发送者名称（可选，默认 "🤖 MCP"）',
        },
      },
      required: ['sessionKey', 'text'],
    },
  },
  {
    name: 'minion_info',
    description: '获取指定小黄人的详细信息，包括会话元数据、个人资料、位置等。',
    inputSchema: {
      type: 'object',
      properties: {
        sessionKey: { type: 'string', description: '小黄人的 sessionKey' },
      },
      required: ['sessionKey'],
    },
  },
  {
    name: 'minion_batch',
    description: '批量执行多个控制命令。一次最多 20 条。用于需要同时控制多个小黄人做不同事情的场景。',
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          description: '命令数组，每条命令包含 action 和 sessionKey，以及对应参数',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['move', 'move_to_minion', 'teleport', 'animate', 'say'],
              },
              sessionKey: { type: 'string' },
              x: { type: 'number' },
              z: { type: 'number' },
              targetKey: { type: 'string' },
              offsetDistance: { type: 'number' },
              animation: { type: 'string' },
              duration: { type: 'number' },
              text: { type: 'string' },
              sender: { type: 'string' },
              speed: { type: 'number' },
            },
            required: ['action', 'sessionKey'],
          },
        },
      },
      required: ['commands'],
    },
  },
  {
    name: 'agent_action',
    description: '对某个 agent 下的所有小黄人执行统一操作。可用于让所有小黄人一起庆祝、集合、跳舞等。',
    inputSchema: {
      type: 'object',
      properties: {
        agentName: { type: 'string', description: 'Agent 名称（如 "main"）' },
        action: {
          type: 'string',
          description: '操作类型',
          enum: ['celebrate', 'gather', 'animate', 'say'],
        },
        animation: {
          type: 'string',
          description: '动画类型（当 action 为 animate 时必填）',
        },
        text: {
          type: 'string',
          description: '文字内容（当 action 为 say 时必填）',
        },
        duration: {
          type: 'number',
          description: '持续时间（秒）',
        },
      },
      required: ['agentName', 'action'],
    },
  },
];

// Tool handlers
async function handleTool(name, args) {
  switch (name) {
    case 'minion_list': {
      const data = await apiRequest('GET', '/api/minions');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }],
      };
    }

    case 'minion_move': {
      const result = await apiRequest('POST', `/api/minions/${encodeURIComponent(args.sessionKey)}/move`, {
        x: args.x,
        z: args.z,
        speed: args.speed,
      });
      return {
        content: [{
          type: 'text',
          text: result.ok
            ? `✅ 小黄人 ${args.sessionKey} 正在走向 (${args.x}, ${args.z})`
            : `❌ 移动失败: ${result.error || '未知错误'}`,
        }],
      };
    }

    case 'minion_move_to': {
      const result = await apiRequest('POST', `/api/minions/${encodeURIComponent(args.sessionKey)}/move-to/${encodeURIComponent(args.targetKey)}`, {
        offsetDistance: args.offsetDistance,
      });
      return {
        content: [{
          type: 'text',
          text: result.ok
            ? `✅ 小黄人 ${args.sessionKey} 正在走向 ${args.targetKey}`
            : `❌ 移动失败: ${result.error || '未知错误'}`,
        }],
      };
    }

    case 'minion_teleport': {
      const result = await apiRequest('POST', `/api/minions/${encodeURIComponent(args.sessionKey)}/teleport`, {
        x: args.x,
        z: args.z,
      });
      return {
        content: [{
          type: 'text',
          text: result.ok
            ? `⚡ 小黄人 ${args.sessionKey} 已瞬移到 (${args.x}, ${args.z})`
            : `❌ 瞬移失败: ${result.error || '未知错误'}`,
        }],
      };
    }

    case 'minion_animate': {
      const result = await apiRequest('POST', `/api/minions/${encodeURIComponent(args.sessionKey)}/animate`, {
        animation: args.animation,
        duration: args.duration,
      });
      return {
        content: [{
          type: 'text',
          text: result.ok
            ? `🎭 小黄人 ${args.sessionKey} 正在表演: ${args.animation}`
            : `❌ 动画失败: ${result.error || '未知错误'}`,
        }],
      };
    }

    case 'minion_say': {
      const result = await apiRequest('POST', `/api/minions/${encodeURIComponent(args.sessionKey)}/say`, {
        text: args.text,
        duration: args.duration,
        sender: args.sender,
      });
      return {
        content: [{
          type: 'text',
          text: result.ok
            ? `💬 小黄人 ${args.sessionKey} 说: "${args.text.slice(0, 100)}"`
            : `❌ 说话失败: ${result.error || '未知错误'}`,
        }],
      };
    }

    case 'minion_info': {
      const result = await apiRequest('GET', `/api/minions/${encodeURIComponent(args.sessionKey)}`);
      return {
        content: [{
          type: 'text',
          text: result.error
            ? `❌ 未找到: ${args.sessionKey}`
            : JSON.stringify(result, null, 2),
        }],
      };
    }

    case 'minion_batch': {
      const result = await apiRequest('POST', '/api/minions/batch', {
        commands: args.commands,
      });
      return {
        content: [{
          type: 'text',
          text: `📦 批量执行完成: ${result.count || 0} 条命令\n${JSON.stringify(result.results, null, 2)}`,
        }],
      };
    }

    case 'agent_action': {
      const result = await apiRequest('POST', `/api/agents/${encodeURIComponent(args.agentName)}/action`, {
        action: args.action,
        animation: args.animation,
        text: args.text,
        duration: args.duration,
      });
      return {
        content: [{
          type: 'text',
          text: result.ok
            ? `🎉 Agent ${args.agentName}: ${args.action} 已执行，影响 ${result.minionCount} 个小黄人`
            : `❌ 操作失败: ${result.error || '未知错误'}`,
        }],
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `❌ 未知工具: ${name}` }],
        isError: true,
      };
  }
}

// ===== stdio MCP Protocol Handler =====
let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  processMessages();
});

function processMessages() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buffer.substring(0, headerEnd);
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = buffer.substring(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(lengthMatch[1]);
    const messageStart = headerEnd + 4;

    if (buffer.length < messageStart + contentLength) break;

    const messageBody = buffer.substring(messageStart, messageStart + contentLength);
    buffer = buffer.substring(messageStart + contentLength);

    try {
      const message = JSON.parse(messageBody);
      handleMessage(message);
    } catch (e) {
      // skip malformed messages
    }
  }
}

function sendMessage(message) {
  const body = JSON.stringify(message);
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  process.stdout.write(header + body);
}

async function handleMessage(msg) {
  // Handle JSON-RPC 2.0
  if (msg.method === 'initialize') {
    sendMessage({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'openclaw-monitor-mcp',
          version: '1.0.0',
        },
      },
    });
  } else if (msg.method === 'notifications/initialized') {
    // No response needed for notifications
  } else if (msg.method === 'tools/list') {
    sendMessage({
      jsonrpc: '2.0',
      id: msg.id,
      result: { tools: TOOLS },
    });
  } else if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    try {
      const result = await handleTool(name, args || {});
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        result,
      });
    } catch (err) {
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: `❌ 错误: ${err.message}` }],
          isError: true,
        },
      });
    }
  } else if (msg.method === 'ping') {
    sendMessage({
      jsonrpc: '2.0',
      id: msg.id,
      result: {},
    });
  } else {
    // Unknown method
    if (msg.id !== undefined) {
      sendMessage({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      });
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Log to stderr (stdout is for MCP protocol)
console.error('[MCP] OpenClaw Monitor MCP Server started');
