# Syrve Invoice AI Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram bot + Mini App that photographs paper invoices, extracts data via GPT-4o Vision, validates it against price history, and posts approved invoices to the Syrve restaurant management system via XML API.

**Architecture:** Fully serverless on Supabase Free Tier — three Deno Edge Functions handle all business logic (Telegram webhook, price analysis, Syrve submission). The React Telegram Mini App calls Supabase directly for reads and Edge Functions for mutations. Tenant isolation is enforced at the DB level via RLS.

**Tech Stack:** Supabase (Postgres + Edge Functions + Storage), Deno, OpenAI API (gpt-4o Structured Outputs), Telegram Bot API + Mini App SDK, React + Vite + Tailwind CSS, AES-GCM encryption via Web Crypto API.

---

## File Map

```
srv-invoice-app/
├── supabase/
│   ├── config.toml                                     CREATE  Supabase project config
│   ├── migrations/
│   │   └── 20260602000000_init_schema.sql              CREATE  All tables, indexes, RLS
│   └── functions/
│       ├── _shared/
│       │   └── types.ts                                CREATE  Shared TS types for all functions
│       ├── bot-webhook/
│       │   ├── index.ts                                CREATE  Telegram webhook + GPT-4o + draft save
│       │   └── deno.json                               CREATE  Deno import map config
│       ├── price-analyzer/
│       │   ├── index.ts                                CREATE  Price anomaly detection
│       │   ├── analyzer.ts                             CREATE  Pure price delta logic (testable)
│       │   └── deno.json                               CREATE
│       └── syrve-api/
│           ├── index.ts                                CREATE  Auth + XML submit + status update
│           ├── crypto-helper.ts                        CREATE  AES-GCM decrypt (testable)
│           ├── syrve-xml-builder.ts                    CREATE  XML assembly (testable)
│           └── deno.json                               CREATE
├── tests/
│   ├── crypto-helper.test.ts                           CREATE  Deno unit tests for AES decrypt
│   ├── syrve-xml-builder.test.ts                       CREATE  Deno unit tests for XML output
│   └── analyzer.test.ts                                CREATE  Deno unit tests for price delta
├── web-mini-app/
│   ├── package.json                                    CREATE
│   ├── vite.config.ts                                  CREATE
│   ├── tailwind.config.ts                              CREATE
│   ├── index.html                                      CREATE
│   └── src/
│       ├── main.tsx                                    CREATE  React entrypoint
│       ├── App.tsx                                     CREATE  Router + Telegram SDK init
│       ├── lib/
│       │   └── supabase.ts                             CREATE  Supabase client singleton
│       ├── types/
│       │   └── index.ts                                CREATE  Shared frontend types
│       └── pages/
│           ├── InvoicePage.tsx                         CREATE  Main review + confirm page
│           └── components/
│               ├── InvoiceItemRow.tsx                  CREATE  Single line item with alert badge
│               └── MappingModal.tsx                    CREATE  Unmapped product picker modal
└── .env.example                                        CREATE  Required env var template
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `supabase/config.toml`
- Create: `.env.example`

- [ ] **Step 1: Create the Supabase config**

```toml
# supabase/config.toml
[project]
project_id = "srv-invoice-app"

[api]
enabled = true
port = 54321
schemas = ["public", "storage", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 15

[studio]
enabled = true
port = 54323
api_url = "http://127.0.0.1"

[inbucket]
enabled = true
port = 54324

[storage]
enabled = true

[auth]
enabled = true
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["https://127.0.0.1:3000"]
jwt_expiry = 3600
enable_refresh_token_rotation = true

[functions.bot-webhook]
verify_jwt = false

[functions.price-analyzer]
verify_jwt = false

[functions.syrve-api]
verify_jwt = false
```

- [ ] **Step 2: Create the .env.example**

```bash
# .env.example
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key

TELEGRAM_BOT_TOKEN=123456789:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# AES-256 key as 64 hex chars (32 bytes)
# Generate with: openssl rand -hex 32
ENCRYPTION_SECRET_HEX=0000000000000000000000000000000000000000000000000000000000000000

# Public URL where the Telegram Mini App is deployed
MINI_APP_BASE_URL=https://your-mini-app.vercel.app
```

- [ ] **Step 3: Create the top-level directory skeleton**

```bash
mkdir -p supabase/migrations
mkdir -p supabase/functions/_shared
mkdir -p supabase/functions/bot-webhook
mkdir -p supabase/functions/price-analyzer
mkdir -p supabase/functions/syrve-api
mkdir -p tests
```

- [ ] **Step 4: Commit**

```bash
git init
git add supabase/config.toml .env.example
git commit -m "chore: project scaffolding and supabase config"
```

---

## Task 2: Database Migration

**Files:**
- Create: `supabase/migrations/20260602000000_init_schema.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260602000000_init_schema.sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. TENANTS
CREATE TABLE public.tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    pib VARCHAR(20) UNIQUE NOT NULL,
    syrve_api_url VARCHAR(255) NOT NULL,
    syrve_login VARCHAR(255) NOT NULL,
    syrve_password_encrypted TEXT NOT NULL,
    price_alert_threshold_percent DECIMAL(5, 2) DEFAULT 10.00 NOT NULL,
    monthly_ocr_limit INTEGER DEFAULT 200 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- 2. USERS
CREATE TABLE public.users (
    id SERIAL PRIMARY KEY,
    tg_id BIGINT UNIQUE NOT NULL,
    tenant_id INTEGER REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    username VARCHAR(100),
    role VARCHAR(20) DEFAULT 'employee' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    CONSTRAINT users_role_check CHECK (role IN ('owner', 'manager', 'employee'))
);

-- 3. SYRVE PRODUCTS (nomenclature)
CREATE TABLE public.syrve_products (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    syrve_guid UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(50),
    base_unit VARCHAR(20),
    is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
    CONSTRAINT unique_tenant_product UNIQUE(tenant_id, syrve_guid)
);

-- 4. SYRVE SUPPLIERS
CREATE TABLE public.syrve_suppliers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    syrve_guid UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    pib VARCHAR(20),
    CONSTRAINT unique_tenant_supplier UNIQUE(tenant_id, syrve_guid)
);

