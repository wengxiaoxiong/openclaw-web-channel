# Atypica Web Channel 集成指南

本指南介绍如何使用 `atypica-web` channel 插件将你的 Web 服务连接到 OpenClaw。

## 1. 安装插件

**重要：** 必须使用以下命令从本地源码目录安装插件：

```bash
openclaw plugins install -l /absolute/path/to/atypica-channel
```

请确保使用**绝对路径**，例如：
- macOS/Linux: `/Users/username/projects/openclaw/atypica-channel`
- Windows: `C:\Users\username\projects\openclaw\atypica-channel`

**注意：** 安装后，插件会自动添加到配置文件的 `plugins.load.paths` 中。如果之前有旧的 `web-channel` 插件，请确保更新路径指向新的 `atypica-channel` 目录。

## 2. 配置

### 2.1 插件配置

安装插件后，配置文件中的 `plugins.load.paths` 会自动更新。确保路径正确：

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/absolute/path/to/atypica-channel"
      ]
    },
    "entries": {
      "web-channel": {
        "enabled": true
      }
    }
  }
}
```

**重要说明：**
- 插件 ID 是 `web-channel`（在 `plugins.entries` 中）
- Channel ID 是 `atypica-web`（在 `channels` 中）
- 这两个是不同的概念：插件是代码包，Channel 是消息渠道配置

### 2.2 Channel 配置

在 `~/.openclaw/openclaw.json` 中启用 channel（或通过 OpenClaw dashboard 配置）：

```json
{
  "channels": {
    "atypica-web": {
      "enabled": true,
      "webhookUrl": "https://your-app.com/webhooks/openclaw",
      "apiSecret": "your-webhook-secret-key",
      "inboundApiKey": "your-inbound-api-key",
      "allowFrom": [],
      "accounts": {
        "default": {
          "enabled": true,
          "webhookUrl": "https://your-app.com/webhooks/openclaw",
          "apiSecret": "your-webhook-secret-key",
          "inboundApiKey": "your-inbound-api-key"
        }
      }
    }
  }
}
```

### 配置项说明

#### 基础配置（`channels.atypica-web`）

- **`enabled`** (boolean, 默认: `true`): 是否启用该 channel
- **`name`** (string, 可选): 账户名称
- **`webhookUrl`** (string, 可选): Agent 回复时推送到的 Webhook URL
- **`apiSecret`** (string, 可选): 用于 Webhook 推送请求认证的密钥（在请求头中使用 `Authorization: Bearer <apiSecret>`）
- **`inboundApiKey`** (string, 可选): 用于认证 Inbound 请求的 API Key（客户端需要在请求头中提供此密钥）
- **`allowFrom`** (array<string>, 可选): 允许的用户 ID 列表（空数组表示允许所有用户）

#### 多账户配置（`channels.atypica-web.accounts`）

支持配置多个账户，每个账户可以有自己的配置：

```json
{
  "channels": {
    "atypica-web": {
      "accounts": {
        "account1": {
          "enabled": true,
          "webhookUrl": "https://app1.com/webhook",
          "apiSecret": "secret1",
          "inboundApiKey": "key1"
        },
        "account2": {
          "enabled": true,
          "webhookUrl": "https://app2.com/webhook",
          "apiSecret": "secret2",
          "inboundApiKey": "key2"
        }
      }
    }
  }
}
```

账户配置会继承基础配置，如果账户中未设置某个字段，则使用基础配置的值。

### 环境变量（备选方案）

如果未在配置文件中设置，可以使用以下环境变量（在 OpenClaw Gateway 进程中设置）：

- `ATYPICA_WEBHOOK_URL`: Webhook URL（用于接收 Agent 回复）
- `ATYPICA_API_SECRET`: Webhook 认证密钥
- `ATYPICA_INBOUND_API_KEY`: Inbound API Key（用于认证入站请求）

## 3. API 接口

插件在 OpenClaw Gateway（默认端口 18789）上暴露以下 HTTP 接口。

### 3.1 Inbound 消息接口（Web -> OpenClaw）

发送消息到 OpenClaw Agent。

`responseMode` 调用方式说明：
- `async`（默认）：接口立即返回 `202 Accepted`，后台处理后通过 webhook 推送回复。
- `sync`：接口阻塞等待 Agent 处理完成，直接返回 `200 OK` 和 `reply`。

**请求**

- **URL**: `POST http://<gateway-host>:18789/atypica/inbound`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <inboundApiKey>` （如果配置了 `inboundApiKey`，必填）
  - 或 `X-API-Key: <inboundApiKey>` （备选方式）
