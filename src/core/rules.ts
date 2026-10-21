import type { Panel, Rule, Cond, ZoneDef, NestSettings, Action, Layout, Violation, SheetDef, Side, Dir, Rot, EdgeSel } from './types';
import { fieldValue, exprScope, partitionKey, orientationOf } from './panels';

// ---------- condition evaluation ----------

const exprCache = new Map<string, ((s: any) => unknown) | Error>();
function compileExpr(src: string) {
  if (exprCache.has(src)) return exprCache.get(src)!;
  let f: ((s: any) => unknown) | Error;
  try {
    // eslint-disable-next-line no-new-func
    f = new Function('p', `with (p) { return (${src}); }`) as any;
  } catch (e: any) { f = new Error(e.message); }
  exprCache.set(src, f);
  return f;
}
export function checkExpr(src: string): string | null {
  const f = compileExpr(src);
  return f instanceof Error ? f.message : null;
}

function cmpOne(val: unknown, op: Cond & { kind: 'cond' }): boolean {
  const s = String(val ?? '').toUpperCase().trim();
  const target = String(op.value ?? '').toUpperCase().trim();
  const list = target.split(/[,;|]/).map(x => x.trim()).filter(Boolean);
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  const tn = parseFloat(op.value);
  switch (op.op) {
    case '=': return typeof val === 'boolean' ? String(val).toUpperCase() === target || (val && ['SI', 'SÍ', 'YES', '1'].includes(target)) || (!val && ['NO', '0'].includes(target)) : (isFinite(tn) && isFinite(n) && /^[\d.\-]+$/.test(target) ? Math.abs(n - tn) < 1e-6 : s === target);
    case '!=': return !cmpOne(val, { ...op, op: '=' });
    case 'contains': return s.includes(target);
    case 'notContains': return !s.includes(target);
    case 'startsWith': return list.some(t => s.startsWith(t));
    case 'endsWith': return list.some(t => s.endsWith(t));
    case 'in': return list.includes(s);
    case 'notIn': return !list.includes(s);
    case '>': return n > tn;
    case '>=': return n >= tn;
    case '<': return n < tn;
    case '<=': return n <= tn;
    case 'between': { const t2 = parseFloat(op.value2 ?? ''); return n >= Math.min(tn, t2) && n <= Math.max(tn, t2); }
    case 'empty': return s === '';
    case 'notEmpty': return s !== '';
    case 'regex': try { return new RegExp(op.value, 'i').test(String(val ?? '')); } catch { return false; }
  }
  return false;
}

export function evalCond(c: Cond, p: Panel, s: NestSettings): boolean {
  if (c.kind === 'group') {
    if (!c.items.length) return !c.not;
    const r = c.mode === 'all' ? c.items.every(i => evalCond(i, p, s)) : c.items.some(i => evalCond(i, p, s));
    return c.not ? !r : r;
  }
  if (c.kind === 'expr') {
    const f = compileExpr(c.expr);
    if (f instanceof Error) return false;
    try { return !!f(exprScope(p, s)); } catch { return false; }
  }
  const val = fieldValue(p, c.field, s);
  if (Array.isArray(val)) {
    // multi-valued field (edges): negative operators mean "none of them"
    if (c.op === '!=' || c.op === 'notContains' || c.op === 'notIn') return val.every(x => cmpOne(x, c));
    return val.some(x => cmpOne(x, c));
  }
  return cmpOne(val, c);
}

/** Does a rule apply to a panel? (orientation filter + conditions) */
export function ruleApplies(r: Rule, p: Panel, s: NestSettings): boolean {
  const a = r.appliesTo ?? 'both';
  if (a !== 'both' && orientationOf(p, s) !== a) return false;
  return evalCond(r.when, p, s);
}

