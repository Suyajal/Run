ALTER TABLE public.record_import ADD COLUMN IF NOT EXISTS image_base64 text;
ALTER TABLE public.running_record ADD COLUMN IF NOT EXISTS image_base64 text;
