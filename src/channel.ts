import {
  type ChannelPlugin,
  type OpenClawConfig,
  type ReplyPayload,
} from "openclaw/plugin-sdk";

export const atypicaWebChannelPlugin: ChannelPlugin = {
  id: "atypica-web",
  meta: {
    id: "atypica-web",
    label: "Atypica Web",
    selectionLabel: "Atypica Web (API)",
    docsPath: "/channels/atypica-web",
    blurb: "Custom web channel for Atypica.",
  },
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (_cfg, accountId) => ({
      accountId: accountId ?? "default",
      enabled: true,
      config: {},
    }),
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId }) => {
      // 'to' is expected to be 'userId:projectId'
      const [userId, projectId] = to.split(":");
      if (!userId || !projectId) {
        console.error("[atypica-web] Invalid 'to' format, expected 'userId:projectId':", to);
        return { ok: false, error: "Invalid recipient format" };
      }

      console.log(`[atypica-web] Pushing reply to user ${userId}, project ${projectId}`);

      // In a real implementation, this would be your web service's webhook URL
      // For now we log it. You should set an environment variable or config for the URL.
      const pushUrl = process.env.ATYPICA_WEBHOOK_URL;
      if (pushUrl) {
        try {
          const response = await fetch(pushUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.ATYPICA_API_SECRET}`,
            },
            body: JSON.stringify({
              userId,
              projectId,
              text,
              type: "assistant",
              timestamp: Date.now(),
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
          }
        } catch (err) {
          console.error("[atypica-web] Failed to push to web service:", err);
          // We still return ok: true to OpenClaw because the agent finished its work
        }
      } else {
        console.warn("[atypica-web] ATYPICA_WEBHOOK_URL not set, skipping push.");
      }

      return { ok: true, channel: "atypica-web" };
    },
  },
};
