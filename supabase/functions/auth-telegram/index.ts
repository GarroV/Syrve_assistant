import { serve } from "https://deno.land/std@0.220.0/http/server.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET")!;

const encoder = new TextEncoder();

function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.byteLength; i++) binary += String.fromCharCode(data[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function createJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

async function verifyTelegramInitData(initData: string): Promise<number> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("No hash in initData");

  const authDate = parseInt(params.get("auth_date") ?? "0");
  if (Math.floor(Date.now() / 1000) - authDate > 3600) throw new Error("initData expired");

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const webAppDataKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secretKeyBytes = await crypto.subtle.sign("HMAC", webAppDataKey, encoder.encode(TELEGRAM_BOT_TOKEN));
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(dataCheckString));
  const expectedHash = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expectedHash !== hash) throw new Error("Invalid initData signature");

  const userJson = params.get("user");
  if (!userJson) throw new Error("No user in initData");
  const user = JSON.parse(userJson);
  return user.id as number;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { init_data } = await req.json();
    if (!init_data) {
      return new Response(JSON.stringify({ error: "init_data required" }), { status: 400 });
    }

    const tgId = await verifyTelegramInitData(init_data);

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: tgId.toString(),
      role: "authenticated",
      iat: now,
      exp: now + 3600,
      app_metadata: { tg_id: tgId },
    };

    const accessToken = await createJWT(payload, SUPABASE_JWT_SECRET);

    return new Response(
      JSON.stringify({ access_token: accessToken, tg_id: tgId }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("signature") || message.includes("expired") ? 401 : 400;
    return new Response(JSON.stringify({ error: message }), { status });
  }
});
