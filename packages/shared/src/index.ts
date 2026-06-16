export const orderStatuses = [
  "NEW",
  "ACCEPTED",
  "PREPARING",
  "ON_DELIVERY",
  "DELIVERED",
  "CANCELLED"
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

export const paymentMethods = ["CASH", "BANK_TRANSFER", "STC_PAY"] as const;

export type PaymentMethod = (typeof paymentMethods)[number];

export type CartItemInput = {
  productId: string;
  quantity: number;
};

export type CheckoutInput = {
  initData?: string;
  telegramFallback?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    auth_date: string;
    sig: string;
  };
  telegramUser?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  customerName: string;
  customerPhone: string;
  customerComment?: string;
  addressText?: string;
  latitude: number;
  longitude: number;
  paymentMethod: PaymentMethod;
  deliveryDay?: string;
  items: CartItemInput[];
};

export type ProductDto = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  salePrice: string;
  discountPrice: string | null;
  unit: string;
  stockQuantity: string;
  imageUrl: string | null;
  sortOrder: number;
};

export function formatMoney(value: number | string): string {
  return `${Number(value).toFixed(2)} SAR`;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${value}`);
}
