import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from '../db/index.js';

export const COLORS = {
  ink: '#0F172A',
  muted: '#64748B',
  line: '#E2E8F0',
  accent: '#1F3B73',
  success: '#0F766E',
  danger: '#B42318',
  warn: '#B45309',
};

export const money = (n) => {
  const num = Number(n || 0);
  return `Rs. ${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const moneyShort = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function createDoc({ size = 'A4', layout = 'portrait', margins = { top: 36, bottom: 42, left: 40, right: 40 }, title } = {}) {
  return new PDFDocument({
    size,
    layout,
    margins,
    bufferPages: true,
    info: { Title: title || 'Document', Producer: 'School ERP' },
  });
}

export function streamPdf(res, doc, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"`);
  doc.pipe(res);
  doc.end();
}

function resolveUpload(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith('/uploads/')) return null;
  const rel = url.replace('/uploads/', '').split('?')[0];
  const file = path.join(UPLOAD_DIR, rel);
  if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) return null;
  return file;
}

export function drawLetterhead(doc, school, { title, subtitle, accent = COLORS.accent, compact = false }) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  const top = doc.y;
  const barHeight = compact ? 78 : 96;

  doc.save();
  doc.rect(left, top, width, barHeight).fill(accent);
  doc.restore();

  const logoPath = resolveUpload(school?.logo_url);
  let textLeft = left + 14;
  if (logoPath) {
    try {
      doc.image(logoPath, left + 14, top + 14, { fit: [50, 50] });
      textLeft = left + 76;
    } catch { /* ignore invalid image */ }
  }

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(compact ? 16 : 20)
    .text(String(school?.name || 'School').toUpperCase(), textLeft, top + 16, { width: width - (textLeft - left) - 20 });
  const contact = [school?.address, school?.city, school?.pincode, school?.phone, school?.email].filter(Boolean).join(' | ');
  doc.font('Helvetica').fontSize(7.5).fillColor('#DCE6F7')
    .text(contact, textLeft, top + (compact ? 36 : 42), { width: width - (textLeft - left) - 20 });
  if (school?.affiliation) {
    doc.fontSize(7).fillColor('#C7D6F0').text(school.affiliation, textLeft, top + (compact ? 50 : 56));
  }
  if (title) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
      .text(title.toUpperCase(), left + 14, top + barHeight - 20, { width: width - 28, align: 'right' });
  }

  doc.y = top + barHeight + 10;
  if (subtitle) {
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(subtitle, left, doc.y, { width, align: 'center' });
    doc.moveDown(0.3);
  }
  return doc.y;
}

export function drawSectionTitle(doc, text, { accent = COLORS.accent } = {}) {
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  const y = doc.y;
  doc.rect(left, y, 3, 12).fill(accent);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(9.5).text(text.toUpperCase(), left + 8, y + 1, { width: width - 10 });
  doc.y = y + 18;
  return doc.y;
}

export function drawKeyValues(doc, pairs, { columns = 2, gap = 12, fontSize = 8.5, width = null, x = null, y = null } = {}) {
  const { left, right } = doc.page.margins;
  const avail = width ?? doc.page.width - left - right;
  const startX = x ?? left;
  const startY = y ?? doc.y;
  const colWidth = (avail - gap * (columns - 1)) / columns;
  let rowY = startY;
  pairs.forEach((pair, idx) => {
    const col = idx % columns;
    if (col === 0 && idx > 0) rowY += fontSize + 7;
    const cx = startX + col * (colWidth + gap);
    doc.font('Helvetica').fontSize(fontSize).fillColor(COLORS.muted).text(`${pair[0]}`, cx, rowY, { width: colWidth * 0.48, continued: false });
    doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(COLORS.ink).text(String(pair[1] ?? '—'), cx + colWidth * 0.48, rowY, { width: colWidth * 0.52 });
  });
  const rows = Math.ceil(pairs.length / columns);
  doc.y = startY + rows * (fontSize + 7);
  return doc.y;
}

/**
 * Table renderer with automatic page breaks and repeated headers.
 * columns: [{ label, key?, width (px), align?, value?(row) }]
 */
