import { z } from "zod";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";

export const AtypicaWebAccountConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(),
    webhookUrl: z.string().optional(),
    apiSecret: z.string().optional(),
    inboundApiKey: z.string().optional(),
    allowFrom: z.array(z.string()).optional(),
  })
  .strict();

export const AtypicaWebConfigSchema = z
  .object({
    enabled: z.boolean().optional().default(true),
    name: z.string().optional(),
    webhookUrl: z.string().optional(),
    apiSecret: z.string().optional(),
    inboundApiKey: z.string().optional(),
    allowFrom: z.array(z.string()).optional(),
    accounts: z.record(z.string(), AtypicaWebAccountConfigSchema).optional(),
  })
  .strict();

export type AtypicaWebAccountConfig = z.infer<typeof AtypicaWebAccountConfigSchema>;
export type AtypicaWebConfig = z.infer<typeof AtypicaWebConfigSchema>;

export function resolveAtypicaWebConfig(cfg: unknown, accountId?: string): AtypicaWebAccountConfig {
  const base = (cfg as Record<string, unknown>)?.channels?.["web-channel"] as
    | AtypicaWebConfig
    | undefined;
  const accounts = base?.accounts ?? {};
  const account = accountId ? accounts[accountId] : undefined;

  return {
    enabled: account?.enabled ?? base?.enabled ?? true,
    name: account?.name ?? base?.name,
    webhookUrl: account?.webhookUrl ?? base?.webhookUrl,
    apiSecret: account?.apiSecret ?? base?.apiSecret,
    inboundApiKey: account?.inboundApiKey ?? base?.inboundApiKey,
    allowFrom: account?.allowFrom ?? base?.allowFrom ?? [],
  };
}

export function listAtypicaWebAccountIds(cfg: unknown): string[] {
  const base = (cfg as Record<string, unknown>)?.channels?.["web-channel"] as
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
