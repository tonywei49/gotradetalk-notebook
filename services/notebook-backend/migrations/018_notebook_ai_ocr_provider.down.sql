alter table if exists public.company_settings
  drop column if exists notebook_ai_ocr_base_url,
  drop column if exists notebook_ai_ocr_api_key,
  drop column if exists notebook_ai_ocr_model;
