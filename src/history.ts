import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginHttpRouteHandler } from "openclaw/plugin-sdk";
import { URL } from "node:url";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

function getStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR || path.join(homedir(), ".openclaw");
}

function getStorePath(agentId: string): string {
  return path.join(getStateDir(), "agents", agentId);
}

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
    const userId = url.searchParams.get("userId");
    const projectId = url.searchParams.get("projectId");
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    if (!userId || !projectId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "userId and projectId are required" }));
      return;
    }

    const agentId = "main";
    const sessionKey = `agent:${userId}:project:${projectId}`;
    const storePath = getStorePath(agentId);
    const storeFile = path.join(storePath, "session-store.json");

    // 读取 session entry
    let store: Record<string, any> = {};
    if (fs.existsSync(storeFile)) {
      try {
        store = JSON.parse(fs.readFileSync(storeFile, "utf-8"));
      } catch {}
    }

    const entry = store[sessionKey];
    if (!entry || !entry.sessionId) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Session not found", sessionKey }));
      return;
    }

    // 读取 transcript 文件
    const sessionDir = path.join(storePath, "sessions");
    const transcriptPath = path.join(sessionDir, `${entry.sessionId}.jsonl`);
    
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
    } catch (err) {
      console.error("[atypica-web] Error reading transcript:", err);
    }

    // 限制返回数量
    const sliced = messages.slice(-limit);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: true,
      userId,
      projectId,
      sessionKey,
      messages: sliced,
    }));
  } catch (err: any) {
    console.error("[atypica-web] History handler error:", err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      ok: false,
      error: "Internal Server Error",
      details: err.message,
    }));
  }
};
