import type { Request, Response, NextFunction } from 'express'
import { isSupabaseAuthConfigured, supabaseAdmin } from '../supabase.js'
import type { RequestUser } from '../types.js'
import { dbQuery } from '../db.js'
import {
  getCompanyByHsDomain,
  getProfileByAuthUserIdOrId,
  getProfileByMatrixUserId,
  getProfileById,
  getStaffProfileByLocalId,
  listMembershipsByUserId
} from '../repos/authRepo.js'

function getBearerToken(req: Request) {
  const authHeader = String(req.headers.authorization || '')
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  const queryToken = String(req.query.access_token || '').trim()
  if (queryToken) return queryToken
  const bodyToken = String((req.body as { access_token?: string } | undefined)?.access_token || '').trim()
  if (bodyToken) return bodyToken
  return ''
}

function normalizeBaseUrl(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function isLikelyJwtToken(token: string) {
  const trimmed = String(token || '').trim()
  if (!trimmed.startsWith('eyJ')) return false
  const parts = trimmed.split('.')
  return parts.length === 3 && parts.every((part) => part.length > 0)
}

type HubMePayload = {
  user_id?: string
  company_id?: string | null
  memberships?: Array<{ company_id: string; role: string }>
  profile?: {
    user_type?: string | null
    user_local_id?: string | null
    matrix_user_id?: string | null
  } | null
}

async function syncProfileFromHub(req: Request, token: string): Promise<string | null> {
  const hsUrl = String(req.query.hs_url || req.headers['x-hs-url'] || '').trim()
  const matrixUserId = String(req.query.matrix_user_id || req.headers['x-matrix-user-id'] || '').trim()
  if (!hsUrl && !matrixUserId) return null

  const hubBase = String(process.env.HUB_API_BASE_URL || 'https://api.gotradetalk.com').trim().replace(/\/+$/, '')
  const meUrl = new URL(`${hubBase}/me`)
  if (hsUrl) meUrl.searchParams.set('hs_url', hsUrl)
  if (matrixUserId) meUrl.searchParams.set('matrix_user_id', matrixUserId)

  const response = await fetch(meUrl.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  if (!response.ok) return null

  const payload = await response.json() as HubMePayload
  const userId = String(payload.user_id || '').trim()
  const companyId = String(payload.company_id || payload.memberships?.[0]?.company_id || '').trim()
  if (!userId) return null

  const userType = String(payload.profile?.user_type || 'staff').trim() || 'staff'
  const userLocalId = String(payload.profile?.user_local_id || '').trim() || null
  const resolvedMatrixUserId = String(payload.profile?.matrix_user_id || matrixUserId || '').trim() || null
  const hsDomain = hsUrl ? new URL(normalizeBaseUrl(hsUrl)).host : null
  const localCompanyByHs = hsDomain ? await getCompanyByHsDomain(hsDomain) : null
  const resolvedCompanyId = String(localCompanyByHs?.id || companyId).trim()
  if (!resolvedCompanyId) return null

  if (!localCompanyByHs) {
    await dbQuery(
      `insert into public.companies (id, hs_domain)
       values ($1::uuid, $2)
       on conflict (id) do update set hs_domain = coalesce(excluded.hs_domain, public.companies.hs_domain)`,
      [resolvedCompanyId, hsDomain]
    )
  }

  let resolvedProfileId = userId
  const profileByMatrix = resolvedMatrixUserId ? await getProfileByMatrixUserId(resolvedMatrixUserId) : null
  if (profileByMatrix?.id) {
    resolvedProfileId = profileByMatrix.id
    await dbQuery(
      `update public.profiles
       set company_id = $2::uuid,
           user_type = $3,
           user_local_id = coalesce($4, user_local_id),
           matrix_user_id = coalesce($5, matrix_user_id)
       where id = $1::uuid`,
      [resolvedProfileId, resolvedCompanyId, userType, userLocalId, resolvedMatrixUserId]
    )
  } else {
    await dbQuery(
      `insert into public.profiles (id, company_id, user_type, user_local_id, matrix_user_id)
       values ($1::uuid, $2::uuid, $3, $4, $5)
       on conflict (id) do update
       set company_id = excluded.company_id,
           user_type = excluded.user_type,
           user_local_id = coalesce(excluded.user_local_id, public.profiles.user_local_id),
           matrix_user_id = coalesce(excluded.matrix_user_id, public.profiles.matrix_user_id)`,
      [resolvedProfileId, resolvedCompanyId, userType, userLocalId, resolvedMatrixUserId]
    )
  }

  const memberships = Array.isArray(payload.memberships) ? payload.memberships : []
  for (const membership of memberships) {
    const membershipCompanyId = String(membership.company_id || '').trim()
    if (!membershipCompanyId) continue
    const role = String(membership.role || 'member').trim() || 'member'
    await dbQuery(
      `insert into public.company_memberships (user_id, company_id, role)
       values ($1::uuid, $2::uuid, $3)
       on conflict (user_id, company_id) do update set role = excluded.role`,
      [resolvedProfileId, membershipCompanyId, role]
    )
  }

  return resolvedProfileId
}

function authNotConfigured(res: Response) {
  return res.status(503).json({
    code: 'AUTH_NOT_CONFIGURED',
    message: 'Supabase auth env missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
  })
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req)

  if (!token) {
    return res.status(401).json({ message: 'Missing auth token' })
  }

  if (!isSupabaseAuthConfigured || !supabaseAdmin) {
    return authNotConfigured(res)
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) {
    return res.status(401).json({ message: 'Invalid auth token' })
  }

  const profile = await getProfileByAuthUserIdOrId(data.user.id)
  const resolvedUserId = profile?.id || data.user.id
  const memberships = await listMembershipsByUserId(resolvedUserId)

  const requestUser: RequestUser = {
    id: resolvedUserId,
    email: data.user.email ?? undefined,
    userType: profile?.user_type,
    isEmployee: memberships.length > 0 || profile?.user_type === 'staff',
    memberships
  }

  ;(req as any).user = requestUser
  return next()
}

export async function requireHubUser(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req)
  if (!token) {
    return res.status(401).json({ message: 'Missing auth token' })
  }

  if (!isLikelyJwtToken(token)) {
    return res.status(401).json({
      code: 'INVALID_AUTH_TOKEN',
      message: 'Invalid auth token type: Notebook API requires Hub/Supabase JWT'
    })
  }

  if (isSupabaseAuthConfigured && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.auth.getUser(token)
    if (!error && data.user) {
      let profile = await getProfileByAuthUserIdOrId(data.user.id)
      if (profile && !String(profile.company_id || '').trim()) {
        profile = null
      }
      if (!profile) {
        const syncedUserId = await syncProfileFromHub(req, token).catch(() => null)
        if (syncedUserId) {
          profile = await getProfileById(syncedUserId)
        }
      }
      const resolvedUserId = profile?.id || data.user.id
      const memberships = await listMembershipsByUserId(resolvedUserId)

      const requestUser: RequestUser = {
        id: resolvedUserId,
        email: data.user.email ?? undefined,
        userType: profile?.user_type,
        isEmployee: memberships.length > 0 || profile?.user_type === 'staff',
        memberships
      }

      ;(req as any).user = requestUser
      return next()
    }
  }

  // Fallback path: validate hub/supabase JWT via hub /me and bootstrap local profile context.
  // This avoids rejecting valid business JWTs when local supabase admin validation is out of sync.
  const syncedUserId = await syncProfileFromHub(req, token).catch(() => null)
  if (syncedUserId) {
    const profile = await getProfileById(syncedUserId)
    const memberships = await listMembershipsByUserId(syncedUserId)
    const requestUser: RequestUser = {
      id: syncedUserId,
      userType: profile?.user_type,
      isEmployee: memberships.length > 0 || profile?.user_type === 'staff',
      memberships
    }
    ;(req as any).user = requestUser
    return next()
  }
  return res.status(401).json({
    code: 'INVALID_AUTH_TOKEN',
    message: 'Invalid auth token'
  })
}
