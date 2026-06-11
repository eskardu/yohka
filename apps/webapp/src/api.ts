import type { Category, Product } from "./types.js";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const localProductsKey = "yohkar-local-products";
const localDeliveryDaysKey = "yohkar-delivery-days";
const localDeliveryTitleKey = "yohkar-delivery-title";

export const weekdayOptions = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье"
] as const;

const fallbackSettings = {
  storeName: "Yohkar",
  deliveryDays: loadLocalDeliveryDays(),
  deliveryTitle: loadLocalDeliveryTitle(),
  deliveryFee: 5,
  freeDeliveryFromAmount: 150,
  freeDeliveryFromKg: 20
};

const fallbackCategories: Category[] = [
  { id: "local-meat", name: "Мясо", sortOrder: 0 },
  { id: "local-mince", name: "Фарш", sortOrder: 1 },
  { id: "local-grocery", name: "Продукты", sortOrder: 2 }
];

const starterProducts: Product[] = [
  {
    id: "local-horse-meat",
    name: "Конина",
    description: "Свежая конина",
    categoryId: "local-meat",
    badge: "HIT",
    purchasePrice: "24",
    salePrice: "30",
    discountPrice: null,
    unit: "kg",
    stockQuantity: "80",
    imageUrl: "https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "local-mince",
    name: "Фарш",
    description: "Домашний фарш",
    categoryId: "local-mince",
    badge: "NEW",
    purchasePrice: "18",
    salePrice: "25",
    discountPrice: null,
    unit: "kg",
    stockQuantity: "60",
    imageUrl: "https://images.unsplash.com/photo-1588168333986-5078d3ae3976?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "local-pasta",
    name: "Макароны",
    description: "Упаковка",
    categoryId: "local-grocery",
    badge: null,
    purchasePrice: "5",
    salePrice: "7",
    discountPrice: null,
    unit: "pack",
    stockQuantity: "150",
    imageUrl: "https://images.unsplash.com/photo-1551462147-37885acc36f1?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "local-sugar",
    name: "Сахар",
    description: "1 кг",
    categoryId: "local-grocery",
    badge: "DISCOUNT",
    purchasePrice: "10",
    salePrice: "15",
    discountPrice: null,
    unit: "pack",
    stockQuantity: "120",
    imageUrl: "https://images.unsplash.com/photo-1581268497089-7a975fb491a3?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "local-zamzam-water",
    name: "Вода Замзам",
    description: "Священная вода Замзам",
    categoryId: "local-grocery",
    badge: "NEW",
    purchasePrice: "8",
    salePrice: "12",
    discountPrice: null,
    unit: "liter",
    stockQuantity: "50",
    imageUrl: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=800&q=80"
  },
  {
    id: "local-fresh-salad",
    name: "Свежий салат",
    description: "Свежий салат на каждый день",
    categoryId: "local-grocery",
    badge: "HIT",
    purchasePrice: "9",
    salePrice: "14",
    discountPrice: null,
    unit: "piece",
    stockQuantity: "40",
    imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80"
  }
];

export async function getSettings(): Promise<Settings> {
  try {
    const response = await fetch(`${apiUrl}/api/settings`);
    if (!response.ok) throw new Error("Не удалось загрузить настройки");
    const settings = await response.json() as Settings;
    return {
      ...settings,
      deliveryTitle: settings.deliveryTitle ?? loadLocalDeliveryTitle()
    };
  } catch {
    return fallbackSettings;
  }
}

export type Settings = {
  storeName: string;
  deliveryDays: string[];
  deliveryTitle?: string;
  deliveryFee: number;
    freeDeliveryFromAmount: number;
    freeDeliveryFromKg: number;
};

export function saveDeliveryTitle(title: string) {
  const cleanTitle = title.trim() || "Ближайшие дни доставки";
  localStorage.setItem(localDeliveryTitleKey, cleanTitle);
  return cleanTitle;
}

export function saveDeliveryDays(days: string[]) {
  const uniqueDays = weekdayOptions.filter((day) => days.includes(day));
  localStorage.setItem(localDeliveryDaysKey, JSON.stringify(uniqueDays));
  return uniqueDays;
}

export async function getCategories() {
  try {
    const response = await fetch(`${apiUrl}/api/categories`);
    if (!response.ok) throw new Error("Не удалось загрузить категории");
    return response.json() as Promise<Category[]>;
  } catch {
    return fallbackCategories;
  }
}

