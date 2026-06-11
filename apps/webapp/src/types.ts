export type TelegramWebApp = {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export type Category = {
  id: string;
  name: string;
  sortOrder: number;
};

export type Product = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  badge: string | null;
  purchasePrice: string;
  salePrice: string;
  discountPrice: string | null;
  unit: string;
  stockQuantity: string;
  imageUrl: string | null;
};

export type CartLine = {
  productId: string;
  quantity: number;
};
