import "dotenv/config";
import { Telegraf, type Context } from "telegraf";

const token = process.env.BOT_TOKEN_CLIENT;
const webAppUrl = process.env.WEBAPP_URL;

if (!token) {
  throw new Error("BOT_TOKEN_CLIENT is required");
}

if (!webAppUrl) {
  throw new Error("WEBAPP_URL is required");
}

const bot = new Telegraf(token);

const shopMenu = {
  reply_markup: {
    keyboard: [
      [{ text: "Открыть магазин", web_app: { url: webAppUrl } }]
    ],
    resize_keyboard: true,
    is_persistent: true
  }
};

async function showShopMenu(ctx: Context) {
  await ctx.reply(
    "Добро пожаловать! Нажмите кнопку внизу, чтобы открыть магазин.",
    shopMenu
  );
}

bot.start(showShopMenu);

bot.command("shop", async (ctx) => {
  await ctx.reply("Магазин готов к заказу.", shopMenu);
});

bot.catch((error) => {
  console.error("Client bot error", error);
});

bot.launch(async () => {
  try {
    await bot.telegram.deleteMyCommands();
    await bot.telegram.setChatMenuButton({
      menuButton: { type: "default" }
    });
  } catch (error) {
    console.error("Failed to clear client bot menu", error);
  }
  console.log("Client bot is running");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
