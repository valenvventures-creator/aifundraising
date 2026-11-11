import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { stringify } from 'csv-stringify/sync';

export interface Column { key: string; label: string; format?: (v: any, row: any) => unknown }

function cellValue(c: Column, row: any) {
  const v = c.format ? c.format(row[c.key], row) : row[c.key];
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join('; ');
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

/** Send rows as CSV or XLSX. Formula-injection safe for CSV (cells starting with = + - @ are prefixed). */
export async function sendTable(res: Response, format: 'csv' | 'xlsx', name: string, columns: Column[], rows: any[]) {
  const safeName = name.replace(/[^\w.\- ]/g, '_');
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'A.I. Fundraising';
    const ws = wb.addWorksheet(name.slice(0, 31));
    ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: Math.min(40, Math.max(12, c.label.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, cellValue(c, r)])));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
    return;
  }
  const data = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => {
    const v = cellValue(c, r);
    return typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  }))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.csv"`);
  res.send(stringify(data));
}
