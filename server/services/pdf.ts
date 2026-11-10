import PDFDocument from 'pdfkit';
import type { Response } from 'express';

export type PdfBlock =
  | { type: 'h1' | 'h2' | 'p' | 'muted'; text: string }
  | { type: 'kv'; rows: [string, string][] }
  | { type: 'table'; columns: string[]; rows: (string | number)[][]; widths?: number[]; align?: ('left' | 'right')[] }
  | { type: 'metrics'; items: { label: string; value: string }[] }
  | { type: 'spacer' }
  | { type: 'pagebreak' };

const INDIGO = '#4f46e5', GRAY = '#6b7280', DARK = '#111827';

/** Render a branded document. All exported PDFs share this layout. */
export function renderPdf(res: Response, filename: string, opts: { title: string; subtitle?: string; org?: string; blocks: PdfBlock[] }) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true, info: { Title: opts.title, Producer: 'A.I. Nonprofits' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\- ]/g, '_')}"`);
  doc.pipe(res);
  const W = doc.page.width - 100;

  doc.fillColor(INDIGO).fontSize(9).font('Helvetica-Bold').text('A.I. NONPROFITS', 50, 40, { characterSpacing: 1.5 });
  if (opts.org) doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(opts.org, 50, 40, { align: 'right', width: W });
  doc.moveDown(1.2);
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(20).text(opts.title);
  if (opts.subtitle) doc.fillColor(GRAY).font('Helvetica').fontSize(10).text(opts.subtitle);
  doc.moveDown(0.6);
  doc.strokeColor('#e5e7eb').moveTo(50, doc.y).lineTo(50 + W, doc.y).stroke();
  doc.moveDown(0.8);

  const ensure = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage(); };

  for (const b of opts.blocks) {
    switch (b.type) {
      case 'h1': ensure(40); doc.moveDown(0.4).fillColor(DARK).font('Helvetica-Bold').fontSize(15).text(b.text).moveDown(0.3); break;
      case 'h2': ensure(30); doc.moveDown(0.3).fillColor(INDIGO).font('Helvetica-Bold').fontSize(11.5).text(b.text).moveDown(0.2); break;
      case 'p': doc.fillColor(DARK).font('Helvetica').fontSize(10).text(b.text, { width: W, lineGap: 2 }).moveDown(0.4); break;
      case 'muted': doc.fillColor(GRAY).font('Helvetica-Oblique').fontSize(8.5).text(b.text, { width: W }).moveDown(0.4); break;
      case 'spacer': doc.moveDown(0.8); break;
      case 'pagebreak': doc.addPage(); break;
      case 'kv': {
        for (const [k, v] of b.rows) {
          ensure(16);
          const y = doc.y;
          doc.fillColor(GRAY).font('Helvetica').fontSize(9.5).text(k, 50, y, { width: 160 });
          doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9.5).text(v || '—', 215, y, { width: W - 165 });
          doc.moveDown(0.25);
        }
        doc.x = 50; doc.moveDown(0.3); break;
      }
      case 'metrics': {
        ensure(55);
        const n = b.items.length, cw = W / Math.max(1, n), y = doc.y;
        b.items.forEach((m, i) => {
          const x = 50 + i * cw;
          doc.roundedRect(x + 2, y, cw - 4, 46, 6).fillAndStroke('#f5f3ff', '#e0e7ff');
          doc.fillColor(GRAY).font('Helvetica').fontSize(8).text(m.label.toUpperCase(), x + 10, y + 8, { width: cw - 20 });
          doc.fillColor(DARK).font('Helvetica-Bold').fontSize(14).text(m.value, x + 10, y + 22, { width: cw - 20 });
        });
        doc.x = 50; doc.y = y + 56; break;
      }
      case 'table': {
        const widths = b.widths ?? b.columns.map(() => W / b.columns.length);
        const align = b.align ?? b.columns.map(() => 'left' as const);
        const drawRow = (cells: (string | number)[], header = false) => {
          const heights = cells.map((c, i) => doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(String(c ?? ''), { width: widths[i] - 8 }));
          const h = Math.max(...heights, 10) + 8;
          ensure(h);
          const y = doc.y;
          if (header) doc.rect(50, y, W, h).fill('#eef2ff');
          let x = 50;
          cells.forEach((c, i) => {
            doc.fillColor(header ? INDIGO : DARK).font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
              .text(String(c ?? ''), x + 4, y + 4, { width: widths[i] - 8, align: align[i] });
            x += widths[i];
          });
          doc.strokeColor('#f1f5f9').moveTo(50, y + h).lineTo(50 + W, y + h).stroke();
          doc.x = 50; doc.y = y + h;
        };
        drawRow(b.columns, true);
        for (const r of b.rows) drawRow(r);
        if (!b.rows.length) doc.fillColor(GRAY).font('Helvetica-Oblique').fontSize(9).text('No rows.', 54, doc.y + 4);
        doc.moveDown(0.6); break;
      }
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.fillColor(GRAY).font('Helvetica').fontSize(7.5)
      .text(`Generated ${new Date().toLocaleString('en-US')} · Page ${i + 1} of ${range.count}`, 50, doc.page.height - 40, { width: W, align: 'center', lineBreak: false });
  }
  doc.end();
}
