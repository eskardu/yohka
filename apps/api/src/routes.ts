import { Router } from "express";
import { OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@yohkar/database";
import { z } from "zod";
import { config } from "./config.js";
import { getNextDeliveryDays } from "./delivery.js";
import { AppError } from "./errors.js";
import { buildGoogleMapsDirectionsUrl } from "./maps.js";
import { createOrder, updateOrderStatus } from "./services/orders.js";

export const router = Router();

const checkoutSchema = z.object({
  initData: z.string().optional(),
  telegramUser: z
    .object({
      id: z.number(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      username: z.string().optional()
    })
    .optional(),
  customerName: z.string().min(2).max(100),
  customerPhone: z.string().min(5).max(30),
  customerComment: z.string().max(500).optional(),
  addressText: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  paymentMethod: z.nativeEnum(PaymentMethod),
  deliveryDay: z.string().optional(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().positive() })).min(1)
});

router.get("/health", (_request, response) => {
  response.json({ ok: true });
});

router.get("/api/settings", (_request, response) => {
  response.json({
    storeName: config.storeName,
    deliveryDays: getNextDeliveryDays(4),
    deliveryFee: config.deliveryFee,
    freeDeliveryFromAmount: config.freeDeliveryFromAmount,
    freeDeliveryFromKg: config.freeDeliveryFromKg
  });
});

router.get("/api/categories", async (_request, response) => {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
  response.json(categories);
});

router.get("/api/products", async (request, response) => {
  const categoryId = typeof request.query.categoryId === "string" ? request.query.categoryId : undefined;
  const products = await prisma.product.findMany({
    where: { isActive: true, ...(categoryId ? { categoryId } : {}) },
    orderBy: { name: "asc" }
  });
  response.json(products);
});

router.post("/api/orders", async (request, response) => {
  const order = await createOrder(checkoutSchema.parse(request.body));
  response.status(201).json(order);
});

router.get("/api/orders", async (request, response) => {
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const orders = await prisma.order.findMany({
    where: status && status in OrderStatus ? { status: status as OrderStatus } : undefined,
    include: { user: true, items: true },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  response.json(orders);
});

router.get("/api/orders/:id", async (request, response) => {
  const order = await prisma.order.findUnique({
    where: { id: request.params.id },
    include: { user: true, items: true }
  });
  if (!order) throw new AppError("Order not found", 404);
  response.json(order);
});

router.patch("/api/orders/:id/status", async (request, response) => {
  const body = z.object({ status: z.nativeEnum(OrderStatus) }).parse(request.body);
  const order = await updateOrderStatus(request.params.id, body.status);
  response.json(order);
});

router.get("/api/admin/stats", async (request, response) => {
  const period = z.enum(["today", "yesterday", "week", "month", "year"]).default("today").parse(request.query.period);
  const { from, to } = getPeriodRange(period);

  const orders = await prisma.order.findMany({
    where: { status: "DELIVERED", deliveredAt: { gte: from, lt: to } },
    include: { items: true }
  });

  const salesTotal = orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
  const profitTotal = orders.reduce((sum, order) => sum + Number(order.profitAmount), 0);
  const soldProductsCount = orders.flatMap((order) => order.items).reduce((sum, item) => sum + Number(item.quantity), 0);
  const costTotal = orders
    .flatMap((order) => order.items)
    .reduce((sum, item) => sum + Number(item.purchasePriceSnapshot) * Number(item.quantity), 0);

  const byProduct = new Map<string, { name: string; quantity: number; profit: number }>();
  for (const item of orders.flatMap((order) => order.items)) {
    const current = byProduct.get(item.productId) ?? {
      name: item.productNameSnapshot,
      quantity: 0,
      profit: 0
    };
    current.quantity += Number(item.quantity);
    current.profit += Number(item.profit);
    byProduct.set(item.productId, current);
  }

  response.json({
    period,
    from,
    to,
    orderCount: orders.length,
    salesTotal,
    costTotal,
    profitTotal,
    averageCheck: orders.length ? salesTotal / orders.length : 0,
    soldProductsCount,
    bestSellingProducts: [...byProduct.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 5),
    mostProfitableProducts: [...byProduct.values()].sort((a, b) => b.profit - a.profit).slice(0, 5)
  });
});

router.get("/api/admin/customers/:id", async (request, response) => {
  const customer = await prisma.user.findUnique({
    where: { id: request.params.id },
    include: { orders: { include: { items: true }, orderBy: { createdAt: "desc" } } }
  });
  if (!customer) throw new AppError("Customer not found", 404);
  const delivered = customer.orders.filter((order) => order.status === "DELIVERED");
  const total = delivered.reduce((sum, order) => sum + Number(order.totalAmount), 0);
  response.json({
    ...customer,
    purchaseCount: delivered.length,
    totalSpent: total,
    averageCheck: delivered.length ? total / delivered.length : 0,
    lastOrderAt: customer.orders[0]?.createdAt ?? null
  });
});

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  categoryId: z.string(),
  badge: z.string().nullable().optional(),
  purchasePrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  discountPrice: z.number().nonnegative().nullable().optional(),
  unit: z.string().min(1),
  stockQuantity: z.number().nonnegative(),
  imageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional()
});

