import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { computeDelta } from "../supabase/functions/price-analyzer/analyzer.ts";

Deno.test("price increase above threshold triggers alert", () => {
  const result = computeDelta({ currentPrice: 120, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, 20);
  assertEquals(result.is_alert, true);
});

Deno.test("price increase below threshold does not trigger alert", () => {
  const result = computeDelta({ currentPrice: 108, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, 8);
  assertEquals(result.is_alert, false);
});

Deno.test("price decrease above threshold triggers alert", () => {
  const result = computeDelta({ currentPrice: 80, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, -20);
  assertEquals(result.is_alert, true);
});

Deno.test("exact threshold boundary does trigger alert", () => {
  const result = computeDelta({ currentPrice: 110, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, 10);
  assertEquals(result.is_alert, true);
});

Deno.test("delta is rounded to 2 decimal places", () => {
  const result = computeDelta({ currentPrice: 103.3333, oldPrice: 100, threshold: 10 });
  assertEquals(result.delta_percent, 3.33);
});
