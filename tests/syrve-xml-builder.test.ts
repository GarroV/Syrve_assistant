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
