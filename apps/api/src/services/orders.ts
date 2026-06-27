import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "@yohkar/database";
import { formatMoney, type CheckoutInput } from "@yohkar/shared";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { formatCustomerOrderConfirmation, formatOrderMessage } from "../formatters.js";
import {
  getAdminTelegram,
  getClientTelegram,
  validateTelegramFallbackData,
  validateTelegramInitData
} from "../telegram.js";

function decimal(value: number) {
  return new Prisma.Decimal(value);
}

function calculateDeliveryFee(subtotal: number, totalKg: number) {
  if (subtotal >= config.freeDeliveryFromAmount) return 0;
  if (totalKg >= config.freeDeliveryFromKg) return 0;
  return config.deliveryFee;
}

export async function createOrder(input: CheckoutInput) {
  const validatedTelegramUser = validateTelegramInitData(input.initData, config.botTokenClient);
  const fallbackTelegramUser = validateTelegramFallbackData(input.telegramFallback, config.botTokenClient);
  const telegramUser =
    validatedTelegramUser ??
    fallbackTelegramUser ??
    input.telegramUser ??
    null;

  if (!telegramUser) {
    throw new AppError("Telegram initData is invalid", 401);
  }

  if (process.env.NODE_ENV === "production" && !validatedTelegramUser && !fallbackTelegramUser) {
    console.warn("Order accepted with Telegram user fallback because initData is missing");
  }

  if (!input.items.length) {
    throw new AppError("Cart is empty");
  }

  const productIds = input.items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true }
  });
  const productsById = new Map(products.map((product) => [product.id, product]));

  let subtotal = 0;
  let totalProfit = 0;
  let totalKg = 0;

  const orderItems = input.items.map((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new AppError("Quantity must be positive");
    }

    const product = productsById.get(item.productId);
    if (!product) throw new AppError("Product is unavailable", 404);
    if (Number(product.stockQuantity) < item.quantity) {
      throw new AppError(`Not enough stock for ${product.name}`);
    }

    const salePrice = Number(product.discountPrice ?? product.salePrice);
    const purchasePrice = Number(product.purchasePrice);
    const totalPrice = item.quantity * salePrice;
    const profit = item.quantity * (salePrice - purchasePrice);

    subtotal += totalPrice;
    totalProfit += profit;
    if (product.unit === "kg") totalKg += item.quantity;

    return {
      productId: product.id,
      productNameSnapshot: product.name,
      purchasePriceSnapshot: decimal(purchasePrice),
      salePriceSnapshot: decimal(salePrice),
      quantity: new Prisma.Decimal(item.quantity),
      totalPrice: decimal(totalPrice),
      profit: decimal(profit)
    };
  });

  const deliveryFee = calculateDeliveryFee(subtotal, totalKg);
  const totalAmount = subtotal + deliveryFee;
  const profitAmount = totalProfit - deliveryFee;

  const order = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { telegramId: BigInt(telegramUser.id) },
      update: {
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        phone: input.customerPhone
      },
      create: {
        telegramId: BigInt(telegramUser.id),
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        phone: input.customerPhone
      }
    });

    for (const item of input.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQuantity: { decrement: item.quantity } }
      });
    }

    const lastQueueNumber = await tx.order.aggregate({
      where: { status: "NEW" },
      _max: { queueNumber: true }
    });

    return tx.order.create({
      data: {
        queueNumber: (lastQueueNumber._max.queueNumber ?? 0) + 1,
        userId: user.id,
        totalAmount: decimal(totalAmount),
        profitAmount: decimal(profitAmount),
        deliveryFee: decimal(deliveryFee),
        paymentMethod: input.paymentMethod,
        customerName: input.customerName.trim(),
        customerPhone: input.customerPhone.trim(),
        latitude: new Prisma.Decimal(input.latitude),
        longitude: new Prisma.Decimal(input.longitude),
        addressText: input.addressText?.trim(),
        customerComment: input.customerComment?.trim(),
        deliveryDay: input.deliveryDay ? new Date(input.deliveryDay) : undefined,
        items: { create: orderItems }
      },
      include: { user: true, items: { include: { product: true } } }
    });
  });

  notifyAdmins(order).catch((error) => {
    console.error("Failed to notify admins about order", order.queueNumber, error);
  });
  notifyCustomerAboutCreatedOrder(order).catch((error) => {
    console.error("Failed to notify customer about created order", order.queueNumber, error);
  });

  return order;
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  const order = await prisma.order.update({
    where: { id },
    data: {
      status,
      deliveredAt: status === "DELIVERED" ? new Date() : null
    },
    include: { user: true, items: true }
  });

  let customerNotificationSent: boolean | null = null;
  let customerNotificationError: string | null = null;

  if (status === "ON_DELIVERY" || status === "DELIVERED") {
    const telegram = getClientTelegram();
    if (telegram) {
      try {
        await telegram.sendMessage(
          Number(order.user.telegramId),
          status === "ON_DELIVERY"
            ? "🚚 Скоро заказ будет доставлен."
            : `📦✅ Заказ доставлен, ждет на улице.\nК оплате: ${formatMoney(order.totalAmount.toString())}`
        );
        customerNotificationSent = true;
      } catch (error) {
        customerNotificationSent = false;
        customerNotificationError = error instanceof Error ? error.message : "Unknown Telegram error";
        console.error("Failed to notify customer about order status", order.queueNumber, error);
      }
    } else {
      customerNotificationSent = false;
      customerNotificationError = "Client bot token is not configured";
    }
  }

  if (status === "ON_DELIVERY" || status === "DELIVERED") {
    updateAdminOrderMessages(order.id, status).catch((error) => {
      console.error("Failed to update admin order message", order.queueNumber, error);
    });
    updateDeliveryListMessages().catch((error) => {
      console.error("Failed to update admin delivery list", order.queueNumber, error);
    });
  }

  return { ...order, customerNotificationSent, customerNotificationError };
}

