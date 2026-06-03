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
