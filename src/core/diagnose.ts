import { T, Tn } from '../i18n';
// Why can't a panel be placed? Detailed, numeric diagnosis for one panel on empty sheets,
// with a preview position and a sheet-size suggestion.

import type { Action, Cond, Panel, Rule, NestSettings, SheetSize, SheetLayout, Placement, Rot, SheetDef, Side, Dir } from './types';
import { constraintsFor, PanelConstraints, placedSize, facing, zoneRect, sideViolations, zoneViolated, edgeCode, inflation } from './rules';
import { tryPlace } from './nest';

const DIR_ES: Record<Dir, string> = { top: T('en la parte de arriba'), bottom: T('en la parte de abajo'), left: T('a la izquierda'), right: T('a la derecha') };
const ANCHOR_ES: Record<string, string> = {
  TH: T('la mitad superior'), BH: T('la mitad inferior'), LH: T('la mitad izquierda'), RH: T('la mitad derecha'),
  T: T('la franja superior'), B: T('la franja inferior'), L: T('la franja izquierda'), R: T('la franja derecha'),
  TL: T('la esquina superior izquierda'), TR: T('la esquina superior derecha'), BL: T('la esquina inferior izquierda'), BR: T('la esquina inferior derecha'),
  TC: T('el centro superior'), BC: T('el centro inferior'), ML: T('el centro izquierdo'), MR: T('el centro derecho'), custom: T('la zona definida'),
};
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

export interface Blocker { ruleId: string; ruleName: string; details: string[]; alt?: { codes: string; rule: Rule } }
export interface SizeCheck { size: SheetSize; ok: boolean; enabled: boolean; perSheet: number; placement?: Placement }
export interface Preview { sheet: SheetSize; placement: Placement; ok: boolean; issues: string[]; zones: { r: { x: number; y: number; w: number; h: number }; name: string; forbid: boolean }[]; hotSides: Dir[] }
export interface Diagnosis {
  panel: Panel;
  c: PanelConstraints;
  rotations: Rot[];
  tooBig: string | null;
  blockers: Blocker[];
  sizes: SizeCheck[];
  suggestion: SizeCheck | null;
  minSheet: SheetSize | null;    // smallest height (with the widest catalog width) that works, when no catalog size does
  current: Preview | null;       // on the largest enabled sheet: where it would go and what it breaks
  fixed: Preview | null;         // on the suggested / minimum sheet, legal
  altSuggestion: { size: SheetSize; perSheet: number; codes: string; ruleName: string; preview: Preview } | null; // if the rule is changed to the side-only version
}

const emptySheet = (sz: SheetSize): SheetLayout => ({ id: 'diag', sheetId: 'diag', w: sz.w, h: sz.h, partition: '', placements: [] });
const fits = (p: Panel, c: PanelConstraints, s: NestSettings, sz: SheetSize) => tryPlace(emptySheet(sz), p, c, s, 'diag', () => undefined);

/** How many copies fit alone on one sheet (to estimate how many sheets to add). */
function perSheet(p: Panel, c: PanelConstraints, s: NestSettings, sz: SheetSize, cap = 40) {
  const sh = emptySheet(sz);
  for (let i = 0; i < cap; i++) {
    const pl = tryPlace(sh, p, c, s, `d${i}`, () => c);
    if (!pl) break;
    sh.placements.push(pl);
  }
  return sh.placements.length;
}

