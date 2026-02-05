import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, OpenClawPluginHttpRouteHandler } from "openclaw/plugin-sdk";
import { URL } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDefaultAtypicaWebAccountId } from "./config.js";
import { getAtypicaRuntime } from "./runtime.js";

type SessionStore = Record<string, { sessionId?: string; sessionFile?: string }>;

export const handleHistoryRequest: OpenClawPluginHttpRouteHandler = async (
  req: IncomingMessage,
  res: ServerResponse,
) => {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const userId = url.searchParams.get("userId")?.trim();
    const projectId = url.searchParams.get("projectId")?.trim();
    const limit = Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10));
    const accountId = url.searchParams.get("accountId")?.trim() || undefined;

    if (!userId || !projectId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "userId and projectId are required" }));
      return;
    }

    const core = getAtypicaRuntime();
    const cfg = core.config.loadConfig() as OpenClawConfig;
    const resolvedAccountId = accountId ?? resolveDefaultAtypicaWebAccountId(cfg);
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "atypica-web",
      accountId: resolvedAccountId,
      peer: { kind: "dm", id: `${userId}:${projectId}` },
    });

    // 根据用户需求，路径格式是：~/.openclaw/agents/<agentId>/sessions/sessions.json
    const sessionsFilePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    // sessionsFilePath 应该是 ~/.openclaw/agents/<agentId>/sessions/sessions.json
    // sessionsDir 是 sessions.json 所在的目录（即 sessions 目录）
    const sessionsDir = path.dirname(sessionsFilePath);
    const storeFile = sessionsFilePath;

    let store: SessionStore = {};
    if (fs.existsSync(storeFile)) {
      try {
        store = JSON.parse(fs.readFileSync(storeFile, "utf-8")) as SessionStore;
      } catch {
        store = {};
      }
    }

    const entry = store[route.sessionKey];
    if (!entry?.sessionId) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Session not found", sessionKey: route.sessionKey }));
      return;
    }

    // session transcript 文件路径：sessions/{sessionId}.jsonl
    // 如果 entry.sessionFile 存在且是绝对路径，使用它；否则使用默认路径
    let sessionFile: string;
    if (entry.sessionFile) {
      if (path.isAbsolute(entry.sessionFile)) {
        sessionFile = entry.sessionFile;
      } else {
        // 相对于 sessions 目录
        sessionFile = path.join(sessionsDir, entry.sessionFile);
      }
    } else {
      // 默认路径：sessions/{sessionId}.jsonl
      sessionFile = path.join(sessionsDir, `${entry.sessionId}.jsonl`);
    }

    // 解析消息，根据用户需求：找到最后一次 user 消息，返回从那之后的所有消息
    interface HistoryMessage {
      role: "user" | "assistant" | "toolResult";
      content: string;
      timestamp?: string;
    }

    const allMessages: HistoryMessage[] = [];
    if (fs.existsSync(sessionFile)) {
      const content = fs.readFileSync(sessionFile, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;

          // 跳过 session 元数据
          if (entry.type === "session") {
            continue;
          }

          // 提取消息内容
          if (entry.message && typeof entry.message === "object") {
            const msg = entry.message as Record<string, unknown>;
            const role = msg.role as string;

            if (role === "user" || role === "assistant" || role === "toolResult") {
              // 提取文本内容
              let content = "";
              if (Array.isArray(msg.content)) {
                content = msg.content
                  .map((item) => {
                    if (typeof item === "object" && item !== null) {
                      const itemObj = item as Record<string, unknown>;
                      if (itemObj.type === "text" && typeof itemObj.text === "string") {
                        return itemObj.text;
                      }
                    }
                    return "";
                  })
                  .filter(Boolean)
                  .join("\n");
              } else if (typeof msg.content === "string") {
                content = msg.content;
              }

              if (content) {
                allMessages.push({
                  role: role as "user" | "assistant" | "toolResult",
                  content,
                  timestamp: entry.timestamp as string | undefined,
                });
              }
            }
          }
        } catch {
          // 忽略无效的 JSON 行
          continue;
        }
      }
    }

    // 找到最后一次 user 消息的索引
    let lastUserIndex = -1;
    for (let i = allMessages.length - 1; i >= 0; i--) {
      if (allMessages[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }

    // 返回最后一次 user 消息之后的所有消息
    // 如果没有找到 user 消息，返回所有消息
    const messages =
      lastUserIndex >= 0 ? allMessages.slice(lastUserIndex + 1) : allMessages;

    // 如果指定了 limit，只返回最后 limit 条
    const sliced = limit > 0 ? messages.slice(-limit) : messages;

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        userId,
        projectId,
        sessionKey: route.sessionKey,
        messages: sliced,
      }),
    );
  } catch (err: unknown) {
    console.error("[atypica-web] History handler error:", err);
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
