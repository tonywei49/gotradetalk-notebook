import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
function parseArgs(argv) {
    const map = new Map();
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--'))
            continue;
        const key = arg.slice(2);
        const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
        map.set(key, value);
        if (value !== 'true')
            i += 1;
    }
    return map;
}
function pct(value) {
    return `${(value * 100).toFixed(2)}%`;
}
function diffPct(current, baseline) {
    const delta = (current - baseline) * 100;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(2)}pp`;
}
function diffMs(current, baseline) {
    const delta = current - baseline;
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(2)} ms`;
}
async function readReport(path) {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw);
}
async function main() {
    const args = parseArgs(process.argv);
    const baselinePath = String(args.get('baseline') || '').trim();
    const currentPath = String(args.get('current') || '').trim();
    const outPath = String(args.get('out') || '').trim();
    if (!baselinePath)
        throw new Error('Missing --baseline <path>');
    if (!currentPath)
        throw new Error('Missing --current <path>');
    const baseline = await readReport(baselinePath);
    const current = await readReport(currentPath);
    const baselineCases = new Map(baseline.cases.map((c) => [c.name, c]));
    const currentCases = new Map(current.cases.map((c) => [c.name, c]));
    const caseNames = Array.from(new Set([...baselineCases.keys(), ...currentCases.keys()])).sort();
    const regressions = [];
    const improvements = [];
    for (const name of caseNames) {
        const b = baselineCases.get(name);
        const c = currentCases.get(name);
        if (!b || !c)
            continue;
        const bRank = b.hit1 ? 1 : b.hit3 ? 3 : b.hit5 ? 5 : 999;
        const cRank = c.hit1 ? 1 : c.hit3 ? 3 : c.hit5 ? 5 : 999;
        if (cRank > bRank)
            regressions.push(name);
        if (cRank < bRank)
            improvements.push(name);
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
    ];
    const markdown = lines.join('\n');
    console.log(markdown);
    if (outPath) {
        await writeFile(outPath, markdown, 'utf8');
        console.log(`\n[RAG-EVAL-COMPARE] markdown report saved: ${outPath}`);
    }
}
main().catch((error) => {
    console.error('[RAG-EVAL-COMPARE] FAIL', error?.message || error);
    process.exit(1);
});
