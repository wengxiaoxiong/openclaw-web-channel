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

    const sessionsFilePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    const storePath = path.dirname(sessionsFilePath);
    const storeFile = path.join(storePath, "session-store.json");

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

    const sessionFile = path.join(storePath, `${entry.sessionId}.jsonl`);

    let messages: Array<Record<string, unknown>> = [];
    if (fs.existsSync(sessionFile)) {
      const content = fs.readFileSync(sessionFile, "utf-8");
      messages = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((line): line is Record<string, unknown> => Boolean(line))
        .filter((line) => line.type !== "session");
    }

    const sliced = messages.slice(-limit);

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
