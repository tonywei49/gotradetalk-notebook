DROP INDEX IF EXISTS public.idx_notebook_items_company_scope_status;

ALTER TABLE public.notebook_items
  DROP COLUMN IF EXISTS source_scope;

DROP TYPE IF EXISTS public.notebook_source_scope;

