# Changelog

## [Unreleased]

### Изменено

- `tenants.monthly_ocr_limit` — добавлен `CHECK (BETWEEN 0 AND 100)`, дефолт снижен с 200 до 50. Закладывает регулируемый месячный лимит OCR-запросов под будущую модель подписок (миграция `20260608000000`)

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
