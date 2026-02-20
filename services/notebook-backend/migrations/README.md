# Migrations Order

This service supports empty Postgres bootstrap.
Baseline migration is idempotent and can run on partially initialized DBs (uses `IF NOT EXISTS` and additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

Apply order (`up`):
1. `000_notebook_baseline.up.sql`
2. `016_notebook_rag_core.up.sql`
3. `017_notebook_ai_provider_profiles.up.sql`
4. `018_notebook_ai_ocr_provider.up.sql`

Rollback order (`down`):
1. `018_notebook_ai_ocr_provider.down.sql`
2. `017_notebook_ai_provider_profiles.down.sql`
3. `016_notebook_rag_core.down.sql`
4. `000_notebook_baseline.down.sql`

## FK Decision
We keep FK integrity in notebook core tables and provide local minimal dependency tables (`companies`, `profiles`, `company_settings`, `company_memberships`) in baseline migration.

Tradeoff:
- Pros: strong data integrity, catches bad references at DB layer.
- Cons: requires minimal identity/company rows to be provisioned in this standalone DB.
