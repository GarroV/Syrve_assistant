# Deployment Runbook

## Prerequisites

- Supabase CLI installed: `brew install supabase/tap/supabase`
- Supabase project created at supabase.com (free tier)
- Telegram Bot created via @BotFather
- OpenAI API key with GPT-4o access
- Node.js 18+ for Mini App build
- Vercel CLI (optional): `npm i -g vercel`

---

## 1. Generate Encryption Key

```bash
openssl rand -hex 32
# Copy the 64-char hex output — this is your ENCRYPTION_SECRET_HEX
```

## 2. Encrypt Syrve Password

Run this Deno snippet locally to encrypt your Syrve server password:

```typescript
import { encryptPassword } from "./supabase/functions/syrve-api/crypto-helper.ts";

const encrypted = await encryptPassword(
  "YOUR_SYRVE_PASSWORD",
  "YOUR_64_HEX_KEY"
);
console.log(encrypted); // Paste this into the DB seed below
```

```bash
deno run --allow-all /tmp/encrypt.ts
```

## 3. Initialize Supabase Project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Expected: `Applying migration 20260602000000_init_schema.sql... done`

## 4. Set Edge Function Secrets

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=123456789:AAxxxxxxxxxx
supabase secrets set OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
supabase secrets set ENCRYPTION_SECRET_HEX=<64-hex-chars-from-step-1>
supabase secrets set MINI_APP_BASE_URL=https://your-mini-app.vercel.app
```

## 5. Deploy Edge Functions

```bash
supabase functions deploy bot-webhook --no-verify-jwt
supabase functions deploy price-analyzer --no-verify-jwt
supabase functions deploy syrve-api --no-verify-jwt
```

Expected output for each:
```
Deploying Function bot-webhook ... done
```

## 6. Register Telegram Webhook

```bash
export BOT_TOKEN=<your-telegram-bot-token>
export WEBHOOK_URL="$(supabase functions url bot-webhook)"

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${WEBHOOK_URL}\"}"
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`

## 7. Seed First Tenant and User

Run in Supabase SQL editor (supabase.com → SQL Editor):

```sql
INSERT INTO public.tenants (
  name, pib, syrve_api_url, syrve_login, syrve_password_encrypted,
  price_alert_threshold_percent, monthly_ocr_limit
) VALUES (
  'My Restaurant',
  '123456789',                          -- 9-digit Serbian PIB
  'https://syrve-server.example.com',   -- Your Syrve Server URL
  'admin',                               -- Syrve login
  'BASE64_ENCRYPTED_PASSWORD',           -- Output from Step 2
  10.00,
  200
);

-- Replace with your actual Telegram user ID (get it from @userinfobot)
INSERT INTO public.users (tg_id, tenant_id, username, role)
VALUES (123456789, 1, 'my_username', 'owner');
```

## 8. Deploy Mini App to Vercel

```bash
cd web-mini-app
cp .env.example .env.local
# Edit .env.local with your actual values:
#   VITE_SUPABASE_URL=https://your-project.supabase.co
#   VITE_SUPABASE_ANON_KEY=your-anon-key

npm run build   # Verify build passes locally first
vercel --prod   # Deploy to Vercel
# OR: connect GitHub repo to Vercel and set env vars in Vercel dashboard
```

Set environment variables in Vercel dashboard:
- `VITE_SUPABASE_URL` = your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` = your Supabase anon key (safe to expose in frontend)

## 9. Register Mini App with Telegram

In @BotFather:
1. `/mybots` → select your bot
2. `Bot Settings` → `Menu Button` → `Configure menu button`
3. Set URL to your Vercel deployment URL

## 10. Smoke Test

1. Send a photo of any paper invoice to your bot
2. Bot replies: "⏳ Документ получен. ИИ анализирует накладную..."
3. Bot replies with Mini App button within ~15 seconds
4. Tap button — Mini App opens, showing parsed line items
5. Unmapped items show red "⚠️ Не связан" badge
6. Map one item → confirm → badge disappears
7. Enter your store GUID and tap "Отправить в Syrve"
8. Verify in Supabase: `SELECT status, syrve_id FROM invoice_history ORDER BY id DESC LIMIT 1;`
9. Expected: `status = 'submitted'`, `syrve_id` = UUID from Syrve

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Bot doesn't respond to photos | Webhook not set or wrong URL | Re-run Step 6, check `supabase functions url bot-webhook` |
| "Вы не зарегистрированы" | User not seeded in DB | Run Step 7 SQL with your actual tg_id |
| GPT-4o times out | Large image + slow network | Telegram resizes photos, usually fine. Check OpenAI key quota |
| Syrve auth error | Wrong password or URL | Verify syrve_api_url ends without trailing `/`, re-encrypt password |
| Mini App shows blank | VITE_ env vars not set in Vercel | Add env vars in Vercel dashboard, redeploy |
| `status = 'error'` in DB | Syrve import rejected XML | Check `error_message` column; validate store_guid and supplier_guid exist in Syrve |