/** Old rules carried "orientation = H/V" as a condition: move it to appliesTo. */
export function normalizeRule(r: Rule): Rule {
  if (r.appliesTo) return r;
  const items = r.when?.items ?? [];
  if (r.when?.mode === 'all' && !r.when.not) {
    const i = items.findIndex(c => c.kind === 'cond' && c.field === 'orientation' && c.op === '=' && ['H', 'V'].includes(c.value.toUpperCase()));
    if (i >= 0) {
      const v = (items[i] as any).value.toUpperCase() as 'H' | 'V';
      return { ...r, appliesTo: v, when: { ...r.when, items: items.filter((_, j) => j !== i) } };
    }
  }
  return { ...r, appliesTo: 'both' };
}

// ---------- panel sides on the sheet ----------

export const ROTS: Rot[] = [0, 90, 180, 270];
export const SIDES: Side[] = ['T', 'B', 'L', 'R'];
const FACING: Record<Rot, Record<Side, Dir>> = {
  0: { T: 'top', B: 'bottom', L: 'left', R: 'right' },
  90: { T: 'left', R: 'top', B: 'right', L: 'bottom' },
  180: { T: 'bottom', B: 'top', L: 'right', R: 'left' },
  270: { T: 'right', R: 'bottom', B: 'left', L: 'top' },
};
/** Mirror about a horizontal line (panel seen from the other face): T and B swap, L and R stay. */
const FLIP: Record<Side, Side> = { T: 'B', B: 'T', L: 'L', R: 'R' };
/** Where a BOM side of the panel ends up on the sheet for a given rotation (after the mirror, if any). */
export const facing = (side: Side, rot: Rot, flip = false): Dir => FACING[rot][flip ? FLIP[side] : side];
/** Which BOM side faces a sheet direction. */
export const sideAt = (dir: Dir, rot: Rot, flip = false): Side => SIDES.find(s => facing(s, rot, flip) === dir)!;
export const placedSize = (w: number, h: number, rot: Rot) => (rot === 90 || rot === 270 ? { w: h, h: w } : { w, h });
export const DIR_LABEL: Record<Dir, string> = { top: 'arriba', bottom: 'abajo', left: 'a la izquierda', right: 'a la derecha' };

export function edgeCode(p: Pick<Panel, 'edgeT' | 'edgeB' | 'edgeL' | 'edgeR'>, s: Side) { return p[`edge${s}` as 'edgeT']; }

/** BOM sides of the panel selected by an EdgeSel ("04, 08" + optional side filter). */
export function matchSides(p: Panel, sel: EdgeSel): Side[] {
  const codes = sel.codes.toUpperCase().split(/[,;| ]+/).map(x => x.trim()).filter(Boolean);
  const pool = sel.sides?.length ? sel.sides : SIDES;
  return pool.filter(s => { const c = String(edgeCode(p, s) ?? '').toUpperCase(); return c && (!codes.length || codes.some(k => c.startsWith(k))); });
}

// ---------- per panel constraints ----------

export interface ZoneConstraint { zone: ZoneDef; forbid: boolean; hard: boolean; weight: number; ruleId: string; ruleName: string }
export interface OrientConstraint { allowed: Rot[]; hard: boolean; weight: number; ruleId: string; ruleName: string; label: string }
export interface SideRule { kind: 'notOnBorder' | 'zone'; sides: Side[]; tol: number; mm?: number; zone?: ZoneDef; mode?: 'inside' | 'outside'; part?: 'return' | 'edge'; hard: boolean; weight: number; ruleId: string; ruleName: string; codes: string }

