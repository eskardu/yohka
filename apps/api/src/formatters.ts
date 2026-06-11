import type { Order, OrderItem, User } from "@prisma/client";
import { formatMoney } from "@yohkar/shared";
import { buildPointMapsUrl } from "./maps.js";

type FullOrder = Order & {
  user: User;
  items: OrderItem[];
};

const paymentLabels = {
  CASH: "наличные",
  BANK_TRANSFER: "перевод",
  STC_PAY: "STC Pay"
} as const;

export function formatOrderMessage(order: FullOrder) {
  const items = order.items
    .map(
      (item, index) =>
        `${index + 1}. ${item.productNameSnapshot} — ${Number(item.quantity)} × ${formatMoney(item.salePriceSnapshot.toString())} = ${formatMoney(item.totalPrice.toString())}`
    )
    .join("\n");

  const username = order.user.username ? `@${order.user.username}` : "не указан";
  const mapsUrl = buildPointMapsUrl(Number(order.latitude), Number(order.longitude));
  const delivery =
    Number(order.deliveryFee) === 0
      ? "бесплатно"
      : formatMoney(order.deliveryFee.toString());

  return [
    `Новый заказ #${order.orderNumber}`,
    "",
    `Клиент: ${order.customerName}`,
    `Телефон: ${order.customerPhone}`,
    `Telegram: ${username}`,
    `К оплате: ${formatMoney(order.totalAmount.toString())}`,
    `Доставка: ${delivery}`,
    `Оплата: ${paymentLabels[order.paymentMethod]}`,
    order.deliveryDay ? `День доставки: ${order.deliveryDay.toISOString().slice(0, 10)}` : "",
    "",
    "Товары:",
    items,
    "",
    "Комментарий:",
    order.customerComment || "не указан",
    "",
    "Геолокация:",
    mapsUrl
  ]
    .filter(Boolean)
    .join("\n");
}
