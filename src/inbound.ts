import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawConfig, OpenClawPluginHttpRouteHandler } from "openclaw/plugin-sdk";
import { createReplyPrefixOptions } from "openclaw/plugin-sdk";
import {
  resolveAtypicaWebConfig,
  resolveDefaultAtypicaWebAccountId,
} from "./config.js";
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

function normalizeAllowEntry(entry: string): string {
  return entry.replace(/^atypica-web:(?:user:)?/i, "").trim();
}

function isAllowedSender(allowFrom: string[] | undefined, userId: string): boolean {
  const list = (allowFrom ?? []).map((entry) => normalizeAllowEntry(String(entry)));
  if (list.length === 0) {
    return true;
  }
  if (list.includes("*")) {
    return true;
  }
  return list.includes(userId);
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
    const resolvedAccountId =
      payload.accountId?.trim() || resolveDefaultAtypicaWebAccountId(cfg);
    const accountConfig = resolveAtypicaWebConfig(cfg, resolvedAccountId);

    if (accountConfig.enabled === false) {
      res.statusCode = 403;
      res.end(JSON.stringify({ ok: false, error: "Account disabled" }));
      return;
    }

    if (!isAllowedSender(accountConfig.allowFrom, userId)) {
      res.statusCode = 403;
      res.end(JSON.stringify({ ok: false, error: "Sender not allowed" }));
      return;
    }

    const peerId = `${userId}:${projectId}`;
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "atypica-web",
      accountId: resolvedAccountId,
      peer: { kind: "dm", id: peerId },
    });

    const storePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    const previousTimestamp = core.channel.session.readSessionUpdatedAt({
      storePath,
      sessionKey: route.sessionKey,
    });

    const rawBody = message;
    const bodyText = core.channel.reply.formatAgentEnvelope({
      channel: "Atypica Web",
      from: `user:${userId}`,
      timestamp: payload.timestamp ?? Date.now(),
      previousTimestamp,
      envelope: core.channel.reply.resolveEnvelopeFormatOptions(cfg),
      body: rawBody,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: bodyText,
      RawBody: rawBody,
      CommandBody: rawBody,
      From: `atypica-web:user:${userId}`,
      To: `atypica-web:project:${projectId}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: "direct",
      ConversationLabel: `project:${projectId}`,
      SenderId: userId,
      SenderName: userId,
      Provider: "atypica-web",
      Surface: "atypica-web",
      MessageSid: payload.messageId,
      Timestamp: payload.timestamp ?? Date.now(),
      OriginatingChannel: "atypica-web",
      OriginatingTo: `atypica-web:project:${projectId}`,
    });

    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      updateLastRoute: {
        sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
        channel: "atypica-web",
        to: `${userId}:${projectId}`,
        accountId: route.accountId,
      },
      onRecordError: (err) => {
        console.error("[atypica-web] Failed updating session meta:", err);
      },
    });

    const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
      cfg,
      agentId: route.agentId,
      channel: "atypica-web",
      accountId: route.accountId,
    });

    void core.channel.reply
      .dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg,
        dispatcherOptions: {
          ...prefixOptions,
          deliver: async (reply) => {
            if (!reply?.text?.trim()) {
              return;
            }
            const result = await pushAtypicaReply({
              cfg,
              accountId: route.accountId,
              payload: {
                userId,
                projectId,
                text: reply.text,
              },
              logger: console,
            });
            if (!result.ok) {
              console.error("[atypica-web] Failed to deliver reply:", result.error);
            }
          },
          onError: (err, info) => {
            console.error(`[atypica-web] ${info.kind} reply failed:`, err);
          },
        },
        replyOptions: {
          onModelSelected,
        },
      })
      .catch((err) => {
        console.error("[atypica-web] Reply dispatch failed:", err);
      });

    res.statusCode = 202;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        message: "Message received",
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
