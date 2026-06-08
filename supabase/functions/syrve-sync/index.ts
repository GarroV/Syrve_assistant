import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { decryptPassword } from "../syrve-api/crypto-helper.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const ENCRYPTION_SECRET_HEX = Deno.env.get("ENCRYPTION_SECRET_HEX")!;

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { tenant_id } = await req.json();
  if (!tenant_id) {
    return new Response(JSON.stringify({ error: "tenant_id required" }), { status: 400 });
  }

  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("syrve_api_url, syrve_login, syrve_password_encrypted")
    .eq("id", tenant_id)
    .single();

  if (tenantErr || !tenant) {
    return new Response(JSON.stringify({ error: "Tenant not found" }), { status: 404 });
  }

  try {
    const plainPassword = await decryptPassword(tenant.syrve_password_encrypted, ENCRYPTION_SECRET_HEX);
    const baseUrl = tenant.syrve_api_url.replace(/\/$/, "");

    // Authenticate
    const authRes = await fetch(
      `${baseUrl}/resto/api/auth/login?login=${encodeURIComponent(tenant.syrve_login)}&pass=${encodeURIComponent(plainPassword)}`
    );
    if (!authRes.ok) throw new Error(`Syrve auth failed: HTTP ${authRes.status}`);
    const authToken = (await authRes.text()).trim();
    if (!authToken || authToken.includes("<")) throw new Error("Invalid auth token");

    // Fetch products (nomenclature)
    const [productsRes, suppliersRes] = await Promise.all([
      fetch(`${baseUrl}/resto/api/v2/entities/products/list?key=${encodeURIComponent(authToken)}&includeDeleted=true`),
      fetch(`${baseUrl}/resto/api/suppliers?key=${encodeURIComponent(authToken)}`),
    ]);

    await fetch(`${baseUrl}/resto/api/auth/logout?key=${encodeURIComponent(authToken)}`);

    const stats = { products: 0, suppliers: 0 };

    if (productsRes.ok) {
      const products: any[] = await productsRes.json();

      const rows = products
        .filter((p) => p.type === "GOODS" || p.type === "MODIFIER")
        .map((p) => ({
          tenant_id,
          syrve_guid: p.id,
          name: p.name,
          sku: p.num ?? null,
          base_unit: p.measureUnit ?? null,
          is_deleted: p.isDeleted ?? false,
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("syrve_products")
          .upsert(rows, { onConflict: "tenant_id,syrve_guid" });
        if (error) throw error;
        stats.products = rows.length;
      }
    }

    if (suppliersRes.ok) {
      const suppliers: any[] = await suppliersRes.json();

      const rows = suppliers.map((s) => ({
        tenant_id,
        syrve_guid: s.id,
        name: s.name,
        pib: s.taxpayerIdNumber ?? null,
      }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from("syrve_suppliers")
          .upsert(rows, { onConflict: "tenant_id,syrve_guid" });
        if (error) throw error;
        stats.suppliers = rows.length;
      }
    }

    return new Response(JSON.stringify({ success: true, ...stats }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