export function drawTable(doc, { columns, rows, fontSize = 8, headerBg = COLORS.accent, headerColor = '#FFFFFF', zebra = true, padding = 4, borderColor = COLORS.line, emptyText = 'No records' } = {}) {
  const { left, right, bottom } = doc.page.margins;
  const width = doc.page.width - left - right;
  const totalWidth = columns.reduce((s, c) => s + c.width, 0);
  const scale = width / totalWidth;
  const widths = columns.map((c) => c.width * scale);
  const rowHeight = fontSize + padding * 2;

  const drawHead = (yPos) => {
    const headerHeights = columns.map((c, i) => doc.heightOfString(String(c.label), { width: widths[i] - padding * 2 }));
    const headHeight = Math.max(rowHeight, Math.max(...headerHeights) + padding * 2);
    doc.save();
    doc.rect(left, yPos, width, headHeight).fill(headerBg);
    doc.restore();
    let x = left;
    doc.font('Helvetica-Bold').fontSize(fontSize).fillColor(headerColor);
    columns.forEach((c, i) => {
      doc.text(String(c.label), x + padding, yPos + padding, { width: widths[i] - padding * 2, align: c.align || 'left' });
      x += widths[i];
    });
    return yPos + headHeight;
  };

  let y = drawHead(doc.y);
  doc.font('Helvetica').fontSize(fontSize);

  if (!rows.length) {
    doc.fillColor(COLORS.muted).text(emptyText, left + padding, y + padding, { width, align: 'center' });
    doc.y = y + rowHeight;
    return doc.y;
  }

  rows.forEach((row, rIdx) => {
    const values = columns.map((c) => (typeof c.value === 'function' ? c.value(row) : row[c.key]));
    const cellHeights = columns.map((c, i) => doc.heightOfString(String(values[i] ?? ''), { width: widths[i] - padding * 2 }));
    const height = Math.max(rowHeight, Math.max(...cellHeights) + padding * 2);

    if (y + height > doc.page.height - bottom) {
      doc.addPage();
      y = drawHead(doc.page.margins.top);
      doc.font('Helvetica').fontSize(fontSize);
    }
    if (zebra && rIdx % 2 === 1) {
      doc.save();
      doc.rect(left, y, width, height).fill('#F6F8FC');
      doc.restore();
    }
    let x = left;
    columns.forEach((c, i) => {
      const color = c.color ? (typeof c.color === 'function' ? c.color(row) : c.color) : COLORS.ink;
      doc.fillColor(color).font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize)
        .text(String(values[i] ?? ''), x + padding, y + padding, { width: widths[i] - padding * 2, align: c.align || 'left' });
      x += widths[i];
    });
    doc.save();
    doc.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(0.5).strokeColor(borderColor).stroke();
    doc.restore();
    y += height;
  });

  doc.y = y + 8;
  return doc.y;
}

export function finishDoc(doc, { footerText = null } = {}) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const { left, right, bottom } = doc.page.margins;
    const y = doc.page.height - bottom + 12;
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted);
    doc.text(footerText || 'Generated by School ERP', left, y, { width: doc.page.width - left - right, align: 'left' });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, y, {
      width: doc.page.width - left - right, align: 'right',
    });
  }
  doc.flushPages();
  return doc;
}

/* --------------------------------- report card --------------------------------- */

export const DEFAULT_REPORT_TEMPLATE = {
  title: 'REPORT CARD',
  accent: '#1F3B73',
  showPhoto: true,
  showRank: true,
  showAttendance: true,
  showGradeLegend: true,
  showTeacherRemark: true,
  showPrincipalRemark: true,
  showSignature: true,
  showStamp: true,
  showDob: true,
  showFatherName: true,
  showSubjectRemark: true,
  footerNote: 'This is a computer generated report card. Any correction must be authorised by the Principal.',
  principalLabel: 'Principal',
  teacherLabel: 'Class Teacher',
};

