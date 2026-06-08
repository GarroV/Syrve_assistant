import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import WebApp from "@twa-dev/sdk";
import { useAuth } from "../contexts/AuthContext";
import type { Invoice, InvoiceItem, SyrveProduct, SyrveSupplier } from "../types";
import InvoiceItemRow from "./components/InvoiceItemRow";
import MappingModal from "./components/MappingModal";

const SYRVE_API_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1/syrve-api";
const PRICE_ANALYZER_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1/price-analyzer";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { client, accessToken } = useAuth();
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

  useEffect(() => {
    if (!id || !client) return;

    const load = async () => {
      try {
        const [invRes, itemsRes, productsRes, suppliersRes] = await Promise.all([
          client.from("invoice_history").select("*").eq("id", id).single(),
          client.from("invoice_items_history").select("*").eq("invoice_id", id),
          client.from("syrve_products").select("id, syrve_guid, name, base_unit").eq("is_deleted", false),
          client.from("syrve_suppliers").select("id, syrve_guid, name, pib"),
        ]);

        if (invRes.error) throw invRes.error;
        setInvoice(invRes.data as Invoice);

        const rawItems: InvoiceItem[] = itemsRes.data ?? [];

        const analysisRes = await fetch(PRICE_ANALYZER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ invoice_id: Number(id) }),
        });

        setItems(analysisRes.ok ? await analysisRes.json() : rawItems);
        setProducts(productsRes.data ?? []);
        setSuppliers(suppliersRes.data ?? []);

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
  }, [id, client, accessToken]);

  const handleMapProduct = useCallback((itemId: number) => {
    setMappingItemId(itemId);
  }, []);

  const handleMappingConfirm = async (itemId: number, productId: number) => {
    if (!client) return;

    await client
      .from("invoice_items_history")
      .update({ syrve_product_id: productId })
      .eq("id", itemId);

    const item = items.find((i) => i.id === itemId);
    if (item && invoice) {
      await client.from("ocr_mappings").upsert(
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
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, quantity: value } : i)));
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
          Authorization: `Bearer ${accessToken}`,
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
    return <div className="p-4 text-red-600">Накладная не найдена</div>;
  }

  const unmappedCount = items.filter((i) => i.syrve_product_id === null).length;
  const alertCount = items.filter((i) => i.is_alert).length;
  const mappingItem = items.find((i) => i.id === mappingItemId);

  return (
    <div className="min-h-screen pb-28" style={{ backgroundColor: "var(--tg-bg)" }}>
      <div className="px-4 pt-4 pb-2 border-b border-gray-200">
        <h1 className="text-base font-bold truncate">Накладная №{invoice.doc_number}</h1>
        <p className="text-xs text-gray-500">
          {invoice.supplier_name} · {invoice.doc_date}
        </p>
        <p className="text-sm font-semibold mt-1">{invoice.total_amount_ocr?.toFixed(2)} RSD</p>
      </div>

      {unmappedCount > 0 && (
        <div className="mx-4 mt-3 bg-red-100 border border-red-300 rounded-lg px-3 py-2 text-sm text-red-700">
          ⚠️ {unmappedCount} позиц{unmappedCount === 1 ? "ия" : "ии"} не привязан{unmappedCount === 1 ? "а" : "ы"} к номенклатуре. Привяжите перед отправкой.
        </div>
      )}
      {alertCount > 0 && (
        <div className="mx-4 mt-2 bg-yellow-100 border border-yellow-300 rounded-lg px-3 py-2 text-sm text-yellow-800">
          📊 {alertCount} позиц{alertCount === 1 ? "ия" : "ии"} с отклонением цены &gt;= порога.
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
