import type { Order, OrderItem, Product, User } from "@prisma/client";
import { formatMoney } from "@yohkar/shared";

type FullOrder = Order & {
  user: User;
  items: Array<OrderItem & { product?: Product | null }>;
};

const paymentLabels = {
  CASH: "наличные",
  BANK_TRANSFER: "перевод",
  STC_PAY: "STC Pay"
} as const;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatQuantity(value: unknown) {
  const number = Number(value);
  if (Number.isInteger(number)) return String(number);
  return number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatUnit(unit?: string | null) {
  const normalized = unit?.trim().toLowerCase();
  if (!normalized) return "";

  const labels: Record<string, string> = {
    kg: "кг",
    "кг": "кг",
    pcs: "шт",
    pc: "шт",
    piece: "шт",
    pieces: "шт",
    "штук": "шт",
    "шт": "шт",
    package: "упак.",
    pack: "упак.",
    "упаковка": "упак.",
    liter: "л",
    litre: "л",
    l: "л",
    "литр": "л"
  };

  return labels[normalized] ?? unit ?? "";
}

export function formatOrderMessage(order: FullOrder) {
  const items = order.items
    .map((item, index) => {
      const unit = formatUnit(item.product?.unit);
      const quantity = formatQuantity(item.quantity);
      const suffix = unit ? ` ${unit}` : "";
      return `${index + 1}. <b>${escapeHtml(item.productNameSnapshot)}</b> ${quantity}${suffix}`;
    })
    .join("\n");

  const username = order.user.username ? `@${order.user.username}` : "не указан";

  return [
    `<b>Новый заказ #${order.orderNumber}</b>`,
    "",
    `<b>Клиент:</b> ${escapeHtml(username)}`,
    `<b>Оплата:</b> ${paymentLabels[order.paymentMethod]}`,
    order.deliveryDay ? `<b>День доставки:</b> ${order.deliveryDay.toISOString().slice(0, 10)}` : "",
    "",
    "<b>Товары:</b>",
    items,
    "",
    "<b>Комментарий:</b>",
    escapeHtml(order.customerComment || "не указан"),
    "",
    `<b>К оплате: ${formatMoney(order.totalAmount.toString())}</b>`
  ]
    .filter(Boolean)
    .join("\n");
}
