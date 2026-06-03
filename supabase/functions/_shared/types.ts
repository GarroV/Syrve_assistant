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