/** Numeric reason a side/zone rule can't be met on a sheet, for each allowed rotation. */
function explainRule(p: Panel, c: PanelConstraints, ruleId: string, s: NestSettings, sz: SheetSize): string[] {
  const out: string[] = [];
  const m = s.margins;
  const U = { x0: m.left, x1: sz.w - m.right, y0: m.bottom, y1: sz.h - m.top };
  for (const sr of c.sideRules.filter(r => r.ruleId === ruleId && r.hard)) {
    for (const rot of c.rotations) {
      const { w, h } = placedSize(p.blankW + c.dw, p.blankH + c.dh, rot);
      const inf = inflation(c, rot, s);
      for (const sd of sr.sides as Side[]) {
        const d = facing(sd, rot, c.flip); const code = edgeCode(p, sd);
        const vertical = d === 'left' || d === 'right';
        const len = vertical ? h : w;
        if (sr.kind === 'zone' && sr.zone) {
          const z = zoneRect(sr.zone, sz.w, sz.h);
          const name = ANCHOR_ES[sr.zone.anchor] ?? T('la zona');
          if (sr.mode !== 'outside') {
            const a = vertical ? Math.max(U.y0, z.y) : Math.max(U.x0, z.x);
            const b = vertical ? Math.min(U.y1, z.y + z.h) : Math.min(U.x1, z.x + z.w);
            const avail = Math.max(0, b - a);
            if (len > avail + 1e-6) {
              out.push(T`Girado ${rot}°: el lado ${sd} (${code}) queda ${DIR_ES[d]} y mide ${f2(len)}" ${vertical ? T('de alto') : T('de largo')}. Dentro de ${name} de una lámina ${sz.h} × ${sz.w} sólo hay ${f2(avail)}" útiles (de ${f2(a)}" a ${f2(b)}"${vertical && a === U.y0 ? T`, contando el margen de ${f2(m.bottom)}"` : ''}). Le faltan ${f2(len - avail)}".`);
              if (vertical && (sr.zone.anchor === 'BH' || sr.zone.anchor === 'TH')) {
                const needH = sr.zone.anchor === 'BH' ? 2 * (len + m.bottom + inf.b) : 2 * (len + m.top + inf.t);
                out.push(T`Para cumplirla girado ${rot}°, la lámina tendría que medir al menos ${f2(Math.ceil(needH * 2) / 2)}" de alto.`);
              }
            } else {
              out.push(T`Girado ${rot}°: el lado ${sd} (${code}) mide ${f2(len)}" y cabe en ${name}, pero el panel completo (${f2(w)} × ${f2(h)}) no entra en una posición que cumpla también los márgenes y las demás reglas.`);
            }
          } else {
            out.push(T`Girado ${rot}°: el lado ${sd} (${code}) queda ${DIR_ES[d]} y no puede entrar en ${name}; con ${f2(w)} × ${f2(h)} no hay posición que lo evite.`);
          }
        } else if (sr.kind === 'notOnBorder') {
          out.push(T`Girado ${rot}°: el lado ${sd} (${code}) queda ${DIR_ES[d]} y debe quedar a más de ${f2(sr.tol)}" del borde; el panel (${f2(w)} × ${f2(h)}) no deja ese espacio en ${sz.h} × ${sz.w}.`);
        }
      }
    }
  }
  for (const z of c.zones.filter(z => z.ruleId === ruleId && z.hard)) {
    const zr = zoneRect(z.zone, sz.w, sz.h);
    const name = ANCHOR_ES[z.zone.anchor] ?? T('la zona');
    // area where the panel may sit: inside the zone, or (forbidden band/half) the rest of the sheet
    let allowed: { x0: number; x1: number; y0: number; y1: number } | null = null;
    if (!z.forbid) allowed = { x0: zr.x, x1: zr.x + zr.w, y0: zr.y, y1: zr.y + zr.h };
    else if (['T', 'TH'].includes(z.zone.anchor)) allowed = { x0: 0, x1: sz.w, y0: 0, y1: zr.y };
    else if (['B', 'BH'].includes(z.zone.anchor)) allowed = { x0: 0, x1: sz.w, y0: zr.y + zr.h, y1: sz.h };
    else if (['L', 'LH'].includes(z.zone.anchor)) allowed = { x0: zr.x + zr.w, x1: sz.w, y0: 0, y1: sz.h };
    else if (['R', 'RH'].includes(z.zone.anchor)) allowed = { x0: 0, x1: zr.x, y0: 0, y1: sz.h };
    if (allowed) {
      const ax0 = Math.max(U.x0, allowed.x0), ax1 = Math.min(U.x1, allowed.x1), ay0 = Math.max(U.y0, allowed.y0), ay1 = Math.min(U.y1, allowed.y1);
      const aw = Math.max(0, ax1 - ax0), ah = Math.max(0, ay1 - ay0);
      const seen = new Set<string>();
      for (const rot of c.rotations) {
        const { w, h } = placedSize(p.blankW + c.dw, p.blankH + c.dh, rot);
        const k = `${f2(w)}x${f2(h)}`; if (seen.has(k)) continue; seen.add(k);
        const fw = w <= aw + 1e-6, fh = h <= ah + 1e-6;
        const where = z.forbid ? T`fuera de ${name}` : T`dentro de ${name}`;
        if (!fw || !fh) {
          out.push(T`Girado ${rot}°: el panel ocupa ${f2(w)} × ${f2(h)}". ${where[0].toUpperCase() + where.slice(1)} de ${sz.h} × ${sz.w} el espacio útil es ${f2(aw)} × ${f2(ah)}" (de y ${f2(ay0)}" a ${f2(ay1)}"). ${!fh ? T`Le sobran ${f2(h - ah)}" de alto` : ''}${!fh && !fw ? ' y ' : ''}${!fw ? T`${!fh ? '' : T('Le sobran ')}${f2(w - aw)}" de largo` : ''}.`);
          if (!fh && (z.zone.anchor === 'TH' || z.zone.anchor === 'BH')) {
            const marg = z.zone.anchor === 'BH' ? (z.forbid ? m.top : m.bottom) : (z.forbid ? m.bottom : m.top);
            out.push(T`Para cumplirla girado ${rot}°, la lámina tendría que medir al menos ${f2(Math.ceil(2 * (h + marg) * 2) / 2)}" de alto.`);
          }
        } else out.push(T`Girado ${rot}°: el panel (${f2(w)} × ${f2(h)}") cabe ${where}, pero no en una posición que cumpla también las demás reglas.`);
      }
    } else {
      out.push(T`El panel ${z.forbid ? T('no puede tocar') : T('tiene que estar en')} ${name} y con ${f2(p.blankW)} × ${f2(p.blankH)}" no hay posición que lo cumpla en ${sz.h} × ${sz.w}.`);
    }
  }
  for (const o of c.orient.filter(o => o.ruleId === ruleId && o.hard)) {
    out.push(T`Obliga la orientación «${o.label}» (giros permitidos: ${o.allowed.join('°, ')}°).`);
  }
  // dedupe identical lines (same rotation pairs 0/180 often give the same text)
  return [...new Set(out)];
}

