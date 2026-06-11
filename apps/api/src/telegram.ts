import crypto from "node:crypto";
import { Telegram } from "telegraf";
import { config } from "./config.js";

type TelegramInitUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export function validateTelegramInitData(
  initData: string | undefined,
  botToken: string
): TelegramInitUser | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash))) {
    return null;
  }

  const userRaw = params.get("user");
  if (!userRaw) return null;

  return JSON.parse(userRaw) as TelegramInitUser;
}

export function getAdminTelegram(): Telegram | null {
  return config.botTokenAdmin ? new Telegram(config.botTokenAdmin) : null;
}

export function getClientTelegram(): Telegram | null {
  return config.botTokenClient ? new Telegram(config.botTokenClient) : null;
}

export function isAdminTelegramId(id: number | string): boolean {
  return config.adminTelegramIds.includes(String(id));
}
