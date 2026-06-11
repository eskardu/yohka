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
  const telegramUser =
    validateTelegramInitData(input.initData, config.botTokenClient) ??
    (process.env.NODE_ENV !== "production" ? input.telegramUser : null);

  if (!telegramUser) {
    throw new AppError("Telegram initData is invalid", 401);
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

    return tx.order.create({
      data: {
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
      include: { user: true, items: true }
    });
  });

  await notifyAdmins(order);
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

  if (status === "ON_DELIVERY" || status === "DELIVERED") {
    const telegram = getClientTelegram();
    if (telegram) {
      await telegram.sendMessage(
        Number(order.user.telegramId),
        status === "ON_DELIVERY"
          ? "Скоро заказ будет доставлен."
          : "Заказ доставлен, ждет на улице."
      );
    }
  }

  return order;
}

export async function notifyAdmins(order: Awaited<ReturnType<typeof prisma.order.create>>) {
  const telegram = getAdminTelegram();
  if (!telegram || config.adminTelegramIds.length === 0) return;

  const text = formatOrderMessage(order as Parameters<typeof formatOrderMessage>[0]);
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "Уведомить: скоро доставка",
          callback_data: `order:${order.id}:ON_DELIVERY`
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

  await Promise.all(
    config.adminTelegramIds.map((chatId) =>
      telegram.sendMessage(chatId, text, { reply_markup: keyboard })
    )
  );
}
