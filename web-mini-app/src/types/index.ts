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
