import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { encryptPassword, decryptPassword } from "../supabase/functions/syrve-api/crypto-helper.ts";

const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // 32 bytes
const PLAINTEXT = "MyS3cretP@ssword!";

Deno.test("encrypt then decrypt returns original plaintext", async () => {
  const encrypted = await encryptPassword(PLAINTEXT, TEST_KEY_HEX);
  const decrypted = await decryptPassword(encrypted, TEST_KEY_HEX);
  assertEquals(decrypted, PLAINTEXT);
});

Deno.test("two encryptions of same string produce different ciphertext (random IV)", async () => {
  const enc1 = await encryptPassword(PLAINTEXT, TEST_KEY_HEX);
  const enc2 = await encryptPassword(PLAINTEXT, TEST_KEY_HEX);
  assertEquals(enc1 === enc2, false);
});

Deno.test("decryptPassword rejects wrong key", async () => {
  const encrypted = await encryptPassword(PLAINTEXT, TEST_KEY_HEX);
  const wrongKey = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  let threw = false;
  try {
    await decryptPassword(encrypted, wrongKey);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
