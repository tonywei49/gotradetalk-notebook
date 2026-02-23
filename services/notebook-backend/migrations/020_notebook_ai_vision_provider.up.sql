alter table if exists public.company_settings
  add column if not exists notebook_ai_vision_base_url text,
  add column if not exists notebook_ai_vision_api_key text,
  add column if not exists notebook_ai_vision_model text;

update public.company_settings
set notebook_ai_vision_base_url = notebook_ai_chat_base_url
where notebook_ai_vision_base_url is null and notebook_ai_chat_base_url is not null;

update public.company_settings
set notebook_ai_vision_api_key = notebook_ai_chat_api_key
where notebook_ai_vision_api_key is null and notebook_ai_chat_api_key is not null;
