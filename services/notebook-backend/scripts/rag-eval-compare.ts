import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'

type EvalCaseResult = {
  name: string
  query: string
  expected_item_id: string
  hit1: boolean
  hit3: boolean
  hit5: boolean
  top_item_ids: string[]
  latency_ms: number
}

type EvalReport = {
  meta: {
    generated_at: string
    cases_path: string
    company_id: string
    owner_user_id: string
    top_k: number
  }
  summary: {
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
  cases: EvalCaseResult[]
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

function pct(value: number) {
  return `${(value * 100).toFixed(2)}%`
}

function diffPct(current: number, baseline: number) {
  const delta = (current - baseline) * 100
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(2)}pp`
}

function diffMs(current: number, baseline: number) {
  const delta = current - baseline
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(2)} ms`
}

async function readReport(path: string) {
  const raw = await readFile(path, 'utf8')
  return JSON.parse(raw) as EvalReport
}

async function main() {
  const args = parseArgs(process.argv)
  const baselinePath = String(args.get('baseline') || '').trim()
  const currentPath = String(args.get('current') || '').trim()
  const outPath = String(args.get('out') || '').trim()

  if (!baselinePath) throw new Error('Missing --baseline <path>')
  if (!currentPath) throw new Error('Missing --current <path>')

  const baseline = await readReport(baselinePath)
  const current = await readReport(currentPath)

  const baselineCases = new Map(baseline.cases.map((c) => [c.name, c]))
  const currentCases = new Map(current.cases.map((c) => [c.name, c]))
  const caseNames = Array.from(new Set([...baselineCases.keys(), ...currentCases.keys()])).sort()

  const regressions: string[] = []
  const improvements: string[] = []

  for (const name of caseNames) {
    const b = baselineCases.get(name)
    const c = currentCases.get(name)
    if (!b || !c) continue

    const bRank = b.hit1 ? 1 : b.hit3 ? 3 : b.hit5 ? 5 : 999
    const cRank = c.hit1 ? 1 : c.hit3 ? 3 : c.hit5 ? 5 : 999

    if (cRank > bRank) regressions.push(name)
    if (cRank < bRank) improvements.push(name)
  }

  const lines = [
    '# RAG Evaluation Comparison Report',
    '',
    '## Inputs',
    `- Baseline: \`${baselinePath}\``,
    `- Current: \`${currentPath}\``,
    '',
    '## Summary Delta',
    `- Hit@1: ${pct(current.summary.hit1_rate)} (${diffPct(current.summary.hit1_rate, baseline.summary.hit1_rate)})`,
    `- Hit@3: ${pct(current.summary.hit3_rate)} (${diffPct(current.summary.hit3_rate, baseline.summary.hit3_rate)})`,
    `- Hit@5: ${pct(current.summary.hit5_rate)} (${diffPct(current.summary.hit5_rate, baseline.summary.hit5_rate)})`,
    `- Latency avg: ${current.summary.latency_avg_ms.toFixed(2)} ms (${diffMs(current.summary.latency_avg_ms, baseline.summary.latency_avg_ms)})`,
    `- Latency p95: ${current.summary.latency_p95_ms.toFixed(2)} ms (${diffMs(current.summary.latency_p95_ms, baseline.summary.latency_p95_ms)})`,
    '',
    '## Case Changes',
    `- Improved cases: ${improvements.length} ${improvements.length ? `(${improvements.join(', ')})` : ''}`,
    `- Regressed cases: ${regressions.length} ${regressions.length ? `(${regressions.join(', ')})` : ''}`,
    '',
    '## Gate (Suggested)',
    `- Regressed cases <= 0: ${regressions.length <= 0 ? 'PASS' : 'FAIL'}`,
    `- Hit@3 delta >= 0pp: ${(current.summary.hit3_rate - baseline.summary.hit3_rate) >= 0 ? 'PASS' : 'FAIL'}`,
    `- Latency p95 delta <= +30%: ${current.summary.latency_p95_ms <= baseline.summary.latency_p95_ms * 1.3 ? 'PASS' : 'FAIL'}`,
    ''
  ]

  const markdown = lines.join('\n')
  console.log(markdown)

  if (outPath) {
    await writeFile(outPath, markdown, 'utf8')
    console.log(`\n[RAG-EVAL-COMPARE] markdown report saved: ${outPath}`)
  }
}

main().catch((error: any) => {
  console.error('[RAG-EVAL-COMPARE] FAIL', error?.message || error)
  process.exit(1)
})
