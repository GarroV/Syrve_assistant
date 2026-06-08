-- Replace USING (true) policies with proper tenant isolation via Telegram JWT.
-- auth.jwt()->'app_metadata'->>'tg_id' is set by auth-telegram edge function.

-- invoice_history
DROP POLICY "Tenant Data Isolation Policy" ON public.invoice_history;
CREATE POLICY "Tenant isolation via tg_id"
ON public.invoice_history
FOR ALL
USING (
  tenant_id = (
    SELECT tenant_id FROM public.users
    WHERE tg_id = (auth.jwt()->'app_metadata'->>'tg_id')::bigint
  )
)
WITH CHECK (
  tenant_id = (
    SELECT tenant_id FROM public.users
    WHERE tg_id = (auth.jwt()->'app_metadata'->>'tg_id')::bigint
  )
);

-- invoice_items_history
DROP POLICY "Items visible to invoice tenant" ON public.invoice_items_history;
CREATE POLICY "Items isolation via tg_id"
ON public.invoice_items_history
FOR ALL
USING (
  invoice_id IN (
    SELECT id FROM public.invoice_history
    WHERE tenant_id = (
      SELECT tenant_id FROM public.users
      WHERE tg_id = (auth.jwt()->'app_metadata'->>'tg_id')::bigint
    )
  )
)
WITH CHECK (
  invoice_id IN (
    SELECT id FROM public.invoice_history
    WHERE tenant_id = (
      SELECT tenant_id FROM public.users
      WHERE tg_id = (auth.jwt()->'app_metadata'->>'tg_id')::bigint
    )
  )
);

-- syrve_products
DROP POLICY "Products visible to tenant" ON public.syrve_products;
CREATE POLICY "Products isolation via tg_id"
ON public.syrve_products FOR SELECT
USING (
  tenant_id = (
    SELECT tenant_id FROM public.users
    WHERE tg_id = (auth.jwt()->'app_metadata'->>'tg_id')::bigint
  )
);

-- syrve_suppliers
DROP POLICY "Suppliers visible to tenant" ON public.syrve_suppliers;
CREATE POLICY "Suppliers isolation via tg_id"
ON public.syrve_suppliers FOR SELECT
USING (
  tenant_id = (
    SELECT tenant_id FROM public.users
    WHERE tg_id = (auth.jwt()->'app_metadata'->>'tg_id')::bigint
  )
);

-- ocr_mappings (was missing RLS entirely)
ALTER TABLE public.ocr_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Mappings isolation via tg_id"
ON public.ocr_mappings
FOR ALL
USING (
  tenant_id = (
    SELECT tenant_id FROM public.users
    WHERE tg_id = (auth.jwt()->'app_metadata'->>'tg_id')::bigint
  )
)
WITH CHECK (
  tenant_id = (
    SELECT tenant_id FROM public.users
    WHERE tg_id = (auth.jwt()->'app_metadata'->>'tg_id')::bigint
  )
);