export interface PanelConstraints {
  uid: string;
  rules: string[];               // rule ids that matched
  exclude: boolean;
  orient: OrientConstraint[];
  rotations: Rot[];               // hard-allowed rotations
  zones: ZoneConstraint[];
  sideRules: SideRule[];
  clearance: Record<Side, number>; // extra clearance (no common line) per BOM side
  gravity: { dir: Dir; weight: number; ruleName: string } | null;
  gap: number;                    // extra clearance all around
  priority: number;
  sheetIds: string[] | null;
  separate: string[];             // extra partition fields
  maxPerSheet: { ruleId: string; ruleName: string; value: number }[];
  dw: number; dh: number;
  returns: Record<Side, number>;  // return (flange) depth per BOM side
  edges: Record<Side, string>;    // edge code per BOM side
  flip: boolean;                  // panel mirrored about a horizontal line (T↔B)
  fixedRot: Rot | null;           // rotation fixed by hand
  pairRules: PairRule[];          // "this side can't share a cut line with a neighbour side coded …"
}
export interface PairRule { sides: Side[]; withCodes: string[]; clearance: number; ruleId: string; ruleName: string; codes: string; mm?: number }

export function allowedRotations(mode: 'A_X' | 'A_Y' | 'long_X' | 'long_Y' | 'free', w: number, h: number): Rot[] {
  switch (mode) {
    case 'A_X': return [0, 180];
    case 'A_Y': return [90, 270];
    case 'long_X': return w >= h ? [0, 180] : [90, 270];
    case 'long_Y': return w >= h ? [90, 270] : [0, 180];
    default: return [...ROTS];
  }
}

export function constraintsFor(p: Panel, rules: Rule[], s: NestSettings): PanelConstraints {
  const c: PanelConstraints = {
    uid: p.uid, rules: [], exclude: !p.include, orient: [], rotations: s.allowRotate ? [...ROTS] : [0], zones: [], sideRules: [],
    clearance: { T: 0, B: 0, L: 0, R: 0 }, gravity: null, gap: 0, priority: 0,
    sheetIds: null, separate: [], maxPerSheet: [], dw: 0, dh: 0,
    returns: { T: 0, B: 0, L: 0, R: 0, ...(p.returns ?? {}) },
    edges: { T: p.edgeT ?? '', B: p.edgeB ?? '', L: p.edgeL ?? '', R: p.edgeR ?? '' }, pairRules: [],
    flip: p.flip ?? (s.mirrorDefault ?? false), fixedRot: p.fixedRot ?? null,
  };
  for (const r of rules) {
    if (!r.enabled) continue;
    if (!ruleApplies(r, p, s)) continue;
    c.rules.push(r.id);
    for (const a of r.actions) applyAction(c, a, r, p);
  }
  if (!c.rotations.length) c.rotations = [0];
  if (c.fixedRot !== null) c.rotations = [c.fixedRot];   // a rotation chosen by hand wins
  return c;
}

function addOrient(c: PanelConstraints, allowed: Rot[], hard: boolean, weight: number, r: Rule, label: string) {
  c.orient.push({ allowed, hard, weight, ruleId: r.id, ruleName: r.name, label });
  if (hard) {
    const next = c.rotations.filter(x => allowed.includes(x));
    c.rotations = next.length ? next : allowed; // on conflict the later rule wins (validation still flags it)
  }
}