function previewOn(p: Panel, c: PanelConstraints, relaxed: PanelConstraints, s: NestSettings, sz: SheetSize, blockerIds: Set<string>): Preview {
  let pl = fits(p, c, s, sz);
  const ok = !!pl;
  if (!pl) pl = fits(p, relaxed, s, sz);
  if (!pl) {
    const rot = c.rotations[0] ?? 0; const d = placedSize(p.blankW + c.dw, p.blankH + c.dh, rot);
    pl = { iid: 'diag', uid: p.uid, x: s.margins.left, y: s.margins.bottom, w: d.w, h: d.h, rot };
  }
  const issues: string[] = []; const hot = new Set<Dir>();
  const r = { x: pl.x, y: pl.y, w: pl.w, h: pl.h };
  const m = s.margins;
  if (pl.x < m.left - 1e-6 || pl.y < m.bottom - 1e-6 || pl.x + pl.w > sz.w - m.right + 1e-6 || pl.y + pl.h > sz.h - m.top + 1e-6) issues.push(T('Se sale del área útil (márgenes)'));
  for (const v of sideViolations(c, r, pl.rot, sz.w, sz.h, p)) if (v.hard) issues.push(`${v.msg} — «${v.ruleName}»`);
  for (const z of c.zones) if (z.hard && zoneViolated(r, z, sz.w, sz.h)) issues.push(`${z.forbid ? T('Toca la zona prohibida') : T('Sale de la zona obligatoria')} — «${z.ruleName}»`);
  for (const o of c.orient) if (o.hard && !o.allowed.includes(pl.rot)) issues.push(T`Orientación distinta a «${o.label}» — «${o.ruleName}»`);
  // highlight the sides that break a zone rule
  for (const sr of c.sideRules) if (sr.hard && blockerIds.has(sr.ruleId)) for (const sd of sr.sides) hot.add(facing(sd, pl.rot, c.flip));
  const zones = [
    ...c.sideRules.filter(sr => sr.hard && sr.zone).map(sr => ({ r: zoneRect(sr.zone!, sz.w, sz.h), name: T`${sr.mode === 'outside' ? T('Sin') : T('Sólo')} lado ${sr.codes}: ${ANCHOR_ES[sr.zone!.anchor] ?? ''}`, forbid: sr.mode === 'outside' })),
    ...c.zones.filter(z => z.hard).map(z => ({ r: zoneRect(z.zone, sz.w, sz.h), name: z.ruleName, forbid: z.forbid })),
  ];
  return { sheet: sz, placement: pl, ok, issues: [...new Set(issues)], zones, hotSides: [...hot] };
}

