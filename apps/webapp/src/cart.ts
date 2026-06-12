import type { CartLine, Product } from "./types.js";

export function getCartTotals(cart: CartLine[], products: Product[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  return cart.reduce(
    (totals, line) => {
      const product = byId.get(line.productId);
      if (!product) return totals;
      const price = Number(product.discountPrice ?? product.salePrice);
      totals.itemCount += line.quantity;
      totals.subtotal += price * line.quantity;
      if (product.unit === "kg") totals.kg += line.quantity;
      return totals;
    },
    { itemCount: 0, subtotal: 0, kg: 0 }
  );
}
