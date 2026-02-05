import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginHttpRouteHandler } from "openclaw/plugin-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

// 简单的配置读取
function getStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR || path.join(homedir(), ".openclaw");
}

function getStorePath(agentId: string): string {
  return path.join(getStateDir(), "agents", agentId);
}

// 确保目录存在
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const handleInboundRequest: OpenClawPluginHttpRouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  try {
    const body = await readBody(req);
    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
      return;
    }

    const { userId, projectId, message } = payload;

    if (!userId || !projectId || !message) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "userId, projectId, and message are required" }));
      return;
    }

    console.log(`[atypica-web] Inbound message from user ${userId}, project ${projectId}: ${message}`);

    // Build session key (使用 main agent)
    const agentId = "main";
    const sessionKey = `agent:${userId}:project:${projectId}`;
    const storePath = getStorePath(agentId);
    const sessionDir = path.join(storePath, "sessions");
    
    ensureDir(sessionDir);

    // 读取或创建 session entry
    const storeFile = path.join(storePath, "session-store.json");
    let store: Record<string, any> = {};
    if (fs.existsSync(storeFile)) {
      try {
        store = JSON.parse(fs.readFileSync(storeFile, "utf-8"));
      } catch {}
    }

    let entry = store[sessionKey];
    if (!entry) {
      entry = {
        sessionId: crypto.randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      entry.updatedAt = Date.now();
    }

    // 写入 session entry
    store[sessionKey] = entry;
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));

    // 写入消息到 transcript 文件
    const transcriptPath = path.join(sessionDir, `${entry.sessionId}.jsonl`);
    const msgEntry = {
      type: "message",
      role: "user",
      content: message,
      timestamp: Date.now(),
      metadata: {
        userId,
        projectId,
        sessionKey,
        channel: "atypica-web",
      },
    };
    fs.appendFileSync(transcriptPath, JSON.stringify(msgEntry) + "\n");

    console.log(`[atypica-web] Message recorded to ${transcriptPath}`);

    // Success response
    res.statusCode = 202; // Accepted
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      message: "Message received",
      sessionKey,
      note: "Message recorded. Trigger agent run separately via gateway.",
    }));
  } catch (err: any) {
    console.error("[atypica-web] Inbound handler error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: false,
      error: "Internal Server Error",
      details: err.message,
    }));
  }
};

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", (err: Error) => reject(err));
  });
}