export function reportCardPdf({ school, student, result, exam, template = {}, gradeRanges = [], doc: existingDoc = null }) {
  const t = { ...DEFAULT_REPORT_TEMPLATE, ...template };
  const doc = existingDoc || createDoc({ title: `Report Card - ${student.full_name}`, margins: { top: 30, bottom: 46, left: 36, right: 36 } });
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;

  drawLetterhead(doc, school, {
    title: `${t.title}`,
    subtitle: `${exam.name} • Academic Session ${exam.session_name || ''}`,
    accent: t.accent,
  });

  // Student identity block
  const photoPath = t.showPhoto ? resolveUpload(student.photo_url) : null;
  const infoWidth = photoPath ? width - 78 : width;
  const boxTop = doc.y;
  const pairs = [
    ['Student Name', student.full_name],
    ['Admission No.', student.admission_no],
    ['Class / Section', `${student.class_name || ''}${student.section_name ? ` - ${student.section_name}` : ''}`],
    ['Roll Number', student.roll_no || '—'],
  ];
  if (t.showDob) pairs.push(['Date of Birth', student.dob || '—']);
  if (t.showFatherName) pairs.push(['Father / Guardian', student.father_name || student.guardian_name || '—']);

  doc.save();
  doc.roundedRect(left, boxTop, width, photoPath ? 74 : 66, 4).lineWidth(0.8).strokeColor(t.accent).stroke();
  doc.restore();
  drawKeyValues(doc, pairs, { columns: 2, fontSize: 8, width: infoWidth, x: left + 8, y: boxTop + 8 });
  if (photoPath) {
    try {
      doc.image(photoPath, left + width - 66, boxTop + 8, { fit: [56, 56] });
    } catch { /* ignore */ }
    doc.rect(left + width - 66, boxTop + 8, 56, 56).lineWidth(0.6).strokeColor(COLORS.line).stroke();
  }
  doc.y = boxTop + (photoPath ? 82 : 74);

  // Marks table
  const subjects = result.subjects_data || [];
  const columns = [
    { label: '#', width: 22, align: 'center', key: 'idx' },
    { label: 'Subject', width: 190, bold: true },
    { label: 'Max Marks', width: 60, align: 'center' },
    { label: 'Obtained', width: 60, align: 'center', bold: true },
    { label: 'Grade', width: 46, align: 'center' },
    { label: 'Status', width: 58, align: 'center' },
  ];
  if (t.showSubjectRemark) columns.push({ label: 'Remark', width: 78 });

  const rows = subjects.map((s, idx) => ({
    idx: idx + 1,
    subject: s.subject_name,
    max: s.is_exempt ? '—' : s.max_marks,
    obtained: s.is_absent ? 'AB' : s.is_exempt ? 'EX' : s.obtained,
    grade: s.is_absent ? 'AB' : s.grade || '—',
    status: s.is_absent ? 'Absent' : s.is_exempt ? 'Exempt' : s.passed === false ? 'Fail' : 'Pass',
    remark: s.remark || '',
    raw: s,
  }));

  drawSectionTitle(doc, 'Subject-wise Performance', { accent: t.accent });
  drawTable(doc, {
    columns,
    rows,
    fontSize: 8,
    headerBg: t.accent,
    emptyText: 'No marks recorded',
  });

  // Totals row
  const totals = [
    ['Total Marks', `${result.total_obtained} / ${result.total_max}`],
    ['Percentage', `${Number(result.percentage).toFixed(2)}%`],
    ['Overall Grade', result.grade || '—'],
    ['Result', String(result.result_status || '').toUpperCase()],
  ];
  if (t.showRank !== false && result.rank) totals.push(['Class Rank', `#${result.rank}`]);
  if (t.showAttendance && result.attendance_total) {
    const pct = result.attendance_total ? Math.round((result.attendance_present / result.attendance_total) * 100) : 0;
    totals.push(['Attendance', `${result.attendance_present}/${result.attendance_total} (${pct}%)`]);
  }

  doc.moveDown(0.2);
  const gridCols = 4;
  const cellW = width / gridCols;
  const gridRows = Math.ceil(totals.length / gridCols);
  let gy = doc.y;
  doc.save();
  doc.rect(left, gy, width, gridRows * 34).fillAndStroke('#F6F8FC', COLORS.line);
  doc.restore();
  totals.forEach((pair, i) => {
    const cx = left + (i % gridCols) * cellW;
    const cy = gy + Math.floor(i / gridCols) * 34;
    doc.font('Helvetica').fontSize(6.8).fillColor(COLORS.muted).text(pair[0].toUpperCase(), cx + 8, cy + 7, { width: cellW - 16 });
    const isFail = pair[0] === 'Result' && String(pair[1]).toLowerCase() !== 'pass';
    doc.font('Helvetica-Bold').fontSize(10).fillColor(isFail ? COLORS.danger : COLORS.ink)
      .text(String(pair[1]), cx + 8, cy + 17, { width: cellW - 16 });
  });
  doc.y = gy + gridRows * 34 + 12;

  // Grade legend
  if (t.showGradeLegend && gradeRanges.length) {
    drawSectionTitle(doc, 'Grading Scale', { accent: t.accent });
    drawTable(doc, {
      columns: [
        { label: 'Range', width: 90, value: (r) => `${r.min}% – ${r.max}%` },
        { label: 'Grade', width: 60, align: 'center', bold: true, key: 'grade' },
        { label: 'Grade Point', width: 70, align: 'center', key: 'points' },
        { label: 'Description', width: 230, key: 'remark' },
      ],
      rows: gradeRanges,
      fontSize: 7.5,
      headerBg: '#334155',
    });
  }

  // Remarks
  if (t.showTeacherRemark || t.showPrincipalRemark) {
    const remarks = [];
    if (t.showTeacherRemark) remarks.push(['Class Teacher Remark', result.teacher_remark || '—']);
    if (t.showPrincipalRemark) remarks.push(['Principal Remark', result.principal_remark || '—']);
    drawSectionTitle(doc, 'Remarks', { accent: t.accent });
    remarks.forEach(([label, value]) => {
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text(label.toUpperCase(), left, doc.y);
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(COLORS.ink).text(value, left, doc.y + 1, { width });
      doc.moveDown(0.6);
    });
  }

  // Signatures
  if (t.showSignature) {
    const y = Math.max(doc.y + 14, doc.page.height - doc.page.margins.bottom - 96);
    if (y + 76 < doc.page.height - doc.page.margins.bottom) {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink);
      doc.moveTo(left, y + 24).lineTo(left + 130, y + 24).strokeColor('#94A3B8').stroke();
      doc.text(t.teacherLabel, left, y + 28, { width: 130 });
      doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, left, y + 42, { width: 130 });

      doc.moveTo(left + width - 160, y + 24).lineTo(left + width - 30, y + 24).strokeColor('#94A3B8').stroke();
      doc.text(t.principalLabel, left + width - 160, y + 28, { width: 130, align: 'center' });
      doc.text(`(${school.principal_name || ''})`, left + width - 160, y + 40, { width: 130, align: 'center' });

      if (t.showStamp) {
        doc.save();
        doc.circle(left + width - 76, y + 62, 26).lineWidth(1).strokeColor(t.accent).stroke();
        doc.font('Helvetica-Bold').fontSize(6).fillColor(t.accent)
          .text('SCHOOL SEAL', left + width - 102, y + 59, { width: 52, align: 'center' });
        doc.restore();
      }
      doc.y = y + 76;
    }
  }

  doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.muted).text(t.footerNote, left, doc.page.height - doc.page.margins.bottom - 10, { width, align: 'center' });
  if (!existingDoc) finishDoc(doc, { footerText: `${school.name} • ${exam.name} • ${student.full_name}` });
  return doc;
}

