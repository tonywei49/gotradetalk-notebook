import { dbQuery } from '../db.js'

export type ProfileRow = {
  id: string
  company_id: string | null
  user_type: string
  auth_user_id: string | null
  user_local_id: string | null
  matrix_user_id: string | null
}

export type MembershipRow = {
  company_id: string
  role: string
}

export type CompanySettingsRow = {
  notebook_ai_enabled: boolean
  notebook_ai_llm_base_url: string | null
  notebook_ai_llm_api_key: string | null
  notebook_ai_chat_base_url: string | null
  notebook_ai_chat_api_key: string | null
  notebook_ai_chat_model: string | null
  notebook_ai_embedding_base_url: string | null
  notebook_ai_embedding_api_key: string | null
  notebook_ai_embedding_model: string | null
  notebook_ai_rerank_base_url: string | null
  notebook_ai_rerank_api_key: string | null
  notebook_ai_rerank_model: string | null
  notebook_ai_ocr_base_url: string | null
  notebook_ai_ocr_api_key: string | null
  notebook_ai_ocr_model: string | null
  notebook_ai_vision_base_url: string | null
  notebook_ai_vision_api_key: string | null
  notebook_ai_vision_model: string | null
  notebook_ai_retrieval_top_k: number
  notebook_ai_score_threshold: number
  notebook_ai_max_context_tokens: number
  notebook_ai_ocr_enabled: boolean
  notebook_ai_allow_low_confidence_send: boolean
  notebook_ai_upload_max_mb: number | null
}

export async function getProfileById(profileId: string): Promise<ProfileRow | null> {
  const result = await dbQuery<ProfileRow>(
    `select id, company_id, user_type, auth_user_id, user_local_id, matrix_user_id
     from public.profiles
     where id = $1
     limit 1`,
    [profileId]
  )
  return result.rows[0] || null
}

export async function upsertInternalProfile(params: {
  profileId: string
  companyId: string
  userType?: 'admin' | 'staff' | 'client'
  userLocalId?: string | null
}): Promise<void> {
  await dbQuery(
    `insert into public.profiles (id, company_id, user_type, user_local_id)
     values ($1, $2, $3, $4)
     on conflict (id) do update
       set company_id = excluded.company_id,
           user_type = excluded.user_type,
           user_local_id = coalesce(excluded.user_local_id, public.profiles.user_local_id)`,
    [
      params.profileId,
      params.companyId,
      params.userType || 'admin',
      params.userLocalId || null
    ]
  )
}

export async function getProfileByMatrixUserId(matrixUserId: string): Promise<ProfileRow | null> {
  const result = await dbQuery<ProfileRow>(
    `select id, company_id, user_type, auth_user_id, user_local_id, matrix_user_id
     from public.profiles
     where matrix_user_id = $1
     limit 1`,
    [matrixUserId]
  )
  return result.rows[0] || null
}

export async function getProfileByAuthUserIdOrId(authUserId: string): Promise<ProfileRow | null> {
  const result = await dbQuery<ProfileRow>(
    `select id, company_id, user_type, auth_user_id, user_local_id, matrix_user_id
     from public.profiles
     where auth_user_id = $1 or id::text = $1
     order by case when auth_user_id = $1 then 0 else 1 end
     limit 1`,
    [authUserId]
  )
  return result.rows[0] || null
}

export async function listMembershipsByUserId(userId: string): Promise<MembershipRow[]> {
  const result = await dbQuery<MembershipRow>(
    `select company_id::text as company_id, role
     from public.company_memberships
     where user_id = $1`,
    [userId]
  )
  return result.rows
}

export async function getCompanyByHsDomain(hsDomain: string): Promise<{ id: string } | null> {
  const result = await dbQuery<{ id: string }>(
    `select id::text as id
     from public.companies
     where hs_domain = $1
     limit 1`,
    [hsDomain]
  )
  return result.rows[0] || null
}

export async function getStaffProfileByLocalId(companyId: string, userLocalId: string): Promise<ProfileRow | null> {
  const result = await dbQuery<ProfileRow>(
    `select id, company_id, user_type, auth_user_id, user_local_id, matrix_user_id
     from public.profiles
     where company_id = $1 and user_local_id = $2 and user_type = 'staff'
     limit 1`,
    [companyId, userLocalId]
  )
  return result.rows[0] || null
}

export async function getCompanySettings(companyId: string): Promise<CompanySettingsRow | null> {
  const result = await dbQuery<CompanySettingsRow>(
    `select
      notebook_ai_enabled,
      notebook_ai_llm_base_url,
      notebook_ai_llm_api_key,
      notebook_ai_chat_base_url,
      notebook_ai_chat_api_key,
      notebook_ai_chat_model,
      notebook_ai_embedding_base_url,
      notebook_ai_embedding_api_key,
      notebook_ai_embedding_model,
      notebook_ai_rerank_base_url,
      notebook_ai_rerank_api_key,
      notebook_ai_rerank_model,
      notebook_ai_ocr_base_url,
      notebook_ai_ocr_api_key,
      notebook_ai_ocr_model,
      notebook_ai_vision_base_url,
      notebook_ai_vision_api_key,
      notebook_ai_vision_model,
      notebook_ai_retrieval_top_k,
      notebook_ai_score_threshold,
      notebook_ai_max_context_tokens,
      notebook_ai_ocr_enabled,
      notebook_ai_allow_low_confidence_send,
      notebook_ai_upload_max_mb
     from public.company_settings
     where company_id = $1
     limit 1`,
    [companyId]
  )
  return result.rows[0] || null
}
