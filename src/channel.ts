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
      // CLI 模式下，回复由 inbound 处理器捕获并推送
      // 这里只记录日志作为备用
      console.log(`[atypica-web] sendText called (CLI mode, no-op): to=${to}, text=${text.substring(0, 50)}...`);
      return { ok: true, channel: "atypica-web" };
    },
  },
};
