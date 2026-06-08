-- supabase/migrations/20260608000000_cap_monthly_ocr_limit.sql
-- Лимит OCR-запросов в месяц теперь регулируется в диапазоне 0-100 на тенанта.
-- Переподписка — естественный месячный сброс: enforcement (OCR-1) считает
-- ai_token_logs за текущий календарный месяц, отдельного счётчика не нужно.

UPDATE public.tenants SET monthly_ocr_limit = 100 WHERE monthly_ocr_limit > 100;

ALTER TABLE public.tenants
    ALTER COLUMN monthly_ocr_limit SET DEFAULT 50,
    ADD CONSTRAINT tenants_monthly_ocr_limit_range CHECK (monthly_ocr_limit BETWEEN 0 AND 100);