-- 5. OCR MAPPINGS dictionary
CREATE TABLE public.ocr_mappings (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    supplier_pib VARCHAR(20) NOT NULL,
    ocr_text_raw TEXT NOT NULL,
    syrve_product_id INTEGER REFERENCES public.syrve_products(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    CONSTRAINT unique_mapping_idx UNIQUE(tenant_id, supplier_pib, ocr_text_raw)
);

-- 6. INVOICE HISTORY (documents)
CREATE TABLE public.invoice_history (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    syrve_id UUID,
    supplier_pib VARCHAR(20),
    supplier_name VARCHAR(255),
    doc_number VARCHAR(100),
    doc_date DATE,
    total_amount_ocr DECIMAL(12, 2),
    status VARCHAR(30) DEFAULT 'draft' NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL,
    CONSTRAINT invoice_status_check CHECK (status IN ('draft', 'submitted', 'error'))
);

-- 7. INVOICE ITEMS (line items)
CREATE TABLE public.invoice_items_history (
    id SERIAL PRIMARY KEY,
    invoice_id INTEGER REFERENCES public.invoice_history(id) ON DELETE CASCADE NOT NULL,
    ocr_text_raw TEXT NOT NULL,
    syrve_product_id INTEGER REFERENCES public.syrve_products(id) ON DELETE SET NULL,
    quantity DECIMAL(10, 3) NOT NULL,
    price_per_unit_no_vat DECIMAL(12, 2) NOT NULL,
    vat_percent DECIMAL(5, 2) NOT NULL,
    total_amount DECIMAL(12, 2) NOT NULL
);

-- 8. AI TOKEN USAGE LOGS
CREATE TABLE public.ai_token_logs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
    user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    prompt_tokens INTEGER NOT NULL,
    completion_tokens INTEGER NOT NULL,
    estimated_cost_usd DECIMAL(10, 5) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- INDEXES
CREATE INDEX idx_invoice_items_product ON public.invoice_items_history(syrve_product_id);
CREATE INDEX idx_invoice_date_filter ON public.invoice_history(doc_date, tenant_id, status);
CREATE INDEX idx_users_tg_id ON public.users(tg_id);
CREATE INDEX idx_ocr_mappings_lookup ON public.ocr_mappings(tenant_id, supplier_pib, ocr_text_raw);

-- RLS: invoice_history
ALTER TABLE public.invoice_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant Data Isolation Policy"
ON public.invoice_history
FOR ALL
USING (
    tenant_id = (
        SELECT tenant_id FROM public.users
        WHERE tg_id = (auth.uid()::text)::bigint
    )
);

-- RLS: invoice_items_history (accessible via invoice ownership)
ALTER TABLE public.invoice_items_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Items visible to invoice tenant"
ON public.invoice_items_history
FOR ALL
USING (
    invoice_id IN (
        SELECT id FROM public.invoice_history
        WHERE tenant_id = (
            SELECT tenant_id FROM public.users
            WHERE tg_id = (auth.uid()::text)::bigint
        )
    )
);

-- RLS: syrve_products (read-only for authenticated users of same tenant)
ALTER TABLE public.syrve_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Products visible to tenant"
ON public.syrve_products FOR SELECT
USING (
    tenant_id = (
        SELECT tenant_id FROM public.users
        WHERE tg_id = (auth.uid()::text)::bigint
    )
);

-- RLS: syrve_suppliers
ALTER TABLE public.syrve_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suppliers visible to tenant"
ON public.syrve_suppliers FOR SELECT
USING (
    tenant_id = (
        SELECT tenant_id FROM public.users
        WHERE tg_id = (auth.uid()::text)::bigint
    )
);
```

- [ ] **Step 2: Apply migration locally (requires Supabase CLI)**

```bash
supabase start
supabase db push
```

Expected: `Applying migration 20260602000000_init_schema.sql... done`

- [ ] **Step 3: Verify tables exist**

```bash
supabase db dump --schema public | grep "CREATE TABLE"
```

Expected output includes: `tenants`, `users`, `syrve_products`, `syrve_suppliers`, `ocr_mappings`, `invoice_history`, `invoice_items_history`, `ai_token_logs`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: database schema — all tables, indexes, RLS policies"
```

---

## Task 3: Shared Types

**Files:**
- Create: `supabase/functions/_shared/types.ts`

- [ ] **Step 1: Write shared types**

```typescript
// supabase/functions/_shared/types.ts

export interface OcrInvoiceItem {
  ocr_text_raw: string;
  quantity: number;
  price_per_unit_no_vat: number;
  vat_percent: number;
  total_amount: number;
}

export interface OcrInvoice {
  supplier_pib: string;
  supplier_name: string;
  doc_number: string;
  doc_date: string; // YYYY-MM-DD
  total_amount_ocr: number;
  items: OcrInvoiceItem[];
}

export interface EnrichedInvoiceItem extends OcrInvoiceItem {
  id: number;
  syrve_product_id: number | null;
  delta_percent: number;
  is_alert: boolean;
  history_found: boolean;
  old_price?: number;
}

export interface SyrveSubmitItem {
  syrve_guid: string;
  quantity: number;
  price: number;
  vat: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/types.ts
git commit -m "feat: shared TypeScript types for edge functions"
```

---

## Task 4: AES-GCM Crypto Helper (TDD)

**Files:**
- Create: `supabase/functions/syrve-api/crypto-helper.ts`
- Create: `tests/crypto-helper.test.ts`
- Create: `supabase/functions/syrve-api/deno.json`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/crypto-helper.test.ts
import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { encryptPassword, decryptPassword } from "../supabase/functions/syrve-api/crypto-helper.ts";

const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 32 bytes
const PLAINTEXT = "MyS3cretP@ssword!";

Deno.test("encrypt then decrypt returns original plaintext", async () => {
  const encrypted = await encryptPassword(PLAINTEXT, TEST_KEY_HEX);
  const decrypted = await decryptPassword(encrypted, TEST_KEY_HEX);
  assertEquals(decrypted, PLAINTEXT);
});

Deno.test("two encryptions of same string produce different ciphertext (random IV)", async () => {
  const enc1 = await encryptPassword(PLAINTEXT, TEST_KEY_HEX);
  const enc2 = await encryptPassword(PLAINTEXT, TEST_KEY_HEX);
  // Different IVs mean different ciphertext
  assertEquals(enc1 === enc2, false);
});

Deno.test("decryptPassword rejects wrong key", async () => {
  const encrypted = await encryptPassword(PLAINTEXT, TEST_KEY_HEX);
  const wrongKey = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  let threw = false;
  try {
    await decryptPassword(encrypted, wrongKey);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
```

- [ ] **Step 2: Run test — expect failure (module not found)**

```bash
deno test tests/crypto-helper.test.ts
```

Expected: `error: Module not found`

- [ ] **Step 3: Implement crypto-helper.ts**

```typescript
// supabase/functions/syrve-api/crypto-helper.ts

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function importKey(secretKeyHex: string): Promise<CryptoKey> {
  const keyBuffer = hexToBytes(secretKeyHex);
  return crypto.subtle.importKey("raw", keyBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptPassword(plaintext: string, secretKeyHex: string): Promise<string> {
  const key = await importKey(secretKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptPassword(encryptedBase64: string, secretKeyHex: string): Promise<string> {
  const binaryData = atob(encryptedBase64);
  const bytes = new Uint8Array(binaryData.length);
  for (let i = 0; i < binaryData.length; i++) bytes[i] = binaryData.charCodeAt(i);
  const iv = bytes.slice(0, 12);
  const encryptedData = bytes.slice(12);
  const key = await importKey(secretKeyHex);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedData);
  return new TextDecoder().decode(decrypted);
}
```

- [ ] **Step 4: Create deno.json for syrve-api**

```json
{
  "imports": {
    "std/": "https://deno.land/std@0.220.0/"
  }
}
```
Save to: `supabase/functions/syrve-api/deno.json`

- [ ] **Step 5: Run tests — expect all pass**

```bash
deno test tests/crypto-helper.test.ts
```

Expected:
```
running 3 tests from tests/crypto-helper.test.ts
encrypt then decrypt returns original plaintext ... ok (Xms)
two encryptions of same string produce different ciphertext (random IV) ... ok (Xms)
decryptPassword rejects wrong key ... ok (Xms)
ok | 3 passed | 0 failed
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/syrve-api/crypto-helper.ts supabase/functions/syrve-api/deno.json tests/crypto-helper.test.ts
git commit -m "feat: AES-GCM crypto helper with tests"
```

---

## Task 5: Syrve XML Builder (TDD)

**Files:**
- Create: `supabase/functions/syrve-api/syrve-xml-builder.ts`
- Create: `tests/syrve-xml-builder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/syrve-xml-builder.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { buildSyrveInvoiceXml } from "../supabase/functions/syrve-api/syrve-xml-builder.ts";

const BASE_DATA = {
  doc_number: "RN-2024-001",
  doc_date: "2024-03-15",
  supplier_guid: "550e8400-e29b-41d4-a716-446655440000",
  store_guid: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  items: [
    { syrve_guid: "aaaa0000-0000-0000-0000-000000000001", quantity: 10, price: 150.50, vat: 10 },
    { syrve_guid: "bbbb0000-0000-0000-0000-000000000002", quantity: 2.5, price: 800, vat: 20 },
  ],
};

Deno.test("XML contains correct doc number", () => {
  const xml = buildSyrveInvoiceXml(BASE_DATA);
  assertStringIncludes(xml, "<number>RN-2024-001</number>");
});

Deno.test("date is reformatted from YYYY-MM-DD to DD.MM.YYYY", () => {
  const xml = buildSyrveInvoiceXml(BASE_DATA);
  assertStringIncludes(xml, "<dateIncoming>15.03.2024</dateIncoming>");
});

Deno.test("supplier and store GUIDs are present", () => {
  const xml = buildSyrveInvoiceXml(BASE_DATA);
  assertStringIncludes(xml, "<supplier>550e8400-e29b-41d4-a716-446655440000</supplier>");
  assertStringIncludes(xml, "<defaultStore>6ba7b810-9dad-11d1-80b4-00c04fd430c8</defaultStore>");
});

Deno.test("items are numbered starting at 1", () => {
  const xml = buildSyrveInvoiceXml(BASE_DATA);
  assertStringIncludes(xml, "<num>1</num>");
  assertStringIncludes(xml, "<num>2</num>");
});

Deno.test("item prices and quantities are present", () => {
  const xml = buildSyrveInvoiceXml(BASE_DATA);
  assertStringIncludes(xml, "<price>150.5</price>");
  assertStringIncludes(xml, "<amount>2.5</amount>");
  assertStringIncludes(xml, "<vatPercent>20</vatPercent>");
});

Deno.test("empty items list produces valid XML without item nodes", () => {
  const xml = buildSyrveInvoiceXml({ ...BASE_DATA, items: [] });
  assertStringIncludes(xml, "<items></items>");
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
deno test tests/syrve-xml-builder.test.ts
```

Expected: `error: Module not found`

- [ ] **Step 3: Implement syrve-xml-builder.ts**

```typescript
// supabase/functions/syrve-api/syrve-xml-builder.ts

export interface SyrveInvoiceData {
  doc_number: string;
  doc_date: string; // YYYY-MM-DD
  supplier_guid: string;
  store_guid: string;
  items: Array<{
    syrve_guid: string;
    quantity: number;
    price: number;
    vat: number;
  }>;
}

export function buildSyrveInvoiceXml(data: SyrveInvoiceData): string {
  const [year, month, day] = data.doc_date.split("-");
  const formattedDate = `${day}.${month}.${year}`;

  const itemsXml = data.items
    .map(
      (item, index) =>
        `<incomingInvoiceItemDto>` +
        `<num>${index + 1}</num>` +
        `<productId>${item.syrve_guid}</productId>` +
        `<amount>${item.quantity}</amount>` +
        `<price>${item.price}</price>` +
        `<vatPercent>${item.vat}</vatPercent>` +
        `</incomingInvoiceItemDto>`
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<incomingInvoiceDto>` +
    `<id></id>` +
    `<number>${data.doc_number}</number>` +
    `<dateIncoming>${formattedDate}</dateIncoming>` +
    `<supplier>${data.supplier_guid}</supplier>` +
    `<defaultStore>${data.store_guid}</defaultStore>` +
    `<items>${itemsXml}</items>` +
    `</incomingInvoiceDto>`
  );
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
deno test tests/syrve-xml-builder.test.ts
```

Expected: `ok | 6 passed | 0 failed`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/syrve-api/syrve-xml-builder.ts tests/syrve-xml-builder.test.ts
git commit -m "feat: Syrve XML builder with tests"
```

---

## Task 6: Price Analyzer Logic (TDD)

**Files:**
- Create: `supabase/functions/price-analyzer/analyzer.ts`
- Create: `tests/analyzer.test.ts`
- Create: `supabase/functions/price-analyzer/deno.json`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/analyzer.test.ts
import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { computeDelta } from "../supabase/functions/price-analyzer/analyzer.ts";

Deno.test("price increase above threshold triggers alert", () => {
  const result = computeDelta({ currentPrice: 120, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, 20);
  assertEquals(result.is_alert, true);
});

Deno.test("price increase below threshold does not trigger alert", () => {
  const result = computeDelta({ currentPrice: 108, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, 8);
  assertEquals(result.is_alert, false);
});

Deno.test("price decrease above threshold triggers alert", () => {
  const result = computeDelta({ currentPrice: 80, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, -20);
  assertEquals(result.is_alert, true);
});

Deno.test("exact threshold boundary does trigger alert", () => {
  const result = computeDelta({ currentPrice: 110, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, 10);
  assertEquals(result.is_alert, true);
});

Deno.test("delta is rounded to 2 decimal places", () => {
  const result = computeDelta({ currentPrice: 103.3333, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, 3.33);
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
deno test tests/analyzer.test.ts
```

Expected: `error: Module not found`

- [ ] **Step 3: Implement analyzer.ts**

```typescript
// supabase/functions/price-analyzer/analyzer.ts

export interface DeltaResult {
  delta_percent: number;
  is_alert: boolean;
}

export function computeDelta(opts: {
  currentPrice: number;
  oldPrice: number;
  threshold: number;
}): DeltaResult {
  const { currentPrice, oldPrice, threshold } = opts;
  const raw = ((currentPrice - oldPrice) / oldPrice) * 100;
  const delta_percent = Math.round(raw * 100) / 100;
  return {
    delta_percent,
    is_alert: Math.abs(delta_percent) >= threshold,
  };
}
```

- [ ] **Step 4: Create deno.json for price-analyzer**

```json
{
  "imports": {
    "std/": "https://deno.land/std@0.220.0/"
  }
}
```
Save to: `supabase/functions/price-analyzer/deno.json`

- [ ] **Step 5: Run tests — expect all pass**

```bash
deno test tests/analyzer.test.ts
```

Expected: `ok | 5 passed | 0 failed`

- [ ] **Step 6: Run all tests together**

```bash
deno test tests/
```

Expected: `ok | 14 passed | 0 failed`

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/price-analyzer/analyzer.ts supabase/functions/price-analyzer/deno.json tests/analyzer.test.ts
git commit -m "feat: price delta computation logic with tests"
```

---

## Task 7: price-analyzer Edge Function

**Files:**
- Create: `supabase/functions/price-analyzer/index.ts`

- [ ] **Step 1: Implement index.ts**

```typescript
// supabase/functions/price-analyzer/index.ts
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { computeDelta } from "./analyzer.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { invoice_id } = await req.json();
  if (!invoice_id) {
    return new Response(JSON.stringify({ error: "invoice_id required" }), { status: 400 });
  }

  const { data: invoice, error: invErr } = await supabase
    .from("invoice_history")
    .select("tenant_id, supplier_pib")
    .eq("id", invoice_id)
    .single();

  if (invErr || !invoice) {
    return new Response(JSON.stringify({ error: "Invoice not found" }), { status: 404 });
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("price_alert_threshold_percent")
    .eq("id", invoice.tenant_id)
    .single();

  if (tenantErr || !tenant) {
    return new Response(JSON.stringify({ error: "Tenant not found" }), { status: 404 });
  }

  const threshold = Number(tenant.price_alert_threshold_percent);

  const { data: currentItems, error: itemsErr } = await supabase
    .from("invoice_items_history")
    .select("id, ocr_text_raw, price_per_unit_no_vat, syrve_product_id")
    .eq("invoice_id", invoice_id);

  if (itemsErr || !currentItems) {
    return new Response(JSON.stringify({ error: "Items not found" }), { status: 404 });
  }

  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const cutoffDate = twoMonthsAgo.toISOString().split("T")[0];

  const enrichedItems = await Promise.all(
    currentItems.map(async (item) => {
      if (!item.syrve_product_id) {
        return { ...item, delta_percent: 0, is_alert: false, history_found: false };
      }

      // Find most recent submitted invoice item for this product from same supplier
      const { data: history } = await supabase
        .from("invoice_items_history")
        .select(`
          price_per_unit_no_vat,
          invoice:invoice_history!inner(id, doc_date, status, tenant_id, supplier_pib)
        `)
        .eq("syrve_product_id", item.syrve_product_id)
        .eq("invoice_history.tenant_id", invoice.tenant_id)
        .eq("invoice_history.supplier_pib", invoice.supplier_pib)
        .eq("invoice_history.status", "submitted")
        .gte("invoice_history.doc_date", cutoffDate)
        .order("invoice_history.doc_date", { ascending: false })
        .limit(1);

      if (!history || history.length === 0) {
        return { ...item, delta_percent: 0, is_alert: false, history_found: false };
      }

      const oldPrice = Number(history[0].price_per_unit_no_vat);
      const currentPrice = Number(item.price_per_unit_no_vat);
      const { delta_percent, is_alert } = computeDelta({ currentPrice, oldPrice, threshold });

      return {
        ...item,
        delta_percent,
        is_alert,
        history_found: true,
        old_price: oldPrice,
      };
    })
  );

  return new Response(JSON.stringify(enrichedItems), {
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Test locally with Supabase CLI**

```bash
supabase functions serve price-analyzer --env-file .env.local
# In another terminal:
curl -X POST http://localhost:54321/functions/v1/price-analyzer \
  -H "Content-Type: application/json" \
  -d '{"invoice_id": 1}'
```

Expected: JSON array (empty or with items, depending on test data)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/price-analyzer/index.ts
git commit -m "feat: price-analyzer edge function"
```

---

## Task 8: bot-webhook Edge Function

**Files:**
- Create: `supabase/functions/bot-webhook/index.ts`
- Create: `supabase/functions/bot-webhook/deno.json`

- [ ] **Step 1: Create deno.json**

```json
{
  "imports": {
    "std/": "https://deno.land/std@0.220.0/",
    "openai": "https://esm.sh/openai@4.52.0"
  }
}
```
Save to: `supabase/functions/bot-webhook/deno.json`

- [ ] **Step 2: Implement index.ts**

```typescript
// supabase/functions/bot-webhook/index.ts
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import OpenAI from "https://esm.sh/openai@4.52.0";
import type { OcrInvoice, OcrInvoiceItem } from "../_shared/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MINI_APP_BASE_URL = Deno.env.get("MINI_APP_BASE_URL")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const INVOICE_SCHEMA = {
  type: "object" as const,
  properties: {
    supplier_pib: { type: "string", description: "9-digit Serbian Tax ID (PIB)" },
    supplier_name: { type: "string" },
    doc_number: { type: "string" },
    doc_date: { type: "string", description: "Format: YYYY-MM-DD" },
    total_amount_ocr: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ocr_text_raw: { type: "string", description: "Raw item name text from the paper invoice" },
          quantity: { type: "number" },
          price_per_unit_no_vat: { type: "number" },
          vat_percent: { type: "number" },
          total_amount: { type: "number" },
        },
        required: ["ocr_text_raw", "quantity", "price_per_unit_no_vat", "vat_percent", "total_amount"],
        additionalProperties: false,
      },
    },
  },
  required: ["supplier_pib", "supplier_name", "doc_number", "doc_date", "total_amount_ocr", "items"],
  additionalProperties: false,
};

serve(async (req: Request) => {
  try {
    const update = await req.json();

    // Only process photo messages
    if (!update.message?.photo) {
      return new Response(JSON.stringify({ status: "skipped" }), { status: 200 });
    }

    const tgUserId: number = update.message.from.id;
    const photoArray = update.message.photo;
    const largestPhoto = photoArray[photoArray.length - 1];

    // Verify user is registered
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, tenant_id")
      .eq("tg_id", tgUserId)
      .single();

    if (userErr || !user) {
      await sendTgMessage(tgUserId, "❌ Вы не зарегистрированы в системе. Обратитесь к администратору заведения.");
      return new Response(JSON.stringify({ status: "unauthorized" }), { status: 200 });
    }

    await sendTgMessage(tgUserId, "⏳ Документ получен. ИИ анализирует накладную... Подождите.");

    // Download photo from Telegram
    const fileRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${largestPhoto.file_id}`
    );
    const fileData = await fileRes.json();
    const filePath: string = fileData.result.file_path;

    const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Image = btoa(
      String.fromCharCode(...new Uint8Array(arrayBuffer))
    );

    // Call GPT-4o with Structured Outputs
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Parse this Serbian invoice (Račun-Otpremnica). Return strict JSON matching the schema. All prices must be without VAT. doc_date must be YYYY-MM-DD format. supplier_pib is the 9-digit Serbian tax ID.",
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: "high" },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "invoice",
          schema: INVOICE_SCHEMA,
          strict: true,
        },
      },
    });

    const parsedInvoice: OcrInvoice = JSON.parse(
      completion.choices[0].message.content ?? "{}"
    );

    // Log token usage
    const usage = completion.usage;
    if (usage) {
      const cost = usage.prompt_tokens * 0.000005 + usage.completion_tokens * 0.000015;
      await supabase.from("ai_token_logs").insert({
        tenant_id: user.tenant_id,
        user_id: user.id,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        estimated_cost_usd: cost,
      });
    }

    // Lookup OCR mappings for auto-linking known products
    const mappedItems = await enrichWithMappings(
      parsedInvoice.items,
      user.tenant_id,
      parsedInvoice.supplier_pib
    );

    // Save invoice draft
    const { data: invoice, error: invErr } = await supabase
      .from("invoice_history")
      .insert({
        tenant_id: user.tenant_id,
        user_id: user.id,
        supplier_pib: parsedInvoice.supplier_pib,
        supplier_name: parsedInvoice.supplier_name,
        doc_number: parsedInvoice.doc_number,
        doc_date: parsedInvoice.doc_date,
        total_amount_ocr: parsedInvoice.total_amount_ocr,
        status: "draft",
      })
      .select()
      .single();

    if (invErr || !invoice) throw invErr ?? new Error("Failed to save invoice");

    // Save line items
    const rows = mappedItems.map((item) => ({
      invoice_id: invoice.id,
      ocr_text_raw: item.ocr_text_raw,
      syrve_product_id: item.syrve_product_id ?? null,
      quantity: item.quantity,
      price_per_unit_no_vat: item.price_per_unit_no_vat,
      vat_percent: item.vat_percent,
      total_amount: item.total_amount,
    }));

    await supabase.from("invoice_items_history").insert(rows);

    // Send Mini App link
    const miniAppUrl = `${MINI_APP_BASE_URL}/invoice/${invoice.id}`;
    await sendTgMessage(
      tgUserId,
      `✅ Накладная №${parsedInvoice.doc_number} распознана!\n` +
        `Поставщик: ${parsedInvoice.supplier_name}\n` +
        `Сумма: ${parsedInvoice.total_amount_ocr} RSD\n\n` +
        `Проверьте позиции перед отправкой в Syrve:`,
      {
        inline_keyboard: [
          [{ text: "📋 Открыть накладную", web_app: { url: miniAppUrl } }],
        ],
      }
    );

    return new Response(JSON.stringify({ success: true, invoice_id: invoice.id }), { status: 200 });
  } catch (err) {
    console.error("bot-webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

async function enrichWithMappings(
  items: OcrInvoiceItem[],
  tenantId: number,
  supplierPib: string
): Promise<Array<OcrInvoiceItem & { syrve_product_id?: number }>> {
  if (items.length === 0) return [];

  const rawTexts = items.map((i) => i.ocr_text_raw);

  const { data: mappings } = await supabase
    .from("ocr_mappings")
    .select("ocr_text_raw, syrve_product_id")
    .eq("tenant_id", tenantId)
    .eq("supplier_pib", supplierPib)
    .in("ocr_text_raw", rawTexts);

  const mappingMap = new Map<string, number>(
    (mappings ?? []).map((m) => [m.ocr_text_raw, m.syrve_product_id])
  );

  return items.map((item) => ({
    ...item,
    syrve_product_id: mappingMap.get(item.ocr_text_raw),
  }));
}

async function sendTgMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}
```

- [ ] **Step 3: Serve function locally to verify no TypeScript errors**

```bash
supabase functions serve bot-webhook --env-file .env.local
```

Expected: `Serving functions on http://localhost:54321/functions/v1/...` with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/bot-webhook/
git commit -m "feat: bot-webhook edge function — Telegram + GPT-4o + draft persistence"
```

---

## Task 9: syrve-api Edge Function

**Files:**
- Create: `supabase/functions/syrve-api/index.ts`

- [ ] **Step 1: Implement index.ts**

```typescript
// supabase/functions/syrve-api/index.ts
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { decryptPassword } from "./crypto-helper.ts";
import { buildSyrveInvoiceXml } from "./syrve-xml-builder.ts";
import type { SyrveSubmitItem } from "../_shared/types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const ENCRYPTION_SECRET_HEX = Deno.env.get("ENCRYPTION_SECRET_HEX")!;

interface SubmitRequest {
  invoice_id: number;
  store_guid: string;
  supplier_guid: string;
  validated_items: SyrveSubmitItem[];
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body: SubmitRequest = await req.json();
  const { invoice_id, store_guid, supplier_guid, validated_items } = body;

  if (!invoice_id || !store_guid || !supplier_guid || !validated_items?.length) {
    return new Response(
      JSON.stringify({ error: "invoice_id, store_guid, supplier_guid, validated_items are required" }),
      { status: 400 }
    );
  }

  // Load invoice + tenant config in one query
  const { data: invoice, error: invErr } = await supabase
    .from("invoice_history")
    .select("id, doc_number, doc_date, tenant_id, tenants(syrve_api_url, syrve_login, syrve_password_encrypted)")
    .eq("id", invoice_id)
    .single();

  if (invErr || !invoice) {
    return new Response(JSON.stringify({ error: "Invoice not found" }), { status: 404 });
  }

  const tenant = (invoice as any).tenants;

  try {
    // Decrypt Syrve password
    const plainPassword = await decryptPassword(tenant.syrve_password_encrypted, ENCRYPTION_SECRET_HEX);

    // Authenticate with Syrve
    const baseUrl = tenant.syrve_api_url.replace(/\/$/, "");
    const authUrl = `${baseUrl}/resto/api/auth/login?login=${encodeURIComponent(tenant.syrve_login)}&pass=${encodeURIComponent(plainPassword)}`;
    const authRes = await fetch(authUrl, { method: "GET" });

    if (!authRes.ok) {
      throw new Error(`Syrve auth failed: HTTP ${authRes.status}`);
    }

    // Syrve returns auth token as plain text in body
    const authToken = (await authRes.text()).trim();
    if (!authToken || authToken.includes("<")) {
      throw new Error("Syrve auth returned invalid token");
    }

    // Build XML payload
    const xmlPayload = buildSyrveInvoiceXml({
      doc_number: invoice.doc_number,
      doc_date: invoice.doc_date,
      supplier_guid,
      store_guid,
      items: validated_items,
    });

    // Submit invoice to Syrve
    const uploadUrl = `${baseUrl}/resto/api/documents/import/incomingInvoice?key=${encodeURIComponent(authToken)}`;
    const syrveRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: xmlPayload,
    });

    const resText = await syrveRes.text();
    if (!syrveRes.ok) {
      throw new Error(`Syrve import error: ${resText}`);
    }

    // resText is the created document GUID
    const createdSyrveGuid = resText.trim();

    await supabase
      .from("invoice_history")
      .update({ status: "submitted", syrve_id: createdSyrveGuid, error_message: null })
      .eq("id", invoice_id);

    return new Response(
      JSON.stringify({ success: true, syrve_id: createdSyrveGuid }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await supabase
      .from("invoice_history")
      .update({ status: "error", error_message: errorMessage })
      .eq("id", invoice_id);

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
supabase functions serve syrve-api --env-file .env.local
```

Expected: Starts with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/syrve-api/index.ts
git commit -m "feat: syrve-api edge function — decrypt, auth, XML submit"
```

---

## Task 10: Web Mini App — Foundation

**Files:**
- Create: `web-mini-app/package.json`
- Create: `web-mini-app/vite.config.ts`
- Create: `web-mini-app/tailwind.config.ts`
- Create: `web-mini-app/index.html`
- Create: `web-mini-app/src/main.tsx`
- Create: `web-mini-app/src/lib/supabase.ts`
- Create: `web-mini-app/src/types/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "syrve-invoice-mini-app",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.7",
    "@twa-dev/sdk": "^7.10.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5",
    "vite": "^5.3.1"
  }
}
```

- [ ] **Step 2: Create vite.config.ts**

```typescript
// web-mini-app/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
});
```

- [ ] **Step 3: Create tailwind.config.ts**

```typescript
// web-mini-app/tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Syrve Invoice</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create src/lib/supabase.ts**

```typescript
// web-mini-app/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

- [ ] **Step 6: Create src/types/index.ts**

```typescript
// web-mini-app/src/types/index.ts

export interface SyrveProduct {
  id: number;
  syrve_guid: string;
  name: string;
  base_unit: string | null;
}

export interface SyrveSupplier {
  id: number;
  syrve_guid: string;
  name: string;
  pib: string | null;
}

export interface InvoiceItem {
  id: number;
  ocr_text_raw: string;
  syrve_product_id: number | null;
  quantity: number;
  price_per_unit_no_vat: number;
  vat_percent: number;
  total_amount: number;
  // enriched by price-analyzer
  delta_percent?: number;
  is_alert?: boolean;
  history_found?: boolean;
  old_price?: number;
}

export interface Invoice {
  id: number;
  supplier_pib: string | null;
  supplier_name: string | null;
  doc_number: string | null;
  doc_date: string | null;
  total_amount_ocr: number | null;
  status: "draft" | "submitted" | "error";
  error_message: string | null;
  items: InvoiceItem[];
}
```

- [ ] **Step 7: Create src/main.tsx**

```typescript
// web-mini-app/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import InvoicePage from "./pages/InvoicePage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/invoice/:id" element={<InvoicePage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 8: Create src/index.css**

```css
/* web-mini-app/src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --tg-bg: var(--tg-theme-bg-color, #ffffff);
  --tg-text: var(--tg-theme-text-color, #000000);
  --tg-hint: var(--tg-theme-hint-color, #999999);
  --tg-button: var(--tg-theme-button-color, #2481cc);
  --tg-button-text: var(--tg-theme-button-text-color, #ffffff);
}

body {
  background-color: var(--tg-bg);
  color: var(--tg-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  margin: 0;
  padding: 0;
}
```

- [ ] **Step 9: Install dependencies and verify dev server starts**

```bash
cd web-mini-app
npm install
npm run dev
```

Expected: Dev server starts at `http://localhost:3000`

- [ ] **Step 10: Commit**

```bash
cd ..
git add web-mini-app/
git commit -m "feat: web mini app foundation — Vite, React, Tailwind, Supabase client"
```

---

## Task 11: InvoiceItemRow Component

**Files:**
- Create: `web-mini-app/src/pages/components/InvoiceItemRow.tsx`

- [ ] **Step 1: Implement InvoiceItemRow.tsx**

```typescript
// web-mini-app/src/pages/components/InvoiceItemRow.tsx
import React from "react";
import type { InvoiceItem, SyrveProduct } from "../../types";

interface Props {
  item: InvoiceItem;
  products: SyrveProduct[];
  onMapProduct: (itemId: number) => void;
  onQuantityChange: (itemId: number, value: number) => void;
  onPriceChange: (itemId: number, value: number) => void;
}

export default function InvoiceItemRow({
  item,
  products,
  onMapProduct,
  onQuantityChange,
  onPriceChange,
}: Props) {
  const mappedProduct = products.find((p) => p.id === item.syrve_product_id);
  const isUnmapped = item.syrve_product_id === null;
  const rowBg = isUnmapped
    ? "bg-red-50 border-red-200"
    : item.is_alert
    ? "bg-yellow-50 border-yellow-300"
    : "bg-white border-gray-200";

  return (
    <div className={`border rounded-lg p-3 mb-2 ${rowBg}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{item.ocr_text_raw}</p>
          {isUnmapped ? (
            <button
              onClick={() => onMapProduct(item.id)}
              className="mt-1 text-xs font-semibold text-white bg-red-500 rounded px-2 py-0.5"
            >
              ⚠️ Не связан — выбрать товар
            </button>
          ) : (
            <p className="text-xs text-gray-500 mt-0.5">{mappedProduct?.name ?? "—"}</p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm text-gray-600">
            {item.quantity} × {item.price_per_unit_no_vat.toFixed(2)} RSD
          </p>
          <p className="text-sm font-semibold">{item.total_amount.toFixed(2)} RSD</p>
          {item.history_found && item.is_alert && (
            <span
              className={`text-xs font-bold ${
                item.delta_percent! > 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              {item.delta_percent! > 0 ? "▲" : "▼"} {Math.abs(item.delta_percent!)}%
              <span className="font-normal text-gray-400 ml-1">
                (было {item.old_price?.toFixed(2)})
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Editable quantity and price */}
      <div className="mt-2 flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-gray-400">Кол-во</label>
          <input
            type="number"
            step="0.001"
            value={item.quantity}
            onChange={(e) => onQuantityChange(item.id, parseFloat(e.target.value))}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-400">Цена без НДС</label>
          <input
            type="number"
            step="0.01"
            value={item.price_per_unit_no_vat}
            onChange={(e) => onPriceChange(item.id, parseFloat(e.target.value))}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web-mini-app/src/pages/components/InvoiceItemRow.tsx
git commit -m "feat: InvoiceItemRow component with price alert badge and edit fields"
```

---

## Task 12: MappingModal Component

**Files:**
- Create: `web-mini-app/src/pages/components/MappingModal.tsx`

- [ ] **Step 1: Implement MappingModal.tsx**

```typescript
// web-mini-app/src/pages/components/MappingModal.tsx
import React, { useState } from "react";
import type { SyrveProduct } from "../../types";

interface Props {
  itemId: number;
  rawText: string;
  products: SyrveProduct[];
  onConfirm: (itemId: number, productId: number) => void;
  onClose: () => void;
}

export default function MappingModal({ itemId, rawText, products, onConfirm, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl p-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold mb-1">Связать товар</h2>
        <p className="text-xs text-gray-500 mb-3 truncate">Накладная: «{rawText}»</p>

        <input
          type="text"
          placeholder="Поиск по номенклатуре Syrve..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 w-full"
          autoFocus
        />

        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Не найдено</p>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg mb-1 cursor-pointer ${
                  selected === p.id
                    ? "bg-blue-100 border border-blue-400"
                    : "bg-gray-50 border border-transparent"
                }`}
              >
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  {p.base_unit && (
                    <p className="text-xs text-gray-400">{p.base_unit}</p>
                  )}
                </div>
                {selected === p.id && (
                  <span className="text-blue-600 text-lg">✓</span>
                )}
              </div>
            ))
          )}
        </div>

        <button
          disabled={selected === null}
          onClick={() => selected !== null && onConfirm(itemId, selected)}
          className="mt-3 w-full py-3 rounded-xl font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: "var(--tg-button)" }}
        >
          Подтвердить связь
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web-mini-app/src/pages/components/MappingModal.tsx
git commit -m "feat: MappingModal component — searchable product picker"
```

---

## Task 13: InvoicePage — Main Review Screen

**Files:**
- Create: `web-mini-app/src/pages/InvoicePage.tsx`

- [ ] **Step 1: Implement InvoicePage.tsx**

```typescript
// web-mini-app/src/pages/InvoicePage.tsx
import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import WebApp from "@twa-dev/sdk";
import { supabase } from "../lib/supabase";
import type { Invoice, InvoiceItem, SyrveProduct, SyrveSupplier } from "../types";
import InvoiceItemRow from "./components/InvoiceItemRow";
import MappingModal from "./components/MappingModal";

const SYRVE_API_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1/syrve-api";
const PRICE_ANALYZER_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1/price-analyzer";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [products, setProducts] = useState<SyrveProduct[]>([]);
  const [suppliers, setSuppliers] = useState<SyrveSupplier[]>([]);
  const [mappingItemId, setMappingItemId] = useState<number | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
  const [storeGuid, setStoreGuid] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    WebApp.ready();
    WebApp.expand();
  }, []);

  // Load invoice, items, products, suppliers and run price analysis
  useEffect(() => {
    if (!id) return;

    const load = async () => {
      try {
        const [invRes, itemsRes, productsRes, suppliersRes] = await Promise.all([
          supabase.from("invoice_history").select("*").eq("id", id).single(),
          supabase.from("invoice_items_history").select("*").eq("invoice_id", id),
          supabase.from("syrve_products").select("id, syrve_guid, name, base_unit").eq("is_deleted", false),
          supabase.from("syrve_suppliers").select("id, syrve_guid, name, pib"),
        ]);

        if (invRes.error) throw invRes.error;
        setInvoice(invRes.data as Invoice);

        const rawItems: InvoiceItem[] = itemsRes.data ?? [];

        // Run price analysis
        const analysisRes = await fetch(PRICE_ANALYZER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ invoice_id: Number(id) }),
        });

        if (analysisRes.ok) {
          const enriched: InvoiceItem[] = await analysisRes.json();
          setItems(enriched);
        } else {
          setItems(rawItems);
        }

        setProducts(productsRes.data ?? []);
        setSuppliers(suppliersRes.data ?? []);

        // Pre-select supplier if PIB match found
        if (invRes.data?.supplier_pib) {
          const match = (suppliersRes.data ?? []).find(
            (s: SyrveSupplier) => s.pib === invRes.data.supplier_pib
          );
          if (match) setSelectedSupplierId(match.syrve_guid);
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const handleMapProduct = useCallback((itemId: number) => {
    setMappingItemId(itemId);
  }, []);

  const handleMappingConfirm = async (itemId: number, productId: number) => {
    // Update in DB
    await supabase
      .from("invoice_items_history")
      .update({ syrve_product_id: productId })
      .eq("id", itemId);

    // Save to ocr_mappings for future auto-mapping
    const item = items.find((i) => i.id === itemId);
    if (item && invoice) {
      await supabase.from("ocr_mappings").upsert(
        {
          tenant_id: (invoice as any).tenant_id,
          supplier_pib: invoice.supplier_pib,
          ocr_text_raw: item.ocr_text_raw,
          syrve_product_id: productId,
        },
        { onConflict: "tenant_id,supplier_pib,ocr_text_raw" }
      );
    }

    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, syrve_product_id: productId } : i))
    );
    setMappingItemId(null);
  };

  const handleQuantityChange = (itemId: number, value: number) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, quantity: value } : i))
    );
  };

  const handlePriceChange = (itemId: number, value: number) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, price_per_unit_no_vat: value } : i))
    );
  };

  const hasUnmapped = items.some((i) => i.syrve_product_id === null);
  const canSubmit = !hasUnmapped && !!selectedSupplierId && !!storeGuid && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !invoice) return;
    setSubmitting(true);
    setError(null);

    try {
      const validatedItems = items.map((i) => ({
        syrve_guid: products.find((p) => p.id === i.syrve_product_id)!.syrve_guid,
        quantity: i.quantity,
        price: i.price_per_unit_no_vat,
        vat: i.vat_percent,
      }));

      const res = await fetch(SYRVE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          invoice_id: invoice.id,
          store_guid: storeGuid,
          supplier_guid: selectedSupplierId,
          validated_items: validatedItems,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? "Unknown error");

      WebApp.showAlert(`✅ Накладная отправлена в Syrve!\nID: ${result.syrve_id}`, () => {
        WebApp.close();
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">Загрузка накладной...</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-4 text-red-600">Накладная не найдена</div>
    );
  }

  const unmappedCount = items.filter((i) => i.syrve_product_id === null).length;
  const alertCount = items.filter((i) => i.is_alert).length;
  const mappingItem = items.find((i) => i.id === mappingItemId);

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: "var(--tg-bg)" }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-gray-200">
        <h1 className="text-base font-bold truncate">Накладная №{invoice.doc_number}</h1>
        <p className="text-xs text-gray-500">
          {invoice.supplier_name} · {invoice.doc_date}
        </p>
        <p className="text-sm font-semibold mt-1">{invoice.total_amount_ocr?.toFixed(2)} RSD</p>
      </div>

      {/* Status banners */}
      {unmappedCount > 0 && (
        <div className="mx-4 mt-3 bg-red-100 border border-red-300 rounded-lg px-3 py-2 text-sm text-red-700">
          ⚠️ {unmappedCount} позиц{unmappedCount === 1 ? "ия" : "ии"} не привязан{unmappedCount === 1 ? "а" : "ы"} к номенклатуре. Привяжите перед отправкой.
        </div>
      )}
      {alertCount > 0 && (
        <div className="mx-4 mt-2 bg-yellow-100 border border-yellow-300 rounded-lg px-3 py-2 text-sm text-yellow-800">
          📊 {alertCount} позиц{alertCount === 1 ? "ия" : "ии"} с отклонением цены {">"}= порога.
        </div>
      )}
      {invoice.status === "error" && invoice.error_message && (
        <div className="mx-4 mt-2 bg-red-100 border border-red-300 rounded-lg px-3 py-2 text-sm text-red-700">
          Ошибка Syrve: {invoice.error_message}
        </div>
      )}
      {error && (
        <div className="mx-4 mt-2 bg-red-100 border border-red-300 rounded-lg px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Supplier selector (shown if PIB not matched) */}
      {!selectedSupplierId && (
        <div className="mx-4 mt-3">
          <label className="text-xs text-gray-500 block mb-1">Поставщик (PIB не распознан)</label>
          <select
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— выберите поставщика —</option>
            {suppliers.map((s) => (
              <option key={s.syrve_guid} value={s.syrve_guid}>
                {s.name} {s.pib ? `(${s.pib})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Store selector */}
      <div className="mx-4 mt-3">
        <label className="text-xs text-gray-500 block mb-1">Склад (GUID)</label>
        <input
          type="text"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          value={storeGuid}
          onChange={(e) => setStoreGuid(e.target.value.trim())}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
      </div>

      {/* Line items */}
      <div className="px-4 mt-4">
        <h2 className="text-sm font-semibold text-gray-600 mb-2">Позиции ({items.length})</h2>
        {items.map((item) => (
          <InvoiceItemRow
            key={item.id}
            item={item}
            products={products}
            onMapProduct={handleMapProduct}
            onQuantityChange={handleQuantityChange}
            onPriceChange={handlePriceChange}
          />
        ))}
      </div>

      {/* Submit button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-200">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-3 rounded-xl font-semibold text-white text-base disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: "var(--tg-button)" }}
        >
          {submitting ? "Отправка..." : "Отправить в Syrve"}
        </button>
        {hasUnmapped && (
          <p className="text-xs text-center text-red-500 mt-1">
            Привяжите все позиции для отправки
          </p>
        )}
      </div>

      {/* Mapping modal */}
      {mappingItemId !== null && mappingItem && (
        <MappingModal
          itemId={mappingItemId}
          rawText={mappingItem.ocr_text_raw}
          products={products}
          onConfirm={handleMappingConfirm}
          onClose={() => setMappingItemId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify TypeScript and no import errors**

```bash
cd web-mini-app
npm run build
```

Expected: Build completes with `dist/` output, 0 errors.

- [ ] **Step 3: Commit**

```bash
cd ..
git add web-mini-app/src/
git commit -m "feat: InvoicePage — full review, mapping, and Syrve submission UI"
```

---

## Task 14: App.tsx and Environment Configuration

**Files:**
- Create: `web-mini-app/src/App.tsx`
- Create: `web-mini-app/.env.example`

- [ ] **Step 1: Create App.tsx**

```typescript
// web-mini-app/src/App.tsx
import React from "react";
import { Routes, Route } from "react-router-dom";
import InvoicePage from "./pages/InvoicePage";

export default function App() {
  return (
    <Routes>
      <Route path="/invoice/:id" element={<InvoicePage />} />
      <Route path="*" element={<div className="p-4 text-gray-500">Страница не найдена</div>} />
    </Routes>
  );
}
```

- [ ] **Step 2: Update main.tsx to use App**

```typescript
// web-mini-app/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 3: Create web-mini-app/.env.example**

```bash
# web-mini-app/.env.example
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 4: Commit**

```bash
git add web-mini-app/src/App.tsx web-mini-app/.env.example
git commit -m "feat: App router and frontend env config"
```

---

## Task 15: Deployment — Supabase Secrets and Telegram Webhook

**Files:**
- No new files — deployment commands only

- [ ] **Step 1: Set all Edge Function secrets**

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=<your-token>
supabase secrets set OPENAI_API_KEY=<your-openai-key>
supabase secrets set ENCRYPTION_SECRET_HEX=<64-hex-chars>
supabase secrets set MINI_APP_BASE_URL=https://your-mini-app.vercel.app
```

- [ ] **Step 2: Deploy all Edge Functions**

```bash
supabase functions deploy bot-webhook --no-verify-jwt
supabase functions deploy price-analyzer --no-verify-jwt
supabase functions deploy syrve-api --no-verify-jwt
```

Expected: `Deployed Function bot-webhook ... price-analyzer ... syrve-api`

- [ ] **Step 3: Push database migration to remote**

```bash
supabase db push
```

Expected: `Applying migration 20260602000000_init_schema.sql... done`

- [ ] **Step 4: Register Telegram webhook**

```bash
export BOT_TOKEN=<your-token>
export WEBHOOK_URL="https://your-project.supabase.co/functions/v1/bot-webhook"

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${WEBHOOK_URL}\"}"
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`

- [ ] **Step 5: Seed first tenant and test user**

```sql
-- Run in Supabase SQL editor
INSERT INTO public.tenants (name, pib, syrve_api_url, syrve_login, syrve_password_encrypted, price_alert_threshold_percent)
VALUES (
  'Test Restaurant',
  '123456789',
  'https://your-syrve-server.com',
  'admin',
  '<encrypted-password-from-encryptPassword()>',
  10.00
);

INSERT INTO public.users (tg_id, tenant_id, username, role)
VALUES (
  <your-telegram-user-id>,
  1,
  'test_admin',
  'owner'
);
```

To generate the encrypted password, run this Deno snippet locally:
```typescript
import { encryptPassword } from "./supabase/functions/syrve-api/crypto-helper.ts";
const enc = await encryptPassword("your-syrve-password", "your-64-hex-key");
console.log(enc);
```

- [ ] **Step 6: Deploy Mini App to Vercel**

```bash
cd web-mini-app
# Set env vars in Vercel dashboard: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npx vercel --prod
```

Expected: Deployment URL matching `MINI_APP_BASE_URL`.

- [ ] **Step 7: End-to-end smoke test**
  1. Send a photo of any paper invoice to the Telegram bot
  2. Bot replies: "⏳ ИИ анализирует накладную..."
  3. Bot replies with Mini App link button within ~15 seconds
  4. Tap the link — Mini App opens, showing parsed line items
  5. Confirm any red (unmapped) rows are shown
  6. Map one item manually, confirm the mapping modal works
  7. Enter a store GUID and tap "Отправить в Syrve"
  8. Verify `invoice_history` row changes from `draft` → `submitted`

- [ ] **Step 8: Commit deployment notes**

```bash
git add .
git commit -m "docs: deployment commands and seed data instructions"
```

---

## Self-Review Checklist

### Spec coverage

| Spec requirement | Task |
|---|---|
| bot-webhook Telegram + OpenAI Vision | Task 8 |
| Structured JSON output schema | Task 8 (INVOICE_SCHEMA) |
| OCR token usage logging | Task 8 (ai_token_logs insert) |
| Auto-map known products from ocr_mappings | Task 8 (enrichWithMappings) |
| Draft invoice saved to DB | Task 8 |
| price-analyzer 2-month history lookback | Task 7 |
| Per-tenant alert threshold | Task 7 |
| syrve-api AES-GCM decrypt | Task 4 (crypto-helper) |
| Syrve XML builder with DD.MM.YYYY date | Task 5 |
| Syrve auth token via GET /login | Task 9 |
| Syrve POST XML submit | Task 9 |
| Invoice status update (submitted/error) | Task 9 |
| RLS tenant isolation | Task 2 |
| All 8 DB tables + indexes | Task 2 |
| Mini App supplier selector (unmatched PIB) | Task 13 |
| Mini App unmapped product alert + block submit | Task 13 |
| Mini App price anomaly badge | Task 11 |
| Mini App editable quantity/price cells | Task 11 |
| Manual mapping persists to ocr_mappings | Task 13 (handleMappingConfirm) |
| Telegram webhook registration | Task 15 |

### Potential gaps fixed inline
- The spec had a syntax error `new Response(status: 200)` — fixed in Task 8
- The spec used `response_format: { type: "json_object", schema: ... }` which is not a valid OpenAI API format — fixed to `json_schema` with `strict: true` in Task 8
- The spec's Syrve auth used `set-cookie` header; Syrve Server API actually returns the token as plain text body — fixed in Task 9
- The store GUID must be known by the user per-session (not in the invoice PDF) — added as a manual input field in Task 13
- `ocr_mappings` upsert on manual mapping was not in the spec's Mini App code — added in Task 13 to complete the learning loop

---

Plan complete and saved to `docs/superpowers/plans/2026-06-03-syrve-invoice-ai-assistant.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — dispatches a fresh subagent per task, with review between tasks for fast iteration

**2. Inline Execution** — executes tasks sequentially in this session using `superpowers:executing-plans`, with checkpoints for review

**Which approach?**