- **Body**:
  ```json
  {
    "userId": "user_123",
    "projectId": "project_abc",
    "message": "你好，OpenClaw！",
    "accountId": "default",
    "responseMode": "async"
  }
  ```
  - `userId` (string, 必填): 用户 ID
  - `projectId` (string, 必填): 项目 ID
  - `message` (string, 必填): 消息内容
  - `accountId` (string, 可选): 账户 ID，默认为 `default`
  - `responseMode` (string, 可选): 响应模式，可选 `async` 或 `sync`，默认为 `async`

**响应**

- **成功（异步）** (`202 Accepted`, `responseMode=async`):
  ```json
  {
    "ok": true,
    "mode": "async",
    "message": "Message queued for processing",
    "sessionKey": "agent:user_123:project_abc",
    "agentId": "user_123"
  }
  ```

- **成功（同步）** (`200 OK`, `responseMode=sync`):
  ```json
  {
    "ok": true,
    "mode": "sync",
    "sessionKey": "agent:user_123:project_abc",
    "agentId": "user_123",
    "reply": "你好！我是你的 AI 助手。"
  }
  ```

- **认证失败** (`401 Unauthorized`):
  ```json
  {
    "ok": false,
    "error": "Invalid API key"
  }
  ```

- **参数错误** (`400 Bad Request`):
  ```json
  {
    "ok": false,
    "error": "userId, projectId, and message are required"
  }
  ```

**认证说明**

- 如果配置了 `inboundApiKey`，客户端**必须**在请求头中提供有效的 API Key
- 支持两种请求头格式：
  1. `Authorization: Bearer <inboundApiKey>` （推荐）
  2. `X-API-Key: <inboundApiKey>` （备选）
- 如果未配置 `inboundApiKey`，则不会进行认证（向后兼容）

**示例（Python）**

```python
import requests

url = "http://127.0.0.1:18789/atypica/inbound"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer your-inbound-api-key"
}
payload = {
    "userId": "user_123",
    "projectId": "project_abc",
    "message": "你好！",
    "responseMode": "async"  # 可选: async(默认) | sync
}

response = requests.post(url, json=payload, headers=headers)
print(response.status_code)  # 202
```

### 3.2 消息历史接口（Web -> OpenClaw）

查询指定用户和项目的消息历史。

**请求**

- **URL**: `GET http://<gateway-host>:18789/atypica/messages`
- **Query Parameters**:
  - `userId` (string, 必填): 用户 ID
  - `projectId` (string, 必填): 项目 ID
  - `limit` (number, 可选): 返回的最大消息数量，默认 50
  - `accountId` (string, 可选): 账户 ID，默认为 `default`
- **Headers**:
  - `Authorization: Bearer <inboundApiKey>` （如果配置了 `inboundApiKey`，建议提供）

**响应**

- **成功** (`200 OK`):
  ```json
  {
    "ok": true,
    "userId": "user_123",
    "projectId": "project_abc",
    "messages": [
      {
        "role": "user",
        "content": "你好！",
        "timestamp": 1700000000000
      },
      {
        "role": "assistant",
        "content": "你好！我是你的 AI 助手。",
        "timestamp": 1700000001000
      }
    ]
  }
  ```

- **错误** (`400 Bad Request`):
  ```json
  {
    "ok": false,
    "error": "userId and projectId are required"
  }
  ```

**示例（Python）**

```python
import requests

url = "http://127.0.0.1:18789/atypica/messages"
params = {
    "userId": "user_123",
    "projectId": "project_abc",
    "limit": 50
}
headers = {
    "Authorization": "Bearer your-inbound-api-key"
}

response = requests.get(url, params=params, headers=headers)
data = response.json()
print(f"获取到 {len(data['messages'])} 条消息")
```

## 4. Webhook 回调（OpenClaw -> Web）

当 Agent 回复消息时，OpenClaw 会向配置的 `webhookUrl` 发送 POST 请求。

**请求**

- **URL**: 配置的 `webhookUrl`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <apiSecret>` （如果配置了 `apiSecret`）
- **Body**:
  ```json
  {
    "userId": "user_123",
    "projectId": "project_abc",
    "text": "你好！我是你的 AI 助手。",
    "type": "assistant",
    "timestamp": 1700000001000
  }
  ```
  - `userId` (string): 用户 ID
  - `projectId` (string): 项目 ID
  - `text` (string): Agent 回复的文本内容
  - `type` (string): 消息类型，`"assistant"` 或 `"system"`
  - `timestamp` (number): 时间戳（毫秒）

**响应**

你的 Webhook 端点应该返回 `200 OK` 表示成功接收。

**认证**

如果配置了 `apiSecret`，OpenClaw 会在请求头中包含 `Authorization: Bearer <apiSecret>`。你的 Webhook 端点应该验证此密钥以确保请求来自 OpenClaw。

**示例（Node.js Express）**

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhooks/openclaw', (req, res) => {
  // 验证 API Secret
  const authHeader = req.headers.authorization;
  const expectedSecret = 'your-api-secret';
  
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { userId, projectId, text, type, timestamp } = req.body;
  
  console.log(`收到来自 ${userId}:${projectId} 的回复:`, text);
  
  // 处理回复...
  
  res.status(200).json({ ok: true });
});

app.listen(3000);
```