/** Edge codes a rule talks about in its conditions (e.g. "04" from "laterales empieza con 04"). */
function codesInRule(r: Rule): string {
  const out: string[] = [];
  const walk = (c: Cond) => {
    if (c.kind === 'group') c.items.forEach(walk);
    else if (c.kind === 'cond' && /^(anyEdge|edge[TBLR]|sideEdges)$/.test(c.field) && ['=', 'startsWith', 'contains', 'in'].includes(c.op) && !('not' in c && (c as any).not)) out.push(...c.value.split(/[,;\s]+/).filter(Boolean));
  };
  walk(r.when);
  return [...new Set(out)].join(', ');
}

/** A whole-panel zone rule rewritten to talk only about the sides with those codes. */
export function sideVariant(r: Rule): { codes: string; rule: Rule } | null {
  const codes = codesInRule(r) || [...new Set((r.name.match(/\b\d{2}\b/g) ?? []))].join(', ');
  if (!codes || !r.actions.some(a => a.type === 'forbidZone' || a.type === 'requireZone')) return null;
  const actions: Action[] = r.actions.map(a => {
    if (a.type !== 'forbidZone' && a.type !== 'requireZone') return a;
    return { type: 'edgeZone', edge: { codes, sides: [] }, zone: { ...a.zone, test: 'inside' }, mode: a.type === 'forbidZone' ? 'outside' : 'inside', strength: a.strength, weight: a.weight };
  });
  return { codes, rule: { ...r, actions } };
}

