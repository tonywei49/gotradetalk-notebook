CREATE TABLE IF NOT EXISTS public.notebook_item_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.notebook_items(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  matrix_media_mxc text NOT NULL,
  matrix_media_name text,
  matrix_media_mime text,
  matrix_media_size bigint,
  is_indexable boolean NOT NULL DEFAULT true,
  status public.notebook_item_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notebook_item_files_item
  ON public.notebook_item_files(item_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notebook_item_files_company_owner
  ON public.notebook_item_files(company_id, owner_user_id, status, created_at DESC);