## 5. 工作流程

1. **Web 服务发送消息** → 调用 Inbound 接口 (`POST /atypica/inbound`)
   - 提供 `userId`、`projectId` 和 `message`
   - 如果配置了 `inboundApiKey`，需要在请求头中提供认证

2. **OpenClaw 处理消息** → Agent 处理消息并生成回复
   - 自动创建或使用现有的 Agent（基于 `userId`）
   - 自动管理 Session（基于 `userId:projectId`）

3. **OpenClaw 推送回复（仅异步模式）** → 调用你的 Webhook (`POST <webhookUrl>`)
   - 如果配置了 `apiSecret`，会在请求头中包含认证信息
   - 你的服务接收回复并处理

4. **查询历史** → 调用消息历史接口 (`GET /atypica/messages`)
   - 可以随时查询指定用户和项目的消息历史

## 6. 核心概念（重要）

- **一个 Agent 就是一个 User**：系统将 `userId` 直接映射为 Agent 身份（会做规范化处理）。
- **首次消息自动建 Agent**：当该 `userId` 对应 Agent 不存在时，会自动创建。
- **会话按 User + Project 维度隔离**：同一用户的不同项目使用不同会话，`sessionKey` 形如 `agent:<agentId>:<projectId>`。

## 7. 注意事项

- **Agent 自动创建**: 如果指定的 `userId` 对应的 Agent 不存在，系统会自动创建
- **Session 管理**: Session Key 格式为 `agent:<agentId>:<projectId>`
- **响应模式**:
  - `async`（默认）: Inbound 接口立即返回 `202 Accepted`，后续异步处理并推送 webhook
  - `sync`: Inbound 接口阻塞等待 Agent 回复，返回 `200 OK` + `reply`（不再额外推送 webhook）
- **API Key 安全**: 
  - `inboundApiKey`: 用于认证客户端发送的请求
  - `apiSecret`: 用于认证 OpenClaw 发送的 Webhook 请求
  - 建议使用不同的密钥，并妥善保管
- **向后兼容**: 如果未配置 `inboundApiKey`，Inbound 接口不会进行认证（但建议在生产环境中配置）

## 8. 常见问题

### 7.1 为什么配置文件中没有 `atypica-web` channel？

**原因：** Channel 配置需要手动添加，插件安装不会自动创建 channel 配置。

**解决方法：**
1. 确保插件已正确安装（检查 `plugins.load.paths` 和 `plugins.entries.web-channel.enabled`）
2. 手动添加 `channels.atypica-web` 配置（见上面的配置示例）
3. 重启 OpenClaw Gateway

### 7.2 插件和 Channel 的区别

- **插件（Plugin）**: 代码包，通过 `plugins.load.paths` 加载，在 `plugins.entries` 中启用
- **Channel**: 消息渠道配置，在 `channels.<channel-id>` 中配置
- 一个插件可以注册多个 channel，但 `atypica-web` 插件只注册一个 `atypica-web` channel

### 7.3 如何验证插件是否正确加载？

运行以下命令检查已注册的 channels：

```bash
openclaw channels list
```

如果看到 `atypica-web` 在列表中，说明插件已正确加载。

### 7.4 配置示例（完整）

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/Users/open/projects/openclaw/atypica-channel"
      ]
    },
    "entries": {
      "web-channel": {
        "enabled": true
      }
    }
  },
  "channels": {
    "atypica-web": {
      "enabled": true,
      "webhookUrl": "https://your-app.com/webhooks/openclaw",
      "apiSecret": "your-webhook-secret-key",
      "inboundApiKey": "your-inbound-api-key",
      "accounts": {
        "default": {
          "enabled": true
        }
      }
    }
  }
}
```

## 9. 测试

可以使用项目中的测试客户端进行测试：

```bash
# 设置 API Key 环境变量
export ATYPICA_INBOUND_API_KEY="your-inbound-api-key"

# 运行测试客户端（脚本位于当前目录）
python test_client.py "测试消息"

# 指定同步调用
python test_client.py --mode sync "测试同步调用"

# 指定异步调用（默认）
python test_client.py --mode async "测试异步调用"
```

测试客户端会自动处理 API Key 认证，并支持同步/异步两种调用方式。
