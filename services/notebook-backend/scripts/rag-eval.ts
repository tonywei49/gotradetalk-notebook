import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import { hybridSearchNotebook } from '../src/services/notebookIndexing.js'

type EvalCase = {
  name?: string
  query: string
  expected_item_id: string
}

type CaseResult = {
  name: string
  query: string
  expected_item_id: string
  hit1: boolean
  hit3: boolean
  hit5: boolean
  top_item_ids: string[]
  latency_ms: number
}

type EvalSummary = {
  total: number
  hit1_count: number
  hit3_count: number
  hit5_count: number
  hit1_rate: number
  hit3_rate: number
  hit5_rate: number
  latency_avg_ms: number
  latency_p95_ms: number
}

type EvalReport = {
  meta: {
    generated_at: string
    cases_path: string
    company_id: string
    owner_user_id: string
    top_k: number
  }
  summary: EvalSummary
  cases: CaseResult[]
}

function parseArgs(argv: string[]) {
  const map = new Map<string, string>()
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true'
    map.set(key, value)
    if (value !== 'true') i += 1
  }
  return map
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function formatPct(numerator: number, denominator: number) {
  if (denominator <= 0) return '0.00%'
  return `${((numerator / denominator) * 100).toFixed(2)}%`
}

async function main() {
  const args = parseArgs(process.argv)
  const casesPath = String(args.get('cases') || '').trim()
  const companyId = String(args.get('company') || process.env.RAG_EVAL_COMPANY_ID || '').trim()
  const ownerUserId = String(args.get('owner') || process.env.RAG_EVAL_OWNER_USER_ID || '').trim()
  const topK = Math.max(1, Number(args.get('topk') || process.env.RAG_EVAL_TOP_K || 5))
  const outPath = String(args.get('out') || '').trim()

  if (!casesPath) {
    throw new Error('Missing --cases <path>')
  }
  if (!companyId) {
    throw new Error('Missing --company or RAG_EVAL_COMPANY_ID')
  }
  if (!ownerUserId) {
    throw new Error('Missing --owner or RAG_EVAL_OWNER_USER_ID')
  }

  const raw = await readFile(casesPath, 'utf8')
  const cases = JSON.parse(raw) as EvalCase[]
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('Cases file must be a non-empty JSON array')
  }

  const results: CaseResult[] = []

  for (let i = 0; i < cases.length; i += 1) {
    const c = cases[i]
    if (!c?.query || !c?.expected_item_id) {
      throw new Error(`Invalid case at index ${i}`)
    }

    const start = Date.now()
    const rows = await hybridSearchNotebook({
      companyId,
      ownerUserId,
      scope: 'personal',
      query: c.query,
      topK
    })
    const latency = Date.now() - start

    const topIds = rows.slice(0, Math.max(topK, 5)).map((r) => String(r.item_id))
    const expected = String(c.expected_item_id)

    results.push({
      name: c.name || `case_${i + 1}`,
      query: c.query,
      expected_item_id: expected,
      hit1: topIds[0] === expected,
      hit3: topIds.slice(0, 3).includes(expected),
      hit5: topIds.slice(0, 5).includes(expected),
      top_item_ids: topIds,
      latency_ms: latency
    })
  }

  const total = results.length
  const hit1Count = results.filter((r) => r.hit1).length
  const hit3Count = results.filter((r) => r.hit3).length
  const hit5Count = results.filter((r) => r.hit5).length
  const latencies = results.map((r) => r.latency_ms)
  const latencyAvg = latencies.reduce((a, b) => a + b, 0) / Math.max(1, total)
  const latencyP95 = percentile(latencies, 95)

  const summary: EvalSummary = {
    total,
    hit1_count: hit1Count,
    hit3_count: hit3Count,
    hit5_count: hit5Count,
    hit1_rate: total > 0 ? hit1Count / total : 0,
    hit3_rate: total > 0 ? hit3Count / total : 0,
    hit5_rate: total > 0 ? hit5Count / total : 0,
    latency_avg_ms: latencyAvg,
    latency_p95_ms: latencyP95
  }

  const report: EvalReport = {
    meta: {
      generated_at: new Date().toISOString(),
      cases_path: casesPath,
      company_id: companyId,
      owner_user_id: ownerUserId,
      top_k: topK
    },
    summary,
    cases: results
  }

  console.log('\n[RAG-EVAL] Summary')
  console.log(`cases: ${total}`)
  console.log(`Hit@1: ${hit1Count}/${total} (${formatPct(hit1Count, total)})`)
  console.log(`Hit@3: ${hit3Count}/${total} (${formatPct(hit3Count, total)})`)
  console.log(`Hit@5: ${hit5Count}/${total} (${formatPct(hit5Count, total)})`)
  console.log(`latency avg: ${latencyAvg.toFixed(2)} ms`)
  console.log(`latency p95: ${latencyP95.toFixed(2)} ms`)

  console.log('\n[RAG-EVAL] Details')
  for (const r of results) {
    const status = r.hit1 ? 'HIT@1' : r.hit3 ? 'HIT@3' : r.hit5 ? 'HIT@5' : 'MISS'
    console.log(`- ${r.name} | ${status} | ${r.latency_ms}ms | expected=${r.expected_item_id} | top=${r.top_item_ids.slice(0, 5).join(',')}`)
  }

  if (outPath) {
    await writeFile(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(`\n[RAG-EVAL] JSON report saved: ${outPath}`)
  }

  const failureCount = total - hit5Count
  if (failureCount > 0) {
    process.exitCode = 2
  }
}

main().catch((error: any) => {
  console.error('[RAG-EVAL] FAIL', error?.message || error)
  process.exit(1)
})
