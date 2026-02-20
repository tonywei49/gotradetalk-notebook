import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireHubUser } from './middleware/auth.js';
import { assistFromContext, assistQuery, attachNotebookFile, createNotebookItem, deleteNotebookItem, getMeCapabilities, getNotebookIndexStatus, listNotebookItems, retryNotebookIndexJob, syncPull, syncPush, updateNotebookItem } from './routes/notebook.js';
import { getInternalNotebookAiSettings, upsertInternalNotebookAiSettings } from './routes/internalNotebookSettings.js';
const app = express();
const port = Number(process.env.PORT || 4010);
const envCorsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
const defaultCorsOrigins = ['http://localhost:8080', 'http://localhost:5173'];
const corsOrigins = envCorsOrigins.length ? Array.from(new Set([...envCorsOrigins, ...defaultCorsOrigins])) : defaultCorsOrigins;
app.use(cors({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if (corsOrigins.includes(origin))
            return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/version', (_req, res) => res.json({ ok: true, version: process.env.GIT_SHA || 'local', time: new Date().toISOString() }));
app.get('/me/capabilities', requireHubUser, getMeCapabilities);
app.get('/notebook/items', requireHubUser, listNotebookItems);
app.post('/notebook/items', requireHubUser, createNotebookItem);
app.patch('/notebook/items/:id', requireHubUser, updateNotebookItem);
app.delete('/notebook/items/:id', requireHubUser, deleteNotebookItem);
app.post('/notebook/items/:id/files', requireHubUser, attachNotebookFile);
app.get('/notebook/items/:id/index-status', requireHubUser, getNotebookIndexStatus);
app.post('/notebook/index/jobs/:id/retry', requireHubUser, retryNotebookIndexJob);
app.post('/chat/assist/query', requireHubUser, assistQuery);
app.post('/chat/assist/from-context', requireHubUser, assistFromContext);
app.post('/notebook/sync/push', requireHubUser, syncPush);
app.get('/notebook/sync/pull', requireHubUser, syncPull);
app.get('/internal/company/settings/notebook-ai', getInternalNotebookAiSettings);
app.put('/internal/company/settings/notebook-ai', upsertInternalNotebookAiSettings);
app.listen(port, () => {
    console.log(`Notebook backend listening on :${port}`);
});
