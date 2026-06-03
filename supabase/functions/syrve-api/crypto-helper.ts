// supabase/functions/syrve-api/crypto-helper.ts

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function importKey(secretKeyHex: string): Promise<CryptoKey> {
  const keyBuffer = hexToBytes(secretKeyHex).buffer as ArrayBuffer;
  return crypto.subtle.importKey("raw", keyBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptPassword(plaintext: string, secretKeyHex: string): Promise<string> {
  const key = await importKey(secretKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptPassword(encryptedBase64: string, secretKeyHex: string): Promise<string> {
  const binaryData = atob(encryptedBase64);
  const bytes = new Uint8Array(binaryData.length);
  for (let i = 0; i < binaryData.length; i++) bytes[i] = binaryData.charCodeAt(i);
  const iv = bytes.slice(0, 12);
  const encryptedData = bytes.slice(12);
  const key = await importKey(secretKeyHex);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedData);
  return new TextDecoder().decode(decrypted);
}