export async function markOrderInTransitForAdmin(id: string) {
  const order = await prisma.order.update({
    where: { id },
    data: { status: "ON_DELIVERY" },
    include: { user: true, items: { include: { product: true } } }
  });

  await updateAdminOrderMessages(order.id, "ON_DELIVERY");
  await updateDeliveryListMessages();
  return order;
}

export async function notifyDeliverySoonForActiveOrders() {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PREPARING", "ON_DELIVERY"] }
    },
    include: { user: true, items: { include: { product: true } } }
  });

  if (!orders.length) {
    return { totalOrders: 0, notifiedUsers: 0, failedUsers: 0 };
  }

  await prisma.order.updateMany({
    where: { id: { in: orders.map((order) => order.id) } },
    data: { status: "ON_DELIVERY" }
  });

  await Promise.allSettled(
    orders.map((order) => updateAdminOrderMessages(order.id, "ON_DELIVERY"))
  );
  await updateDeliveryListMessages();

  const telegram = getClientTelegram();
  if (!telegram) {
    console.error("Client bot is not configured, cannot send delivery notifications");
    return { totalOrders: orders.length, notifiedUsers: 0, failedUsers: 0 };
  }

  const chatIds = [...new Set(orders.map((order) => Number(order.user.telegramId)))];
  const results = await Promise.allSettled(
    chatIds.map((chatId) => telegram.sendMessage(chatId, "🚚 Скоро заказ будет доставлен."))
  );
  const failedUsers = results.filter((result) => result.status === "rejected").length;

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to send bulk delivery notification", result.reason);
    }
  }

  return {
    totalOrders: orders.length,
    notifiedUsers: chatIds.length - failedUsers,
    failedUsers
  };
}

export async function notifyCustomerEta(id: string, minutes: number) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { user: true }
  });

  if (!order) {
    throw new AppError("Order not found", 404);
  }

  const telegram = getClientTelegram();
  if (!telegram) {
    return {
      orderNumber: order.queueNumber,
      customerNotificationSent: false,
      customerNotificationError: "Client bot token is not configured"
    };
  }

  try {
    await telegram.sendMessage(
      Number(order.user.telegramId),
      [
        "🚚 Курьер уже выехал к вам.",
        `Примерно через ${minutes} минут будет у вас.`,
        `К оплате: ${formatMoney(order.totalAmount.toString())}`
      ].join("\n")
    );

    return {
      orderNumber: order.queueNumber,
      customerNotificationSent: true,
      customerNotificationError: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram error";
    console.error("Failed to notify customer about route ETA", order.queueNumber, error);
    return {
      orderNumber: order.queueNumber,
      customerNotificationSent: false,
      customerNotificationError: message
    };
  }
}