/* ---------------------------------- invoice ---------------------------------- */

export function invoicePdf({ school, student, invoice, items = [], payments = [] }) {
  const accent = COLORS.accent;
  const doc = createDoc({ title: `Invoice ${invoice.invoice_no}` });
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;

  drawLetterhead(doc, school, { title: 'FEE INVOICE', accent, compact: true });

  doc.font('Helvetica-Bold').fontSize(14).fillColor(accent).text('FEE INVOICE', left, doc.y);
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted)
    .text(`Invoice No: ${invoice.invoice_no}`, left, doc.y, { width, align: 'right' });
  doc.text(`Issue Date: ${invoice.issue_date}`, left, doc.y - 2, { width, align: 'right' });
  doc.text(`Due Date: ${invoice.due_date}`, left, doc.y - 2, { width, align: 'right' });
  doc.moveDown(0.6);

  const billTop = doc.y;
  doc.save();
  doc.rect(left, billTop, width / 2 - 6, 84).fillAndStroke('#F6F8FC', COLORS.line);
  doc.rect(left + width / 2 + 6, billTop, width / 2 - 6, 84).fillAndStroke('#F6F8FC', COLORS.line);
  doc.restore();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted).text('BILLED TO', left + 8, billTop + 8);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text(student?.full_name || '—', left + 8, billTop + 20);
  doc.font('Helvetica').fontSize(8)
    .text(`Admission No: ${student?.admission_no || '—'}`, left + 8, billTop + 34)
    .text(`Class: ${student?.class_name || ''} ${student?.section_name || ''}`, left + 8, billTop + 45)
    .text(`Guardian: ${student?.father_name || student?.guardian_name || '—'}`, left + 8, billTop + 56)
    .text(`Phone: ${student?.phone || '—'}`, left + 8, billTop + 67);

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted).text('ACADEMIC SESSION', left + width / 2 + 14, billTop + 8);
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink)
    .text(invoice.period ? `Billing period: ${invoice.period}` : 'Annual billing', left + width / 2 + 14, billTop + 20)
    .text(`Status: ${String(invoice.status || '').toUpperCase()}`, left + width / 2 + 14, billTop + 32)
    .text(`Generated: ${new Date(invoice.created_at).toLocaleString('en-GB')}`, left + width / 2 + 14, billTop + 44);
  doc.y = billTop + 96;

  drawTable(doc, {
    columns: [
      { label: '#', width: 24, align: 'center', key: 'idx' },
      { label: 'Description', width: 300, key: 'description' },
      { label: 'Qty', width: 50, align: 'center', key: 'quantity' },
      { label: 'Amount', width: 90, align: 'right', value: (r) => moneyShort(r.amount) },
    ],
    rows: items.map((it, i) => ({ ...it, idx: i + 1 })),
    fontSize: 8.5,
    headerBg: accent,
  });

  const totalsX = left + width - 220;
  const totalRows = [
    ['Subtotal', moneyShort(invoice.subtotal)],
    ['Discount', `- ${moneyShort(invoice.discount)}`],
    ['Late fee', moneyShort(invoice.late_fee)],
    ['Total payable', moneyShort(invoice.total)],
    ['Amount paid', moneyShort(invoice.amount_paid)],
    ['Balance due', moneyShort(invoice.balance)],
  ];
  let ty = doc.y + 4;
  totalRows.forEach(([label, value], idx) => {
    const strong = idx >= 3;
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
      .fillColor(strong ? COLORS.ink : COLORS.muted).text(label, totalsX, ty, { width: 120 });
    doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
      .fillColor(idx === 5 && Number(invoice.balance) > 0 ? COLORS.danger : COLORS.ink)
      .text(value, totalsX + 120, ty, { width: 100, align: 'right' });
    ty += 15;
  });
  doc.y = ty + 8;

  if (payments.length) {
    drawSectionTitle(doc, 'Payment history', { accent });
    drawTable(doc, {
      columns: [
        { label: 'Date', width: 110, value: (p) => (p.paid_at || p.created_at || '').slice(0, 10) },
        { label: 'Receipt', width: 130, key: 'receipt_no' },
        { label: 'Method', width: 100, key: 'method' },
        { label: 'Status', width: 90, key: 'status' },
        { label: 'Amount', width: 90, align: 'right', value: (p) => moneyShort(p.amount) },
      ],
      rows: payments,
      fontSize: 8,
      headerBg: '#334155',
    });
  }

  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
    .text('This invoice is generated by the school finance system. Online payments are confirmed only after server-side verification with the payment gateway.', left, doc.y + 10, { width });
  finishDoc(doc, { footerText: `${school.name} • Invoice ${invoice.invoice_no}` });
  return doc;
}

