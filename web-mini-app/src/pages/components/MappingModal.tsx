// web-mini-app/src/pages/components/MappingModal.tsx
import React, { useState } from "react";
import type { SyrveProduct } from "../../types";

interface Props {
  itemId: number;
  rawText: string;
  products: SyrveProduct[];
  onConfirm: (itemId: number, productId: number) => void;
  onClose: () => void;
}

export default function MappingModal({ itemId, rawText, products, onConfirm, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end z-50" onClick={onClose}>
      <div
        className="bg-white w-full rounded-t-2xl p-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold mb-1">Связать товар</h2>
        <p className="text-xs text-gray-500 mb-3 truncate">Накладная: «{rawText}»</p>

        <input
          type="text"
          placeholder="Поиск по номенклатуре Syrve..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 w-full"
          autoFocus
        />

        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">Не найдено</p>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg mb-1 cursor-pointer ${
                  selected === p.id
                    ? "bg-blue-100 border border-blue-400"
                    : "bg-gray-50 border border-transparent"
                }`}
              >
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  {p.base_unit && (
                    <p className="text-xs text-gray-400">{p.base_unit}</p>
                  )}
                </div>
                {selected === p.id && (
                  <span className="text-blue-600 text-lg">✓</span>
                )}
              </div>
            ))
          )}
        </div>

        <button
          disabled={selected === null}
          onClick={() => selected !== null && onConfirm(itemId, selected)}
          className="mt-3 w-full py-3 rounded-xl font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: "var(--tg-button)" }}
        >
          Подтвердить связь
        </button>
      </div>
    </div>
  );
}