export async function registerAdminDeliveryListMessage(chatId: number | string | bigint, messageId: number) {
  await prisma.adminDeliveryListMessage.upsert({
    where: { chatId: BigInt(chatId) },
    update: { messageId },
    create: { chatId: BigInt(chatId), messageId }
  });
}

export async function getDeliveryStatusText() {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PREPARING", "ON_DELIVERY", "DELIVERED"] },
      routePosition: { not: null }
    },
    orderBy: [{ routePosition: "asc" }, { createdAt: "asc" }]
  });

  return formatDeliveryStatusText(
    orders.map((order) => ({
      orderNumber: order.queueNumber,
      status: order.status
    }))
  );
}

export async function notifyAdmins(order: Awaited<ReturnType<typeof prisma.order.create>>) {
  const telegram = getAdminTelegram();
  if (!telegram || config.adminTelegramIds.length === 0) return;

  const text = formatOrderMessage(order as Parameters<typeof formatOrderMessage>[0]);
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "Доставлено",
          callback_data: `order:${order.id}:DELIVERED`
        }
      ],
      [
        {
          text: "Открыть маршрут",
          url: `https://www.google.com/maps/search/?api=1&query=${order.latitude},${order.longitude}`
        }
      ]
    ]
  };

  const results = await Promise.allSettled(
    config.adminTelegramIds.map((chatId) =>
      telegram.sendMessage(chatId, text, { parse_mode: "HTML" })
    )
  );

  const messages: Array<{ orderId: string; chatId: bigint; messageId: number }> = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      console.error("Failed to send admin order notification", order.queueNumber, result.reason);
      continue;
    }

    messages.push({
      orderId: order.id,
      chatId: BigInt(config.adminTelegramIds[index]!),
      messageId: result.value.message_id
    });
  }

  if (messages.length) {
    await prisma.adminOrderMessage.createMany({
      data: messages,
      skipDuplicates: true
    });
  }
}

async function updateAdminOrderMessages(orderId: string, status: "ON_DELIVERY" | "DELIVERED") {
  const telegram = getAdminTelegram();
  if (!telegram) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: true,
      items: { include: { product: true } },
      adminMessages: true
    }
  });

  if (!order || !order.adminMessages.length) return;

  const statusLine = status === "ON_DELIVERY"
    ? "\n\n<b>🚚 В пути</b>"
    : "\n\n<b>✅ Доставлено</b>";
  const text = `${formatOrderMessage(order)}${statusLine}`;

  await Promise.allSettled(
    order.adminMessages.map((message) =>
      telegram.editMessageText(
        Number(message.chatId),
        message.messageId,
        undefined,
        text,
        { parse_mode: "HTML" }
      )
    )
  );
}

async function updateDeliveryListMessages() {
  const telegram = getAdminTelegram();
  if (!telegram) return;

  const messages = await prisma.adminDeliveryListMessage.findMany();
  if (!messages.length) return;

  const text = await getDeliveryStatusText();
  if (!text) return;

  await Promise.allSettled(
    messages.map((message) =>
      telegram.editMessageText(
        Number(message.chatId),
        message.messageId,
        undefined,
        text
      )
    )
  );
}

function formatDeliveryStatusText(orders: Array<{ orderNumber: number; status: OrderStatus }>) {
  if (!orders.length) return "";

  return [
    "Статус доставки:",
    ...orders.map((order) => {
      const statusText = order.status === "DELIVERED"
        ? "доставлено ✅"
        : "в пути 🚚";
      return `заказ ${order.orderNumber} ${statusText}`;
    })
  ].join("\n");
}

async function notifyCustomerAboutCreatedOrder(order: Parameters<typeof formatCustomerOrderConfirmation>[0]) {
  const telegram = getClientTelegram();
  if (!telegram) return;

  await telegram.sendMessage(
    Number(order.user.telegramId),
    formatCustomerOrderConfirmation(order),
    { parse_mode: "HTML" }
  );
}
