// web-mini-app/src/pages/components/InvoiceItemRow.tsx
import React from "react";
import type { InvoiceItem, SyrveProduct } from "../../types";

interface Props {
  item: InvoiceItem;
  products: SyrveProduct[];
  onMapProduct: (itemId: number) => void;
  onQuantityChange: (itemId: number, value: number) => void;
  onPriceChange: (itemId: number, value: number) => void;
}

export default function InvoiceItemRow({
  item,
  products,
  onMapProduct,
  onQuantityChange,
  onPriceChange,
}: Props) {
  const mappedProduct = products.find((p) => p.id === item.syrve_product_id);
  const isUnmapped = item.syrve_product_id === null;
  const rowBg = isUnmapped
    ? "bg-red-50 border-red-200"
    : item.is_alert
    ? "bg-yellow-50 border-yellow-300"
    : "bg-white border-gray-200";

  return (
    <div className={`border rounded-lg p-3 mb-2 ${rowBg}`}>
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{item.ocr_text_raw}</p>
          {isUnmapped ? (
            <button
              onClick={() => onMapProduct(item.id)}
              className="mt-1 text-xs font-semibold text-white bg-red-500 rounded px-2 py-0.5"
            >
              ⚠️ Не связан — выбрать товар
            </button>
          ) : (
            <p className="text-xs text-gray-500 mt-0.5">{mappedProduct?.name ?? "—"}</p>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm text-gray-600">
            {item.quantity} × {item.price_per_unit_no_vat.toFixed(2)} RSD
          </p>
          <p className="text-sm font-semibold">{item.total_amount.toFixed(2)} RSD</p>
          {item.history_found && item.is_alert && (
            <span
              className={`text-xs font-bold ${
                item.delta_percent! > 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              {item.delta_percent! > 0 ? "▲" : "▼"} {Math.abs(item.delta_percent!)}%
              <span className="font-normal text-gray-400 ml-1">
                (было {item.old_price?.toFixed(2)})
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Editable quantity and price */}
      <div className="mt-2 flex gap-2">
        <div className="flex-1">
          <label className="text-xs text-gray-400">Кол-во</label>
          <input
            type="number"
            step="0.001"
            value={item.quantity}
            onChange={(e) => onQuantityChange(item.id, parseFloat(e.target.value))}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs text-gray-400">Цена без НДС</label>
          <input
            type="number"
            step="0.01"
            value={item.price_per_unit_no_vat}
            onChange={(e) => onPriceChange(item.id, parseFloat(e.target.value))}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
      </div>
    </div>
  );
}
