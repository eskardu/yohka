import { Router, type RequestHandler } from "express";
import { OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@yohkar/database";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config.js";
import { AppError } from "./errors.js";
import { buildGoogleMapsDirectionsUrlFromSorted, sortByNearestNeighbor } from "./maps.js";
import { createOrder, markOrderInTransitForAdmin, notifyCustomerEta, notifyDeliverySoonForActiveOrders, updateOrderStatus } from "./services/orders.js";

export const router = Router();

const asyncRoute = (handler: RequestHandler): RequestHandler =>
  (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };

const checkoutSchema = z.object({
  initData: z.string().optional(),
  telegramFallback: z
    .object({
      id: z.number(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      username: z.string().optional(),
      auth_date: z.string(),
      sig: z.string()
    })
    .optional(),
  telegramUser: z
    .object({
      id: z.number(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      username: z.string().optional()
    })
    .optional(),
  customerName: z.string().min(2).max(100),
  customerPhone: z.string().trim().max(50).optional().transform((value) => value || "не указан"),
  customerComment: z.string().max(500).optional(),
  addressText: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  paymentMethod: z.nativeEnum(PaymentMethod),
  deliveryDay: z.string().optional(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().positive() })).min(1)
});

const weekdayOptions = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье"
] as const;

const settingsSchema = z.object({
  deliveryTitle: z.string().min(1).max(80).optional(),
  deliveryDays: z.array(z.enum(weekdayOptions)).min(1).max(7).optional(),
  headerImageUrl: z.string().min(1).max(500).nullable().optional()
});

const etaNotificationSchema = z.object({
  minutes: z.number().refine((value) => [5, 10, 15, 20, 25].includes(value), {
    message: "ETA must be 5, 10, 15, 20, or 25 minutes"
  })
});

const imageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

const uploadRoot = process.env.UPLOAD_DIR ?? path.resolve("uploads");

router.get("/health", (_request, response) => {
  response.json({ ok: true });
});

router.get("/api/settings", asyncRoute(async (_request, response) => {
  const settings = await getStoreSettings();
  response.json({
    storeName: config.storeName,
    headerImageUrl: settings.headerImageUrl,
    deliveryTitle: settings.deliveryTitle,
    deliveryDays: settings.deliveryDays,
    deliveryFee: config.deliveryFee,
    freeDeliveryFromAmount: config.freeDeliveryFromAmount,
    freeDeliveryFromKg: config.freeDeliveryFromKg
  });
}));

router.patch("/api/settings", asyncRoute(async (request, response) => {
  const body = settingsSchema.parse(request.body);
  const settings = await prisma.storeSettings.upsert({
    where: { id: "default" },
    update: body,
    create: {
      id: "default",
      headerImageUrl: body.headerImageUrl ?? null,
      deliveryTitle: body.deliveryTitle ?? "Ближайшие дни доставки",
      deliveryDays: body.deliveryDays ?? ["Вторник", "Четверг", "Суббота"]
    }
  });
  response.json(settings);
}));

router.post("/api/admin/uploads", asyncRoute(async (request, response) => {
  const kind = z.enum(["header", "product"]).default("product").parse(request.query.kind);
  const contentType = String(request.headers["content-type"] ?? "").split(";")[0].toLowerCase();

  if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
    throw new AppError("Image file was not received", 400);
  }

  const ext = imageTypes.get(contentType) ?? detectImageExtension(request.body);

  if (!ext) {
    throw new AppError("Supported image formats: JPG, PNG, WEBP", 415);
  }

  const uploadDir = path.join(uploadRoot, kind);
  await fs.mkdir(uploadDir, { recursive: true });

  const filename = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(uploadDir, filename), request.body);

  response.status(201).json({ url: `/uploads/${kind}/${filename}` });
}));

router.get("/api/categories", asyncRoute(async (_request, response) => {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
  response.json(categories);
}));

