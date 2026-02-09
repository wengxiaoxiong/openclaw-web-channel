import { resolveAtypicaWebConfig } from "./config.js";

export type AtypicaReplyPayload = {
  userId: string;
  projectId?: string;
  text: string;
  type?: "assistant" | "system";
  timestamp?: number;
};

export type AtypicaPushOptions = {
  cfg: unknown;
  accountId?: string | null;
  payload: AtypicaReplyPayload;
  logger?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
};

export async function pushAtypicaReply(params: AtypicaPushOptions): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { cfg, accountId, payload, logger } = params;
  const resolved = resolveAtypicaWebConfig(cfg, accountId ?? undefined);
  const webhookUrl = resolved.webhookUrl?.trim() || process.env.ATYPICA_WEBHOOK_URL?.trim();
  const apiSecret = resolved.apiSecret?.trim() || process.env.ATYPICA_API_SECRET?.trim();

  if (!webhookUrl) {
    logger?.warn?.("[web-channel] webhookUrl not configured, skipping push.");
    return { ok: false, error: "webhookUrl not configured" };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiSecret ? { Authorization: `Bearer ${apiSecret}` } : {}),
      },
      body: JSON.stringify({
        userId: payload.userId,
        ...(payload.projectId != null ? { projectId: payload.projectId } : {}),
        text: payload.text,
        type: payload.type ?? "assistant",
        timestamp: payload.timestamp ?? Date.now(),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, error: `HTTP ${response.status}: ${body}` };
    }
  } catch (err) {
    return { ok: false, error: String(err) };
  }

  return { ok: true };
}
