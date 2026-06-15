import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "@yohkar/database";
import type { CheckoutInput } from "@yohkar/shared";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { formatOrderMessage } from "../formatters.js";
import { getAdminTelegram, getClientTelegram, validateTelegramInitData } from "../telegram.js";

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
  const fallbackTelegramUser =
    input.telegramUser && input.telegramUser.id !== 100000001
      ? input.telegramUser
      : null;
  const telegramUser =
    validatedTelegramUser ??
    (process.env.NODE_ENV === "production" ? fallbackTelegramUser : input.telegramUser ?? null);

  if (!telegramUser) {
    throw new AppError("Telegram initData is invalid", 401);
  }

  if (process.env.NODE_ENV === "production" && !validatedTelegramUser) {
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
      where: { status: { in: ["NEW", "ACCEPTED", "PREPARING"] } },
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
            ? "Скоро заказ будет доставлен."
            : "Заказ доставлен, ждет на улице."
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

  return { ...order, customerNotificationSent, customerNotificationError };
}

export async function notifyDeliverySoonForActiveOrders() {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["NEW", "ACCEPTED", "PREPARING", "ON_DELIVERY"] }
    },
    include: { user: true }
  });

  if (!orders.length) {
    return { totalOrders: 0, notifiedUsers: 0, failedUsers: 0 };
  }

  await prisma.order.updateMany({
    where: { id: { in: orders.map((order) => order.id) } },
    data: { status: "ON_DELIVERY" }
  });

  const telegram = getClientTelegram();
  if (!telegram) {
    console.error("Client bot is not configured, cannot send delivery notifications");
    return { totalOrders: orders.length, notifiedUsers: 0, failedUsers: 0 };
  }

  const chatIds = [...new Set(orders.map((order) => Number(order.user.telegramId)))];
  const results = await Promise.allSettled(
    chatIds.map((chatId) => telegram.sendMessage(chatId, "Скоро заказ будет доставлен."))
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
      telegram.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard })
    )
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Failed to send admin order notification", order.queueNumber, result.reason);
    }
  }
}
