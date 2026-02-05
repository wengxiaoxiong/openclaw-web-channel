import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, OpenClawPluginHttpRouteHandler } from "openclaw/plugin-sdk";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import { resolveDefaultAtypicaWebAccountId } from "./config.js";
import { pushAtypicaReply } from "./outbound.js";
import { getAtypicaRuntime } from "./runtime.js";

type InboundPayload = {
  userId?: string;
  projectId?: string;
  message?: string;
  messageId?: string;
  timestamp?: number;
  accountId?: string;
};

/**
 * 检查 agent 是否存在
 */
function agentExists(cfg: OpenClawConfig, agentId: string): boolean {
  const agents = cfg.agents?.list ?? [];
  const normalizedId = agentId.toLowerCase().trim();
  return agents.some((entry) => {
    if (!entry?.id) return false;
    return entry.id.toLowerCase().trim() === normalizedId;
  });
}

/**
 * 创建 agent/user
 */
async function createAgent(options: {
  agentId: string;
  workspace?: string;
  bind?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { agentId, workspace, bind } = options;
  
  // 默认 workspace 路径：~/.openclaw/users/<agentId>
  const defaultWorkspace = workspace || path.join(os.homedir(), ".openclaw", "users", agentId);
  
  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    defaultWorkspace,
    "--non-interactive",
  ];

  // 如果指定了 bind，添加 --bind 参数
  // 默认绑定到 atypica-web channel
  if (bind) {
    args.push("--bind", bind);
  } else {
    args.push("--bind", "atypica-web");
  }

  console.log(`[atypica-web] Creating agent: openclaw ${args.join(" ")}`);

  const proc = spawn("openclaw", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        const errorMsg = stderr.trim() || stdout.trim() || `Command failed with code ${code}`;
        console.error(`[atypica-web] Failed to create agent: ${errorMsg}`);
        resolve({
          ok: false,
          error: errorMsg,
        });
        return;
      }

      console.log(`[atypica-web] Successfully created agent: ${agentId}`);
      resolve({ ok: true });
    });

    proc.on("error", (err) => {
      console.error(`[atypica-web] Failed to spawn agents add command:`, err);
      resolve({
        ok: false,
        error: `Failed to execute command: ${err.message}`,
      });
    });
  });
}

/**
 * CLI 调用函数 - 调用 openclaw agent 命令
 */
async function callOpenClawCLI(options: {
  message: string;
  sessionKey?: string;
  agentId?: string;
  timeout?: number;
}): Promise<string> {
  const args = ["agent", "--message", options.message, "--thinking", "low"];

  // 同时传递 agentId 和 sessionKey（如果都有的话）
  // 这样可以确保 CLI 正确处理 session
  if (options.agentId) {
    args.push("--agent", options.agentId);
  }
  if (options.sessionKey) {
    // 注意：CLI 参数是 --session-id 而不是 --session-key
    args.push("--session-id", options.sessionKey);
  }

  console.log(`[atypica-web] Executing: openclaw ${args.join(" ")}`);

  const proc = spawn("openclaw", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const trimmed = stdout.trim();
        resolve(trimmed || "[Empty response]");
      } else {
        reject(new Error(`CLI exited with code ${code}: ${stderr}`));
      }
    });

    // 超时处理
    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`CLI timeout after ${options.timeout}ms`));
    }, options.timeout || 120000);

    proc.on("close", () => clearTimeout(timeout));
  });
}

/**
 * 异步处理消息 - 调用 CLI 并推送到 webhook
 */
async function processMessageAsync(params: {
  userId: string;
  projectId: string;
  message: string;
  accountId: string;
  agentId: string;
  sessionKey: string;
}): Promise<void> {
  console.log(`[atypica-web] Processing message for ${params.userId}:${params.projectId}`);

  try {
    // 调用 CLI
    const reply = await callOpenClawCLI({
      message: params.message,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      timeout: 120000,
    });

    console.log(`[atypica-web] Got reply: ${reply.substring(0, 100)}...`);

    // 推送到 webhook
    const core = getAtypicaRuntime();
    const cfg = core.config.loadConfig() as OpenClawConfig;

    await pushAtypicaReply({
      cfg,
      accountId: params.accountId,
      payload: {
        userId: params.userId,
        projectId: params.projectId,
        text: reply,
      },
      logger: console,
    });

    console.log(`[atypica-web] Successfully pushed reply to webhook`);
  } catch (err) {
    console.error(`[atypica-web] Failed to process message:`, err);
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
    let cfg = core.config.loadConfig() as OpenClawConfig;
    const resolvedAccountId = payload.accountId?.trim() || resolveDefaultAtypicaWebAccountId(cfg);

    // 使用 userId 作为 agentId（规范化处理）
    // 移除特殊字符，只保留字母、数字、连字符和下划线
    const normalizedAgentId = userId.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    
    console.log(`[atypica-web] Received message from ${userId}:${projectId}`);
    console.log(`[atypica-web] Using agentId: ${normalizedAgentId}`);

    // 检查 agent 是否存在，如果不存在则创建
    if (!agentExists(cfg, normalizedAgentId)) {
      console.log(`[atypica-web] Agent "${normalizedAgentId}" does not exist, creating...`);
      
      // 构建 workspace 路径：~/.openclaw/users/<userId>
      const workspace = path.join(os.homedir(), ".openclaw", "users", userId);
      
      const createResult = await createAgent({
        agentId: normalizedAgentId,
        workspace,
        bind: "atypica-web",
      });

      if (!createResult.ok) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            ok: false,
            error: "Failed to create agent",
            details: createResult.error,
          }),
        );
        return;
      }

      // 重新加载配置以获取新创建的 agent
      cfg = core.config.loadConfig() as OpenClawConfig;
      console.log(`[atypica-web] Agent "${normalizedAgentId}" created successfully`);
    }

    // 使用 SDK routing 获取 sessionKey（使用创建的 agent）
    const peerId = `${userId}:${projectId}`;
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "atypica-web",
      accountId: resolvedAccountId,
      peer: { kind: "dm", id: peerId },
    });

    console.log(`[atypica-web] Routed to agent: ${route.agentId}, session: ${route.sessionKey}`);

    // 立即返回 202 Accepted
    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        message: "Message queued for processing",
        sessionKey: route.sessionKey,
        agentId: route.agentId,
      }),
    );

    // 异步处理（不等待）
    processMessageAsync({
      userId,
      projectId,
      message,
      accountId: resolvedAccountId,
      agentId: route.agentId,
      sessionKey: route.sessionKey,
    }).catch((err) => {
      console.error("[atypica-web] Async processing failed:", err);
    });
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
