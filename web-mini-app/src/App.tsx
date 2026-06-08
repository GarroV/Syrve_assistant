import React from "react";
import { Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import InvoicePage from "./pages/InvoicePage";

function AppRoutes() {
  const { loading, error } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        Авторизация...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen p-4 text-red-600 text-center">
        {error}
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/invoice/:id" element={<InvoicePage />} />
      <Route path="*" element={<div className="p-4 text-gray-500">Страница не найдена</div>} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
