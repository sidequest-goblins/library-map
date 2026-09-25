import fs from 'node:fs/promises';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const [input, output, previews] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: build_archive_workbook.mjs scan.json ARCHIVE.xlsx [preview-directory]');
try { await fs.access(output); throw new Error('Output already exists. Choose a new output path to preserve manual archive edits.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const data = JSON.parse(await fs.readFile(input, 'utf8'));
const wb = Workbook.create();
const sourceIds = new Map(data.sources.map((s, i) => [s.source, `S${String(i + 1).padStart(3, '0')}`]));
const asText = value => typeof value === 'string' && value.startsWith('=') ? `'${value}` : value;
const cell = value => {
  if (typeof value === 'string' && /^#(REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.test(value)) return `Source error: ${value}`;
  return asText(value ?? null);
};
const column = index => { let s = ''; for (index++; index; index = Math.floor((index - 1) / 26)) s = String.fromCharCode(65 + (index - 1) % 26) + s; return s; };
const fields = ['Title', 'First', 'Last', ...data.headers.filter(h => !['Title', 'First', 'Last'].includes(h))];
const mainHeaders = ['Title', 'First', 'Last', 'Review decision', 'Review notes', ...fields.slice(3),
  'Scan finding', 'Possible current books', 'First seen in sources', 'Last seen in sources',
  'Preferred source', 'Source sheet', 'Source row', 'Recovery key'];
function mainRow(record) {
  return [record.values.Title, record.values.First, record.values.Last, 'Not reviewed', null,
    ...fields.slice(3).map(h => record.values[h]), record.status, record.possible,
    record.firstSeen.slice(0, 10), record.lastSeen.slice(0, 10),
    sourceIds.get(record.preferred.source), record.preferred.sheet, record.preferred.row, record.key];
}
function sheet(name, title, note, headers, rows, tableName, editable = false) {
  const s = wb.worksheets.add(name);
  s.showGridLines = false;
  const lastCol = column(headers.length - 1);
  const end = 6 + rows.length;
  const range = s.getRange(`A1:${lastCol}${Math.max(end, 7)}`);
  range.format.font = { name: 'Arial', size: 10, color: '#24252B' };
  range.format.rowHeight = 25;
  range.format.columnWidth = 18;
  range.format.verticalAlignment = 'center';
  s.getRange('A2:D2').merge();
  s.getRange('A2').values = [[title]];
  s.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: '#39314E' };
  s.getRange('A3:E3').merge();
  s.getRange('A3').values = [[note]];
  s.getRange('A3:E3').format.wrapText = true;
  s.getRange('A3:E3').format.rowHeight = 32;
  s.getRange('A4:D4').merge();
  s.getRange('A4').values = [[`${rows.length} records | Scanned ${data.generatedAt.slice(0, 10)}`]];
  s.getRange(`A6:${lastCol}6`).values = [headers];
  if (rows.length) s.getRange(`A7:${lastCol}${end}`).values = rows.map(r => r.map((v, i) => {
    if (/seen in sources|Snapshot date|Offload Date/.test(headers[i]) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00Z`);
    return cell(v);
  }));
  const table = s.tables.add(`A6:${lastCol}${Math.max(end, 7)}`, true, tableName);
  table.style = 'TableStyleLight1';
  table.showFilterButton = true;
  s.getRange(`A6:${lastCol}6`).format = { fill: '#493F5A', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, wrapText: true, rowHeight: 34 };
  s.getRange(`A7:${lastCol}${Math.max(end, 7)}`).format.wrapText = true;
  const widths = [];
  headers.forEach((h, i) => {
    const col = column(i);
    const width = h === 'Title' ? 60 : ['First', 'Last'].includes(h) ? 21
      : /notes|Possible current|Source path|Source references/i.test(h) ? 55
      : /Book ID|Recovery key|SHA256/.test(h) ? 49
      : h === 'SYSTEM COLUMNS - AUTOMATION ONLY' ? 26
      : ['CJ', 'JC', 'BIPOC', 'LGBTQ+', 'Year', 'Pages', 'Position', 'Source row'].includes(h) ? 10 : 22;
    s.getRange(`${col}6:${col}${Math.max(end, 7)}`).format.columnWidth = width;
    widths.push(width);
    if (h === 'ISBN' || h === 'Book ID' || h === 'Recovery key') s.getRange(`${col}7:${col}${Math.max(end, 7)}`).setNumberFormat('@');
    if (/seen in sources|Snapshot date|Offload Date/.test(h)) s.getRange(`${col}7:${col}${Math.max(end, 7)}`).setNumberFormat('yyyy-mm-dd');
  });
  if (editable && rows.length) {
    s.getRange(`D7:E${end}`).format.fill = '#F1EAF8';
    s.getRange(`D7:D${end}`).dataValidation = { rule: { type: 'list', values: ['Not reviewed', 'Confirmed removed', 'Still owned', 'Duplicate / correction', 'Unsure'] } };
  }
  if (rows.length) {
    const heights = rows.map((r, i) => {
      const lines = r.map((v, c) => String(v ?? '').split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (widths[c] * 0.85))), 0));
      return [i + 7, Math.max(30, Math.max(...lines) * 14 + 10)];
    });
    for (const [row, height] of heights) s.getRange(`A${row}:${lastCol}${row}`).format.rowHeight = Math.min(400, height);
  }
  s.freezePanes.freezeRows(6);
  s.freezePanes.freezeColumns(1);
  return s;
}

const missing = data.records.filter(r => r.status === 'Missing from current list');
const uncertain = data.records.filter(r => r.status !== 'Missing from current list');
sheet('Archive', 'Books missing from the current List View',
  'Last-known List View values. Missing does not confirm offloaded. Use the shaded review columns; scroll right for all original fields.',
  mainHeaders, missing.map(mainRow), 'ArchiveRecords', true);
sheet('Review', 'Historical records needing an identity check',
  'These may be current books with changed IDs, names, or editions. They are kept separate from removed-book candidates.',
  mainHeaders, uncertain.map(mainRow), 'ReviewRecords', true);

const history = [];
for (const record of data.records) {
  const variants = new Map();
  for (const version of record.versions) {
    const key = JSON.stringify(Object.entries(version.values).sort(([a], [b]) => a.localeCompare(b)));
    if (!variants.has(key)) variants.set(key, { values: version.values, refs: [], first: version.date, last: version.date });
    const variant = variants.get(key);
    variant.refs.push(`${sourceIds.get(version.source)}/${version.row}`);
    if (version.date < variant.first) variant.first = version.date;
    if (version.date > variant.last) variant.last = version.date;
  }
  for (const variant of variants.values()) history.push([
    ...fields.map(h => variant.values[h]), record.key, variant.first.slice(0, 10), variant.last.slice(0, 10), variant.refs.join('; '),
  ]);
}
sheet('History', 'Historical row versions',
  'Distinct saved values. Source references use source ID / row number. Formulas are frozen; saved errors are labeled as source errors.',
  [...fields, 'Recovery key', 'First seen in sources', 'Last seen in sources', 'Source references'], history, 'HistoricalRows');
sheet('Sources', 'Files and saved versions included in the scan',
  `${data.currentCount} current books compared with ${data.historyRowsRead} historical rows. Dates describe snapshots, not offload dates. No cover files copied.`,
  ['Source ID', 'Source kind', 'Snapshot date', 'Rows read', 'Source path', 'SHA256'],
  data.sources.map(s => [sourceIds.get(s.source), s.kind, s.date.slice(0, 10), s.rows, s.source, s.sha256]), 'ArchiveSources');
wb.worksheets.getItem('Sources').getRange('A6:A100').format.columnWidth = 12;
wb.worksheets.getItem('Sources').getRange('E6:E100').format.columnWidth = 100;
wb.recalculate();
await fs.mkdir(path.dirname(output), { recursive: true });
const exported = await SpreadsheetFile.exportXlsx(wb);
await exported.save(output);
// Keep the exporter's diagnostic sidecar with scan working files, not the workbook.
try {
  const sidecar = output + '.inspect.ndjson';
  await fs.copyFile(sidecar, path.join(path.dirname(input), 'export.inspect.ndjson'));
  await fs.unlink(sidecar);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previews) {
  await fs.mkdir(previews, { recursive: true });
  for (const name of ['Archive', 'Review', 'History', 'Sources']) {
    const png = await wb.render({ sheetName: name, range: name === 'Sources' ? 'A1:E12' : 'A1:E13', scale: 1.3, format: 'png' });
    await fs.writeFile(path.join(previews, `${name}.png`), new Uint8Array(await png.arrayBuffer()));
  }
}
console.log(JSON.stringify({ output, missing: missing.length, review: uncertain.length, historicalVariants: history.length, sources: data.sources.length }));
