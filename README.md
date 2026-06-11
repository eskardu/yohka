# Yohkar Orders MVP

MVP системы заказов продуктов через Telegram:

- React + Vite Telegram Mini App для клиента
- Express API на TypeScript
- PostgreSQL + Prisma
- клиентский Telegram bot для открытия Mini App
- админский Telegram bot для заказов, статусов, статистики и общего маршрута

## Структура

```text
apps/webapp      Telegram Mini App
apps/api         Backend API
apps/client-bot  Bot с кнопкой "Открыть магазин"
apps/admin-bot   Bot для админа/курьера
packages/database Prisma schema/client
packages/shared   Общие типы и утилиты
```

## Локальный запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать `.env` из `.env.example` и заполнить:

```bash
cp .env.example .env
```

3. Поднять PostgreSQL и указать `DATABASE_URL`.

4. Применить миграции, сгенерировать Prisma Client и загрузить seed:

```bash
npm run prisma:migrate
npm run prisma:generate
npm run prisma:seed
```

5. Запустить все сервисы:

```bash
npm run dev
```

По умолчанию:

- API: `http://localhost:4000`
- Mini App: `http://127.0.0.1:5173`

Для теста вне Telegram frontend отправляет dev-пользователя, если `NODE_ENV !== production`.

## Telegram bots

1. Создать два бота через BotFather:
   - клиентский бот: `BOT_TOKEN_CLIENT`
   - админский бот: `BOT_TOKEN_ADMIN`
2. Для Mini App указать публичный `WEBAPP_URL`. В проде это должен быть HTTPS URL.
3. В `.env` добавить Telegram ID админов:

```env
ADMIN_TELEGRAM_IDS="123456789,987654321"
```

4. Запустить:

```bash
npm run dev -w @yohkar/client-bot
npm run dev -w @yohkar/admin-bot
```

Клиентский бот отвечает `/start` кнопкой открытия магазина. Админский бот открывает меню через `/admin`, получает новые заказы от API и позволяет менять статусы inline-кнопками.

Для доступа к админке Mini App укажите в env:

```env
VITE_ADMIN_TELEGRAM_IDS="ваш_telegram_id"
VITE_ADMIN_PIN="сложный_PIN_для_локального_входа"
```

В Telegram кнопка админки показывается только указанным Telegram ID. В локальном браузере можно войти по PIN.

## Основной сценарий

1. Клиент открывает клиентского бота.
2. Нажимает "Открыть магазин".
3. Выбирает категорию и товары.
4. Открывает корзину и checkout.
5. Вводит имя, телефон, адрес/комментарий, выбирает способ оплаты и день доставки.
6. Отправляет геолокацию.
7. Backend валидирует Telegram initData, проверяет товары и остатки, считает цены из базы, создает заказ и snapshot позиций.
8. Admin bot получает заказ с товарами, суммой, геолокацией и кнопками статуса.
9. После статуса `DELIVERED` API сохраняет `deliveredAt`, заказ попадает в статистику, клиент получает сообщение.

## API

Основные endpoints:

- `GET /api/categories`
- `GET /api/products`
- `GET /api/products?categoryId=...`
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/orders/:id`
- `PATCH /api/orders/:id/status`
- `GET /api/admin/stats?period=today|yesterday|week|month|year`
- `GET /api/admin/customers/:id`
- `POST /api/admin/products`
- `PATCH /api/admin/products/:id`
- `PATCH /api/admin/products/:id/deactivate`
- `GET /api/admin/routes/today`

## Route building

`GET /api/admin/routes/today` берет заказы со статусом `ACCEPTED` и `ON_DELIVERY` за текущий день, сортирует точки простым nearest-neighbor алгоритмом от координат магазина (`STORE_LATITUDE`, `STORE_LONGITUDE`) и возвращает Google Maps Directions URL.

## Deploy

Минимальный вариант:

- PostgreSQL: Supabase, Neon, Railway или managed Postgres
- API и боты: Render, Railway, Fly.io, VPS или Docker
- Webapp: Vercel, Netlify, Cloudflare Pages или статический хостинг
- `WEBAPP_URL` должен быть HTTPS
- `CORS_ORIGIN` должен указывать на домен Mini App
- выполнить `npm run prisma:deploy` на deploy API
- выполнить `npm run prisma:seed` один раз для начальных товаров

## Production hardening

Перед реальным запуском стоит добавить:

- авторизацию admin API endpoints, сейчас они рассчитаны на доверенный backend/bot контур MVP
- webhook-режим для Telegram bots вместо long polling
- rate limiting и audit log для админских действий
- нормализацию телефонов и адресов
- транзакционную проверку остатков с защитой от гонок при высоком трафике
- мониторинг, structured logging и Sentry
- секреты через vault/hosting secrets
- CI с `npm audit`, typecheck, build и миграционными проверками
- обработку платежей и статусов оплаты

`npm install` сейчас сообщает о 2 critical audit findings в дереве зависимостей. Перед production нужно разобрать `npm audit` и обновить уязвимые пакеты без слепого ломающего `audit fix`.

## Version 2

- промокоды
- referral system
- loyalty points
- delivery zones
- push-уведомления клиентам
- low stock alerts
- CSV/Excel export
- импорт товаров из spreadsheet
- отдельные аккаунты курьеров
- payment integration
- invoice generation
- web admin panel поверх уже готовых admin endpoints
