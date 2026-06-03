# Syrve Invoice AI Assistant

Telegram-бот + Mini App для мгновенной приёмки бумажных накладных в ресторанах Сербии. Сфотографировал накладную — GPT-4o Vision распознал данные — проверил цены — отправил в Syrve одной кнопкой.

## Стек

| Слой | Технологии |
|---|---|
| Хостинг | Supabase Free Tier (Postgres + Edge Functions + Storage) |
| Backend | Deno Edge Functions (TypeScript) |
| ИИ | OpenAI GPT-4o Vision — Structured Outputs |
| Frontend | React 18 + Vite + Tailwind CSS (Telegram Mini App) |
| POS интеграция | Syrve Server REST API (XML) |
| Крипто | Web Crypto API — AES-256-GCM |

## Архитектура

```
[Telegram photo] → [bot-webhook EF] → [GPT-4o Vision] → [invoice_history draft]
                                                                    ↓
[Mini App] ← [price-analyzer EF] ← [2-month price history]
     ↓
[Confirm] → [syrve-api EF] → [Syrve Server XML API] → [invoice submitted]
```

## Быстрый старт

```bash
# 1. Установить Supabase CLI
brew install supabase/tap/supabase

# 2. Сгенерировать ключ шифрования
openssl rand -hex 32

# 3. Задеплоить
supabase link --project-ref YOUR_REF
supabase db push
supabase functions deploy bot-webhook --no-verify-jwt
supabase functions deploy price-analyzer --no-verify-jwt
supabase functions deploy syrve-api --no-verify-jwt

# 4. Зарегистрировать вебхук Telegram
curl -X POST "https://api.telegram.org/botTOKEN/setWebhook" \
  -d '{"url": "https://YOUR_PROJECT.supabase.co/functions/v1/bot-webhook"}'
```

Полный runbook → [DEPLOY.md](DEPLOY.md)

## Структура проекта

```
supabase/
  migrations/   — SQL схема (8 таблиц, индексы, RLS)
  functions/
    _shared/    — общие TypeScript типы
    bot-webhook/    — Telegram webhook + GPT-4o
    price-analyzer/ — анализ отклонений цен
    syrve-api/      — крипто + XML + Syrve интеграция
tests/          — Deno unit tests (14 тестов)
web-mini-app/   — React Mini App для Telegram
DEPLOY.md       — полный деплой-гайд
```

## Переменные окружения

Supabase Edge Functions (через `supabase secrets set`):

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather |
| `OPENAI_API_KEY` | OpenAI API ключ с доступом к GPT-4o |
| `ENCRYPTION_SECRET_HEX` | AES-256 ключ (64 hex символа) |
| `MINI_APP_BASE_URL` | URL развёрнутого Mini App |

Mini App (`web-mini-app/.env.local`):

| Переменная | Описание |
|---|---|
| `VITE_SUPABASE_URL` | URL Supabase проекта |
| `VITE_SUPABASE_ANON_KEY` | Публичный anon ключ |
