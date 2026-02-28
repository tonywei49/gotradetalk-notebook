ALTER TABLE public.notebook_index_jobs
  ADD COLUMN IF NOT EXISTS chunk_strategy varchar(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS chunk_size     integer     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS chunk_separator text       DEFAULT NULL;