/* ---------------------------------- receipt ---------------------------------- */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

export function numberToWordsIndian(num) {
  let n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (n) parts.push(twoDigits(n));
  return parts.join(' ');
}

export function receiptPdf({ school, student, payment, invoice }) {
  const accent = '#0F766E';
  const doc = createDoc({ title: `Receipt ${payment.receipt_no}` });
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;

  drawLetterhead(doc, school, { title: 'FEE PAYMENT RECEIPT', accent, compact: true });
  doc.font('Helvetica-Bold').fontSize(15).fillColor(accent).text('PAYMENT RECEIPT', left, doc.y, { width, align: 'center' });
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
    .text(`Receipt No: ${payment.receipt_no}`, left, doc.y, { width, align: 'center' });
  doc.moveDown(0.8);

  const pairs = [
    ['Student name', student?.full_name || '—'],
    ['Admission no.', student?.admission_no || '—'],
    ['Class / Section', `${student?.class_name || ''} ${student?.section_name || ''}`.trim() || '—'],
    ['Invoice no.', invoice?.invoice_no || '—'],
    ['Payment date', new Date(payment.paid_at || payment.created_at).toLocaleString('en-GB')],
    ['Payment method', String(payment.method || '').toUpperCase()],
    ['Transaction / UTR', payment.txn_ref || payment.gateway_payment_id || '—'],
    ['Gateway', payment.gateway || 'Offline / manual'],
  ];
  const top = doc.y;
  doc.save();
  doc.roundedRect(left, top, width, 108, 4).lineWidth(0.8).strokeColor(accent).stroke();
  doc.restore();
  drawKeyValues(doc, pairs, { columns: 2, fontSize: 8.5, width: width - 20, x: left + 10, y: top + 10 });
  doc.y = top + 118;

  doc.save();
  doc.rect(left, doc.y, width, 52).fill('#ECFDF5');
  doc.restore();
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('AMOUNT RECEIVED', left + 12, doc.y + 10);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(accent).text(money(payment.amount), left + 12, doc.y + 1);
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink)
    .text(`In words: ${numberToWordsIndian(payment.amount)} Rupees Only`, left + 12, doc.y + 20, { width: width - 24 });
  doc.y += 64;

  if (invoice) {
    drawSectionTitle(doc, 'Invoice summary', { accent });
    drawKeyValues(doc, [
      ['Invoice total', moneyShort(invoice.total)],
      ['Previously paid', moneyShort(Math.max(0, Number(invoice.amount_paid) - Number(payment.amount)))],
      ['This payment', moneyShort(payment.amount)],
      ['Balance due', moneyShort(invoice.balance)],
    ], { columns: 2, fontSize: 8.5, width });
  }

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink)
    .text(`Status: ${String(payment.status).toUpperCase()}  •  ${payment.gateway_payment_id ? `Gateway payment id: ${payment.gateway_payment_id}` : 'Recorded at school counter'}`, left, doc.y + 8, { width });
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(COLORS.muted)
    .text('Computer generated receipt. Retain for your records.', left, doc.y + 14, { width });

  const sigY = Math.max(doc.y + 40, doc.page.height - doc.page.margins.bottom - 60);
  doc.moveTo(left + width - 170, sigY).lineTo(left + width - 30, sigY).strokeColor('#94A3B8').stroke();
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.ink).text('Authorised Signatory', left + width - 170, sigY + 4, { width: 140, align: 'center' });

  finishDoc(doc, { footerText: `${school.name} • Receipt ${payment.receipt_no}` });
  return doc;
}

