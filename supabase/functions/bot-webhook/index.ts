// supabase/functions/bot-webhook/index.ts
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import OpenAI from "https://esm.sh/openai@4.52.0";
import type { OcrInvoice, OcrInvoiceItem } from "../_shared/types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MINI_APP_BASE_URL = Deno.env.get("MINI_APP_BASE_URL")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const INVOICE_SCHEMA = {
  type: "object" as const,
  properties: {
    supplier_pib: { type: "string", description: "9-digit Serbian Tax ID (PIB)" },
    supplier_name: { type: "string" },
    doc_number: { type: "string" },
    doc_date: { type: "string", description: "Format: YYYY-MM-DD" },
    total_amount_ocr: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ocr_text_raw: { type: "string", description: "Raw item name text from the paper invoice" },
          quantity: { type: "number" },
          price_per_unit_no_vat: { type: "number" },
          vat_percent: { type: "number" },
          total_amount: { type: "number" },
        },
        required: ["ocr_text_raw", "quantity", "price_per_unit_no_vat", "vat_percent", "total_amount"],
        additionalProperties: false,
      },
    },
  },
  required: ["supplier_pib", "supplier_name", "doc_number", "doc_date", "total_amount_ocr", "items"],
  additionalProperties: false,
};

serve(async (req: Request) => {
  try {
    const update = await req.json();

    // Only process photo messages
    if (!update.message?.photo) {
      return new Response(JSON.stringify({ status: "skipped" }), { status: 200 });
    }

    const tgUserId: number = update.message.from.id;
    const photoArray = update.message.photo;
    const largestPhoto = photoArray[photoArray.length - 1];

    // Verify user is registered
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, tenant_id")
      .eq("tg_id", tgUserId)
      .single();

    if (userErr || !user) {
      await sendTgMessage(tgUserId, "❌ Вы не зарегистрированы в системе. Обратитесь к администратору заведения.");
      return new Response(JSON.stringify({ status: "unauthorized" }), { status: 200 });
    }

    await sendTgMessage(tgUserId, "⏳ Документ получен. ИИ анализирует накладную... Подождите.");

    // Download photo from Telegram
    const fileRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${largestPhoto.file_id}`
    );
    const fileData = await fileRes.json();
    const filePath: string = fileData.result.file_path;

    const imgRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`);
    const arrayBuffer = await imgRes.arrayBuffer();
    const base64Image = btoa(
      String.fromCharCode(...new Uint8Array(arrayBuffer))
    );

    // Call GPT-4o with Structured Outputs
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Parse this Serbian invoice (Račun-Otpremnica). Return strict JSON matching the schema. All prices must be without VAT. doc_date must be YYYY-MM-DD format. supplier_pib is the 9-digit Serbian tax ID.",
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: "high" },
            },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "invoice",
          schema: INVOICE_SCHEMA,
          strict: true,
        },
      },
    });

    const parsedInvoice: OcrInvoice = JSON.parse(
      completion.choices[0].message.content ?? "{}"
    );

    // Log token usage
    const usage = completion.usage;
    if (usage) {
      const cost = usage.prompt_tokens * 0.000005 + usage.completion_tokens * 0.000015;
      await supabase.from("ai_token_logs").insert({
        tenant_id: user.tenant_id,
        user_id: user.id,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        estimated_cost_usd: cost,
      });
    }

    // Lookup OCR mappings for auto-linking known products
    const mappedItems = await enrichWithMappings(
      parsedInvoice.items,
      user.tenant_id,
      parsedInvoice.supplier_pib
    );

    // Save invoice draft
    const { data: invoice, error: invErr } = await supabase
      .from("invoice_history")
      .insert({
        tenant_id: user.tenant_id,
        user_id: user.id,
        supplier_pib: parsedInvoice.supplier_pib,
        supplier_name: parsedInvoice.supplier_name,
        doc_number: parsedInvoice.doc_number,
        doc_date: parsedInvoice.doc_date,
        total_amount_ocr: parsedInvoice.total_amount_ocr,
        status: "draft",
      })
      .select()
      .single();

    if (invErr || !invoice) throw invErr ?? new Error("Failed to save invoice");

    // Save line items
    const rows = mappedItems.map((item) => ({
      invoice_id: invoice.id,
      ocr_text_raw: item.ocr_text_raw,
      syrve_product_id: item.syrve_product_id ?? null,
      quantity: item.quantity,
      price_per_unit_no_vat: item.price_per_unit_no_vat,
      vat_percent: item.vat_percent,
      total_amount: item.total_amount,
    }));

    await supabase.from("invoice_items_history").insert(rows);

    // Send Mini App link
    const miniAppUrl = `${MINI_APP_BASE_URL}/invoice/${invoice.id}`;
    await sendTgMessage(
      tgUserId,
      `✅ Накладная №${parsedInvoice.doc_number} распознана!\n` +
        `Поставщик: ${parsedInvoice.supplier_name}\n` +
        `Сумма: ${parsedInvoice.total_amount_ocr} RSD\n\n` +
        `Проверьте позиции перед отправкой в Syrve:`,
      {
        inline_keyboard: [
          [{ text: "📋 Открыть накладную", web_app: { url: miniAppUrl } }],
        ],
      }
    );

    return new Response(JSON.stringify({ success: true, invoice_id: invoice.id }), { status: 200 });
  } catch (err) {
    console.error("bot-webhook error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

async function enrichWithMappings(
  items: OcrInvoiceItem[],
  tenantId: number,
  supplierPib: string
): Promise<Array<OcrInvoiceItem & { syrve_product_id?: number }>> {
  if (items.length === 0) return [];

  const rawTexts = items.map((i) => i.ocr_text_raw);

  const { data: mappings } = await supabase
    .from("ocr_mappings")
    .select("ocr_text_raw, syrve_product_id")
    .eq("tenant_id", tenantId)
    .eq("supplier_pib", supplierPib)
    .in("ocr_text_raw", rawTexts);

  const mappingMap = new Map<string, number>(
    (mappings ?? []).map((m) => [m.ocr_text_raw, m.syrve_product_id])
  );

  return items.map((item) => ({
    ...item,
    syrve_product_id: mappingMap.get(item.ocr_text_raw),
  }));
}

async function sendTgMessage(
  chatId: number,
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}
