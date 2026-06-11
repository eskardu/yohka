CREATE TABLE "StoreSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "deliveryTitle" TEXT NOT NULL DEFAULT 'Ближайшие дни доставки',
  "deliveryDays" TEXT[] NOT NULL DEFAULT ARRAY['Вторник', 'Четверг', 'Суббота']::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "StoreSettings" ("id", "deliveryTitle", "deliveryDays", "updatedAt")
VALUES ('default', 'Ближайшие дни доставки', ARRAY['Вторник', 'Четверг', 'Суббота']::TEXT[], CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
