# Инструкции для Claude Code — Syrve Invoice AI Assistant

**Проект:** Telegram-бот + Mini App для приёмки бумажных накладных в ресторанах. Фото накладной → GPT-4o Vision распознаёт → проверка цен → отправка в Syrve POS.

**Стек:** Supabase (Postgres + Edge Functions + Storage), Deno Edge Functions на TypeScript, OpenAI GPT-4o Vision, React 18 + Vite + Tailwind (Mini App), Syrve Server REST API (XML), Web Crypto AES-256-GCM.

---

## Перед изменением кода

1. **Прочитай `ARCHITECTURE.md`** — флоу данных, таблицы БД, описание каждой edge function, изоляция тенантов, шифрование. За деплоем — `DEPLOY.md`, за обзором стека/эндпоинтов — `README.md`.
2. **Type-check перед коммитом** — красный type-check не коммитим:
   - Edge Functions (Deno): `deno check supabase/functions/<name>/index.ts` (захватывает импорты `_shared/` и `../`).
   - Тесты (Deno): `deno test --allow-all tests/` — 3 файла (`analyzer`, `crypto-helper`, `syrve-xml-builder`).
   - Mini App (Node): `cd web-mini-app && npm run build` (это `tsc && vite build` — тип-чек + сборка).
3. **Деплой сразу после изменения кода** — код без деплоя не меняет ничего для пользователя.
   - Edge Functions всегда с `--no-verify-jwt` (иначе Telegram/Mini App получат 401):
     `supabase functions deploy <name> --no-verify-jwt`
   - Функции с импортами из `_shared/` или `../` деплоить только через **Supabase CLI**, не через MCP (MCP ломает относительные импорты).
   - Mini App: `cd web-mini-app && npm run build && vercel --prod` (или авто-деплой через подключённый GitHub-репо).

---

## Git-дисциплина

- **Рабочая ветка:** вся разработка ведётся в фича-ветке от `main`. Никогда не коммитить напрямую в `main` — изменения только через PR.
- Один коммит = одно логически завершённое изменение. Не накапливать несколько правок в одном коммите.
- После каждого коммита — сразу `git push`. Код без пуша не существует для CI, деплоя и остальных.
- Формула: `git add <files> && git commit -m "..." && git push -u origin <branch>`.
- Если сессия длится несколько часов — коммитить и пушить минимум раз в день, даже незаконченное (WIP-коммит).

### Conventional commits (строго)

Commit-сообщения = источник истории/changelog. Формат: `<type>: <описание по сути>`.
Типы: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

---

## Документация — обновлять сразу по факту, не копить в конце сессии

- **ARCHITECTURE.md** — при любом изменении флоу, структуры данных, таблиц БД, edge functions или ключевых зависимостей.
- **README.md** — при изменении стека, публичных эндпоинтов, env-переменных или способа развёртывания.
- **DEPLOY.md** — при изменении шагов деплоя, секретов или регистрации вебхука/Mini App.
- **CHANGELOG.md** — после новой фичи или изменения поведения, пока контекст свежий.
- **BACKLOG.md** — при закрытии задачи, появлении нового техдолга или изменении приоритетов.

Незакоммиченные изменения и необновлённая документация в конце сессии — незавершённая задача. Если флоу изменился, а док нет — задача не закрыта.

---

## Безопасность

### Секреты и env

- **Никогда не хардкодить секреты** в коде — только через env / `supabase secrets set`. `.env` / `.env.local` не коммитить (только `.env.example`).
- Edge-секреты: `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`, `ENCRYPTION_SECRET_HEX` (64 hex), `MINI_APP_BASE_URL`, плюс автоматические `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
- `ENCRYPTION_SECRET_HEX` шифрует пароль Syrve (AES-256-GCM, IV prepended, base64) — ключ генерируется один раз `openssl rand -hex 32`, ротация ломает расшифровку существующих паролей.
- Mini App: только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` (anon-ключ безопасно публиковать во фронте — никаких сервисных ключей в Mini App).
- Валидация входов на границах: проверять `tenant_id` / `invoice_id` / Telegram `initData` до использования.

### Доступ и изоляция тенантов

- Edge Functions работают через `service_role` (bypass RLS). **Вся проверка доступа — только в коде** через `tenant_id` из таблицы `users`. Не обходить эти проверки прямыми запросами.
- При мутациях (изменение, удаление) — всегда проверять, что пользователь владеет ресурсом / относится к нужному `tenant_id`.
- Mini App авторизуется через `auth-telegram` (HMAC-SHA256 верификация `initData` → Supabase JWT с `app_metadata.tg_id`); прямые запросы из Mini App идут с этим JWT, RLS фильтрует по `tg_id → tenant_id`.

### Миграции БД

- `ADD COLUMN` — безопасно, делать сразу.
- `DROP COLUMN`, `RENAME COLUMN`, `ALTER TYPE` — только в два шага: убрать из кода → деплой → менять схему.
- **Никогда не писать `DELETE` / `UPDATE` без `WHERE`** — даже в миграциях.
- Миграции лежат в `supabase/migrations/` (имя `YYYYMMDDHHMMSS_*.sql`), применяются `supabase db push`.

---

## Стиль кода

- Не добавлять фичи, рефакторинг или абстракции за пределами задачи (YAGNI).
- Не добавлять обработку ошибок для сценариев, которые не могут произойти.
- Комментарии — только когда WHY неочевиден (скрытое ограничение, воркэраунд для конкретного бага). Не объяснять ЧТО делает код — это делают хорошие имена.
- Перед изменением работающей интеграции — сначала понять, как она работает **прямо сейчас**, не предполагать. Три итерации попыток починить то, что работало — признак того, что не разобрались в текущем состоянии.

---

## Карта проекта

```
supabase/
  config.toml
  migrations/                — SQL-схема и изменения (init + RLS fix + OCR-лимит)
  functions/
    _shared/types.ts         — общие TypeScript-типы (OcrInvoice и пр.)
    auth-telegram/           — верификация initData → Supabase JWT
    bot-webhook/             — Telegram webhook + GPT-4o Vision OCR → draft
    price-analyzer/          — анализ отклонений цен (analyzer.ts — чистая логика)
    syrve-api/               — отправка в Syrve: crypto-helper.ts + syrve-xml-builder.ts
    syrve-sync/              — синк номенклатуры и поставщиков из Syrve в справочники
tests/                       — Deno unit-тесты (analyzer, crypto-helper, xml-builder)
web-mini-app/                — React 18 + Vite + Tailwind Mini App
  src/pages/                 — InvoicePage + components (InvoiceItemRow, MappingModal)
  src/contexts/AuthContext   — авторизация через auth-telegram
  src/lib/supabase.ts        — клиент (anon-ключ, SELECT + вызовы EF)
ARCHITECTURE.md · README.md · DEPLOY.md · BACKLOG.md · CHANGELOG.md
```

**Edge Functions деплоятся по отдельности** (`bot-webhook`, `price-analyzer`, `syrve-api`, `auth-telegram`, `syrve-sync`) — каждая со своим `deno.json`, общего root-конфига Deno нет.
