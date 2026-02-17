import { supabaseAdmin } from '../supabase.js';
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
export async function requireAuth(req, res, next) {
    const token = getBearerToken(req);
    if (!token) {
        return res.status(401).json({ message: 'Missing auth token' });
    }
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
        return res.status(401).json({ message: 'Invalid auth token' });
    }
    const userId = data.user.id;
    const { data: memberships, error: membershipError } = await supabaseAdmin
        .from('company_memberships')
        .select('company_id, role')
        .eq('user_id', userId);
    if (membershipError) {
        return res.status(500).json({ message: membershipError.message });
    }
    const mappedMemberships = memberships || [];
    const requestUser = {
        id: userId,
        email: data.user.email ?? undefined,
        isEmployee: mappedMemberships.length > 0,
        memberships: mappedMemberships
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
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, user_type')
            .eq('matrix_user_id', matrixUserId)
            .maybeSingle();
        if (!profileError && profile) {
            const requestUser = {
                id: profile.id,
                userType: profile.user_type,
                isEmployee: profile.user_type === 'staff',
                memberships: []
            };
            req.user = requestUser;
            return next();
        }
    }
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && data.user) {
        const userId = data.user.id;
        const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('id, user_type')
            .or(`auth_user_id.eq.${userId},id.eq.${userId}`)
            .maybeSingle();
        const { data: memberships } = await supabaseAdmin
            .from('company_memberships')
            .select('company_id, role')
            .eq('user_id', userId);
        const mappedMemberships = memberships || [];
        const requestUser = {
            id: profile?.id || userId,
            email: data.user.email ?? undefined,
            userType: profile?.user_type,
            isEmployee: mappedMemberships.length > 0 || profile?.user_type === 'staff',
            memberships: mappedMemberships
        };
        req.user = requestUser;
        return next();
    }
    try {
        const hsUrl = String(req.query.hs_url || req.headers['x-hs-url'] || '').trim();
        if (!hsUrl) {
            return res.status(400).json({ message: 'Missing hs_url' });
        }
        const matrixUserId = String(req.query.matrix_user_id || req.headers['x-matrix-user-id'] || '').trim();
        if (matrixUserId) {
            const { data: profile, error: profileError } = await supabaseAdmin
                .from('profiles')
                .select('id, user_type')
                .eq('matrix_user_id', matrixUserId)
                .maybeSingle();
            if (!profileError && profile) {
                const requestUser = {
                    id: profile.id,
                    userType: profile.user_type,
                    isEmployee: profile.user_type === 'staff',
                    memberships: []
                };
                req.user = requestUser;
                return next();
            }
        }
        const whoami = await fetchMatrixWhoami(normalizeBaseUrl(hsUrl), token);
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, user_type')
            .eq('matrix_user_id', whoami.user_id)
            .maybeSingle();
        if (profileError || !profile) {
            return res.status(404).json({ message: 'Profile not found' });
        }
        const requestUser = {
            id: profile.id,
            userType: profile.user_type,
            isEmployee: profile.user_type === 'staff',
            memberships: []
        };
        req.user = requestUser;
        return next();
    }
    catch (matrixError) {
        const matrixUserId = String(req.query.matrix_user_id || req.headers['x-matrix-user-id'] || '').trim();
        if (matrixUserId) {
            const localPart = matrixUserId.startsWith('@') ? matrixUserId.slice(1).split(':')[0] : '';
            const hsUrl = String(req.query.hs_url || req.headers['x-hs-url'] || '').trim();
            const host = hsUrl ? new URL(normalizeBaseUrl(hsUrl)).host : '';
            if (localPart && host) {
                const { data: company } = await supabaseAdmin
                    .from('companies')
                    .select('id')
                    .eq('hs_domain', host)
                    .maybeSingle();
                if (company?.id) {
                    const { data: fallbackProfile, error: fallbackError } = await supabaseAdmin
                        .from('profiles')
                        .select('id, user_type')
                        .eq('user_local_id', localPart)
                        .eq('company_id', company.id)
                        .eq('user_type', 'staff')
                        .maybeSingle();
                    if (!fallbackError && fallbackProfile) {
                        const requestUser = {
                            id: fallbackProfile.id,
                            userType: fallbackProfile.user_type,
                            isEmployee: true,
                            memberships: []
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
