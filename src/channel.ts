import {
  type ChannelPlugin,
  DEFAULT_ACCOUNT_ID,
  getChatChannelMeta,
} from "openclaw/plugin-sdk";

// 手动定义 JSON schema（绕过 buildChannelConfigSchema）
const atypicaWebConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: true },
    name: { type: "string" },
    webhookUrl: { type: "string" },
    apiSecret: { type: "string" },
    allowFrom: { 
      type: "array", 
      items: { type: "string" } 
    },
    accounts: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          name: { type: "string" },
          webhookUrl: { type: "string" },
          apiSecret: { type: "string" },
          allowFrom: { 
            type: "array", 
            items: { type: "string" } 
          },
        },
      },
    },
  },
};

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
  // 直接提供 schema 对象
  configSchema: { schema: atypicaWebConfigSchema },
  config: {
    listAccountIds: (cfg) => {
      const base = cfg?.channels?.["atypica-web"];
      const ids = new Set<string>();
      if (base?.webhookUrl || base?.enabled !== undefined) {
        ids.add(DEFAULT_ACCOUNT_ID);
      }
      const accounts = base?.accounts;
      if (accounts && typeof accounts === "object") {
        Object.keys(accounts).forEach(id => ids.add(id));
      }
      return Array.from(ids);
    },
    resolveAccount: (cfg, accountId) => {
      const base = cfg?.channels?.["atypica-web"] ?? {};
      const accounts = base?.accounts ?? {};
      const account = accountId ? accounts[accountId] : undefined;
      
      const config = {
        enabled: account?.enabled ?? base?.enabled ?? true,
        name: account?.name ?? base?.name,
        webhookUrl: account?.webhookUrl ?? base?.webhookUrl,
        apiSecret: account?.apiSecret ?? base?.apiSecret,
        allowFrom: account?.allowFrom ?? base?.allowFrom ?? [],
      };

      return {
        accountId: accountId ?? DEFAULT_ACCOUNT_ID,
        enabled: config.enabled,
        config,
      };
    },
    defaultAccountId: (cfg) => {
      const ids = cfg?.channels?.["atypica-web"]?.accounts ? 
        Object.keys(cfg.channels["atypica-web"].accounts) : [];
      return ids.length > 0 ? ids[0] : DEFAULT_ACCOUNT_ID;
    },
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
    sendText: async ({ to, text, accountId }) => {
      const [userId, projectId] = to.split(":");
      if (!userId || !projectId) {
        console.error("[atypica-web] Invalid 'to' format, expected 'userId:projectId':", to);
        return { ok: false, error: "Invalid recipient format" };
      }

      console.log(`[atypica-web] Pushing reply to user ${userId}, project ${projectId}`);

      const pushUrl = process.env.ATYPICA_WEBHOOK_URL ?? 
        (accountId ? process.env[`ATYPICA_WEBHOOK_URL_${accountId.toUpperCase()}`] : undefined);
        
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
        }
      } else {
        console.warn("[atypica-web] ATYPICA_WEBHOOK_URL not set, skipping push.");
      }

      return { ok: true, channel: "atypica-web" };
    },
  },
};
