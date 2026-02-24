# Migrations Order

This service supports empty Postgres bootstrap.
Baseline migration is idempotent and can run on partially initialized DBs (uses `IF NOT EXISTS` and additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

Apply order (`up`):
1. `000_notebook_baseline.up.sql`
2. `016_notebook_rag_core.up.sql`
3. `017_notebook_ai_provider_profiles.up.sql`
4. `018_notebook_ai_ocr_provider.up.sql`
5. `019_notebook_item_files.up.sql`
6. `020_notebook_ai_vision_provider.up.sql`
7. `021_platform_ai_policies.up.sql`

Rollback order (`down`):
1. `021_platform_ai_policies.down.sql`
2. `020_notebook_ai_vision_provider.down.sql`
3. `019_notebook_item_files.down.sql`
4. `018_notebook_ai_ocr_provider.down.sql`
5. `017_notebook_ai_provider_profiles.down.sql`
6. `016_notebook_rag_core.down.sql`
7. `000_notebook_baseline.down.sql`

## FK Decision
We keep FK integrity in notebook core tables and provide local minimal dependency tables (`companies`, `profiles`, `company_settings`, `company_memberships`) in baseline migration.

Tradeoff:
- Pros: strong data integrity, catches bad references at DB layer.
- Cons: requires minimal identity/company rows to be provisioned in this standalone DB.
