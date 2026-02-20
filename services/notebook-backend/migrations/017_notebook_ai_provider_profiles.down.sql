alter table if exists public.company_settings
  drop column if exists notebook_ai_chat_base_url,
  drop column if exists notebook_ai_chat_api_key,
  drop column if exists notebook_ai_embedding_base_url,
  drop column if exists notebook_ai_embedding_api_key,
  drop column if exists notebook_ai_rerank_base_url,
  drop column if exists notebook_ai_rerank_api_key;
