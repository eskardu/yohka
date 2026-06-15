import crypto from "node:crypto";
import { Telegram } from "telegraf";
import { config } from "./config.js";

export type TelegramInitUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramFallbackUser = TelegramInitUser & {
  auth_date: string;
  sig: string;
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

export function validateTelegramFallbackData(
  fallback: TelegramFallbackUser | undefined,
  botToken: string
): TelegramInitUser | null {
  if (!fallback || !botToken) return null;

  const authTime = Number(fallback.auth_date);
  if (!Number.isFinite(authTime)) return null;

  const maxAgeSeconds = 60 * 60 * 24 * 365;
  if (Math.abs(Date.now() / 1000 - authTime) > maxAgeSeconds) return null;

  const payload = [
    String(fallback.id),
    fallback.username ?? "",
    fallback.first_name ?? "",
    fallback.last_name ?? "",
    fallback.auth_date
  ].join("\n");
  const computed = crypto.createHmac("sha256", botToken).update(payload).digest("hex");

  const computedBuffer = Buffer.from(computed);
  const signatureBuffer = Buffer.from(fallback.sig);
  if (computedBuffer.length !== signatureBuffer.length) return null;
  if (!crypto.timingSafeEqual(computedBuffer, signatureBuffer)) return null;

  return {
    id: fallback.id,
    first_name: fallback.first_name,
    last_name: fallback.last_name,
    username: fallback.username
  };
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
