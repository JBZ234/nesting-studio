import { T, Tn } from '../i18n';
import type { Panel, Project, Side, NestSettings } from './types';
import type { BomResult } from './bom';
import { parseStepFileName } from './bom';
import type { FlatPattern } from './unfold';

export interface StepEntry { file: string; flat?: FlatPattern; error?: string }

export const sideKey = (depth: string, side: Side, code: string) => `${depth}|${side}|${code}`;

function coreSize(type: string, A: number, B: number, C?: number) {
  const t = type.toUpperCase();
  if (t === 'CORN') return { w: A + B, h: C ?? B };
  if (t === 'FASF') return { w: A, h: B + (C ?? 0) };
  return { w: A, h: B };
}

/** Learn how much each edge condition adds to the blank, from unfolded STEP files. */
export function calibrateAllowances(panels: Panel[], flats: Record<string, FlatPattern>): Record<string, number> {
  const acc: Record<string, number[]> = {};
  const push = (k: string, v: number) => { if (v > -0.5 && v < 12) (acc[k] ||= []).push(v); };
  for (const p of panels) {
    const f = flats[p.uid]; if (!f) continue;
    const bw = f.baseBox.x1 - f.baseBox.x0, bh = f.baseBox.y1 - f.baseBox.y0;
    if (Math.abs(bw - p.A) > 1 || Math.abs(bh - p.B) > 1) continue; // only flat-faced panels
    const dx = (p.A - bw) / 2, dy = (p.B - bh) / 2;
    push(sideKey(p.depth, 'L', p.edgeL), f.baseBox.x0 - dx);
    push(sideKey(p.depth, 'R', p.edgeR), f.width - f.baseBox.x1 - dx);
    push(sideKey(p.depth, 'B', p.edgeB), f.baseBox.y0 - dy);
    push(sideKey(p.depth, 'T', p.edgeT), f.height - f.baseBox.y1 - dy);
  }
  const out: Record<string, number> = {};
  for (const [k, vs] of Object.entries(acc)) out[k] = +(vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(4);
  return out;
}

export function allowanceFor(allow: Record<string, number>, depth: string, side: Side, code: string, Z = 1.25): { v: number; known: boolean } {
  const k = sideKey(depth, side, code);
  if (k in allow) return { v: allow[k], known: true };
  // same side+code at any depth, scaled by depth difference
  const alt = Object.entries(allow).find(([kk]) => kk.endsWith(`|${side}|${code}`));
  if (alt) return { v: alt[1], known: true };
  return { v: Z, known: false };
}

export function estimateBlank(p: Omit<Panel, 'blankW' | 'blankH' | 'blankSource'>, allow: Record<string, number>) {
  const c = coreSize(p.type, p.A, p.B, p.C);
  const Z = Math.max(p.Z ?? 1.25, p.Z1 ?? 0);
  const L = allowanceFor(allow, p.depth, 'L', p.edgeL, Z), R = allowanceFor(allow, p.depth, 'R', p.edgeR, Z);
  const T = allowanceFor(allow, p.depth, 'T', p.edgeT, Z), Bm = allowanceFor(allow, p.depth, 'B', p.edgeB, Z);
  return { w: c.w + L.v + R.v, h: c.h + T.v + Bm.v, exact: L.known && R.known && T.known && Bm.known, returns: { L: Math.max(0, L.v), R: Math.max(0, R.v), T: Math.max(0, T.v), B: Math.max(0, Bm.v) } };
}

export function buildPanels(boms: BomResult[], steps: StepEntry[], project: Project): { panels: Panel[]; flats: Record<string, FlatPattern>; warnings: string[] } {
  const warnings: string[] = [];
  const panels: Panel[] = [];
  const byMark = new Map<string, Panel[]>();
  // Newest BOM first: a revised BOM replaces the lines of an older one for the same job + mark.
  const rank = (b: BomResult) => [b.header.date || '', /revis/i.test(b.file) ? 1 : 0, parseFloat(b.header.release) || 0, b.file] as const;
  const ordered = [...boms].sort((x, y) => {
    const a = rank(x), c = rank(y);
    return a[0] !== c[0] ? (a[0] < c[0] ? 1 : -1) : a[1] !== c[1] ? c[1] - a[1] : a[2] !== c[2] ? c[2] - a[2] : a[3] < c[3] ? 1 : -1;
  });
  const seen = new Map<string, string>(); // uid -> file that won
  const superseded = new Map<string, { by: string; n: number }>();
  for (const b of ordered) for (const bp of b.panels) {
    const p: Panel = { ...bp, include: true, blankW: 0, blankH: 0, blankSource: 'estimado' };
    const won = seen.get(p.uid);
    if (won) {
      if (won === b.file) { warnings.push(T`Marca repetida ${p.mark} dentro de ${b.file}: se sumó la cantidad`); const q = panels.find(x => x.uid === p.uid); if (q) q.qty += p.qty; }
      else { const s = superseded.get(b.file) || { by: won, n: 0 }; s.n++; superseded.set(b.file, s); }
      continue;
    }
    seen.set(p.uid, b.file);
    panels.push(p);
    const arr = byMark.get(p.mark) || []; arr.push(p); byMark.set(p.mark, arr);
  }
  for (const [file, s] of superseded) warnings.unshift(T`${file}: ${s.n} marcas ya estaban en ${s.by} (más reciente); se ignoraron para no duplicar piezas`);
  const flats: Record<string, FlatPattern> = {};
  for (const s of steps) {
    const info = parseStepFileName(s.file);
    if (!info) { warnings.push(T`Nombre STEP no reconocido: ${s.file}`); continue; }
    const cands = byMark.get(info.mark) || [];
    let p = cands.find(c => c.type === info.type && c.edgeT === info.edgeT && c.edgeB === info.edgeB && c.edgeL === info.edgeL && c.edgeR === info.edgeR) || cands[0];
    if (cands.length > 1) {
      const exact = cands.filter(c => c.type === info.type && c.edgeT === info.edgeT && c.edgeB === info.edgeB && c.edgeL === info.edgeL && c.edgeR === info.edgeR);
      if (exact.length !== 1) warnings.push(T`STEP ${s.file}: marca ${info.mark} aparece en varios BOM; se usó ${p?.bomFile}`);
    }
    if (!p) {
      if (!s.flat) continue;
      // STEP without BOM line: create a panel from file name + geometry
      p = {
        uid: `STEP|${info.mark}`, mark: info.mark, job: '', release: '', qty: 1, include: true,
        type: info.type, depth: info.depth, edgeT: info.edgeT, edgeB: info.edgeB, edgeL: info.edgeL, edgeR: info.edgeR,
        mtl: info.mtl, thk: info.thk,
        A: +(s.flat.baseBox.x1 - s.flat.baseBox.x0).toFixed(3), B: +(s.flat.baseBox.y1 - s.flat.baseBox.y0).toFixed(3),
        grain: '', notes: T('Sin línea en BOM'), options: '', material: info.mtl, alloy: '', thickness: '', finish: '', finishCode: '',
        bomFile: '', bomSheet: '', extra: {}, blankW: 0, blankH: 0, blankSource: 'step',
      };
      panels.push(p);
      warnings.push(T`STEP ${s.file} no tiene línea en ningún BOM: se agregó con cantidad 1`);
    } else if (p.type && info.type && (p.type !== info.type || p.edgeT !== info.edgeT || p.edgeL !== info.edgeL || p.edgeR !== info.edgeR || p.edgeB !== info.edgeB)) {
      warnings.push(T`STEP ${s.file}: tipo/bordes no coinciden con BOM (${p.type} ${p.edgeT}-${p.edgeB}-${p.edgeL}-${p.edgeR})`);
    }
    p.stepFile = s.file;
    if (s.flat) flats[p.uid] = s.flat;
    else if (s.error) warnings.push(T`STEP ${s.file}: ${s.error}`);
  }
  const learned = calibrateAllowances(panels, flats);
  const allow = { ...learned, ...project.edgeAllowances };
  for (const p of panels) {
    const o = project.overrides[p.uid];
    if (o) { const { blankW, blankH, ...rest } = o; void blankW; void blankH; Object.assign(p, rest); }
    const f = flats[p.uid];
    if (f) {
      p.blankW = +f.width.toFixed(4); p.blankH = +f.height.toFixed(4); p.blankSource = 'step';
      const b = f.baseBox;
      p.returns = { L: +b.x0.toFixed(4), R: +(f.width - b.x1).toFixed(4), B: +b.y0.toFixed(4), T: +(f.height - b.y1).toFixed(4) };
    } else {
      const e = estimateBlank(p, allow); p.blankW = +e.w.toFixed(4); p.blankH = +e.h.toFixed(4); p.blankSource = 'estimado';
      p.returns = e.returns;
    }
    if (o && (o.blankW !== undefined || o.blankH !== undefined)) {
      if (o.blankW !== undefined) p.blankW = o.blankW;
      if (o.blankH !== undefined) p.blankH = o.blankH;
      p.blankSource = 'manual';
    }
  }
  return { panels, flats, warnings };
}

// ---------- fields usable in rules ----------

export interface FieldDef { key: string; label: string; kind: 'number' | 'text' | 'edge' | 'bool'; group: string }

export const FIELDS: FieldDef[] = [
  { key: 'anyEdge', label: T('Cualquier borde (T/B/L/R)'), kind: 'edge', group: T('Bordes') },
  { key: 'edgeT', label: T('Borde superior (T)'), kind: 'edge', group: T('Bordes') },
  { key: 'edgeB', label: T('Borde inferior (B)'), kind: 'edge', group: T('Bordes') },
  { key: 'edgeL', label: T('Borde izquierdo (L)'), kind: 'edge', group: T('Bordes') },
  { key: 'edgeR', label: T('Borde derecho (R)'), kind: 'edge', group: T('Bordes') },
  { key: 'sideEdges', label: T('Bordes laterales (L/R)'), kind: 'edge', group: T('Bordes') },
  { key: 'orientation', label: T('Orientación del panel (H/V)'), kind: 'text', group: T('Geometría') },
  { key: 'A', label: T('Medida A'), kind: 'number', group: T('Geometría') },
  { key: 'B', label: T('Medida B'), kind: 'number', group: T('Geometría') },
  { key: 'C', label: T('Medida C'), kind: 'number', group: T('Geometría') },
  { key: 'Z', label: T('Profundidad Z'), kind: 'number', group: T('Geometría') },
  { key: 'blankW', label: T('Desarrollo ancho (eje A)'), kind: 'number', group: T('Geometría') },
  { key: 'blankH', label: T('Desarrollo alto (eje B)'), kind: 'number', group: T('Geometría') },
  { key: 'blankLong', label: T('Desarrollo lado largo'), kind: 'number', group: T('Geometría') },
  { key: 'blankShort', label: T('Desarrollo lado corto'), kind: 'number', group: T('Geometría') },
  { key: 'area', label: T('Área del desarrollo (in²)'), kind: 'number', group: T('Geometría') },
  { key: 'type', label: T('Tipo (FLAT, CORN…)'), kind: 'text', group: 'BOM' },
  { key: 'depth', label: 'Depth', kind: 'text', group: 'BOM' },
  { key: 'mark', label: 'Panel mark', kind: 'text', group: 'BOM' },
  { key: 'qty', label: T('Cantidad'), kind: 'number', group: 'BOM' },
  { key: 'job', label: 'Job #', kind: 'text', group: 'BOM' },
  { key: 'grain', label: 'Grain', kind: 'text', group: 'BOM' },
  { key: 'options', label: 'Options', kind: 'text', group: 'BOM' },
  { key: 'notes', label: 'Notes', kind: 'text', group: 'BOM' },
  { key: 'mtl', label: T('Material (código)'), kind: 'text', group: 'BOM' },
  { key: 'thk', label: T('Calibre (código)'), kind: 'text', group: 'BOM' },
  { key: 'material', label: 'Material', kind: 'text', group: 'BOM' },
  { key: 'finish', label: 'Color', kind: 'text', group: 'BOM' },
  { key: 'bomSheet', label: T('Hoja del BOM'), kind: 'text', group: 'BOM' },
  { key: 'hasStep', label: T('Tiene STEP'), kind: 'bool', group: 'BOM' },
];

export function orientationOf(p: Pick<Panel, 'A' | 'B'>, s: Pick<NestSettings, 'horizontalWhen'>): 'H' | 'V' {
  return (s.horizontalWhen === 'A>B' ? p.A > p.B : p.A >= p.B) ? 'H' : 'V';
}

export function fieldValue(p: Panel, key: string, s: Pick<NestSettings, 'horizontalWhen'>): unknown {
  switch (key) {
    case 'anyEdge': return [p.edgeT, p.edgeB, p.edgeL, p.edgeR];
    case 'sideEdges': return [p.edgeL, p.edgeR];
    case 'orientation': return orientationOf(p, s);
    case 'blankLong': return Math.max(p.blankW, p.blankH);
    case 'blankShort': return Math.min(p.blankW, p.blankH);
    case 'area': return p.blankW * p.blankH;
    case 'hasStep': return !!p.stepFile;
    default: return (p as any)[key] ?? p.extra?.[key] ?? '';
  }
}

/** Object exposed to free-form expressions in rules. */
export function exprScope(p: Panel, s: Pick<NestSettings, 'horizontalWhen'>) {
  return {
    ...p.extra, ...p,
    T: p.edgeT, Bt: p.edgeB, L: p.edgeL, R: p.edgeR,
    edges: [p.edgeT, p.edgeB, p.edgeL, p.edgeR],
    orientation: orientationOf(p, s),
    long: Math.max(p.blankW, p.blankH), short: Math.min(p.blankW, p.blankH),
    area: p.blankW * p.blankH,
    fam: (code: string) => String(code).slice(0, 2),
  };
}

export function partitionKey(p: Panel, fields: string[], s: Pick<NestSettings, 'horizontalWhen'>): string {
  return fields.map(f => String(fieldValue(p, f, s) ?? '')).join(' · ');
}