function applyAction(c: PanelConstraints, a: Action, r: Rule, p: Panel) {
  switch (a.type) {
    case 'exclude': c.exclude = true; break;
    case 'gap': c.gap = Math.max(c.gap, a.value); break;
    case 'priority': c.priority += a.value; break;
    case 'sheets': c.sheetIds = c.sheetIds ? c.sheetIds.filter(x => a.ids.includes(x)) : [...a.ids]; break;
    case 'separateBy': if (!c.separate.includes(a.field)) c.separate.push(a.field); break;
    case 'maxPerSheet': c.maxPerSheet.push({ ruleId: r.id, ruleName: r.name, value: a.value }); break;
    case 'blankAdjust': c.dw += a.dw; c.dh += a.dh; break;
    case 'forbidZone':
    case 'requireZone':
      c.zones.push({ zone: a.zone, forbid: a.type === 'forbidZone', hard: a.strength === 'hard', weight: a.weight, ruleId: r.id, ruleName: r.name });
      break;
    case 'orientation':
      addOrient(c, allowedRotations(a.mode, p.blankW, p.blankH), a.strength === 'hard', a.weight, r, ({ A_X: 'A en X', A_Y: 'A en Y', long_X: 'lado largo en X', long_Y: 'lado largo en Y', free: 'libre' })[a.mode]);
      break;
    case 'edgeFacing': {
      const sides = matchSides(p, a.edge);
      if (!sides.length) break;
      const allowed = ROTS.filter(rot => sides.some(sd => facing(sd, rot, c.flip) === a.dir));
      addOrient(c, allowed, a.strength === 'hard', a.weight, r, `lado ${a.edge.codes} ${DIR_LABEL[a.dir]}`);
      break;
    }
    case 'edgeNotOnBorder': {
      const sides = matchSides(p, a.edge);
      if (sides.length) c.sideRules.push({ kind: 'notOnBorder', sides, tol: a.tol, hard: a.strength === 'hard', weight: a.weight, ruleId: r.id, ruleName: r.name, codes: a.edge.codes });
      break;
    }
    case 'edgeZone': {
      const sides = matchSides(p, a.edge);
      if (sides.length) c.sideRules.push({ kind: 'zone', sides, tol: 0, zone: a.zone, mode: a.mode, part: a.part ?? 'return', hard: a.strength === 'hard', weight: a.weight, ruleId: r.id, ruleName: r.name, codes: a.edge.codes });
      break;
    }
    case 'edgeNoCommonLine': {
      const sides = matchSides(p, a.edge);
      const withCodes = (a.withCodes ?? '').toUpperCase().split(/[,;| ]+/).map(x => x.trim()).filter(Boolean);
      if (!withCodes.length) { for (const sd of sides) c.clearance[sd] = Math.max(c.clearance[sd], a.clearance); }
      else if (sides.length) c.pairRules.push({ sides, withCodes, clearance: a.clearance, ruleId: r.id, ruleName: r.name, codes: a.edge.codes });
      break;
    }
    case 'edgeClearance': {
      const sides = matchSides(p, a.edge);
      const inch = Math.max(0, a.mm) / 25.4;
      if (!sides.length || a.mm < 0.1) break;   // below 0.1 mm it's just touching
      if (a.border) c.sideRules.push({ kind: 'notOnBorder', sides, tol: inch, mm: a.mm, hard: true, weight: 10, ruleId: r.id, ruleName: r.name, codes: a.edge.codes });
      // '*' = any side of the neighbour that faces this one (parallel faces), coded or not
      if (a.panels) c.pairRules.push({ sides, withCodes: ['*'], clearance: inch, ruleId: r.id, ruleName: r.name, codes: a.edge.codes, mm: a.mm });
      break;
    }
    case 'gravity':
      c.gravity = { dir: a.dir, weight: a.weight, ruleName: r.name };
      break;
  }
}

// ---------- geometry helpers ----------

export interface Rect { x: number; y: number; w: number; h: number }
export interface Infl { l: number; r: number; b: number; t: number }

/** Clearance around a placed panel, per sheet direction (global gap/2 + rule clearances). */
export function inflation(c: PanelConstraints | undefined, rot: Rot, s: NestSettings): Infl {
  const base = s.gap / 2 + (c?.gap ?? 0);
  const cl = (d: Dir) => base + (c ? c.clearance[sideAt(d, rot, c.flip)] : 0);
  return { l: cl('left'), r: cl('right'), b: cl('bottom'), t: cl('top') };
}

