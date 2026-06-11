import "dotenv/config";
import { Telegraf, Markup } from "telegraf";

const token = process.env.BOT_TOKEN_CLIENT;
const webAppUrl = process.env.WEBAPP_URL;

if (!token) {
  throw new Error("BOT_TOKEN_CLIENT is required");
}

if (!webAppUrl) {
  throw new Error("WEBAPP_URL is required");
}

const bot = new Telegraf(token);

bot.start(async (ctx) => {
  await ctx.reply(
    "Добро пожаловать! Откройте магазин, выберите продукты и отправьте заказ с геолокацией.",
    Markup.inlineKeyboard([
      Markup.button.webApp("Открыть магазин", webAppUrl)
    ])
  );
});

bot.command("shop", async (ctx) => {
  await ctx.reply("Магазин готов к заказу.", Markup.inlineKeyboard([
    Markup.button.webApp("Открыть магазин", webAppUrl)
  ]));
});

bot.catch((error) => {
  console.error("Client bot error", error);
});

bot.launch(() => {
  console.log("Client bot is running");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
