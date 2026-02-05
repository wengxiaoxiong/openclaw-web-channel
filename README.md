# Atypica Web Channel Integration Guide

This guide explains how to connect your Web service to OpenClaw using the `atypica-web` channel plugin.

## 1. Installation

Install the plugin from your local source directory:

```bash
openclaw plugins install -l /absolute/path/to/atypica-channel
```

## 2. Configuration

Enable the channel in your `~/.openclaw/openclaw.json` (or configure via the OpenClaw dashboard):

```json
{
  "channels": {
    "atypica-web": {
      "enabled": true,
      "accounts": {
        "default": { "enabled": true }
      }
    }
  }
}
```

### Channel Config (Preferred)

These are configurable in the OpenClaw dashboard under the `atypica-web` channel:

- `channels.atypica-web.webhookUrl`: Your web service endpoint to receive agent replies.
- `channels.atypica-web.apiSecret`: Secret token for authenticating push requests.
- `channels.atypica-web.allowFrom`: Allowed user IDs (optional).

### Environment Variables (Fallback)

Set the following environment variables for the OpenClaw Gateway process:

- `ATYPICA_WEBHOOK_URL`: Your web service endpoint to receive agent replies (e.g., `https://api.atypica.com/webhooks/openclaw`).
- `ATYPICA_API_SECRET`: A secret token for authenticating push requests from OpenClaw.

## 3. API Endpoints

The plugin exposes two HTTP endpoints on the OpenClaw Gateway (default port 18789).

### 3.1 Inbound Message (Web -> OpenClaw)

Send a message from your system to an agent.

- **URL**: `POST http://<gateway-host>:18789/atypica/inbound`
- **Body**:
  ```json
  {
    "userId": "user_123",
    "projectId": "project_abc",
    "message": "Hello OpenClaw!",
    "accountId": "default"
  }
  ```
- **Response**: `202 Accepted`

### 3.2 Fetch History (Web -> OpenClaw)

Retrieve message history for a specific user and project.

- **URL**: `GET http://<gateway-host>:18789/atypica/messages?userId=user_123&projectId=project_abc&limit=50&accountId=default`
- **Response**: `200 OK`
  ```json
  {
    "ok": true,
    "userId": "user_123",
    "projectId": "project_abc",
    "messages": [
      { "role": "user", "content": "..." },
      { "role": "assistant", "content": "..." }
    ]
  }
  ```

## 4. Outbound Webhook (OpenClaw -> Web)

When the agent replies, OpenClaw will send a POST request to your `ATYPICA_WEBHOOK_URL`.

- **Headers**:
  - `Authorization: Bearer <ATYPICA_API_SECRET>`
- **Body**:
  ```json
  {
    "userId": "user_123",
    "projectId": "project_abc",
    "text": "Hello! I am your AI assistant.",
    "type": "assistant",
    "timestamp": 1700000000000
  }
  ```
