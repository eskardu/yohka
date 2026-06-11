import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  "Мясо",
  "Фарш",
  "Сахар",
  "Макароны",
  "Масло",
  "Салаты",
  "Другие продукты"
];

const products = [
  {
    category: "Мясо",
    name: "Конина",
    description: "Свежая конина, фасовка по запросу",
    badge: "HIT",
    purchasePrice: 24,
    salePrice: 30,
    unit: "kg",
    stockQuantity: 80,
    imageUrl: "https://images.unsplash.com/photo-1607623814075-e51df1bdc82f?auto=format&fit=crop&w=800&q=80"
  },
  {
    category: "Фарш",
    name: "Фарш",
    description: "Домашний фарш для блюд на каждый день",
    badge: "NEW",
    purchasePrice: 18,
    salePrice: 25,
    unit: "kg",
    stockQuantity: 60,
    imageUrl: "https://images.unsplash.com/photo-1588168333986-5078d3ae3976?auto=format&fit=crop&w=800&q=80"
  },
  {
    category: "Сахар",
    name: "Сахар",
    description: "Белый сахар, упаковка 1 кг",
    badge: "DISCOUNT",
    purchasePrice: 10,
    salePrice: 15,
    unit: "pack",
    stockQuantity: 120,
    imageUrl: "https://images.unsplash.com/photo-1581268497089-7a975fb491a3?auto=format&fit=crop&w=800&q=80"
  },
  {
    category: "Макароны",
    name: "Макароны",
    description: "Макароны из твердых сортов пшеницы",
    badge: null,
    purchasePrice: 5,
    salePrice: 7,
    unit: "pack",
    stockQuantity: 150,
    imageUrl: "https://images.unsplash.com/photo-1551462147-37885acc36f1?auto=format&fit=crop&w=800&q=80"
  },
  {
    category: "Масло",
    name: "Сливочное масло",
    description: "Сливочное масло 82.5%",
    badge: null,
    purchasePrice: 11,
    salePrice: 16,
    unit: "piece",
    stockQuantity: 70,
    imageUrl: "https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?auto=format&fit=crop&w=800&q=80"
  },
  {
    category: "Салаты",
    name: "Салат",
    description: "Готовый салат, свежая порция",
    badge: "NEW",
    purchasePrice: 9,
    salePrice: 14,
    unit: "piece",
    stockQuantity: 45,
    imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80"
  },
  {
    category: "Другие продукты",
    name: "Вода Замзам",
    description: "Священная вода Замзам",
    badge: "NEW",
    purchasePrice: 8,
    salePrice: 12,
    unit: "liter",
    stockQuantity: 50,
    imageUrl: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=800&q=80"
  },
  {
    category: "Салаты",
    name: "Свежий салат",
    description: "Свежий салат на каждый день",
    badge: "HIT",
    purchasePrice: 9,
    salePrice: 14,
    unit: "piece",
    stockQuantity: 40,
    imageUrl: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80"
  }
];

async function main() {
  const categoryMap = new Map<string, string>();

  for (const [index, name] of categories.entries()) {
    const category = await prisma.category.upsert({
      where: { id: `seed-${name}` },
      update: { name, sortOrder: index, isActive: true },
      create: { id: `seed-${name}`, name, sortOrder: index, isActive: true }
    });
    categoryMap.set(name, category.id);
  }

  for (const product of products) {
    const categoryId = categoryMap.get(product.category);
    if (!categoryId) continue;
    const { category: _category, ...data } = product;

    await prisma.product.upsert({
      where: { id: `seed-${product.name}` },
      update: {
        ...data,
        categoryId,
        isActive: true
      },
      create: {
        id: `seed-${product.name}`,
        ...data,
        categoryId,
        isActive: true
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
