import ExcelJS from 'exceljs';
import { csvEscape } from './validate.js';

export function toCsv(columns, rows) {
  const head = columns.map((c) => csvEscape(c.label ?? c.key)).join(',');
  const body = rows.map((row) => columns.map((c) => csvEscape(formatCell(row, c))).join(',')).join('\r\n');
  return `\uFEFF${head}\r\n${body}`;
}

function formatCell(row, col) {
  const raw = typeof col.value === 'function' ? col.value(row) : row[col.key];
  if (raw == null) return '';
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return raw;
}

export function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(columns, rows));
}

export async function sendXlsx(res, filename, columns, rows, { sheetName = 'Report', title = null, meta = [] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'School ERP';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 30), { views: [{ state: 'frozen', ySplit: title ? 4 : 1 }] });

  let headerRowIndex = 1;
  if (title) {
    ws.mergeCells(1, 1, 1, Math.max(columns.length, 2));
    const t = ws.getCell(1, 1);
    t.value = title;
    t.font = { bold: true, size: 14 };
    t.alignment = { horizontal: 'left' };
    headerRowIndex += 1;
    if (meta.length) {
      ws.mergeCells(2, 1, 2, Math.max(columns.length, 2));
      const m = ws.getCell(2, 1);
      m.value = meta.join('  •  ');
      m.font = { size: 9, color: { argb: 'FF666666' } };
      headerRowIndex += 1;
    }
    headerRowIndex += 1; // spacer row
  }

  ws.getRow(headerRowIndex).values = columns.map((c) => c.label ?? c.key);
  const headerRow = ws.getRow(headerRowIndex);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3B73' } };
    cell.alignment = { vertical: 'middle' };
  });

  rows.forEach((row) => {
    ws.addRow(columns.map((c) => {
      const v = typeof c.value === 'function' ? c.value(row) : row[c.key];
      if (v == null) return '';
      if (typeof v === 'number') return v;
      return String(v);
    }));
  });

  columns.forEach((c, idx) => {
    const width = Math.max(
      String(c.label ?? c.key).length + 2,
      ...rows.slice(0, 200).map((r) => String((typeof c.value === 'function' ? c.value(r) : r[c.key]) ?? '').length + 2),
    );
    ws.getColumn(idx + 1).width = Math.min(Math.max(width, 10), 46);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const buffer = await wb.xlsx.writeBuffer();
  res.send(Buffer.from(buffer));
}

/** Choose CSV/XLSX/JSON based on ?format= */
export async function sendTable(req, res, { filename, columns, rows, meta = [], title = null }) {
  const format = String(req.query.format || 'csv').toLowerCase();
  if (format === 'xlsx' || format === 'excel') {
    return sendXlsx(res, `${filename}.xlsx`, columns, rows, { title: title || filename, meta });
  }
  if (format === 'json') {
    return res.json({ rows, total: rows.length });
  }
  return sendCsv(res, `${filename}.csv`, columns, rows);
}