export function zoneRect(z: ZoneDef, W: number, H: number): Rect {
  const w = Math.min(z.w, W), h = Math.min(z.h, H);
  switch (z.anchor) {
    case 'TL': return { x: 0, y: H - h, w, h };
    case 'TC': return { x: (W - w) / 2, y: H - h, w, h };
    case 'TR': return { x: W - w, y: H - h, w, h };
    case 'ML': return { x: 0, y: (H - h) / 2, w, h };
    case 'MR': return { x: W - w, y: (H - h) / 2, w, h };
    case 'BL': return { x: 0, y: 0, w, h };
    case 'BC': return { x: (W - w) / 2, y: 0, w, h };
    case 'BR': return { x: W - w, y: 0, w, h };
    case 'T': return { x: 0, y: H - h, w: W, h };
    case 'B': return { x: 0, y: 0, w: W, h };
    case 'L': return { x: 0, y: 0, w, h: H };
    case 'R': return { x: W - w, y: 0, w, h: H };
    case 'TH': return { x: 0, y: H / 2, w: W, h: H / 2 };
    case 'BH': return { x: 0, y: 0, w: W, h: H / 2 };
    case 'LH': return { x: 0, y: 0, w: W / 2, h: H };
    case 'RH': return { x: W / 2, y: 0, w: W / 2, h: H };
    case 'custom': return { x: z.x ?? 0, y: z.y ?? 0, w, h };
  }
}

const EPS = 1e-6;
export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
export const inside = (a: Rect, b: Rect) => a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS;

/** Does a rect violate a zone constraint? */
export function zoneViolated(r: Rect, zc: ZoneConstraint, W: number, H: number): boolean {
  const z = zoneRect(zc.zone, W, H);
  const hit = zc.zone.test === 'inside' ? inside(r, z) : intersects(r, z);
  return zc.forbid ? hit : !hit;
}

export function orientPenalty(c: PanelConstraints, rot: Rot): number {
  let pen = 0;
  for (const o of c.orient) if (!o.hard && !o.allowed.includes(rot)) pen += o.weight;
  return pen;
}

/** The segment of the placed blank that a sheet direction refers to. */
export function sideSegment(r: Rect, d: Dir): Rect {
  switch (d) {
    case 'left': return { x: r.x, y: r.y, w: 0, h: r.h };
    case 'right': return { x: r.x + r.w, y: r.y, w: 0, h: r.h };
    case 'bottom': return { x: r.x, y: r.y, w: r.w, h: 0 };
    case 'top': return { x: r.x, y: r.y + r.h, w: r.w, h: 0 };
  }
}
const segInside = (sg: Rect, z: Rect) => inside(sg, z);
const segHits = (sg: Rect, z: Rect) => sg.w === 0
  ? sg.x > z.x + EPS && sg.x < z.x + z.w - EPS && sg.y < z.y + z.h - EPS && sg.y + sg.h > z.y + EPS
  : sg.y > z.y + EPS && sg.y < z.y + z.h - EPS && sg.x < z.x + z.w - EPS && sg.x + sg.w > z.x + EPS;

/** The strip of the placed blank occupied by a side's return. */
export function returnStrip(r: Rect, d: Dir, depth: number): Rect {
  switch (d) {
    case 'left': return { x: r.x, y: r.y, w: depth, h: r.h };
    case 'right': return { x: r.x + r.w - depth, y: r.y, w: depth, h: r.h };
    case 'bottom': return { x: r.x, y: r.y, w: r.w, h: depth };
    case 'top': return { x: r.x, y: r.y + r.h - depth, w: r.w, h: depth };
  }
}

const OPP: Record<Dir, Dir> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
/**
 * Pairwise "no common line": a side of A and the facing side of B are closer than the clearance
 * one of them asks for. Returns the clearance needed (0 = fine).
 */
