import "dotenv/config";

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  botTokenClient: process.env.BOT_TOKEN_CLIENT ?? "",
  botTokenAdmin: process.env.BOT_TOKEN_ADMIN ?? "",
  adminTelegramIds: (process.env.ADMIN_TELEGRAM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  storeName: process.env.STORE_NAME ?? "Yohkar",
  storeLatitude: Number(process.env.STORE_LATITUDE ?? 24.7136),
  storeLongitude: Number(process.env.STORE_LONGITUDE ?? 46.6753),
  deliveryFee: Number(process.env.DELIVERY_FEE ?? 5),
  freeDeliveryFromAmount: Number(process.env.FREE_DELIVERY_FROM_AMOUNT ?? 150),
  freeDeliveryFromKg: Number(process.env.FREE_DELIVERY_FROM_KG ?? 20)
};
