import React, { createContext, useContext, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebApp from "@twa-dev/sdk";
import { createAuthenticatedClient } from "../lib/supabase";

const AUTH_URL = import.meta.env.VITE_SUPABASE_URL + "/functions/v1/auth-telegram";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface AuthState {
  client: SupabaseClient | null;
  accessToken: string | null;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthState>({ client: null, accessToken: null, loading: true, error: null });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ client: null, accessToken: null, loading: true, error: null });

  useEffect(() => {
    const authenticate = async () => {
      try {
        const initData = WebApp.initData;
        if (!initData) throw new Error("Откройте приложение через Telegram");

        const res = await fetch(AUTH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ init_data: initData }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error ?? "Ошибка авторизации");
        }

        const { access_token } = await res.json();
        setState({
          client: createAuthenticatedClient(access_token),
          accessToken: access_token,
          loading: false,
          error: null,
        });
      } catch (e) {
        setState({ client: null, accessToken: null, loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    };

    authenticate();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