export function pairClearance(a: PanelConstraints | undefined, ra: Rect, rotA: Rot, b: PanelConstraints | undefined, rb: Rect, rotB: Rot): { need: number; rule?: PairRule; msg?: string } {
  if (!a || !b || (!a.pairRules.length && !b.pairRules.length)) return { need: 0 };
  // which side of A faces B
  const ovY = Math.min(ra.y + ra.h, rb.y + rb.h) - Math.max(ra.y, rb.y);
  const ovX = Math.min(ra.x + ra.w, rb.x + rb.w) - Math.max(ra.x, rb.x);
  let d: Dir | null = null; let gap = 0;
  if (ovY > 1e-6) {
    if (rb.x >= ra.x + ra.w - 1e-6) { d = 'right'; gap = rb.x - (ra.x + ra.w); }
    else if (ra.x >= rb.x + rb.w - 1e-6) { d = 'left'; gap = ra.x - (rb.x + rb.w); }
  }
  if (!d && ovX > 1e-6) {
    if (rb.y >= ra.y + ra.h - 1e-6) { d = 'top'; gap = rb.y - (ra.y + ra.h); }
    else if (ra.y >= rb.y + rb.h - 1e-6) { d = 'bottom'; gap = ra.y - (rb.y + rb.h); }
  }
  if (!d) return { need: 0 };
  const sa = sideAt(d, rotA, a.flip), sb = sideAt(OPP[d], rotB, b.flip);
  const ca = (a.edges[sa] ?? '').toUpperCase(), cb = (b.edges[sb] ?? '').toUpperCase();
  let need = 0; let rule: PairRule | undefined;
  for (const pr of a.pairRules) if (pr.sides.includes(sa) && pr.withCodes.some(k => k === '*' || (cb && cb.startsWith(k))) && pr.clearance > need) { need = pr.clearance; rule = pr; }
  for (const pr of b.pairRules) if (pr.sides.includes(sb) && pr.withCodes.some(k => k === '*' || (ca && ca.startsWith(k))) && pr.clearance > need) { need = pr.clearance; rule = pr; }
  if (need <= 0 || gap >= need - 1e-3) return { need: 0 };   // 1e-3" tolerance: positions are stored rounded to 4 decimals
  if (rule?.withCodes.includes('*')) {
    const mine = a.pairRules.includes(rule) ? ca : cb, other = a.pairRules.includes(rule) ? cb : ca;
    return { need, rule, msg: `El lado ${mine || '—'} queda a ${(gap * 25.4).toFixed(1)} mm del ${other ? `lado ${other}` : 'lado'} del vecino (mínimo ${rule.mm ?? +(need * 25.4).toFixed(1)} mm)` };
  }
  return { need, rule, msg: `El lado ${ca} queda a ${gap < 1e-3 ? '0' : gap.toFixed(2)}" del lado ${cb} del vecino (sin common line: mínimo ${need}")` };
}

export interface SideViolation { hard: boolean; weight: number; ruleId: string; ruleName: string; msg: string }

/** Check the per-side rules of a placed panel. */
export function sideViolations(c: PanelConstraints, r: Rect, rot: Rot, W: number, H: number, p?: Panel): SideViolation[] {
  const out: SideViolation[] = [];
  for (const sr of c.sideRules) {
    for (const sd of sr.sides) {
      const d = facing(sd, rot, c.flip);
      const code = p ? edgeCode(p, sd) : sr.codes;
      if (sr.kind === 'notOnBorder') {
        const dist = d === 'left' ? r.x : d === 'right' ? W - r.x - r.w : d === 'bottom' ? r.y : H - r.y - r.h;
        if (dist < sr.tol - EPS && sr.mm != null) { out.push({ hard: sr.hard, weight: sr.weight, ruleId: sr.ruleId, ruleName: sr.ruleName, msg: `El lado ${code} queda a ${(Math.max(0, dist) * 25.4).toFixed(1)} mm del borde ${d === 'top' ? 'superior' : d === 'bottom' ? 'inferior' : d === 'left' ? 'izquierdo' : 'derecho'} (mínimo ${sr.mm} mm)` }); break; }
        if (dist < sr.tol - EPS) { out.push({ hard: sr.hard, weight: sr.weight, ruleId: sr.ruleId, ruleName: sr.ruleName, msg: `El lado ${code} queda en el borde ${d === 'top' ? 'superior' : d === 'bottom' ? 'inferior' : d === 'left' ? 'izquierdo' : 'derecho'} de la lámina` }); break; }
      } else if (sr.zone) {
        const z = zoneRect(sr.zone, W, H);
        const depth = sr.part === 'edge' ? 0 : Math.min(c.returns?.[sd] ?? 0, d === 'left' || d === 'right' ? r.w : r.h);
        let bad: boolean;
        if (depth > 0.01) {
          // the whole return strip (from the bend to the cut edge) must be in / out of the zone
          const st = returnStrip(r, d, depth);
          bad = sr.mode === 'outside' ? intersects(st, z) : !inside(st, z);
        } else {
          const sg = sideSegment(r, d);
          bad = sr.mode === 'outside' ? segHits(sg, z) : !segInside(sg, z);
        }
        if (bad) { out.push({ hard: sr.hard, weight: sr.weight, ruleId: sr.ruleId, ruleName: sr.ruleName, msg: sr.mode === 'outside' ? `El lado ${code} entra en la zona prohibida` : `El lado ${code} sale de la zona permitida` }); break; }
      }
    }
  }
  return out;
}