export function diagnosePanel(p: Panel, rules: Rule[], s: NestSettings, catalog: SheetSize[], sheets: SheetDef[]): Diagnosis {
  const c = constraintsFor(p, rules, s);
  const enabled = sheets.filter(d => d.enabled);
  const key = (z: SheetSize) => `${z.h}x${z.w}`;
  const all = new Map<string, SheetSize>();
  for (const z of catalog) all.set(key(z), { w: z.w, h: z.h });
  for (const d of enabled) all.set(key(d), { w: d.w, h: d.h });
  const enabledKeys = new Set(enabled.map(key));

  const sizes: SizeCheck[] = [...all.values()].sort((a, b) => a.h - b.h || a.w - b.w).map(size => {
    const pl = fits(p, c, s, size);
    return { size, ok: !!pl, enabled: enabledKeys.has(key(size)), perSheet: pl ? perSheet(p, c, s, size) : 0, placement: pl ?? undefined };
  });

  const big = (enabled.length ? enabled : [...all.values()]).reduce((a, d) => (d.w * d.h > a.w * a.h ? d : a));
  const bigSz = { w: big.w, h: big.h };
  const m = s.margins;
  const uw = big.w - m.left - m.right, uh = big.h - m.top - m.bottom;
  const bw = p.blankW + c.dw, bh = p.blankH + c.dh;
  const fitsAny = c.rotations.some(r => { const d = placedSize(bw, bh, r); return d.w <= uw + 1e-6 && d.h <= uh + 1e-6; });
  const tooBig = fitsAny ? null : T`El desarrollo mide ${f2(bw)} × ${f2(bh)}" y el área útil de ${big.h} × ${big.w} es ${f2(uw)} × ${f2(uh)}" (con los giros permitidos: ${c.rotations.join('°, ')}°).`;

  // which hard rules block it on the largest sheet (drop one at a time, then all together)
  const blockers: Blocker[] = [];
  const blockerIds = new Set<string>();
  if (!fits(p, c, s, bigSz)) {
    const matched = rules.filter(r => c.rules.includes(r.id));
    for (const r of matched) {
      const c2 = constraintsFor(p, rules.filter(x => x.id !== r.id), s);
      if (fits(p, c2, s, bigSz)) {
        const alt = sideVariant(r);
        const altOk = alt && fits(p, constraintsFor(p, rules.map(x => x.id === r.id ? alt.rule : x), s), s, bigSz);
        blockers.push({ ruleId: r.id, ruleName: Tn(r.name), details: explainRule(p, c, r.id, s, bigSz), alt: altOk ? alt! : undefined }); blockerIds.add(r.id);
      }
    }
    if (!blockers.length && !tooBig) {
      // combination: list every hard rule with geometry that applies
      for (const r of matched) {
        const det = explainRule(p, c, r.id, s, bigSz);
        if (det.length) { blockers.push({ ruleId: r.id, ruleName: Tn(r.name), details: det }); blockerIds.add(r.id); }
      }
    }
  }
  const relaxed = constraintsFor(p, rules.filter(r => !blockerIds.has(r.id)), s);

  // suggestion: smallest sheet area that works, preferring sizes already in the nesting
  const okSizes = sizes.filter(z => z.ok);
  const suggestion = okSizes.length
    ? okSizes.slice().sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.size.w * a.size.h - b.size.w * b.size.h)[0]
    : null;

  // if no size in the catalog works: smallest height (step 1") with the widest width that does
  let minSheet: SheetSize | null = null;
  if (!suggestion) {
    const widths = [...new Set([...all.values()].map(z => z.w))].sort((a, b) => b - a);
    for (const w of widths.slice(0, 3)) {
      for (let h = Math.max(...[...all.values()].map(z => z.h)) + 1; h <= 240; h += 1) {
        if (fits(p, c, s, { w, h })) { if (!minSheet || h < minSheet.h || (h === minSheet.h && w < minSheet.w)) minSheet = { w, h }; break; }
      }
    }
  }

  const current = blockers.length || tooBig ? previewOn(p, c, relaxed, s, bigSz, blockerIds) : null;
  const target = suggestion?.size ?? minSheet;
  const fixed = target ? previewOn(p, c, relaxed, s, target, blockerIds) : null;
  // with the side-only version of the blocking rules: which sheet would work?
  let altSuggestion: Diagnosis['altSuggestion'] = null;
  const alts = blockers.filter(b => b.alt);
  if (!suggestion && alts.length) {
    const rules2 = rules.map(r => alts.find(b => b.ruleId === r.id)?.alt?.rule ?? r);
    const c2 = constraintsFor(p, rules2, s);
    const ok2 = sizes.map(z => ({ z, pl: fits(p, c2, s, z.size) })).filter(x => x.pl)
      .sort((a, b) => Number(b.z.enabled) - Number(a.z.enabled) || a.z.size.w * a.z.size.h - b.z.size.w * b.z.size.h)[0];
    if (ok2) altSuggestion = { size: ok2.z.size, perSheet: perSheet(p, c2, s, ok2.z.size), codes: alts[0].alt!.codes, ruleName: alts[0].ruleName, preview: previewOn(p, c2, c2, s, ok2.z.size, new Set(alts.map(b => b.ruleId))) };
  }
  return { panel: p, c, rotations: c.rotations, tooBig, blockers, sizes, suggestion, minSheet, current, fixed, altSuggestion };
}
