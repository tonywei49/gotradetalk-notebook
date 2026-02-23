alter table if exists public.company_settings
  drop column if exists notebook_ai_vision_model,
  drop column if exists notebook_ai_vision_api_key,
  drop column if exists notebook_ai_vision_base_url;
