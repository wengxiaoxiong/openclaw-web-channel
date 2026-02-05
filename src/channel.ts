import {
  type ChannelPlugin,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  getChatChannelMeta,
} from "openclaw/plugin-sdk";
import {
  AtypicaWebConfigSchema,
  listAtypicaWebAccountIds,
  resolveAtypicaWebConfig,
  resolveDefaultAtypicaWebAccountId,
} from "./config.js";
import { pushAtypicaReply } from "./outbound.js";

const meta = getChatChannelMeta("atypica-web");

export const atypicaWebChannelPlugin: ChannelPlugin = {
  id: "atypica-web",
  meta: {
    ...meta,
    id: "atypica-web",
    label: "Atypica Web",
    selectionLabel: "Atypica Web (API)",
    docsPath: "/channels/atypica-web",
    blurb: "Custom web channel for Atypica app integration.",
  },
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  // 关键：添加 configSchema
  configSchema: buildChannelConfigSchema(AtypicaWebConfigSchema),
  config: {
    listAccountIds: (cfg) => listAtypicaWebAccountIds(cfg),
    resolveAccount: (cfg, accountId) => {
      const config = resolveAtypicaWebConfig(cfg, accountId ?? undefined);
      return {
        accountId: accountId ?? DEFAULT_ACCOUNT_ID,
        enabled: config.enabled,
        config,
      };
    },
    defaultAccountId: (cfg) => resolveDefaultAtypicaWebAccountId(cfg),
    isConfigured: (account) => true,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.config?.name ?? account.accountId,
      enabled: account.enabled,
      configured: true,
    }),
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ to, text, accountId, cfg }) => {
      const [userId, projectId] = to.split(":");
      if (!userId || !projectId) {
        console.error("[atypica-web] Invalid 'to' format, expected 'userId:projectId':", to);
        return { ok: false, error: "Invalid recipient format" };
      }

      console.log(`[atypica-web] Pushing reply to user ${userId}, project ${projectId}`);

      const result = await pushAtypicaReply({
        cfg,
        accountId: accountId ?? null,
        payload: {
          userId,
          projectId,
          text,
        },
        logger: console,
      });

      if (!result.ok) {
        console.error("[atypica-web] Failed to push to web service:", result.error);
      }

      return { ok: true, channel: "atypica-web" };
    },
  },
};
