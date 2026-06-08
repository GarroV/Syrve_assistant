# Backlog

## В работе

_Нет активных задач_

---

## Идеи (не приоритезировано)

### POS-1: Поддержка других POS-систем (Garson и др.)
Гарсон широко используется в Сербии — есть смысл поддержать его как второй провайдер. Архитектура сейчас завязана на Syrve (XML `incomingInvoice`, своя авторизация), но интеграция уже изолирована в отдельную Edge Function (`syrve-api`), так что добавление второго провайдера — не переписывание ядра (OCR/price-analyzer/Mini App остаются провайдер-агностичными).

**План:**
1. Связаться с Garson — узнать, дают ли API для импорта накладных и на каких условиях (формат, авторизация — по сайту неясно, нужны детали напрямую от них)
2. Добавить `pos_provider` enum-поле в `tenants` (`syrve` | `garson` | ...)
3. Только когда увидим реальный формат API Garson — писать адаптер `garson-api` по аналогии с `syrve-api` (гадать формат заранее = переписывать потом)

**Блокер:** не архитектура, а отсутствие информации о Garson API. Первый шаг — написать им.

---

## Запаркованы

### MINIAPP: Mini App как интерфейс
Весь UI на инлайн-кнопках Telegram. Mini App добавляется поверх позже как улучшение UX — не как основной интерфейс.

---

## Следующий приоритет

### OCR-1: Лимит OCR запросов по тенанту
Поле `monthly_ocr_limit` в `tenants` заполняется (теперь ограничено диапазоном 0–100, см. миграцию `20260608000000`), но `bot-webhook` его не проверяет. Тенант может делать неограниченное количество GPT-4o Vision запросов.

Решение: перед вызовом OpenAI — `COUNT(ai_token_logs)` за текущий календарный месяц (`created_at >= date_trunc('month', now())`), сравнить с лимитом. Сброс лимита — естественный, через границу календарного месяца, отдельный счётчик/cron не нужен ("переподписка" = новый месяц = новое окно подсчёта).

### SYNC-1: Синхронизация номенклатуры Syrve
`syrve_products` и `syrve_suppliers` сейчас заполняются вручную через SQL. Нужна edge function для pull из Syrve API и upsert в БД.

### SYRVE-1: Logout из Syrve после отправки накладной
`syrve-api` получает auth token но не вызывает `/resto/api/auth/logout`. Сессии накапливаются. Если Syrve ограничивает количество одновременных сессий — это сломает новые логины.

---

## Технический долг

### TD-1: Password in GET query string
Пароль Syrve передаётся как query param в URL авторизации. Попадает в логи nginx/proxy на стороне Syrve сервера. Если Syrve поддерживает POST auth или заголовки — мигрировать.

### TD-2: Invoice type has items field
`web-mini-app/src/types/index.ts` — `Invoice.items: InvoiceItem[]` объявлен как обязательный, но никогда не заполняется из DB (items хранятся отдельно). Поле нужно убрать или сделать `items?: InvoiceItem[]`.

---

## Закрытые задачи

- [x] Scaffold проекта (Supabase config, .env.example, директории) — 2026-06-03
- [x] SQL миграция (8 таблиц, RLS, индексы) — 2026-06-03
- [x] Shared TypeScript типы — 2026-06-03
- [x] AES-GCM crypto helper с тестами — 2026-06-03
- [x] Syrve XML builder с тестами — 2026-06-03
- [x] Price delta logic с тестами — 2026-06-03
- [x] price-analyzer Edge Function — 2026-06-03
- [x] bot-webhook Edge Function (GPT-4o Vision, Structured Outputs) — 2026-06-03
- [x] syrve-api Edge Function — 2026-06-03
- [x] Mini App foundation (Vite + React + Tailwind) — 2026-06-03
- [x] InvoiceItemRow компонент — 2026-06-03
- [x] MappingModal компонент — 2026-06-03
- [x] InvoicePage (полный flow) — 2026-06-03
- [x] DEPLOY.md — 2026-06-03
- [x] Критические баги (XML injection, btoa overflow, silent insert, RLS cast, cross-tenant leak) — 2026-06-03
- [x] AUTH-1: Telegram JWT авторизация для Mini App (auth-telegram EF, RLS по tg_id) — 2026-06-03
