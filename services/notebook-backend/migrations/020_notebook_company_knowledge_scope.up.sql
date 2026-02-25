DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notebook_source_scope') THEN
    CREATE TYPE public.notebook_source_scope AS ENUM ('personal', 'company');
  END IF;
END $$;

ALTER TABLE public.notebook_items
  ADD COLUMN IF NOT EXISTS source_scope public.notebook_source_scope NOT NULL DEFAULT 'personal';

CREATE INDEX IF NOT EXISTS idx_notebook_items_company_scope_status
  ON public.notebook_items(company_id, source_scope, status, updated_at DESC);

