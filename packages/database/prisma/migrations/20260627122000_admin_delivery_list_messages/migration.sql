CREATE TABLE "AdminDeliveryListMessage" (
    "id" TEXT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminDeliveryListMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminDeliveryListMessage_chatId_key" ON "AdminDeliveryListMessage"("chatId");