/** Penalty for not hugging the preferred edge (used to rank positions). */
export function gravityTerm(c: PanelConstraints, r: Rect, W: number, H: number): number {
  if (!c.gravity) return 0;
  const d = c.gravity.dir;
  const dist = d === 'top' ? H - r.y - r.h : d === 'bottom' ? r.y : d === 'left' ? r.x : W - r.x - r.w;
  return (c.gravity.weight / 100) * (dist / (d === 'top' || d === 'bottom' ? H : W));
}

const ROT_LABEL = (r: Rot) => `${r}°`;

// ---------- validation of a (possibly hand-edited) layout ----------

export function validateLayout(layout: Layout, panels: Map<string, Panel>, cons: Map<string, PanelConstraints>, s: NestSettings, sheetDefs: SheetDef[]): Map<string, Violation[]> {
  const out = new Map<string, Violation[]>();
  const add = (v: Violation) => { const a = out.get(v.iid) || []; if (!a.some(x => x.ruleId === v.ruleId && x.msg === v.msg)) a.push(v); out.set(v.iid, a); };
  for (const sh of layout.sheets) {
    const m = s.margins;
    const usable: Rect = { x: m.left, y: m.bottom, w: sh.w - m.left - m.right, h: sh.h - m.top - m.bottom };
    const counts = new Map<string, number>();
    const infl = sh.placements.map(pl => inflation(cons.get(pl.uid), pl.rot, s));
    for (let i = 0; i < sh.placements.length; i++) {
      const pl = sh.placements[i];
      const c = cons.get(pl.uid); const p = panels.get(pl.uid);
      if (!c || !p) continue;
      const r: Rect = { x: pl.x, y: pl.y, w: pl.w, h: pl.h };
      if (pl.trial) add({ iid: pl.iid, ruleId: '_trial', ruleName: 'Pieza de prueba', hard: true, msg: 'Pieza de prueba: no sale en la exportación y se quita al optimizar. Bórrala (Supr) cuando termines de revisarla.', penalty: 0 });
      if (!inside(r, usable)) add({ iid: pl.iid, ruleId: '_bounds', ruleName: 'Límites de lámina', hard: true, msg: 'Fuera del área útil (márgenes)', penalty: 0 });
      const a = infl[i];
      const ra = { x: r.x - a.l, y: r.y - a.b, w: r.w + a.l + a.r, h: r.h + a.b + a.t };
      for (let j = i + 1; j < sh.placements.length; j++) {
        const q = sh.placements[j]; const b = infl[j];
        const rb = { x: q.x - b.l, y: q.y - b.b, w: q.w + b.l + b.r, h: q.h + b.b + b.t };
        // both inflated by half the required gap -> they must not overlap
        const shrink = (x: Rect, k: number) => ({ x: x.x + k, y: x.y + k, w: x.w - 2 * k, h: x.h - 2 * k });
        if (intersects(shrink(ra, 1e-4), shrink(rb, 1e-4))) {
          const ov = intersects(r, q);
          const qm = panels.get(q.uid)?.mark;
          add({ iid: pl.iid, ruleId: '_overlap', ruleName: ov ? 'Traslape' : 'Separación', hard: true, msg: ov ? `Se traslapa con ${qm}` : `Falta separación con ${qm} (lado sin common line)`, penalty: 0 });
          add({ iid: q.iid, ruleId: '_overlap', ruleName: ov ? 'Traslape' : 'Separación', hard: true, msg: ov ? `Se traslapa con ${p.mark}` : `Falta separación con ${p.mark} (lado sin common line)`, penalty: 0 });
        } else {
          const pc = pairClearance(c, r, pl.rot, cons.get(q.uid), q, q.rot);
          if (pc.need) {
            const qm = panels.get(q.uid)?.mark;
            add({ iid: pl.iid, ruleId: pc.rule!.ruleId, ruleName: pc.rule!.ruleName, hard: true, msg: `${pc.msg} — con ${qm}`, penalty: 0 });
            add({ iid: q.iid, ruleId: pc.rule!.ruleId, ruleName: pc.rule!.ruleName, hard: true, msg: `Sin common line con ${p.mark}: faltan ${pc.need}" de separación`, penalty: 0 });
          }
        }
      }
      for (const z of c.zones) if (zoneViolated(r, z, sh.w, sh.h)) add({ iid: pl.iid, ruleId: z.ruleId, ruleName: z.ruleName, hard: z.hard, msg: z.forbid ? 'Ubicado en zona prohibida' : 'Fuera de la zona obligatoria', penalty: z.hard ? 0 : z.weight });
      for (const o of c.orient) if (!o.allowed.includes(pl.rot)) add({ iid: pl.iid, ruleId: o.ruleId, ruleName: o.ruleName, hard: o.hard, msg: `Debe ir con ${o.label} (está girado ${ROT_LABEL(pl.rot)})`, penalty: o.hard ? 0 : o.weight });
      if (!c.rotations.includes(pl.rot) && !c.orient.some(o => o.hard)) add({ iid: pl.iid, ruleId: '_rot', ruleName: 'Rotación', hard: true, msg: 'Rotación desactivada en ajustes', penalty: 0 });
      for (const v of sideViolations(c, r, pl.rot, sh.w, sh.h, p)) add({ iid: pl.iid, ruleId: v.ruleId, ruleName: v.ruleName, hard: v.hard, msg: v.msg, penalty: v.hard ? 0 : v.weight });
      if (c.sheetIds && !c.sheetIds.includes(sh.sheetId)) add({ iid: pl.iid, ruleId: '_sheet', ruleName: 'Lámina permitida', hard: true, msg: 'Este tamaño de lámina no está permitido para el panel', penalty: 0 });
      for (const mx of c.maxPerSheet) counts.set(mx.ruleId, (counts.get(mx.ruleId) || 0) + 1);
    }
    for (const pl of sh.placements) {
      const c = cons.get(pl.uid); if (!c) continue;
      for (const mx of c.maxPerSheet) if ((counts.get(mx.ruleId) || 0) > mx.value) add({ iid: pl.iid, ruleId: mx.ruleId, ruleName: mx.ruleName, hard: true, msg: `Máximo ${mx.value} por lámina`, penalty: 0 });
    }
    // partition mixing
    const keys = new Set(sh.placements.map(pl => { const p = panels.get(pl.uid); const c = cons.get(pl.uid); return p && c ? partitionKey(p, [...s.partitionBy, ...c.separate], s) : ''; }));
    if (keys.size > 1) for (const pl of sh.placements) add({ iid: pl.iid, ruleId: '_partition', ruleName: 'Separación por grupo', hard: true, msg: 'Paneles de grupos distintos en la misma lámina', penalty: 0 });
  }
  void sheetDefs;
  return out;
}
