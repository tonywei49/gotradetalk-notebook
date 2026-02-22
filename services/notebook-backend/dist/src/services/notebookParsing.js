import { Readable } from 'stream';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { parse as parseCsv } from 'csv-parse/sync';
function escapeMarkdownCell(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}
function rowsToMarkdownTable(rows) {
    if (rows.length === 0)
        return '';
    const width = Math.max(...rows.map((row) => row.length), 1);
    const headerRow = (rows[0] || []).map((v, idx) => escapeMarkdownCell(v) || `col_${idx + 1}`);
    while (headerRow.length < width)
        headerRow.push(`col_${headerRow.length + 1}`);
    const divider = new Array(width).fill('---');
    const bodyRows = rows.slice(1).map((row) => {
        const cells = row.map((v) => escapeMarkdownCell(v));
        while (cells.length < width)
            cells.push('');
        return cells;
    });
    const lines = [
        `| ${headerRow.join(' | ')} |`,
        `| ${divider.join(' | ')} |`,
        ...bodyRows.map((row) => `| ${row.join(' | ')} |`)
    ];
    return lines.join('\n');
}
function normalizeExtractedText(text) {
    return text
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function splitPdfPages(rawText) {
    const normalized = rawText.replace(/\r\n/g, '\n');
    const pages = normalized.split(/\f+/g).map((page) => page.trim()).filter(Boolean);
    return pages.length > 0 ? pages : [normalized.trim()].filter(Boolean);
}
function looksLikePageNumberLine(line) {
    const value = line.trim().toLowerCase();
    if (!value)
        return false;
    if (/^page\s+\d+(\s*\/\s*\d+)?$/.test(value))
        return true;
    if (/^page\s+\d+\s+of\s+\d+$/.test(value))
        return true;
    if (/^\d+\s*\/\s*\d+$/.test(value))
        return true;
    if (/^-?\s*\d+\s*-?$/.test(value))
        return true;
    return false;
}
function removeRepeatedPdfHeaderFooter(pages) {
    if (pages.length < 2)
        return pages;
    const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
    const topCounts = new Map();
    const bottomCounts = new Map();
    const pageLines = pages.map((page) => page.split('\n').map((line) => line.trim()).filter(Boolean));
    for (const lines of pageLines) {
        const topUnique = new Set(lines.slice(0, 3));
        const bottomUnique = new Set(lines.slice(-3));
        for (const line of topUnique)
            topCounts.set(line, (topCounts.get(line) || 0) + 1);
        for (const line of bottomUnique)
            bottomCounts.set(line, (bottomCounts.get(line) || 0) + 1);
    }
    const repeatedTop = new Set(Array.from(topCounts.entries())
        .filter(([line, count]) => count >= threshold && line.length <= 120)
        .map(([line]) => line));
    const repeatedBottom = new Set(Array.from(bottomCounts.entries())
        .filter(([line, count]) => count >= threshold && line.length <= 120)
        .map(([line]) => line));
    return pageLines.map((lines) => {
        const startWindow = new Set(lines.slice(0, 3));
        const endWindow = new Set(lines.slice(-3));
        return lines
            .filter((line) => !looksLikePageNumberLine(line))
            .filter((line) => !(startWindow.has(line) && repeatedTop.has(line)))
            .filter((line) => !(endWindow.has(line) && repeatedBottom.has(line)))
            .join('\n')
            .trim();
    }).filter(Boolean);
}
function formatPdfAsMarkdown(pages) {
    return pages
        .map((pageText, index) => `## Page ${index + 1}\n\n${pageText}`)
        .join('\n\n');
}
export const __notebookParsingTestables = {
    splitPdfPages,
    removeRepeatedPdfHeaderFooter,
    looksLikePageNumberLine
};
function normalizeMime(mime, fileName) {
    const m = String(mime || '').toLowerCase();
    const name = String(fileName || '').toLowerCase();
    if (m.includes('pdf') || name.endsWith('.pdf'))
        return 'pdf';
    if (m.includes('word') || name.endsWith('.docx'))
        return 'docx';
    if (m.includes('csv') || name.endsWith('.csv'))
        return 'csv';
    if (m.includes('sheet') || name.endsWith('.xlsx'))
        return 'xlsx';
    if (m.includes('markdown') || name.endsWith('.md'))
        return 'md';
    if (m.includes('text/plain') || name.endsWith('.txt'))
        return 'txt';
    return 'unsupported';
}
async function streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}
async function readResponseBodySafe(resp) {
    try {
        return await resp.text();
    }
    catch {
        return '';
    }
}
async function fetchDownload(matrixBaseUrl, path, accessToken, asQueryToken = false) {
    const url = new URL(path, matrixBaseUrl);
    const headers = {};
    if (accessToken && !asQueryToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }
    if (accessToken && asQueryToken) {
        url.searchParams.set('access_token', accessToken);
    }
    return fetch(url, { headers });
}
export async function fetchMatrixMediaBuffer(matrixBaseUrl, accessToken, mxc) {
    const normalized = mxc.replace('mxc://', '');
    const [serverName, mediaId] = normalized.split('/');
    if (!serverName || !mediaId) {
        throw new Error('INVALID_MXC');
    }
    const encodedServer = encodeURIComponent(serverName);
    const encodedMedia = encodeURIComponent(mediaId);
    const candidatePaths = [
        `/_matrix/media/v3/download/${encodedServer}/${encodedMedia}`,
        `/_matrix/client/v1/media/download/${encodedServer}/${encodedMedia}`,
        `/_matrix/media/r0/download/${encodedServer}/${encodedMedia}`
    ];
    let lastStatus = 0;
    let lastBody = '';
    const attempts = [];
    if (accessToken) {
        attempts.push({ token: accessToken, asQuery: false });
        attempts.push({ token: accessToken, asQuery: true });
    }
    attempts.push({ token: undefined, asQuery: false });
    for (const attempt of attempts) {
        for (const path of candidatePaths) {
            const resp = await fetchDownload(matrixBaseUrl, path, attempt.token, Boolean(attempt.asQuery));
            if (resp.ok && resp.body) {
                return streamToBuffer(Readable.fromWeb(resp.body));
            }
            lastStatus = resp.status;
            lastBody = await readResponseBodySafe(resp);
        }
    }
    const hint = accessToken
        ? ' (check NOTEBOOK_INDEX_MATRIX_ACCESS_TOKEN and NOTEBOOK_INDEX_MATRIX_HS_URL)'
        : ' (missing NOTEBOOK_INDEX_MATRIX_ACCESS_TOKEN)';
    throw new Error(`MEDIA_DOWNLOAD_FAILED: ${lastStatus} ${lastBody}${hint}`);
}
export async function parseDocument(buffer, matrixMediaMime, matrixMediaName) {
    const type = normalizeMime(matrixMediaMime, matrixMediaName);
    if (type === 'txt' || type === 'md') {
        return { text: normalizeExtractedText(buffer.toString('utf8')), sourceType: type };
    }
    if (type === 'pdf') {
        const parser = new PDFParse({ data: buffer });
        const data = await parser.getText();
        await parser.destroy();
        const pages = splitPdfPages(String(data.text || ''));
        const cleanedPages = removeRepeatedPdfHeaderFooter(pages);
        const text = normalizeExtractedText(formatPdfAsMarkdown(cleanedPages.length > 0 ? cleanedPages : pages));
        return {
            text,
            sourceType: 'pdf',
            sourceLocator: `page:1-${Math.max(cleanedPages.length, pages.length, 1)}`
        };
    }
    if (type === 'docx') {
        let markdownValue = '';
        const convertToMarkdown = mammoth.convertToMarkdown;
        if (typeof convertToMarkdown === 'function') {
            const markdown = await convertToMarkdown({ buffer }).catch(() => ({ value: '' }));
            markdownValue = String(markdown?.value || '');
        }
        if (markdownValue.trim()) {
            return { text: normalizeExtractedText(markdownValue), sourceType: 'docx' };
        }
        const data = await mammoth.extractRawText({ buffer });
        return { text: normalizeExtractedText(data.value || ''), sourceType: 'docx' };
    }
    if (type === 'csv') {
        const rows = parseCsv(buffer.toString('utf8'), { skip_empty_lines: true });
        const table = rowsToMarkdownTable(rows);
        const text = normalizeExtractedText([
            '# CSV Document',
            '',
            table || '(empty csv)'
        ].join('\n'));
        return { text, sourceType: 'csv', sourceLocator: 'row:1-' + Math.max(rows.length, 1) };
    }
    if (type === 'xlsx') {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const lines = [];
        let firstLocator = '';
        workbook.SheetNames.forEach((sheetName) => {
            const ws = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
            const table = rowsToMarkdownTable(json);
            lines.push(`## Sheet: ${sheetName}`);
            lines.push('');
            lines.push(table || '(empty sheet)');
            lines.push('');
            if (!firstLocator && json.length > 0) {
                firstLocator = `${sheetName}:R1-R${json.length}`;
            }
        });
        return {
            text: normalizeExtractedText(lines.join('\n')),
            sourceType: 'xlsx',
            sourceLocator: firstLocator || undefined
        };
    }
    throw new Error('UNSUPPORTED_FILE_TYPE');
}
