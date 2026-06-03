# Архитектура системы

## Паттерн

100% Serverless на Supabase Free Tier. Нет постоянно запущенных серверов — только Edge Functions, которые поднимаются на каждый запрос. Единая точка правды — PostgreSQL в Supabase.

## Поток данных

```
[Пользователь]
    │ фото накладной
    ▼
[Telegram Bot API]
    │ webhook POST
    ▼
[bot-webhook Edge Function]
    ├─ GET /getFile → скачивает фото с серверов Telegram
    ├─ POST OpenAI GPT-4o Vision (Structured Outputs) → OcrInvoice JSON
    ├─ SELECT ocr_mappings → автолинк известных позиций
    ├─ INSERT invoice_history (status=draft)
    ├─ INSERT invoice_items_history
    ├─ INSERT ai_token_logs
    └─ sendMessage → инлайн-кнопка с Mini App URL
    
[Mini App открывается в Telegram]
    ├─ POST auth-telegram → verifyInitData → Supabase JWT (tg_id)
    ├─ SELECT invoice_history + invoice_items_history (JWT, RLS изолирует тенанта)
    ├─ SELECT syrve_products + syrve_suppliers (JWT, RLS изолирует тенанта)
    ├─ POST price-analyzer Edge Function
    │       └─ SELECT invoice_history (tenant+supplier+date range)
    │       └─ SELECT invoice_items_history (by product, by invoices above)
    │       └─ computeDelta() → delta_percent, is_alert
    └─ рендер: красные (unmapped) + жёлтые (price alert) строки
    
[Пользователь подтверждает]
    └─ POST syrve-api Edge Function
            ├─ SELECT invoice_history + tenants (join)
            ├─ decryptPassword() AES-GCM
            ├─ GET Syrve /resto/api/auth/login → authToken
            ├─ buildSyrveInvoiceXml() → XML payload
            ├─ POST Syrve /resto/api/documents/import/incomingInvoice
            └─ UPDATE invoice_history status=submitted|error
```

## База данных

### Таблицы

| Таблица | Назначение |
|---|---|
| `tenants` | Заведения — настройки Syrve, порог цены, лимит OCR |
| `users` | Telegram пользователи → tenant, роль |
| `syrve_products` | Справочник номенклатуры из Syrve |
| `syrve_suppliers` | Справочник поставщиков из Syrve |
| `ocr_mappings` | Словарь OCR-текст → syrve_product (обучается вручную) |
| `invoice_history` | Документы: draft → submitted / error |
| `invoice_items_history` | Строки накладных с ценами |
| `ai_token_logs` | Расходы OpenAI API по тенантам |

### Изоляция тенантов

Edge Functions работают через `service_role` ключ (bypass RLS). Весь контроль доступа — в коде функций, через `tenant_id` из таблицы `users`.

Mini App авторизуется через `auth-telegram` edge function: передаёт Telegram `initData`, получает Supabase JWT с `app_metadata.tg_id`. Все прямые запросы к Supabase идут с этим JWT — RLS фильтрует строки через `(auth.jwt()->'app_metadata'->>'tg_id')::bigint` сопоставляя с `users.tg_id → tenant_id`.

### Ключевые индексы

- `idx_invoice_date_filter (doc_date, tenant_id, status)` — поиск истории цен за 2 месяца
- `idx_invoice_items_product (syrve_product_id)` — поиск цен по товару
- `idx_ocr_mappings_lookup (tenant_id, supplier_pib, ocr_text_raw)` — автолинк при распознавании

## Edge Functions

### auth-telegram

- **Триггер:** POST из Mini App при старте (один раз за сессию)
- **Вход:** `{ init_data: string }` — Telegram WebApp initData
- **Логика:** HMAC-SHA256 верификация подписи (ключ = HMAC("WebAppData", BOT_TOKEN)), проверка `auth_date` (не старше 1ч), создание Supabase JWT с `{ sub: tg_id, role: "authenticated", app_metadata: { tg_id } }` подписанного `SUPABASE_JWT_SECRET`
- **Выход:** `{ access_token, tg_id }`

### bot-webhook

- **Триггер:** Telegram webhook (каждое сообщение боту)
- **Вход:** Telegram Update JSON
- **Ключевые зависимости:** OpenAI API, Telegram Bot API, Supabase DB
- **Особенности:** base64 конвертация фото — chunked (8192 байт), чтобы избежать stack overflow на больших изображениях

### price-analyzer

- **Триггер:** POST из Mini App при загрузке инвойса
- **Вход:** `{ invoice_id }`
- **Логика:** 2-шаговый запрос — сначала ID инвойсов тенанта за 2 месяца, потом цены по этим инвойсам. Прямой JOIN с фильтрацией через Supabase JS v2 не работает — используем два независимых запроса.

### syrve-api

- **Триггер:** POST из Mini App при нажатии «Отправить»
- **Вход:** `{ invoice_id, store_guid, supplier_guid, validated_items[] }`
- **Безопасность:** пароль Syrve хранится зашифрованным (AES-256-GCM, IV prepended, base64). Ключ — env var `ENCRYPTION_SECRET_HEX`.
- **Syrve auth:** GET `/resto/api/auth/login?login=...&pass=...` → plain-text токен в теле ответа → передаётся как `?key=TOKEN` в следующих запросах.

## Mini App

React 18 + Vite + Tailwind. Встроен в Telegram через `web_app` кнопку.

- Читает данные напрямую через Supabase anon ключ (только SELECT)
- Вызывает Edge Functions с anon ключом в Authorization header
- При маппинге товара: сохраняет связь в `ocr_mappings` — следующий раз этот OCR-текст от этого поставщика автоматически привяжется

## Шифрование паролей

```
ENCRYPT: plaintext → AES-256-GCM(random 12-byte IV) → IV || ciphertext → base64
DECRYPT: base64 → bytes → IV (first 12) + ciphertext (rest) → AES-256-GCM decrypt → plaintext
```

Ключ: 32-байтный AES ключ как 64 hex символа в env var. Генерируется один раз: `openssl rand -hex 32`.
