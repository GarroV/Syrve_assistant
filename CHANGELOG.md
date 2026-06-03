# Changelog

## [0.2.0] — 2026-06-03

### Добавлено

- `auth-telegram` edge function — верификация Telegram `initData` (HMAC-SHA256), выдача Supabase JWT с `app_metadata.tg_id`; токен живёт 1 час
- `AuthContext` (Mini App) — при старте авторизует пользователя через `auth-telegram`, хранит authenticated Supabase client и `accessToken` в React context
- RLS миграция `20260603000000_fix_rls_telegram_jwt.sql` — все политики `USING (true)` заменены на фильтрацию по `tg_id` из JWT; добавлен RLS на `ocr_mappings` (ранее отсутствовал)

### Изменено

- `InvoicePage` — все запросы к Supabase через authenticated client из `AuthContext`; заголовки edge function вызовов обновлены на JWT вместо anon key
- `supabase.ts` — добавлена `createAuthenticatedClient(accessToken)` фабрика
- `App.tsx` — обёрнут в `AuthProvider` с экранами загрузки/ошибки авторизации

### Безопасность

- Закрыта дыра AUTH-1: до этого Mini App с anon ключом мог читать `invoice_history` любого тенанта зная ID документа

## [0.1.0] — 2026-06-03

### Добавлено

**Инфраструктура**
- Supabase конфиг (`supabase/config.toml`) с отключённым JWT для edge functions
- SQL миграция: 8 таблиц (tenants, users, syrve_products, syrve_suppliers, ocr_mappings, invoice_history, invoice_items_history, ai_token_logs), 4 индекса, RLS на всех таблицах с данными тенантов

**Edge Functions**
- `bot-webhook` — обработчик Telegram webhook: скачивает фото, вызывает GPT-4o Vision (Structured Outputs, json_schema), автолинкует товары через ocr_mappings, сохраняет черновик инвойса, отправляет Mini App ссылку
- `price-analyzer` — анализ отклонений цен за 2 месяца; два-шаговый запрос для корректной изоляции по тенанту/поставщику
- `syrve-api` — расшифровка пароля AES-GCM, авторизация в Syrve, сборка и отправка XML накладной, обновление статуса документа

**Утилиты (с тестами TDD)**
- `crypto-helper.ts` — AES-256-GCM encrypt/decrypt через Web Crypto API (3 теста)
- `syrve-xml-builder.ts` — сборка XML для Syrve incomingInvoice API с DD.MM.YYYY датой (6 тестов)
- `analyzer.ts` — вычисление delta_percent и is_alert с 2-знаковым округлением (5 тестов)

**Mini App (Telegram)**
- `InvoicePage` — загрузка инвойса + price-analyzer, автовыбор поставщика по PIB, ручной маппинг товаров, редактирование qty/price, submit в Syrve
- `InvoiceItemRow` — строка позиции с price alert badge (▲/▼%), полями редактирования, красной подсветкой для unmapped
- `MappingModal` — bottom-sheet для связки OCR-текста с номенклатурой Syrve, поиск, выбор, сохранение в ocr_mappings

**Документация**
- `DEPLOY.md` — полный деплой-гайд: генерация ключа, шифрование пароля, Supabase push, secrets, функции, webhook, seed SQL, Vercel, smoke test, troubleshooting

### Исправлено (в рамках 0.1.0)

- XML injection — добавлен `xmlEscape()` для doc_number и GUID полей в XML builder
- Stack overflow — chunked base64 конвертация фото (8192-байтные чанки вместо spread)
- Потеря данных — ошибка вставки строк накладной теперь пробрасывается, не глотается
- RLS — убраны поломанные `auth.uid()::bigint` касты; используется `USING (true)` (MVP, v2 добавит JWT)
- Cross-tenant утечка — price-analyzer перешёл на двухшаговый запрос вместо фильтрации через join (Supabase JS v2 не поддерживает dot-notation фильтры на joined таблицах)
