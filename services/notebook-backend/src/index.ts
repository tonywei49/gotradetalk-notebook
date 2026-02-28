import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { requireHubUser } from './middleware/auth.js'
import {
  assistFromContext,
  assistQuery,
  attachNotebookFile,
  createNotebookItem,
  createCompanyNotebookItem,
  deleteNotebookItemFile,
  deleteNotebookItem,
  deleteCompanyNotebookItem,
  getMeCapabilities,
  getNotebookItemChunks,
  getNotebookItemParsedPreview,
  getNotebookIndexStatus,
  listNotebookItemFiles,
  listNotebookItems,
  reindexNotebookItem,
  retryNotebookIndexJob,
  syncPull,
  syncPush,
  updateNotebookItem,
  updateCompanyNotebookItem
} from './routes/notebook.js'
import { getInternalNotebookAiSettings, upsertInternalNotebookAiSettings } from './routes/internalNotebookSettings.js'
import {
  createInternalCompanyKnowledgeItem,
  deleteInternalCompanyKnowledgeItem,
  listInternalCompanyKnowledgeItems,
  offlineInternalCompanyKnowledgeItem,
  retryInternalCompanyKnowledgeIndex
} from './routes/internalCompanyKnowledge.js'
import {
  getCompanyNotebookAiSettings,
  getCompanyTranslationSettings,
  rejectManagedNotebookAiUpdate,
  rejectManagedTranslationUpdate
} from './routes/companySettings.js'

const app = express()
const port = Number(process.env.PORT || 4010)
const jsonBodyLimit = String(process.env.JSON_BODY_LIMIT || '20mb').trim() || '20mb'

const envCorsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean)
const defaultCorsOrigins = [
  'http://localhost:8080',
  'http://localhost:5173',
  'https://chat.gotradetalk.com'
]
const corsOrigins = envCorsOrigins.length
  ? Array.from(new Set([...envCorsOrigins, ...defaultCorsOrigins]))
  : defaultCorsOrigins

function isAllowedCorsOrigin(origin: string) {
  if (corsOrigins.includes('*')) return true
  if (corsOrigins.includes(origin)) return true
  if (/^https:\/\/[a-z0-9-]+\.gotradetalk-ui\.pages\.dev$/i.test(origin)) return true
  return false
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (isAllowedCorsOrigin(origin)) return callback(null, true)
    return callback(new Error('Not allowed by CORS'))
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-HS-URL', 'X-Matrix-User-Id', 'X-Matrix-Access-Token'],
  optionsSuccessStatus: 204,
  credentials: true
}))
app.use(express.json({ limit: jsonBodyLimit }))
app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit }))

app.get('/health', (_req, res) => res.json({ ok: true }))
app.get('/version', (_req, res) => res.json({ ok: true, version: process.env.GIT_SHA || 'local', time: new Date().toISOString() }))

app.get('/me/capabilities', requireHubUser, getMeCapabilities)

app.get('/company/settings/notebook-ai', requireHubUser, getCompanyNotebookAiSettings)
app.put('/company/settings/notebook-ai', requireHubUser, rejectManagedNotebookAiUpdate)
app.get('/company/settings/translation', requireHubUser, getCompanyTranslationSettings)
app.put('/company/settings/translation', requireHubUser, rejectManagedTranslationUpdate)

app.get('/notebook/items', requireHubUser, listNotebookItems)
app.post('/notebook/items', requireHubUser, createNotebookItem)
app.post('/notebook/company/items', requireHubUser, createCompanyNotebookItem)
app.patch('/notebook/items/:id', requireHubUser, updateNotebookItem)
app.patch('/notebook/company/items/:id', requireHubUser, updateCompanyNotebookItem)
app.delete('/notebook/items/:id', requireHubUser, deleteNotebookItem)
app.delete('/notebook/company/items/:id', requireHubUser, deleteCompanyNotebookItem)
app.post('/notebook/items/:id/files', requireHubUser, attachNotebookFile)
app.get('/notebook/items/:id/files', requireHubUser, listNotebookItemFiles)
app.delete('/notebook/items/:id/files/:fileId', requireHubUser, deleteNotebookItemFile)
app.get('/notebook/items/:id/index-status', requireHubUser, getNotebookIndexStatus)
app.post('/notebook/items/:id/reindex', requireHubUser, reindexNotebookItem)
app.get('/notebook/items/:id/parsed-preview', requireHubUser, getNotebookItemParsedPreview)
app.get('/notebook/items/:id/chunks', requireHubUser, getNotebookItemChunks)
app.post('/notebook/index/jobs/:id/retry', requireHubUser, retryNotebookIndexJob)

app.post('/chat/assist/query', requireHubUser, assistQuery)
app.post('/chat/assist/from-context', requireHubUser, assistFromContext)

app.post('/notebook/sync/push', requireHubUser, syncPush)
app.get('/notebook/sync/pull', requireHubUser, syncPull)

app.get('/internal/company/settings/notebook-ai', getInternalNotebookAiSettings)
app.put('/internal/company/settings/notebook-ai', upsertInternalNotebookAiSettings)
app.get('/internal/company/knowledge/items', listInternalCompanyKnowledgeItems)
app.post('/internal/company/knowledge/items', createInternalCompanyKnowledgeItem)
app.delete('/internal/company/knowledge/items/:id', deleteInternalCompanyKnowledgeItem)
app.post('/internal/company/knowledge/items/:id/offline', offlineInternalCompanyKnowledgeItem)
app.post('/internal/company/knowledge/items/:id/retry-index', retryInternalCompanyKnowledgeIndex)

app.listen(port, () => {
  console.log(`Notebook backend listening on :${port}`)
})
