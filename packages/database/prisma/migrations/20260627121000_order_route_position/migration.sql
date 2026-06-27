ALTER TABLE "Order" ADD COLUMN "routePosition" INTEGER;

CREATE INDEX "Order_status_routePosition_idx" ON "Order"("status", "routePosition");
