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
