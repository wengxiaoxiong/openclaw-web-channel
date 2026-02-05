import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, OpenClawPluginHttpRouteHandler } from "openclaw/plugin-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveAtypicaWebConfig, resolveDefaultAtypicaWebAccountId } from "./config.js";
import { pushAtypicaReply } from "./outbound.js";
import { getAtypicaRuntime } from "./runtime.js";

// 内存消息队列
const messageQueue: Array<{
  userId: string;
  projectId: string;
  message: string;
  timestamp: number;
  accountId: string;
}> = [];

let isProcessing = false;

type InboundPayload = {
  userId?: string;
  projectId?: string;
  message?: string;
  messageId?: string;
  timestamp?: number;
  accountId?: string;
};

export function startMessageProcessor(): void {
  if (isProcessing) return;
  isProcessing = true;
  
  // 每 100ms 检查一次队列
  setInterval(async () => {
    if (messageQueue.length === 0) return;
    
    const msg = messageQueue.shift();
    if (!msg) return;
    
    try {
      await processMessage(msg);
    } catch (err) {
      console.error("[atypica-web] Failed to process message:", err);
    }
  }, 100);
}

async function processMessage(msg: {
  userId: string;
  projectId: string;
  message: string;
  timestamp: number;
  accountId: string;
}): Promise<void> {
  const core = getAtypicaRuntime();
  const cfg = core.config.loadConfig() as OpenClawConfig;
  
  const peerId = `${msg.userId}:${msg.projectId}`;
  const route = core.channel.routing.resolveAgentRoute({
    cfg,
    channel: "atypica-web",
    accountId: msg.accountId,
    peer: { kind: "dm", id: peerId },
  });

  const sessionsFilePath = core.channel.session.resolveStorePath(cfg.session?.store, {
    agentId: route.agentId,
  });
  const storePath = path.dirname(sessionsFilePath);
  
  // 读取 session 历史
  const storeFile = path.join(storePath, "session-store.json");
  let sessionData: any = {};
  if (fs.existsSync(storeFile)) {
    try {
      sessionData = JSON.parse(fs.readFileSync(storeFile, "utf-8"));
    } catch {}
  }
  
  const entry = sessionData[route.sessionKey];
  if (!entry?.sessionId) {
    console.log("[atypica-web] No session found for", route.sessionKey);
    return;
  }

  // 读取 transcript 文件
  const transcriptPath = path.join(storePath, `${entry.sessionId}.jsonl`);
  let messages: any[] = [];
  try {
    if (fs.existsSync(transcriptPath)) {
      const content = fs.readFileSync(transcriptPath, "utf-8");
      messages = content
        .split("\n")
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch {}

  // 找到最后一条用户消息
  const lastUserMessage = messages.filter(m => m.role === "user").pop();
  if (!lastUserMessage) {
    console.log("[atypica-web] No user message found in transcript");
    return;
  }

  // 检查是否已经处理过
  const lastAssistantMessage = messages.filter(m => m.role === "assistant").pop();
  if (lastAssistantMessage && lastAssistantMessage.timestamp > lastUserMessage.timestamp) {
    console.log("[atypica-web] Message already processed");
    return;
  }

  console.log(`[atypica-web] Processing message: ${lastUserMessage.content.substring(0, 50)}...`);

  // TODO: 这里需要调用 OpenClaw 的 agent 来生成回复
  // 由于 SDK 限制，目前只能记录消息，无法直接触发 agent
  //  workaround: 使用系统命令或者等待 OpenClaw 提供公共 API
  
  // 临时方案：直接推送一个测试回复
  if (process.env.ATYPICA_AUTO_REPLY === "true") {
    const testReply = `[Auto-reply] Received your message: "${lastUserMessage.content.substring(0, 30)}..."`;
    
    // 写入 assistant 消息到 transcript
    const assistantEntry = {
      type: "message",
      role: "assistant",
      content: testReply,
      timestamp: Date.now(),
    };
    fs.appendFileSync(transcriptPath, JSON.stringify(assistantEntry) + "\n");
    
    // 推送回复
    await pushAtypicaReply({
      cfg,
      accountId: msg.accountId,
      payload: {
        userId: msg.userId,
        projectId: msg.projectId,
        text: testReply,
      },
      logger: console,
    });
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
    let payload: InboundPayload;
    try {
      payload = JSON.parse(body) as InboundPayload;
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
      return;
    }

    const userId = payload.userId?.trim();
    const projectId = payload.projectId?.trim();
    const message = payload.message?.trim();

    if (!userId || !projectId || !message) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "userId, projectId, and message are required" }));
      return;
    }

    const core = getAtypicaRuntime();
    const cfg = core.config.loadConfig() as OpenClawConfig;
    const resolvedAccountId = payload.accountId?.trim() || resolveDefaultAtypicaWebAccountId(cfg);
    const accountConfig = resolveAtypicaWebConfig(cfg, resolvedAccountId);

    if (accountConfig.enabled === false) {
      res.statusCode = 403;
      res.end(JSON.stringify({ ok: false, error: "Account disabled" }));
      return;
    }

    // 记录消息到 session 文件
    const peerId = `${userId}:${projectId}`;
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "atypica-web",
      accountId: resolvedAccountId,
      peer: { kind: "dm", id: peerId },
    });

    // resolveStorePath 返回的是 sessions.json 文件路径，我们需要它的目录
    const sessionsFilePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    const storePath = path.dirname(sessionsFilePath);

    // 确保目录存在
    if (!fs.existsSync(storePath)) {
      fs.mkdirSync(storePath, { recursive: true });
    }

    // 读取或创建 session entry (session-store.json 和 sessions.json 在同一个目录)
    const storeFile = path.join(storePath, "session-store.json");
    let store: Record<string, any> = {};
    if (fs.existsSync(storeFile)) {
      try {
        store = JSON.parse(fs.readFileSync(storeFile, "utf-8"));
      } catch {}
    }

    let entry = store[route.sessionKey];
    if (!entry) {
      entry = {
        sessionId: crypto.randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    } else {
      entry.updatedAt = Date.now();
    }

    store[route.sessionKey] = entry;
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));

    // 写入消息到 transcript
    const transcriptPath = path.join(storePath, `${entry.sessionId}.jsonl`);
    const msgEntry = {
      type: "message",
      role: "user",
      content: message,
      timestamp: payload.timestamp ?? Date.now(),
      metadata: {
        userId,
        projectId,
        sessionKey: route.sessionKey,
        channel: "atypica-web",
      },
    };
    fs.appendFileSync(transcriptPath, JSON.stringify(msgEntry) + "\n");

    // 将消息加入处理队列
    messageQueue.push({
      userId,
      projectId,
      message,
      timestamp: Date.now(),
      accountId: resolvedAccountId,
    });

    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        message: "Message received and queued for processing",
        sessionKey: route.sessionKey,
        agentId: route.agentId,
      }),
    );
  } catch (err: unknown) {
    console.error("[atypica-web] Inbound handler error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        error: "Internal Server Error",
        details: err instanceof Error ? err.message : String(err),
      }),
    );
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
