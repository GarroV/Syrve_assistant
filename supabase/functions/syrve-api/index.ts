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
