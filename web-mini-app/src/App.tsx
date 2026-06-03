import React from "react";
import { Routes, Route } from "react-router-dom";
import InvoicePage from "./pages/InvoicePage";

export default function App() {
  return (
    <Routes>
      <Route path="/invoice/:id" element={<InvoicePage />} />
      <Route path="*" element={<div className="p-4 text-gray-500">Страница не найдена</div>} />
    </Routes>
  );
}
