ALTER TABLE "Product" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ordered_products AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, name ASC) - 1 AS sort_order
  FROM "Product"
)
UPDATE "Product"
SET "sortOrder" = ordered_products.sort_order
FROM ordered_products
WHERE "Product".id = ordered_products.id;

CREATE INDEX "Product_sortOrder_idx" ON "Product"("sortOrder");
