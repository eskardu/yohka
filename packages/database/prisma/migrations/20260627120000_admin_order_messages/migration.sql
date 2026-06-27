CREATE TABLE "AdminOrderMessage" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "messageId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminOrderMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminOrderMessage_orderId_chatId_key" ON "AdminOrderMessage"("orderId", "chatId");
CREATE INDEX "AdminOrderMessage_orderId_idx" ON "AdminOrderMessage"("orderId");

ALTER TABLE "AdminOrderMessage"
  ADD CONSTRAINT "AdminOrderMessage_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
