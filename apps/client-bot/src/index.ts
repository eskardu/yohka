import "dotenv/config";
import crypto from "node:crypto";
import { Telegraf, type Context } from "telegraf";

const token = process.env.BOT_TOKEN_CLIENT;
const webAppUrl = process.env.WEBAPP_URL;

if (!token) {
  throw new Error("BOT_TOKEN_CLIENT is required");
}

if (!webAppUrl) {
  throw new Error("WEBAPP_URL is required");
}

const botToken = token;
const appUrl = webAppUrl;

const bot = new Telegraf(botToken);

function buildSignedWebAppUrl(ctx: Context) {
  if (!ctx.from) return appUrl;

  const url = new URL(appUrl);
  const authDate = String(Math.floor(Date.now() / 1000));
  const payload = [
    String(ctx.from.id),
    ctx.from.username ?? "",
    ctx.from.first_name ?? "",
    ctx.from.last_name ?? "",
    authDate
  ].join("\n");
  const signature = crypto.createHmac("sha256", botToken).update(payload).digest("hex");

  url.searchParams.set("tg_id", String(ctx.from.id));
  url.searchParams.set("tg_auth", authDate);
  url.searchParams.set("tg_sig", signature);
  if (ctx.from.username) url.searchParams.set("tg_username", ctx.from.username);
  if (ctx.from.first_name) url.searchParams.set("tg_first_name", ctx.from.first_name);
  if (ctx.from.last_name) url.searchParams.set("tg_last_name", ctx.from.last_name);

  return url.toString();
}

function shopMenu(ctx: Context) {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "Открыть магазин", web_app: { url: buildSignedWebAppUrl(ctx) } }]
      ],
      resize_keyboard: true,
      is_persistent: true
    }
  };
}

async function showShopMenu(ctx: Context) {
  await ctx.reply(
    "Добро пожаловать! Нажмите кнопку внизу, чтобы открыть магазин.",
    shopMenu(ctx)
  );
}

bot.start(showShopMenu);

bot.command("shop", async (ctx) => {
  await ctx.reply("Магазин готов к заказу.", shopMenu(ctx));
});

bot.catch((error) => {
  console.error("Client bot error", error);
});

bot.launch(async () => {
  try {
    await bot.telegram.deleteMyCommands();
    await bot.telegram.setChatMenuButton({ menuButton: { type: "default" } });
  } catch (error) {
    console.error("Failed to clear client bot menu", error);
  }
  console.log("Client bot is running");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
