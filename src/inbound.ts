import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { OpenClawPluginHttpRouteHandler } from "../../src/plugins/types.js";
import type { AgentBinding } from "../../src/config/types.agents.js";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import { resolveDefaultAtypicaWebAccountId, resolveAtypicaWebConfig } from "./config.js";
import { pushAtypicaReply } from "./outbound.js";
import { getAtypicaRuntime } from "./runtime.js";

type InboundPayload = {
  userId?: string;
  projectId?: string;
  message?: string;
  messageId?: string;
  timestamp?: number;
  accountId?: string;
  responseMode?: "async" | "sync";
};

function resolveResponseMode(value?: string): "async" | "sync" {
  if (value === "sync") return "sync";
  return "async";
}

/**
 * 从请求头中提取 API key
 * 支持两种格式：
 * 1. Authorization: Bearer <key>
 * 2. X-API-Key: <key>
 */
function extractApiKeyFromHeaders(req: IncomingMessage): string | null {
  // 检查 Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }

  // 检查 X-API-Key header
  const apiKeyHeader = req.headers["x-api-key"];
  if (apiKeyHeader && typeof apiKeyHeader === "string") {
    return apiKeyHeader.trim();
  }

  return null;
}

/**
 * 验证 API key
 */
function validateApiKey(
  cfg: OpenClawConfig,
  accountId: string,
  providedKey: string | null,
): { valid: boolean; error?: string } {
  const accountConfig = resolveAtypicaWebConfig(cfg, accountId);
  const configuredKey = accountConfig.inboundApiKey?.trim();

  // 如果未配置 inboundApiKey，则不进行验证（向后兼容）
  if (!configuredKey) {
    return { valid: true };
  }

  // 如果配置了 inboundApiKey，但请求中未提供，则拒绝
  if (!providedKey) {
    return {
      valid: false,
      error: "API key required. Provide it in Authorization: Bearer <key> or X-API-Key header",
    };
  }

  // 使用时间安全的比较来防止时序攻击
  if (configuredKey !== providedKey) {
    return {
      valid: false,
      error: "Invalid API key",
    };
  }

  return { valid: true };
}

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
  // 如果不指定，则不创建 channel-level binding（我们会手动添加 peer-level binding）
  if (bind) {
    args.push("--bind", bind);
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
    // 先加载配置以进行 API key 验证
    const core = getAtypicaRuntime();
    let cfg = core.config.loadConfig() as OpenClawConfig;

    // 读取请求体
    const body = await readBody(req);
    let payload: InboundPayload;
    try {
      payload = JSON.parse(body) as InboundPayload;
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
      return;
    }

    const resolvedAccountId = payload.accountId?.trim() || resolveDefaultAtypicaWebAccountId(cfg);

    // 验证 API key
    const providedKey = extractApiKeyFromHeaders(req);
    const validation = validateApiKey(cfg, resolvedAccountId, providedKey);
    if (!validation.valid) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: validation.error || "Unauthorized" }));
      return;
    }

    const userId = payload.userId?.trim();
    const projectId = payload.projectId?.trim();
    const message = payload.message?.trim();
    const responseMode = resolveResponseMode(payload.responseMode?.trim());

    if (!userId || !projectId || !message) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, error: "userId, projectId, and message are required" }));
      return;
    }

    // 使用 userId 作为 agentId（规范化处理）
    // 移除特殊字符，只保留字母、数字、连字符和下划线
    const normalizedAgentId = userId.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    
    console.log(`[atypica-web] Received message from ${userId}:${projectId}`);
    console.log(`[atypica-web] Using agentId: ${normalizedAgentId}`);

    const peerId = `${userId}:${projectId}`;
    
    // 检查 agent 是否存在，如果不存在则创建
    if (!agentExists(cfg, normalizedAgentId)) {
      console.log(`[atypica-web] Agent "${normalizedAgentId}" does not exist, creating...`);
      
      // 构建 workspace 路径：~/.openclaw/users/<userId>
      const workspace = path.join(os.homedir(), ".openclaw", "users", userId);
      
      // 不创建 channel-level binding，我们稍后会添加 peer-level binding
      const createResult = await createAgent({
        agentId: normalizedAgentId,
        workspace,
        bind: undefined, // 不创建 channel binding
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

    // 使用 SDK routing 获取 sessionKey（检查当前路由）
    let route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "atypica-web",
      accountId: resolvedAccountId,
      peer: { kind: "dm", id: peerId },
    });

    // 检查是否需要添加 peer-level binding
    // 如果路由到的 agent 不是我们期望的，或者不是通过 peer binding 路由的，则添加 peer binding
    if (route.agentId !== normalizedAgentId || route.matchedBy !== "binding.peer") {
      console.log(`[atypica-web] Adding peer binding for ${peerId} to agent ${normalizedAgentId}`);
      cfg = await addPeerBinding(cfg, {
        agentId: normalizedAgentId,
        channel: "atypica-web",
        accountId: resolvedAccountId,
        peer: { kind: "dm", id: peerId },
      });
      
      // 重新解析路由
      route = core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "atypica-web",
        accountId: resolvedAccountId,
        peer: { kind: "dm", id: peerId },
      });
    }

    console.log(`[atypica-web] Routed to agent: ${route.agentId}, session: ${route.sessionKey}`);

    if (responseMode === "sync") {
      const reply = await callOpenClawCLI({
        message,
        agentId: route.agentId,
        sessionKey: route.sessionKey,
        timeout: 120000,
      });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          mode: "sync",
          sessionKey: route.sessionKey,
          agentId: route.agentId,
          reply,
        }),
      );
      return;
    }

    // 默认 async：立即返回 202 Accepted
    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        mode: "async",
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

/**
 * 添加 peer-level binding 到配置
 */
async function addPeerBinding(
  cfg: OpenClawConfig,
  binding: {
    agentId: string;
    channel: string;
    accountId: string;
    peer: { kind: "dm" | "group" | "channel"; id: string };
  },
): Promise<OpenClawConfig> {
  // 检查 binding 是否已存在
  const existingBindings = cfg.bindings ?? [];
  const bindingKey = `${binding.channel}|${binding.accountId}|${binding.peer.kind}|${binding.peer.id}`;
  const exists = existingBindings.some((b) => {
    const key = `${b.match.channel}|${b.match.accountId || ""}|${b.match.peer?.kind || ""}|${b.match.peer?.id || ""}`;
    return key === bindingKey;
  });

  if (exists) {
    console.log(`[atypica-web] Peer binding already exists for ${binding.peer.id}`);
    return cfg;
  }

  // 添加新的 binding
  const newBinding: AgentBinding = {
    agentId: binding.agentId,
    match: {
      channel: binding.channel,
      accountId: binding.accountId,
      peer: binding.peer,
    },
  };

  const updatedConfig: OpenClawConfig = {
    ...cfg,
    bindings: [...existingBindings, newBinding],
  };

  // 使用 SDK 的 writeConfigFile 写入配置文件
  const core = getAtypicaRuntime();
  try {
    await core.config.writeConfigFile(updatedConfig);
    console.log(`[atypica-web] Added peer binding for ${binding.peer.id} to agent ${binding.agentId}`);
    return updatedConfig;
  } catch (err) {
    console.error(`[atypica-web] Failed to write config file:`, err);
    // 返回更新后的配置（即使写入失败，内存中的配置也是正确的）
    return updatedConfig;
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", (err: Error) => reject(err));
  });
}