/* --------------------------------- generic --------------------------------- */

export function tableReportPdf({ school, title, subtitle, meta = [], columns, rows, orientation = 'portrait' }) {
  const doc = createDoc({ layout: orientation, title });
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;

  drawLetterhead(doc, school, { title: 'REPORT', accent: COLORS.accent, compact: true });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.ink).text(title, left, doc.y, { width });
  if (subtitle) doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted).text(subtitle, left, doc.y + 2, { width });
  if (meta.length) doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(meta.join('   |   '), left, doc.y + 3, { width });
  doc.moveDown(0.8);

  const scaleTotal = columns.reduce((s, c) => s + (c.pdfWidth || c.width || 100), 0);
  const pdfColumns = columns.map((c) => ({
    label: c.label,
    width: ((c.pdfWidth || c.width || 100) / scaleTotal) * width,
    align: c.align,
    key: c.key,
    value: c.value,
  }));

  drawTable(doc, { columns: pdfColumns, rows, fontSize: 7.5, headerBg: COLORS.accent });
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
    .text(`Total records: ${rows.length}`, left, doc.y + 6);
  finishDoc(doc, { footerText: `${school.name} • ${title}` });
  return doc;
}

export function timetablePdf({ school, title, subtitle, periods, days, grid }) {
  const doc = createDoc({ layout: 'landscape', title });
  const { left, right } = doc.page.margins;
  const width = doc.page.width - left - right;
  drawLetterhead(doc, school, { title: 'TIMETABLE', accent: COLORS.accent, compact: true });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text(title, left, doc.y, { width });
  if (subtitle) doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(subtitle, left, doc.y + 2, { width });
  doc.moveDown(0.6);

  const dayColWidth = 74;
  const periodWidth = (width - dayColWidth) / Math.max(periods.length, 1);
  const columns = [
    { label: 'Day', width: dayColWidth, bold: true, key: 'day' },
    ...periods.map((p) => ({
      label: `${p.name}  ${p.start_time}-${p.end_time}`,
      width: periodWidth,
      key: p.id,
    })),
  ];
  const rows = days.map((day) => {
    const row = { day: day.label };
    periods.forEach((p) => {
      const cell = grid[`${day.value}-${p.id}`];
      row[p.id] = cell ? cell.label : p.is_break ? 'Break' : '—';
    });
    return row;
  });
  drawTable(doc, { columns, rows, fontSize: 7, headerBg: COLORS.accent });
  finishDoc(doc, { footerText: `${school.name} • Timetable` });
  return doc;
}
