import "dotenv/config";
import { Telegraf, Markup, type Context } from "telegraf";

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

bot.hears("Открыть магазин", async (ctx) => {
  await ctx.reply(
    "Нажмите кнопку ниже, чтобы открыть магазин.",
    Markup.inlineKeyboard([
      Markup.button.webApp("Открыть магазин", webAppUrl)
    ])
  );
});

bot.catch((error) => {
  console.error("Client bot error", error);
});

bot.launch(async () => {
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Открыть магазин" },
      { command: "shop", description: "Открыть магазин" }
    ]);
    await bot.telegram.setChatMenuButton({
      menuButton: {
        type: "web_app",
        text: "Открыть магазин",
        web_app: { url: webAppUrl }
      }
    });
  } catch (error) {
    console.error("Failed to set client bot menu", error);
  }
  console.log("Client bot is running");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
