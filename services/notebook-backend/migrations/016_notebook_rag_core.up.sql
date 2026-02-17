-- 016_notebook_rag_core.sql
-- Notebook RAG core tables for hub-backend (BE-01)

create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_item_type') THEN
    CREATE TYPE public.notebook_item_type AS ENUM ('text', 'file');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_index_status') THEN
    CREATE TYPE public.notebook_index_status AS ENUM ('pending', 'running', 'success', 'failed', 'skipped');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_item_status') THEN
    CREATE TYPE public.notebook_item_status AS ENUM ('active', 'deleted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_job_type') THEN
    CREATE TYPE public.notebook_job_type AS ENUM ('upsert', 'delete', 'reindex');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_job_status') THEN
    CREATE TYPE public.notebook_job_status AS ENUM ('pending', 'running', 'success', 'failed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assist_trigger_type') THEN
    CREATE TYPE public.assist_trigger_type AS ENUM ('manual_query', 'from_message_context');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assist_adopted_action') THEN
    CREATE TYPE public.assist_adopted_action AS ENUM ('none', 'inserted', 'sent');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_sync_entity_type') THEN
    CREATE TYPE public.notebook_sync_entity_type AS ENUM ('item', 'item_file');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_sync_op_type') THEN
    CREATE TYPE public.notebook_sync_op_type AS ENUM ('create', 'update', 'delete');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_sync_status') THEN
    CREATE TYPE public.notebook_sync_status AS ENUM ('pending', 'applied', 'conflict', 'rejected');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notebook_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text,
  content_markdown text,
  item_type public.notebook_item_type NOT NULL DEFAULT 'text',
  matrix_media_mxc text,
  matrix_media_name text,
  matrix_media_mime text,
  matrix_media_size bigint,
  is_indexable boolean NOT NULL DEFAULT false,
  index_status public.notebook_index_status NOT NULL DEFAULT 'pending',
  index_error text,
  status public.notebook_item_status NOT NULL DEFAULT 'active',
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notebook_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.notebook_items(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  chunk_text text NOT NULL,
  token_count integer,
  content_hash text NOT NULL,
  source_type text,
  source_locator text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS public.notebook_index_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.notebook_items(id) ON DELETE CASCADE,
  job_type public.notebook_job_type NOT NULL,
  status public.notebook_job_status NOT NULL DEFAULT 'pending',
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assist_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  room_id text,
  trigger_type public.assist_trigger_type NOT NULL,
  trigger_event_id text,
  query_text text NOT NULL,
  context_message_ids jsonb,
  used_sources jsonb,
  response_text text,
  response_confidence numeric(6,4),
  adopted_action public.assist_adopted_action NOT NULL DEFAULT 'none',
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notebook_sync_ops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  entity_type public.notebook_sync_entity_type NOT NULL,
  entity_id text NOT NULL,
  op_type public.notebook_sync_op_type NOT NULL,
  op_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_revision bigint,
  client_op_id text NOT NULL,
  status public.notebook_sync_status NOT NULL DEFAULT 'pending',
  conflict_copy jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (client_op_id)
);

CREATE INDEX IF NOT EXISTS idx_notebook_items_company_owner_updated
  ON public.notebook_items(company_id, owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notebook_items_company_status
  ON public.notebook_items(company_id, status);
CREATE INDEX IF NOT EXISTS idx_notebook_chunks_company_owner
  ON public.notebook_chunks(company_id, owner_user_id);
CREATE INDEX IF NOT EXISTS idx_notebook_index_jobs_company_status
  ON public.notebook_index_jobs(company_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_notebook_sync_ops_company_user_created
  ON public.notebook_sync_ops(company_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assist_logs_company_created
  ON public.assist_logs(company_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_notebook_items_updated ON public.notebook_items;
CREATE TRIGGER trg_notebook_items_updated
  BEFORE UPDATE ON public.notebook_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_notebook_chunks_updated ON public.notebook_chunks;
CREATE TRIGGER trg_notebook_chunks_updated
  BEFORE UPDATE ON public.notebook_chunks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
