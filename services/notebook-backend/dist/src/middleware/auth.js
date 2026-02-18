import { isSupabaseAuthConfigured, supabaseAdmin } from '../supabase.js';
import { getCompanyByHsDomain, getProfileByAuthUserIdOrId, getProfileByMatrixUserId, getStaffProfileByLocalId, listMembershipsByUserId } from '../repos/authRepo.js';
function getBearerToken(req) {
    const authHeader = String(req.headers.authorization || '');
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    const queryToken = String(req.query.access_token || '').trim();
    if (queryToken)
        return queryToken;
    const bodyToken = String(req.body?.access_token || '').trim();
    if (bodyToken)
        return bodyToken;
    return '';
}
function normalizeBaseUrl(value) {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}
async function fetchMatrixWhoami(matrixBaseUrl, accessToken) {
    const url = new URL('/_matrix/client/v3/account/whoami', matrixBaseUrl);
    let response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
    if (!response.ok) {
        const fallbackUrl = new URL(url.toString());
        fallbackUrl.searchParams.set('access_token', accessToken);
        response = await fetch(fallbackUrl, { method: 'GET' });
    }
    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Matrix whoami failed (${response.status})`);
    }
    return response.json();
}
function authNotConfigured(res) {
    return res.status(503).json({
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Supabase auth env missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    });
}
export async function requireAuth(req, res, next) {
    const token = getBearerToken(req);
    if (!token) {
        return res.status(401).json({ message: 'Missing auth token' });
    }
    if (!isSupabaseAuthConfigured || !supabaseAdmin) {
        return authNotConfigured(res);
    }
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
        return res.status(401).json({ message: 'Invalid auth token' });
    }
    const profile = await getProfileByAuthUserIdOrId(data.user.id);
    const resolvedUserId = profile?.id || data.user.id;
    const memberships = await listMembershipsByUserId(resolvedUserId);
    const requestUser = {
        id: resolvedUserId,
        email: data.user.email ?? undefined,
        userType: profile?.user_type,
        isEmployee: memberships.length > 0 || profile?.user_type === 'staff',
        memberships
    };
    req.user = requestUser;
    return next();
}
export async function requireHubUser(req, res, next) {
    const token = getBearerToken(req);
    if (!token) {
        return res.status(401).json({ message: 'Missing auth token' });
    }
    const matrixUserId = String(req.query.matrix_user_id || req.headers['x-matrix-user-id'] || '').trim();
    if (matrixUserId) {
        const profile = await getProfileByMatrixUserId(matrixUserId);
        if (profile) {
            const memberships = await listMembershipsByUserId(profile.id);
            const requestUser = {
                id: profile.id,
                userType: profile.user_type,
                isEmployee: memberships.length > 0 || profile.user_type === 'staff',
                memberships
            };
            req.user = requestUser;
            return next();
        }
    }
    if (isSupabaseAuthConfigured && supabaseAdmin) {
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (!error && data.user) {
            const profile = await getProfileByAuthUserIdOrId(data.user.id);
            const resolvedUserId = profile?.id || data.user.id;
            const memberships = await listMembershipsByUserId(resolvedUserId);
            const requestUser = {
                id: resolvedUserId,
                email: data.user.email ?? undefined,
                userType: profile?.user_type,
                isEmployee: memberships.length > 0 || profile?.user_type === 'staff',
                memberships
            };
            req.user = requestUser;
            return next();
        }
    }
    try {
        const hsUrl = String(req.query.hs_url || req.headers['x-hs-url'] || '').trim();
        if (!hsUrl) {
            return res.status(400).json({ message: 'Missing hs_url' });
        }
        const whoami = await fetchMatrixWhoami(normalizeBaseUrl(hsUrl), token);
        const profile = await getProfileByMatrixUserId(whoami.user_id);
        if (!profile) {
            return res.status(404).json({ message: 'Profile not found' });
        }
        const memberships = await listMembershipsByUserId(profile.id);
        const requestUser = {
            id: profile.id,
            userType: profile.user_type,
            isEmployee: memberships.length > 0 || profile.user_type === 'staff',
            memberships
        };
        req.user = requestUser;
        return next();
    }
    catch (matrixError) {
        if (matrixUserId) {
            const localPart = matrixUserId.startsWith('@') ? matrixUserId.slice(1).split(':')[0] : '';
            const hsUrl = String(req.query.hs_url || req.headers['x-hs-url'] || '').trim();
            const host = hsUrl ? new URL(normalizeBaseUrl(hsUrl)).host : '';
            if (localPart && host) {
                const company = await getCompanyByHsDomain(host);
                if (company?.id) {
                    const fallbackProfile = await getStaffProfileByLocalId(company.id, localPart);
                    if (fallbackProfile) {
                        const memberships = await listMembershipsByUserId(fallbackProfile.id);
                        const requestUser = {
                            id: fallbackProfile.id,
                            userType: fallbackProfile.user_type,
                            isEmployee: true,
                            memberships
                        };
                        req.user = requestUser;
                        return next();
                    }
                }
            }
        }
        return res.status(401).json({ message: matrixError instanceof Error ? matrixError.message : 'Unauthorized' });
    }
}
