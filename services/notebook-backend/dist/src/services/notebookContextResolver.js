export async function resolveMatrixContextMessages(params) {
    const hsUrl = String(params.hsUrl || '').trim();
    const accessToken = String(params.accessToken || '').trim();
    const roomId = String(params.roomId || '').trim();
    const anchorEventId = String(params.anchorEventId || '').trim();
    const windowSize = Math.min(Math.max(Number(params.windowSize || 5), 1), 20);
    if (!hsUrl || !accessToken || !roomId || !anchorEventId) {
        throw new Error('INVALID_CONTEXT');
    }
    const url = new URL(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/context/${encodeURIComponent(anchorEventId)}`, hsUrl);
    url.searchParams.set('limit', String(windowSize));
    const resp = await fetch(url, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
    if (!resp.ok) {
        throw new Error('INVALID_CONTEXT');
    }
    const body = await resp.json();
    const before = (body.events_before || []).slice(-windowSize);
    const ordered = [...before, ...(body.event ? [body.event] : [])];
    const messages = ordered
        .map((m) => ({ event_id: String(m.event_id || ''), body: String(m.content?.body || '').trim() }))
        .filter((m) => m.event_id && m.body);
    if (messages.length === 0) {
        throw new Error('INVALID_CONTEXT');
    }
    return messages;
}