router.get("/api/products", asyncRoute(async (request, response) => {
  const categoryId = typeof request.query.categoryId === "string" ? request.query.categoryId : undefined;
  const products = await prisma.product.findMany({
    where: { isActive: true, ...(categoryId ? { categoryId } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });
  response.json(products);
}));

router.post("/api/orders", asyncRoute(async (request, response) => {
  const order = await createOrder(checkoutSchema.parse(request.body));
  response.status(201).json({
    ...order,
    systemOrderNumber: order.orderNumber,
    orderNumber: order.queueNumber
  });
}));

router.get("/api/orders", asyncRoute(async (request, response) => {
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const orders = await prisma.order.findMany({
    where: status && status in OrderStatus ? { status: status as OrderStatus } : undefined,
    include: { user: true, items: true },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  response.json(orders.map((order) => ({
    ...order,
    systemOrderNumber: order.orderNumber,
    orderNumber: order.queueNumber
  })));
}));

router.get("/api/orders/:id", asyncRoute(async (request, response) => {
  const orderId = z.string().parse(request.params.id);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { user: true, items: true }
  });
  if (!order) throw new AppError("Order not found", 404);
  response.json({
    ...order,
    systemOrderNumber: order.orderNumber,
    orderNumber: order.queueNumber
  });
}));

router.post("/api/orders/notify-delivery-soon", asyncRoute(async (_request, response) => {
  const result = await notifyDeliverySoonForActiveOrders();
  response.json(result);
}));

router.post("/api/admin/orders/collect", asyncRoute(async (_request, response) => {
  const orders = await prisma.order.findMany({
    where: { status: "NEW" },
    include: {
      user: true,
      items: { include: { product: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  if (!orders.length) {
    response.json({ orderCount: 0, items: [], orders: [] });
    return;
  }

  const points = orders.map((order) => ({
    id: order.id,
    orderNumber: order.queueNumber,
    latitude: Number(order.latitude),
    longitude: Number(order.longitude)
  }));
  const sorted = sortByNearestNeighbor(
    { latitude: config.storeLatitude, longitude: config.storeLongitude },
    points
  );
  const routePositions = new Map(sorted.map((order, index) => [order.id, index + 1]));

  await prisma.$transaction(
    orders.map((order) =>
      prisma.order.update({
        where: { id: order.id },
        data: {
          status: "PREPARING",
          routePosition: routePositions.get(order.id) ?? null
        }
      })
    )
  );

  const itemsByProduct = new Map<string, { name: string; quantity: number; unit: string }>();
  for (const item of orders.flatMap((order) => order.items)) {
    const current = itemsByProduct.get(item.productId) ?? {
      name: item.productNameSnapshot,
      quantity: 0,
      unit: item.product.unit
    };
    current.quantity += Number(item.quantity);
    itemsByProduct.set(item.productId, current);
  }

  response.json({
    orderCount: orders.length,
    items: [...itemsByProduct.values()].sort((a, b) => a.name.localeCompare(b.name)),
    orders: [...orders].sort((a, b) => (routePositions.get(a.id) ?? 0) - (routePositions.get(b.id) ?? 0)).map((order) => ({
      id: order.id,
      orderNumber: order.queueNumber,
      username: order.user.username,
      totalAmount: order.totalAmount
    }))
  });
}));

router.post("/api/orders/:id/notify-eta", asyncRoute(async (request, response) => {
  const orderId = z.string().parse(request.params.id);
  const body = etaNotificationSchema.parse(request.body);
  const result = await notifyCustomerEta(orderId, body.minutes);
  response.json(result);
}));

router.post("/api/admin/route/next/eta", asyncRoute(async (request, response) => {
  const body = etaNotificationSchema.parse(request.body);
  const order = await findNextRouteOrder();

  if (!order) {
    response.json({ found: false });
    return;
  }

  const result = await notifyCustomerEta(order.id, body.minutes);
  await markOrderInTransitForAdmin(order.id);
  response.json({
    found: true,
    routePoint: 1,
    orderId: order.id,
    ...result,
    orderNumber: order.orderNumber
  });
}));

router.post("/api/admin/route/next/delivered", asyncRoute(async (_request, response) => {
  const order = await findNextRouteOrder();

  if (!order) {
    response.json({ found: false });
    return;
  }

  const result = await updateOrderStatus(order.id, "DELIVERED");
  response.json({
    found: true,
    routePoint: 1,
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerNotificationSent: result.customerNotificationSent,
    customerNotificationError: result.customerNotificationError
  });
}));

router.patch("/api/orders/:id/status", asyncRoute(async (request, response) => {
  const orderId = z.string().parse(request.params.id);
  const body = z.object({ status: z.nativeEnum(OrderStatus) }).parse(request.body);
  const order = await updateOrderStatus(orderId, body.status);
  response.json({
    ...order,
    systemOrderNumber: order.orderNumber,
    orderNumber: order.queueNumber
  });
}));

router.get("/api/admin/stats", asyncRoute(async (request, response) => {
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
}));

router.post("/api/admin/stats/reset", asyncRoute(async (_request, response) => {
  const result = await prisma.order.deleteMany({
    where: { status: { in: ["DELIVERED", "CANCELLED"] } }
  });

  response.json({ deletedOrders: result.count });
}));

router.get("/api/admin/customers/:id", asyncRoute(async (request, response) => {
  const customerId = z.string().parse(request.params.id);
  const customer = await prisma.user.findUnique({
    where: { id: customerId },
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
}));

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
  sortOrder: z.number().int().nonnegative().optional(),
  imageUrl: z.string().min(1).max(500).refine(
    (value) => value.startsWith("/uploads/") || /^https?:\/\//.test(value),
    "Image URL must be an uploaded file path or http URL"
  ).nullable().optional(),
  isActive: z.boolean().optional()
});

router.post("/api/admin/products", asyncRoute(async (request, response) => {
  const body = productSchema.parse(request.body);
  const maxSortOrder = await prisma.product.aggregate({ _max: { sortOrder: true } });
  const product = await prisma.product.create({
    data: {
      ...body,
      sortOrder: body.sortOrder ?? (maxSortOrder._max.sortOrder ?? -1) + 1,
      purchasePrice: new Prisma.Decimal(body.purchasePrice),
      salePrice: new Prisma.Decimal(body.salePrice),
      discountPrice: body.discountPrice == null ? null : new Prisma.Decimal(body.discountPrice),
      stockQuantity: new Prisma.Decimal(body.stockQuantity)
    }
  });
  response.status(201).json(product);
}));

router.patch("/api/admin/products/reorder", asyncRoute(async (request, response) => {
  const body = z.object({ orderedIds: z.array(z.string()).min(1) }).parse(request.body);

  await prisma.$transaction(
    body.orderedIds.map((id, index) =>
      prisma.product.update({
        where: { id },
        data: { sortOrder: index }
      })
    )
  );

  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
  });

  response.json(products);
}));

router.patch("/api/admin/products/:id", asyncRoute(async (request, response) => {
  const productId = z.string().parse(request.params.id);
  const body = productSchema.partial().parse(request.body);
  const product = await prisma.product.update({
    where: { id: productId },
    data: {
      ...body,
      purchasePrice: body.purchasePrice == null ? undefined : new Prisma.Decimal(body.purchasePrice),
      salePrice: body.salePrice == null ? undefined : new Prisma.Decimal(body.salePrice),
      discountPrice: body.discountPrice === undefined ? undefined : body.discountPrice === null ? null : new Prisma.Decimal(body.discountPrice),
      stockQuantity: body.stockQuantity == null ? undefined : new Prisma.Decimal(body.stockQuantity)
    }
  });
  response.json(product);
}));

router.patch("/api/admin/products/:id/deactivate", asyncRoute(async (request, response) => {
  const productId = z.string().parse(request.params.id);
  const product = await prisma.product.update({
    where: { id: productId },
    data: { isActive: false }
  });
  response.json(product);
}));

router.get("/api/admin/routes/today", asyncRoute(async (_request, response) => {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PREPARING", "ON_DELIVERY"] },
      routePosition: { not: null }
    },
    orderBy: [{ routePosition: "asc" }, { createdAt: "asc" }]
  });

  const points = orders.map((order) => ({
    id: order.id,
    orderNumber: order.queueNumber,
    latitude: Number(order.latitude),
    longitude: Number(order.longitude)
  }));
  const route = buildGoogleMapsDirectionsUrlFromSorted(
    { latitude: config.storeLatitude, longitude: config.storeLongitude },
    points
  );
  response.json(route);
}));

async function findNextRouteOrder() {
  const order = await prisma.order.findFirst({
    where: {
      status: { in: ["PREPARING", "ON_DELIVERY"] },
      routePosition: { not: null }
    },
    orderBy: [{ routePosition: "asc" }, { createdAt: "asc" }]
  });

  return order
    ? {
      id: order.id,
      orderNumber: order.queueNumber,
      latitude: Number(order.latitude),
      longitude: Number(order.longitude)
    }
    : null;
}

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

async function getStoreSettings() {
  return prisma.storeSettings.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      headerImageUrl: null,
      deliveryTitle: "Ближайшие дни доставки",
      deliveryDays: ["Вторник", "Четверг", "Суббота"]
    }
  });
}

function detectImageExtension(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return undefined;
}
