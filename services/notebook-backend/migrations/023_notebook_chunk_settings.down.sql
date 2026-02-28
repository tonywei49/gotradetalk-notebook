ALTER TABLE public.notebook_index_jobs
  DROP COLUMN IF EXISTS chunk_strategy,
  DROP COLUMN IF EXISTS chunk_size,
  DROP COLUMN IF EXISTS chunk_separator;
