import { Type, type Static } from "@sinclair/typebox";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";

export const AtypicaWebAccountConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    name: Type.Optional(Type.String()),
    webhookUrl: Type.Optional(Type.String()),
    apiSecret: Type.Optional(Type.String()),
    allowFrom: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export const AtypicaWebConfigSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean({ default: true })),
    name: Type.Optional(Type.String()),
    webhookUrl: Type.Optional(Type.String()),
    apiSecret: Type.Optional(Type.String()),
    allowFrom: Type.Optional(Type.Array(Type.String())),
    accounts: Type.Optional(Type.Record(Type.String(), AtypicaWebAccountConfigSchema)),
  },
  { additionalProperties: false },
);

export type AtypicaWebAccountConfig = Static<typeof AtypicaWebAccountConfigSchema>;
export type AtypicaWebConfig = Static<typeof AtypicaWebConfigSchema>;

export function resolveAtypicaWebConfig(cfg: unknown, accountId?: string): AtypicaWebAccountConfig {
  const base = (cfg as Record<string, unknown>)?.channels?.["atypica-web"] as
    | AtypicaWebConfig
    | undefined;
  const accounts = base?.accounts ?? {};
  const account = accountId ? accounts[accountId] : undefined;

  return {
    enabled: account?.enabled ?? base?.enabled ?? true,
    name: account?.name ?? base?.name,
    webhookUrl: account?.webhookUrl ?? base?.webhookUrl,
    apiSecret: account?.apiSecret ?? base?.apiSecret,
    allowFrom: account?.allowFrom ?? base?.allowFrom ?? [],
  };
}

export function listAtypicaWebAccountIds(cfg: unknown): string[] {
  const base = (cfg as Record<string, unknown>)?.channels?.["atypica-web"] as
    | AtypicaWebConfig
    | undefined;
  const ids = new Set<string>();

  if (base?.webhookUrl || base?.enabled !== undefined) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  const accounts = base?.accounts;
  if (accounts && typeof accounts === "object") {
    Object.keys(accounts).forEach((id) => ids.add(id));
  }

  return Array.from(ids);
}

export function resolveDefaultAtypicaWebAccountId(cfg: unknown): string {
  const ids = listAtypicaWebAccountIds(cfg);
  return ids.includes(DEFAULT_ACCOUNT_ID) ? DEFAULT_ACCOUNT_ID : ids[0] ?? DEFAULT_ACCOUNT_ID;
}