router.post("/api/admin/products", async (request, response) => {
  const body = productSchema.parse(request.body);
  const product = await prisma.product.create({
    data: {
      ...body,
      purchasePrice: new Prisma.Decimal(body.purchasePrice),
      salePrice: new Prisma.Decimal(body.salePrice),
      discountPrice: body.discountPrice == null ? null : new Prisma.Decimal(body.discountPrice),
      stockQuantity: new Prisma.Decimal(body.stockQuantity)
    }
  });
  response.status(201).json(product);
});

router.patch("/api/admin/products/:id", async (request, response) => {
  const body = productSchema.partial().parse(request.body);
  const product = await prisma.product.update({
    where: { id: request.params.id },
    data: {
      ...body,
      purchasePrice: body.purchasePrice == null ? undefined : new Prisma.Decimal(body.purchasePrice),
      salePrice: body.salePrice == null ? undefined : new Prisma.Decimal(body.salePrice),
      discountPrice: body.discountPrice === undefined ? undefined : body.discountPrice === null ? null : new Prisma.Decimal(body.discountPrice),
      stockQuantity: body.stockQuantity == null ? undefined : new Prisma.Decimal(body.stockQuantity)
    }
  });
  response.json(product);
});

router.patch("/api/admin/products/:id/deactivate", async (request, response) => {
  const product = await prisma.product.update({
    where: { id: request.params.id },
    data: { isActive: false }
  });
  response.json(product);
});

router.get("/api/admin/routes/today", async (_request, response) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["ACCEPTED", "ON_DELIVERY"] },
      createdAt: { gte: start, lt: end }
    },
    orderBy: { createdAt: "asc" }
  });

  const points = orders.map((order) => ({
    id: order.id,
    orderNumber: order.orderNumber,
    latitude: Number(order.latitude),
    longitude: Number(order.longitude)
  }));
  const route = buildGoogleMapsDirectionsUrl(
    { latitude: config.storeLatitude, longitude: config.storeLongitude },
    points
  );
  response.json(route);
});

function getPeriodRange(period: "today" | "yesterday" | "week" | "month" | "year") {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);

  if (period === "yesterday") {
    const to = new Date(from);
    from.setDate(from.getDate() - 1);
    return { from, to };
  }
  if (period === "week") {
    from.setDate(from.getDate() - 6);
  }
  if (period === "month") {
    from.setDate(1);
  }
  if (period === "year") {
    from.setMonth(0, 1);
  }

  const to = new Date(now);
  to.setMilliseconds(999);
  return { from, to };
}
