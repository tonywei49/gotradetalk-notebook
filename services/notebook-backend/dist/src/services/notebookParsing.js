import { Readable } from 'stream';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { parse as parseCsv } from 'csv-parse/sync';
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
export async function fetchMatrixMediaBuffer(matrixBaseUrl, accessToken, mxc) {
    const normalized = mxc.replace('mxc://', '');
    const [serverName, mediaId] = normalized.split('/');
    if (!serverName || !mediaId) {
        throw new Error('INVALID_MXC');
    }
    const url = new URL(`/_matrix/media/v3/download/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}`, matrixBaseUrl);
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => '');
        throw new Error(`MEDIA_DOWNLOAD_FAILED: ${resp.status} ${text}`);
    }
    return streamToBuffer(Readable.fromWeb(resp.body));
}
export async function parseDocument(buffer, matrixMediaMime, matrixMediaName) {
    const type = normalizeMime(matrixMediaMime, matrixMediaName);
    if (type === 'txt' || type === 'md') {
        return { text: buffer.toString('utf8'), sourceType: type };
    }
    if (type === 'pdf') {
        const parser = new PDFParse({ data: buffer });
        const data = await parser.getText();
        await parser.destroy();
        return { text: data.text || '', sourceType: 'pdf' };
    }
    if (type === 'docx') {
        const data = await mammoth.extractRawText({ buffer });
        return { text: data.value || '', sourceType: 'docx' };
    }
    if (type === 'csv') {
        const rows = parseCsv(buffer.toString('utf8'), { skip_empty_lines: true });
        const text = rows.map((row, idx) => `row ${idx + 1}: ${row.join(' | ')}`).join('\n');
        return { text, sourceType: 'csv', sourceLocator: 'row:1-' + rows.length };
    }
    if (type === 'xlsx') {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const lines = [];
        let firstLocator = '';
        workbook.SheetNames.forEach((sheetName) => {
            const ws = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
            json.forEach((row, index) => {
                const line = `sheet:${sheetName} row:${index + 1} ${row.map((v) => String(v ?? '')).join(' | ')}`;
                lines.push(line);
            });
            if (!firstLocator && json.length > 0) {
                firstLocator = `${sheetName}:R1-R${json.length}`;
            }
        });
        return {
            text: lines.join('\n'),
            sourceType: 'xlsx',
            sourceLocator: firstLocator || undefined
        };
    }
    throw new Error('UNSUPPORTED_FILE_TYPE');
}