export async function getProducts(categoryId?: string) {
  try {
    const params = categoryId ? `?categoryId=${categoryId}` : "";
    const response = await fetch(`${apiUrl}/api/products${params}`);
    if (!response.ok) throw new Error("Не удалось загрузить товары");
    return response.json() as Promise<Product[]>;
  } catch {
    const products = loadLocalProducts();
    return categoryId ? products.filter((product) => product.categoryId === categoryId) : products;
  }
}

export async function postOrder(payload: unknown) {
  try {
    const response = await fetch(`${apiUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Не удалось отправить заказ");
    }
    return data as Promise<{ id: string; orderNumber: number; totalAmount: string }>;
  } catch {
    if (!import.meta.env.DEV) {
      throw new Error("Не удалось отправить заказ");
    }
    return {
      id: crypto.randomUUID(),
      orderNumber: Math.floor(1000 + Math.random() * 9000),
      totalAmount: "0"
    };
  }
}

export async function createProduct(payload: unknown) {
  try {
    const response = await fetch(`${apiUrl}/api/admin/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Не удалось добавить товар");
    return data as Promise<Product>;
  } catch {
    const product = normalizeLocalProduct(payload, crypto.randomUUID());
    const products = [...loadLocalProducts(), product];
    saveLocalProducts(products);
    return product;
  }
}

export async function updateProduct(productId: string, payload: unknown) {
  try {
    const response = await fetch(`${apiUrl}/api/admin/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Не удалось обновить товар");
    return data as Promise<Product>;
  } catch {
    const products = loadLocalProducts();
    const current = products.find((product) => product.id === productId);
    const product = { ...current, ...normalizeLocalProduct(payload, productId) } as Product;
    saveLocalProducts(products.map((item) => (item.id === productId ? product : item)));
    return product;
  }
}

export async function deactivateProduct(productId: string) {
  try {
    const response = await fetch(`${apiUrl}/api/admin/products/${productId}/deactivate`, {
      method: "PATCH"
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Не удалось скрыть товар");
    return data as Promise<Product>;
  } catch {
    const products = loadLocalProducts();
    const product = products.find((item) => item.id === productId) ?? products[0];
    saveLocalProducts(products.filter((item) => item.id !== productId));
    return product;
  }
}

function loadLocalProducts() {
  try {
    const saved = localStorage.getItem(localProductsKey);
    if (!saved) {
      saveLocalProducts(starterProducts);
      return starterProducts;
    }
    const savedProducts = (JSON.parse(saved) as Product[]).map((product) =>
      product.id === "local-sugar"
        ? {
            ...product,
            imageUrl: "https://images.unsplash.com/photo-1581268497089-7a975fb491a3?auto=format&fit=crop&w=800&q=80"
          }
        : product
    );
    const savedIds = new Set(savedProducts.map((product) => product.id));
    const missingProducts = starterProducts.filter((product) => !savedIds.has(product.id));
    const mergedProducts = [...savedProducts, ...missingProducts];
    if (missingProducts.length) saveLocalProducts(mergedProducts);
    return mergedProducts;
  } catch {
    return starterProducts;
  }
}

function saveLocalProducts(products: Product[]) {
  localStorage.setItem(localProductsKey, JSON.stringify(products));
}

function loadLocalDeliveryDays() {
  try {
    const saved = localStorage.getItem(localDeliveryDaysKey);
    if (saved) {
      const days = JSON.parse(saved) as string[];
      const weekDays = weekdayOptions.filter((day) => days.includes(day));
      return weekDays.length ? weekDays : getFallbackDeliveryDays();
    }
  } catch {
    // Fall back to generated days below.
  }
  return getFallbackDeliveryDays();
}

function loadLocalDeliveryTitle() {
  return localStorage.getItem(localDeliveryTitleKey) ?? "Ближайшие дни доставки";
}

function normalizeLocalProduct(payload: unknown, id: string): Product {
  const data = payload as Partial<Record<keyof Product, unknown>>;
  return {
    id,
    name: String(data.name ?? "Новый товар"),
    description: data.description == null ? null : String(data.description),
    categoryId: String(data.categoryId ?? fallbackCategories[0].id),
    badge: data.badge == null || data.badge === "" ? null : String(data.badge),
    purchasePrice: String(data.purchasePrice ?? 0),
    salePrice: String(data.salePrice ?? 0),
    discountPrice: data.discountPrice == null ? null : String(data.discountPrice),
    unit: String(data.unit ?? "piece"),
    stockQuantity: String(data.stockQuantity ?? 0),
    imageUrl: data.imageUrl == null ? null : String(data.imageUrl)
  };
}

function getFallbackDeliveryDays() {
  return ["Вторник", "Четверг", "Суббота"];
}
