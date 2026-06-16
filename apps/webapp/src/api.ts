import type { Category, Product } from "./types.js";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const maxUploadBytes = 900 * 1024;
const maxImageSide = 1600;
const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const imageTypeByExtension = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"]
]);

export const weekdayOptions = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье"
] as const;

export type Settings = {
  storeName: string;
  headerImageUrl?: string | null;
  deliveryDays: string[];
  deliveryTitle?: string;
  deliveryFee: number;
  freeDeliveryFromAmount: number;
  freeDeliveryFromKg: number;
};

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const errorMessage =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : fallbackMessage;
    throw new Error(errorMessage);
  }
  return data as T;
}

export async function getSettings(): Promise<Settings> {
  const response = await fetch(`${apiUrl}/api/settings`, { cache: "no-store" });
  return readJson<Settings>(response, "Не удалось загрузить настройки");
}

export async function updateSettings(payload: Partial<Pick<Settings, "deliveryDays" | "deliveryTitle" | "headerImageUrl">>) {
  const response = await fetch(`${apiUrl}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return readJson<Settings>(response, "Не удалось сохранить настройки");
}

export async function uploadImage(file: File, kind: "header" | "product") {
  const body = await prepareImageUpload(file);
  const response = await fetch(`${apiUrl}/api/admin/uploads?kind=${kind}`, {
    method: "POST",
    headers: { "Content-Type": body.type },
    body
  });
  if (response.status === 413) {
    throw new Error("Фото слишком большое. Попробуйте выбрать фото меньшего размера.");
  }
  return readJson<{ url: string }>(response, "Не удалось загрузить фото");
}

async function prepareImageUpload(file: File): Promise<Blob> {
  const imageType = getSupportedImageType(file);

  if (!imageType) {
    throw new Error("Выберите файл изображения.");
  }

  if (file.size <= maxUploadBytes) {
    return file.type === imageType ? file : new Blob([file], { type: imageType });
  }

  const image = await loadImage(file);
  const scale = Math.min(1, maxImageSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Не удалось подготовить фото к загрузке.");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const quality of [0.82, 0.72, 0.62]) {
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (blob.size <= maxUploadBytes || quality === 0.62) return blob;
  }

  throw new Error("Не удалось подготовить фото к загрузке.");
}

function getSupportedImageType(file: File) {
  if (supportedImageTypes.has(file.type)) return file.type;

  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension ? imageTypeByExtension.get(extension) : undefined;
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Не удалось открыть фото. Попробуйте JPG, PNG или WEBP."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Не удалось подготовить фото к загрузке."));
    }, type, quality);
  });
}

export async function getCategories() {
  const response = await fetch(`${apiUrl}/api/categories`, { cache: "no-store" });
  return readJson<Category[]>(response, "Не удалось загрузить категории");
}

export async function getProducts(categoryId?: string) {
  const params = categoryId ? `?categoryId=${categoryId}` : "";
  const response = await fetch(`${apiUrl}/api/products${params}`, { cache: "no-store" });
  return readJson<Product[]>(response, "Не удалось загрузить товары");
}

export async function postOrder(payload: unknown) {
  try {
    const response = await fetch(`${apiUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return readJson<{ id: string; orderNumber: number; totalAmount: string }>(
      response,
      "Не удалось отправить заказ"
    );
  } catch (error) {
    if (!import.meta.env.DEV) {
      throw error instanceof Error ? error : new Error("Не удалось отправить заказ");
    }
    return {
      id: crypto.randomUUID(),
      orderNumber: Math.floor(1000 + Math.random() * 9000),
      totalAmount: "0"
    };
  }
}

export async function createProduct(payload: unknown) {
  const response = await fetch(`${apiUrl}/api/admin/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return readJson<Product>(response, "Не удалось добавить товар");
}

export async function updateProduct(productId: string, payload: unknown) {
  const response = await fetch(`${apiUrl}/api/admin/products/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return readJson<Product>(response, "Не удалось обновить товар");
}

export async function deactivateProduct(productId: string) {
  const response = await fetch(`${apiUrl}/api/admin/products/${productId}/deactivate`, {
    method: "PATCH"
  });
  return readJson<Product>(response, "Не удалось скрыть товар");
}

export async function reorderProducts(orderedIds: string[]) {
  const response = await fetch(`${apiUrl}/api/admin/products/reorder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedIds })
  });
  return readJson<Product[]>(response, "Не удалось изменить порядок товаров");
}
