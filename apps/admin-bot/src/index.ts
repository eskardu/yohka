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

type StatPeriod = "today" | "week" | "month" | "year";

const adminMenu = {
  reply_markup: {
    keyboard: [
      ["Скоро доставка"],
      ["Общий маршрут", "Статистика"],
      ["Сброс статистики"]
    ],
    resize_keyboard: true,
    is_persistent: true
  }
};

const statsKeyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback("Сегодня", "stats:today"),
    Markup.button.callback("Неделя", "stats:week")
  ],
  [
    Markup.button.callback("Месяц", "stats:month"),
    Markup.button.callback("Год", "stats:year")
  ]
]);

const resetStatsKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("Да, сбросить статистику", "stats:reset:confirm")],
  [Markup.button.callback("Отмена", "stats:reset:cancel")]
]);

const statPeriodLabels: Record<StatPeriod, string> = {
  today: "сегодня",
  week: "за неделю",
  month: "за месяц",
  year: "за год"
};

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

bot.hears("Скоро доставка", async (ctx) => {
  await notifyDeliverySoon(ctx);
});

bot.hears("Общий маршрут", async (ctx) => {
  await sendTodayRoute(ctx);
});

bot.hears("Статистика", async (ctx) => {
  await showStatsMenu(ctx);
});

bot.hears("Сброс статистики", async (ctx) => {
  await ctx.reply(
    "Сбросить статистику? Будут удалены доставленные и отмененные заказы. Активные заказы останутся.",
    resetStatsKeyboard
  );
});

bot.action("orders:new", async (ctx) => {
  await ctx.answerCbQuery();
  await sendOrders(ctx, "NEW");
});

bot.action("orders:delivery", async (ctx) => {
  await ctx.answerCbQuery();
  await sendOrders(ctx, "ON_DELIVERY");
});

bot.action("orders:notify-soon", async (ctx) => {
  await ctx.answerCbQuery();
  await notifyDeliverySoon(ctx);
});

bot.action(/^stats:(today|week|month|year)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await sendStats(ctx, ctx.match[1] as StatPeriod);
});

bot.action("stats:reset:cancel", async (ctx) => {
  await ctx.answerCbQuery("Отменено");
  await ctx.editMessageText("Сброс статистики отменен.");
});

bot.action("stats:reset:confirm", async (ctx) => {
  await ctx.answerCbQuery();
  const response = await fetch(`${apiBaseUrl}/api/admin/stats/reset`, { method: "POST" });

  if (!response.ok) {
    await ctx.editMessageText("Не удалось сбросить статистику.");
    return;
  }

  const result = await response.json() as { deletedOrders: number };
  await ctx.editMessageText(`Статистика сброшена. Удалено заказов: ${result.deletedOrders}.`);
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

  if (status === "DELIVERED") {
    try {
      await ctx.deleteMessage();
    } catch (error) {
      console.error("Failed to delete delivered order message", error);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    }
    return;
  }

  if (status === "ON_DELIVERY") {
    await ctx.editMessageReplyMarkup({
      inline_keyboard: [
        [
          {
            text: "Доставлено",
            callback_data: `order:${orderId}:DELIVERED`
          }
        ]
      ]
    });
    await ctx.reply(
      `Заказ #${order.orderNumber}: клиенту отправлено уведомление "Скоро заказ будет доставлен".`,
      adminMenu
    );
    return;
  }

  await ctx.reply(`Заказ #${order.orderNumber}: отменен.`, adminMenu);
});

bot.command("route", async (ctx) => {
  await sendTodayRoute(ctx);
});

async function showAdminMenu(ctx: Context) {
  await ctx.reply("Админ-меню закреплено внизу.", adminMenu);
}

async function showStatsMenu(ctx: Context) {
  await ctx.reply("Выберите период статистики:", statsKeyboard);
}

async function notifyDeliverySoon(ctx: Context) {
  const response = await fetch(`${apiBaseUrl}/api/orders/notify-delivery-soon`, {
    method: "POST"
  });

  if (!response.ok) {
    await ctx.reply("Не удалось отправить массовое уведомление.", adminMenu);
    return;
  }

  const result = await response.json() as {
    totalOrders: number;
    notifiedUsers: number;
    failedUsers: number;
  };

  if (result.totalOrders === 0) {
    await ctx.reply("Активных заказов для уведомления нет.", adminMenu);
    return;
  }

  await ctx.reply(
    [
      "Уведомление о скорой доставке отправлено.",
      `Активных заказов: ${result.totalOrders}`,
      `Клиентов уведомлено: ${result.notifiedUsers}`,
      `Ошибок отправки: ${result.failedUsers}`
    ].join("\n"),
    adminMenu
  );
}

async function sendTodayRoute(ctx: Context) {
  const response = await fetch(`${apiBaseUrl}/api/admin/routes/today`);
  const route = await response.json() as {
    url: string;
    sorted: Array<{ orderNumber: number; latitude: number; longitude: number }>;
  };

  if (!route.sorted.length) {
    await ctx.reply("На сегодня нет заказов со статусом принят/в доставке и геолокацией.", adminMenu);
    return;
  }

  const orderList = route.sorted
    .map((order, index) => `${index + 1}. Заказ #${order.orderNumber}`)
    .join("\n");

  await ctx.reply(
    `Порядок доставки:\n${orderList}`,
    Markup.inlineKeyboard([
      Markup.button.url("Открыть общий маршрут", route.url)
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
    await ctx.reply("Заказов нет.", adminMenu);
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
        `Клиент: ${username}`,
        `Контакт: ${order.customerPhone || "не указан"}`,
        "",
        "Товары:",
        items,
        "",
        `К оплате: ${formatMoney(order.totalAmount)}`
      ].join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("Доставлено", `order:${order.id}:DELIVERED`)]
      ])
    );
  }
}

async function sendStats(ctx: Context, period: StatPeriod) {
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
      `Статистика ${statPeriodLabels[period]}`,
      `Заказов: ${stats.orderCount}`,
      `Продажи: ${formatMoney(stats.salesTotal)}`,
      `Себестоимость: ${formatMoney(stats.costTotal)}`,
      `Прибыль: ${formatMoney(stats.profitTotal)}`,
      `Средний чек: ${formatMoney(stats.averageCheck)}`,
      "",
      "Топ продаж:",
      best
    ].join("\n"),
    adminMenu
  );
}

bot.catch((error) => {
  console.error("Admin bot error", error);
});

bot.launch(async () => {
  try {
    await bot.telegram.deleteMyCommands();
  } catch (error) {
    console.error("Failed to clear admin bot commands", error);
  }
  console.log("Admin bot is running");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
