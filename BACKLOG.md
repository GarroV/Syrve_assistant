# Backlog

## В работе

_Нет активных задач_

---

## Следующий приоритет

### AUTH-1: Telegram JWT авторизация для Mini App
**Долг из 0.1.0.** RLS политики сейчас используют `USING (true)` — изоляция тенантов только на уровне service_role в edge functions. Mini App с anon ключом может читать чужие инвойсы если знает ID.

Решение: верифицировать Telegram WebApp `initData` через edge function, выдавать Supabase JWT с `app_metadata.tg_id`, использовать `(auth.jwt()->'app_metadata'->>'tg_id')::bigint` в RLS.

### OCR-1: Лимит OCR запросов по тенанту
Поле `monthly_ocr_limit` в `tenants` заполняется, но `bot-webhook` его не проверяет. Тенант может делать неограниченное количество GPT-4o Vision запросов.

Решение: перед вызовом OpenAI — `COUNT(ai_token_logs)` за текущий месяц, сравнить с лимитом.

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
