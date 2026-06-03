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
