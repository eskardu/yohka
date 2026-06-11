import "dotenv/config";
import { Telegraf, Markup, type Context } from "telegraf";
import { formatMoney, type OrderStatus } from "@yohkar/shared";

const token = process.env.BOT_TOKEN_ADMIN;
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const adminIds = (process.env.ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (!token) {
  throw new Error("BOT_TOKEN_ADMIN is required");
}

const bot = new Telegraf(token);

function isAdmin(id?: number) {
  return id ? adminIds.includes(String(id)) : false;
}

bot.use(async (ctx, next) => {
  if (!isAdmin(ctx.from?.id)) {
    await ctx.reply("Нет доступа.");
    return;
  }
  await next();
});

bot.start((ctx) => showAdminMenu(ctx));
bot.command("admin", (ctx) => showAdminMenu(ctx));

bot.action("orders:new", async (ctx) => {
  await ctx.answerCbQuery();
  await sendOrders(ctx, "NEW");
});

bot.action("orders:delivery", async (ctx) => {
  await ctx.answerCbQuery();
  await sendOrders(ctx, "ON_DELIVERY");
});

bot.action("stats:today", async (ctx) => {
  await ctx.answerCbQuery();
  await sendStats(ctx, "today");
});

bot.action("stats:week", async (ctx) => {
  await ctx.answerCbQuery();
  await sendStats(ctx, "week");
});

bot.action("route:today", async (ctx) => {
  await ctx.answerCbQuery();
  await sendTodayRoute(ctx);
});

bot.action(/^order:(.+):(ON_DELIVERY|DELIVERED|CANCELLED)$/, async (ctx) => {
  const [, orderId, status] = ctx.match;
  const response = await fetch(`${apiBaseUrl}/api/orders/${orderId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    await ctx.answerCbQuery("Не удалось обновить заказ");
    return;
  }

  const order = await response.json() as { orderNumber: number };
  await ctx.answerCbQuery("Готово");

  if (status === "ON_DELIVERY") {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          {
            text: "Уведомить: заказ доставлен",
            callback_data: `order:${orderId}:DELIVERED`
          }
        ]
      ]
    });
    await ctx.reply(`Заказ #${order.orderNumber}: клиенту отправлено уведомление "Скоро заказ будет доставлен".`);
    return;
  }

  if (status === "DELIVERED") {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(`Заказ #${order.orderNumber}: клиенту отправлено уведомление "Заказ доставлен, ждет на улице".`);
    return;
  }

  await ctx.reply(`Заказ #${order.orderNumber}: отменен.`);
});

bot.command("route", async (ctx) => {
  await sendTodayRoute(ctx);
});

async function sendTodayRoute(ctx: Context) {
  const response = await fetch(`${apiBaseUrl}/api/admin/routes/today`);
  const route = await response.json() as {
    url: string;
    sorted: Array<{ orderNumber: number; latitude: number; longitude: number }>;
  };

  if (!route.sorted.length) {
    await ctx.reply("На сегодня нет заказов со статусом принят/в доставке и геолокацией.");
    return;
  }

  const orderList = route.sorted
    .map((order, index) => `${index + 1}. Заказ #${order.orderNumber}`)
    .join("\n");

  await ctx.reply(`Порядок доставки:\n${orderList}`, Markup.inlineKeyboard([
    Markup.button.url("Открыть общий маршрут", route.url)
  ]));
}

async function showAdminMenu(ctx: Context) {
  await ctx.reply(
    "Админ-меню",
    Markup.inlineKeyboard([
      [Markup.button.callback("Новые заказы", "orders:new"), Markup.button.callback("В доставке", "orders:delivery")],
      [Markup.button.callback("Статистика сегодня", "stats:today"), Markup.button.callback("Неделя", "stats:week")],
      [Markup.button.callback("Построить общий маршрут", "route:today")]
    ])
  );
}

async function sendOrders(ctx: Context, status: OrderStatus) {
  const response = await fetch(`${apiBaseUrl}/api/orders?status=${status}`);
  const orders = await response.json() as Array<{
    id: string;
    orderNumber: number;
    customerName: string;
    customerPhone: string;
    totalAmount: string;
    user?: { username?: string | null };
    items: Array<{ productNameSnapshot: string; quantity: string; totalPrice: string }>;
  }>;

  if (!orders.length) {
    await ctx.reply("Заказов нет.");
    return;
  }

  for (const order of orders.slice(0, 10)) {
    const username = order.user?.username ? `@${order.user.username}` : "не указан";
    const items = order.items
      .map((item, index) => `${index + 1}. ${item.productNameSnapshot}: ${Number(item.quantity)} = ${formatMoney(item.totalPrice)}`)
      .join("\n");

    await ctx.reply(
      [
        `Заказ #${order.orderNumber}`,
        `Клиент: ${order.customerName}`,
        `Телефон: ${order.customerPhone}`,
        `Telegram: ${username}`,
        "",
        "Товары:",
        items,
        "",
        `К оплате: ${formatMoney(order.totalAmount)}`
      ].join("\n"),
      Markup.inlineKeyboard([
        [
          Markup.button.callback("Уведомить: скоро доставка", `order:${order.id}:ON_DELIVERY`)
        ]
      ])
    );
  }
}

async function sendStats(ctx: Context, period: "today" | "week") {
  const response = await fetch(`${apiBaseUrl}/api/admin/stats?period=${period}`);
  const stats = await response.json() as {
    orderCount: number;
    salesTotal: number;
    costTotal: number;
    profitTotal: number;
    averageCheck: number;
    bestSellingProducts: Array<{ name: string; quantity: number }>;
  };

  const best = stats.bestSellingProducts
    .map((item, index) => `${index + 1}. ${item.name}: ${item.quantity}`)
    .join("\n") || "нет данных";

  await ctx.reply(
    [
      `Статистика: ${period}`,
      `Заказов: ${stats.orderCount}`,
      `Продажи: ${formatMoney(stats.salesTotal)}`,
      `Себестоимость: ${formatMoney(stats.costTotal)}`,
      `Прибыль: ${formatMoney(stats.profitTotal)}`,
      `Средний чек: ${formatMoney(stats.averageCheck)}`,
      "",
      "Топ продаж:",
      best
    ].join("\n")
  );
}

bot.catch((error) => {
  console.error("Admin bot error", error);
});

bot.launch(() => {
  console.log("Admin bot is running");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
