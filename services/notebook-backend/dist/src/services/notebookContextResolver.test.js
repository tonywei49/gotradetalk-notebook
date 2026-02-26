import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMatrixContextMessages } from './notebookContextResolver.js';
test('resolveMatrixContextMessages throws INVALID_CONTEXT when required params missing', async () => {
    await assert.rejects(resolveMatrixContextMessages({
        hsUrl: '',
        accessToken: '',
        roomId: '',
        anchorEventId: ''
    }), /INVALID_CONTEXT/);
});
test('resolveMatrixContextMessages returns ordered context messages', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
        return {
            ok: true,
            json: async () => ({
                events_before: [
                    { event_id: '$1', content: { body: 'A' } },
                    { event_id: '$2', content: { body: 'B' } }
                ],
                event: { event_id: '$3', content: { body: 'C' } }
            })
        };
    });
    try {
        const rows = await resolveMatrixContextMessages({
            hsUrl: 'https://matrix.example.com',
            accessToken: 'tok',
            roomId: '!r:example.com',
            anchorEventId: '$3',
            windowSize: 5
        });
        assert.deepEqual(rows, [
            { event_id: '$1', body: 'A' },
            { event_id: '$2', body: 'B' },
            { event_id: '$3', body: 'C' }
        ]);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
test('resolveMatrixContextMessages throws INVALID_CONTEXT on non-ok response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: false, text: async () => 'x' }));
    try {
        await assert.rejects(resolveMatrixContextMessages({
            hsUrl: 'https://matrix.example.com',
            accessToken: 'tok',
            roomId: '!r:example.com',
            anchorEventId: '$3',
            windowSize: 5
        }), /INVALID_CONTEXT/);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
