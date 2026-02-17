-- 016_notebook_rag_core.down.sql

DROP TRIGGER IF EXISTS trg_notebook_chunks_updated ON public.notebook_chunks;
DROP TRIGGER IF EXISTS trg_notebook_items_updated ON public.notebook_items;

DROP TABLE IF EXISTS public.notebook_sync_ops;
DROP TABLE IF EXISTS public.assist_logs;
DROP TABLE IF EXISTS public.notebook_index_jobs;
DROP TABLE IF EXISTS public.notebook_chunks;
DROP TABLE IF EXISTS public.notebook_items;

DROP TYPE IF EXISTS public.notebook_sync_status;
DROP TYPE IF EXISTS public.notebook_sync_op_type;
DROP TYPE IF EXISTS public.notebook_sync_entity_type;
DROP TYPE IF EXISTS public.assist_adopted_action;
DROP TYPE IF EXISTS public.assist_trigger_type;
DROP TYPE IF EXISTS public.notebook_job_status;
DROP TYPE IF EXISTS public.notebook_job_type;
DROP TYPE IF EXISTS public.notebook_item_status;
DROP TYPE IF EXISTS public.notebook_index_status;
DROP TYPE IF EXISTS public.notebook_item_type;
