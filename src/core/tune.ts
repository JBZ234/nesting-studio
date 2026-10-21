// Try other values of the optimizer sliders and report if one gives a clearly better result.

import type { Layout, NestSettings } from './types';
import { nest, NestInput, groupIdentical } from './nest';

export interface TuneSummary { unplaced: number; sheets: number; sheetArea: number; util: number; layouts: number }
export interface TuneChange { key: keyof NestSettings; label: string; from: string; to: string }
export interface TuneResult { patch: Partial<NestSettings>; base: TuneSummary; best: TuneSummary; changes: TuneChange[]; tried: number }

export const summarize = (l: Layout): TuneSummary => ({
  unplaced: l.unplaced.length, sheets: l.sheets.length, sheetArea: l.stats.sheetArea, util: l.stats.utilization, layouts: groupIdentical(l).length,
});

/** Clearly better: fewer pieces left out, or at least 1.5 % less sheet material. */
export function isBetter(a: TuneSummary, b: TuneSummary) {
  if (a.unplaced !== b.unplaced) return a.unplaced < b.unplaced;
  return a.sheetArea < b.sheetArea * 0.985;
}

const LABEL: Partial<Record<keyof NestSettings, string>> = {
  repeatSheets: 'Repetir láminas iguales', gridWeight: 'Láminas cuadriculadas', repeatWeight: 'Prioridad de repetir', repeatMinUtil: 'Aprovechamiento mínimo para repetir', rowAlign: 'Filas del mismo alto',
};
const show = (k: keyof NestSettings, v: any) => k === 'repeatSheets' ? (v ? 'sí' : 'no') : k === 'repeatMinUtil' ? `${v}%` : (k === 'rowAlign' || k === 'gridWeight') && !v ? 'no' : String(v);

export function tuneSettings(input: NestInput, base: TuneSummary, onStep?: (i: number, n: number) => void): TuneResult | null {
  const s = input.settings;
  const timeMs = Math.min(2500, Math.max(800, s.timeMs * 0.5));
  const variants: Partial<NestSettings>[] = [];
  const add = (p: Partial<NestSettings>) => { if (Object.entries(p).some(([k, v]) => (s as any)[k] !== v)) variants.push(p); };
  add({ repeatSheets: !s.repeatSheets });
  if (s.repeatSheets) {
    for (const v of [0, 15, 30, 60]) if (v !== s.repeatWeight) add({ repeatWeight: v });
    for (const v of [55, 70, 85]) if (v !== s.repeatMinUtil) add({ repeatMinUtil: v });
  }
  for (const v of [0, 60, 100]) if (v !== s.rowAlign) add({ rowAlign: v });
  for (const v of [0, 30, 60, 100]) if (v !== (s.gridWeight ?? 0)) add({ gridWeight: v });

  const run = (p: Partial<NestSettings>) => summarize(nest({ ...input, settings: { ...s, ...p, timeMs }, noExtend: true }));
  let best: { p: Partial<NestSettings>; sm: TuneSummary } | null = null;
  const good: { p: Partial<NestSettings>; sm: TuneSummary }[] = [];
  let i = 0;
  for (const p of variants) {
    onStep?.(++i, variants.length + 1);
    const sm = run(p);
    if (isBetter(sm, base)) { good.push({ p, sm }); if (!best || isBetter(sm, best.sm)) best = { p, sm }; }
  }
  // combine the single changes that helped (repeatSheets=false makes the repeat knobs moot)
  if (good.length >= 2) {
    const merged = Object.assign({}, ...good.map(g => g.p)) as Partial<NestSettings>;
    if (merged.repeatSheets === false) { delete merged.repeatWeight; delete merged.repeatMinUtil; }
    onStep?.(++i, variants.length + 1);
    const sm = run(merged);
    if (isBetter(sm, best!.sm)) best = { p: merged, sm };
  }
  if (!best) return null;
  const changes = (Object.keys(best.p) as (keyof NestSettings)[]).map(k => ({ key: k, label: LABEL[k] ?? k, from: show(k, s[k]), to: show(k, best!.p[k]) }));
  return { patch: best.p, base, best: best.sm, changes, tried: i };
}
