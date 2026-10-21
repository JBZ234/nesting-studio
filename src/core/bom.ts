import * as XLSX from 'xlsx';
import type { Panel } from './types';

export interface BomHeader {
  job: string; jobName: string; release: string; material: string; alloy: string;
  thickness: string; finish: string; finishCode: string; panelCount: number; date: string;
}

export type BomPanel = Omit<Panel, 'blankW' | 'blankH' | 'blankSource' | 'include'>;

export interface BomResult { file: string; header: BomHeader; panels: BomPanel[]; warnings: string[] }

const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(6));
  return String(v).trim();
};
const num = (v: unknown): number | undefined => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : undefined;
};
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9#]/g, '');

function excelDate(v: unknown): string {
  const n = num(v);
  if (n && n > 30000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return str(v);
}

function readHeader(rows: unknown[][]): BomHeader {
  const h: BomHeader = { job: '', jobName: '', release: '', material: '', alloy: '', thickness: '', finish: '', finishCode: '', panelCount: 0, date: '' };
  const after = (r: unknown[], i: number) => { for (let j = i + 1; j < r.length; j++) { const s = str(r[j]); if (s) return { s, raw: r[j] }; } return { s: '', raw: '' }; };
  for (const r of rows) for (let i = 0; i < r.length; i++) {
    const k = norm(str(r[i]));
    if (!str(r[i]).includes(':')) continue;
    const nx = after(r, i);
    if (k === 'JOBNUMBER') h.job = nx.s;
    else if (k === 'JOBNAME') h.jobName = str(r[i + 1]);
    else if (k === 'RELEASE#') h.release = nx.s;
    else if (k === 'MATERIAL') h.material = nx.s;
    else if (k === 'ALLOY') h.alloy = nx.s;
    else if (k === 'THICKNESS') h.thickness = nx.s;
    else if (k === 'FINISHCOLOR') h.finish = nx.s;
    else if (k === 'FINISHCODE') h.finishCode = nx.s;
    else if (k === 'PANELCOUNT') h.panelCount = num(nx.raw) || 0;
    else if (k === 'DATE') h.date = excelDate(nx.raw);
  }
  return h;
}

export function parseBomWorkbook(data: ArrayBuffer | Uint8Array, fileName: string): BomResult {
  const wb = XLSX.read(data, { type: 'array' });
  const warnings: string[] = [];
  let header: BomHeader | null = null;
  const panels: BomPanel[] = [];

  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '' });
    if (!rows.length) continue;
    const depthRow = rows.findIndex(r => norm(str(r[0])).startsWith('DEPTH'));
    if (depthRow < 0) {
      if (!header) {
        const h = readHeader(rows);
        if (h.job || h.material) header = h;
      }
      continue;
    }
    // panel sheet
    const hdr = rows[depthRow].map(c => norm(str(c)));
    const vals = rows[depthRow + 1] || [];
    const get = (k: string) => { const i = hdr.indexOf(k); return i >= 0 ? vals[i] : ''; };
    const depth = str(vals[0]);
    const type = str(get('TYPE'));
    const edgeT = str(get('T')), edgeB = str(get('B')), edgeL = str(get('L')), edgeR = str(get('R'));
    const mtl = str(get('MTL'));
    const thkN = num(get('THK'));
    const thk = thkN !== undefined ? String(Math.round(thkN)).padStart(2, '0') : str(get('THK'));
    let job = '', release = '';
    for (const r of rows.slice(0, depthRow)) for (let i = 0; i < r.length; i++) {
      const k = norm(str(r[i]));
      if (k === 'JOB#') job = str(r[i + 1]);
      if (k === 'RELEASE#') release = str(r.slice(i + 1).find(x => str(x)) ?? '');
    }
    const markRow = rows.findIndex((r, i) => i > depthRow && norm(str(r[0])) === 'PANELMARK');
    if (markRow < 0) { warnings.push(`${sn}: no se encontró la fila PANEL MARK`); continue; }
    const cols = rows[markRow].map(c => norm(str(c)));
    const ci = (k: string) => cols.indexOf(k);
    for (let r = markRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const mark = str(row[0]);
      if (!mark) { if (rows.slice(r, r + 2).every(x => !str(x[0]))) break; continue; }
      if (/^(TOTAL|NOTES)/i.test(mark)) break;
      const qty = num(row[ci('QUANTITY')]) ?? 0;
      const A = num(row[ci('A')]); const B = num(row[ci('B')]);
      if (A === undefined || B === undefined) { warnings.push(`${sn} fila ${r + 1}: panel ${mark} sin A/B`); continue; }
      const extra: Record<string, string | number> = {};
      cols.forEach((c, i) => {
        if (!c || ['PANELMARK', 'QUANTITY', 'A', 'B', 'C', 'X', 'Y', 'Z', 'Z1', 'GRAIN', 'NOTES', 'OPTIONS'].includes(c)) return;
        const s = str(row[i]); if (s) extra[c] = s;
      });
      const opt = ci('OPTIONS') >= 0 ? row.slice(ci('OPTIONS')).map(str).filter(Boolean).join(' ') : '';
      panels.push({
        uid: '', mark, job, release, qty, type, depth,
        edgeT, edgeB, edgeL, edgeR, mtl, thk,
        A, B, C: num(row[ci('C')]), X: num(row[ci('X')]), Y: num(row[ci('Y')]), Z: num(row[ci('Z')]), Z1: num(row[ci('Z1')]),
        grain: str(row[ci('GRAIN')]), notes: str(row[ci('NOTES')]), options: opt,
        material: '', alloy: '', thickness: '', finish: '', finishCode: '',
        bomFile: fileName, bomSheet: sn, extra,
      });
    }
  }
  const h = header ?? { job: '', jobName: '', release: '', material: '', alloy: '', thickness: '', finish: '', finishCode: '', panelCount: 0, date: '' };
  for (const p of panels) {
    p.job = p.job || h.job; p.release = p.release || h.release;
    p.material = h.material; p.alloy = h.alloy; p.thickness = h.thickness; p.finish = h.finish; p.finishCode = h.finishCode;
    p.uid = `${p.job}|${p.mark}`;
  }
  const total = panels.reduce((s, p) => s + p.qty, 0);
  if (h.panelCount && Math.abs(total - h.panelCount) > 0.5) warnings.push(`Panel Count del BOM (${h.panelCount}) ≠ suma de cantidades (${total})`);
  return { file: fileName, header: h, panels, warnings };
}

/** "125-400-TTFL-01A-02A-04A-04A-AL-08_2042.step" or "…-AL-08_3063_GCT2.step" -> parts (suffix = panel option) */
export function parseStepFileName(name: string) {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.(step|stp)$/i, '');
  const us = base.indexOf('_');
  if (us < 0) return null;
  const rest = base.slice(us + 1).split('_');
  const mark = rest[0];
  const suffix = rest.slice(1).join('_');
  const toks = base.slice(0, us).split('-');
  if (toks.length < 8) return { mark, suffix, depth: '', type: '', edgeT: '', edgeB: '', edgeL: '', edgeR: '', mtl: '', thk: '', base };
  const thk = toks.pop()!, mtl = toks.pop()!, edgeR = toks.pop()!, edgeL = toks.pop()!, edgeB = toks.pop()!, edgeT = toks.pop()!, type = toks.pop()!;
  return { mark, suffix, depth: toks.join('-'), type, edgeT, edgeB, edgeL, edgeR, mtl, thk, base };
}
