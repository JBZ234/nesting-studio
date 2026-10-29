import { T, Tn } from '../i18n';
// Rule-aware rectangular nesting.
// MaxRects free-space bookkeeping + rule-aware candidate positions,
// sheet-by-sheet greedy filling, and a time-boxed multi-start / local search
// over item orderings and placement heuristics.

import type { Panel, Rule, NestSettings, SheetDef, Layout, SheetLayout, Placement, Rot, SheetSize } from './types';
import { pairClearance, constraintsFor, PanelConstraints, Rect, zoneRect, zoneViolated, orientPenalty, intersects, inside, inflation, placedSize, sideViolations, gravityTerm, Infl, staggerConflicts } from './rules';
import { partitionKey } from './panels';

export interface NestInput {
  panels: Panel[];
  rules: Rule[];
  sheets: SheetDef[];
  settings: NestSettings;
  seed?: SheetLayout[];        // sheets with locked placements to keep
  frozen?: SheetLayout[];      // whole sheets kept exactly as they are
  weights?: { soft: number; uniqueLayout: number; compact: number };
  noExtend?: boolean;          // don't keep searching past timeMs (used by quick what-if runs)
}

interface Item {
  iid: string; uid: string;
  w: number; h: number;       // blank (rot 0)
  c: PanelConstraints;
  area: number;
  infl: Record<Rot, Infl>;    // clearance per sheet side, for each rotation
  part: string;
  mat: string;
}

type Heur = 'gravity' | 'bssf' | 'baf' | 'contact';
const HEURS: Heur[] = ['gravity', 'contact', 'bssf', 'baf'];

// ---------------- MaxRects ----------------

class Packer {
  free: Rect[];
  used: { r: Rect; it: Item; rot: Rot; pr: Rect }[] = [];
  constructor(public W: number, public H: number, public area: Rect, public s: NestSettings, public real: Rect) {
    this.free = [{ ...area }];
  }
  place(r: Rect) {
    const out: Rect[] = [];
    for (const f of this.free) {
      if (!intersects(f, r)) { out.push(f); continue; }
      if (r.x > f.x) out.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) out.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      if (r.y > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) out.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
    }
    // prune
    const keep: Rect[] = [];
    out.sort((a, b) => b.w * b.h - a.w * a.h);
    for (const a of out) {
      if (a.w < 1e-6 || a.h < 1e-6) continue;
      if (keep.some(k => a.x >= k.x - 1e-9 && a.y >= k.y - 1e-9 && a.x + a.w <= k.x + k.w + 1e-9 && a.y + a.h <= k.y + k.h + 1e-9)) continue;
      keep.push(a);
    }
    this.free = keep;
  }
  fits(r: Rect) {
    return this.free.some(f => r.x >= f.x - 1e-9 && r.y >= f.y - 1e-9 && r.x + r.w <= f.x + f.w + 1e-9 && r.y + r.h <= f.y + f.h + 1e-9);
  }
}

function contactScore(p: Packer, r: Rect): number {
  let c = 0;
  const ov = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const A = p.area;
  if (Math.abs(r.x - A.x) < 1e-6) c += r.h;
  if (Math.abs(r.x + r.w - (A.x + A.w)) < 1e-6) c += r.h;
  if (Math.abs(r.y - A.y) < 1e-6) c += r.w;
  if (Math.abs(r.y + r.h - (A.y + A.h)) < 1e-6) c += r.w;
  for (const u of p.used) {
    const q = u.r;
    if (Math.abs(q.x + q.w - r.x) < 1e-6 || Math.abs(r.x + r.w - q.x) < 1e-6) c += ov(r.y, r.y + r.h, q.y, q.y + q.h);
    if (Math.abs(q.y + q.h - r.y) < 1e-6 || Math.abs(r.y + r.h - q.y) < 1e-6) c += ov(r.x, r.x + r.w, q.x, q.x + q.w);
  }
  return c;
}

interface Cand { r: Rect; pr: Rect; rot: Rot; score: number; soft: number }

function bestPosition(p: Packer, it: Item, heur: Heur): Cand | null {
  const { s } = p;
  let best: Cand | null = null;
  const g = it.c.gravity?.dir;
  const fx = g === 'right' ? true : g === 'left' ? false : s.fillFrom.includes('R');
  const fy = g === 'top' ? true : g === 'bottom' ? false : s.fillFrom.includes('T');
  const zr = it.c.zones.filter(z => z.hard).map(z => zoneRect(z.zone, p.W, p.H));
  for (const sr of it.c.sideRules) if (sr.hard && sr.zone) zr.push(zoneRect(sr.zone, p.W, p.H));
  const borderTol = it.c.sideRules.filter(r => r.kind === 'notOnBorder').map(r => r.tol);
  // clearances that pairwise "no common line" rules may ask for (this panel's or any placed panel's)
  const pairCl = [...new Set([...it.c.pairRules, ...p.used.flatMap(u => u.it.c.pairRules)].map(r => r.clearance))].filter(v => v > 0);
  const retDepths = [...new Set(it.c.sideRules.filter(r => r.kind === 'zone' && r.part !== 'edge').flatMap(r => r.sides.map(sd => it.c.returns?.[sd] ?? 0)).filter(v => v > 0.01))];
  const U = p.real;
  for (const rot of it.c.rotations) {
    const { w: pw, h: ph } = placedSize(it.w, it.h, rot);
    const inf = it.infl[rot];
    const iw = pw + inf.l + inf.r, ih = ph + inf.b + inf.t;
    const softRot = orientPenalty(it.c, rot);
    // panel x/y positions worth trying besides free-rect corners
    const px: number[] = [U.x, U.x + U.w - pw], py: number[] = [U.y, U.y + U.h - ph];
    for (const z of zr) {
      px.push(z.x + z.w, z.x - pw, z.x); py.push(z.y + z.h, z.y - ph, z.y);
      for (const rv of retDepths) { px.push(z.x - rv, z.x + z.w - pw + rv); py.push(z.y - rv, z.y + z.h - ph + rv); }
    }
    for (const t of borderTol) { px.push(t + 1e-3, p.W - t - pw - 1e-3); py.push(t + 1e-3, p.H - t - ph - 1e-3); }
    if (pairCl.length) for (const u of p.used) for (const cl of pairCl) {
      px.push(u.pr.x + u.pr.w + cl, u.pr.x - cl - pw); py.push(u.pr.y + u.pr.h + cl, u.pr.y - cl - ph);
    }
    for (const f of p.free) {
      if (iw > f.w + 1e-9 || ih > f.h + 1e-9) continue;
      const xs = new Set<number>([f.x, f.x + f.w - iw]);
      const ys = new Set<number>([f.y, f.y + f.h - ih]);
      for (const x of px) { const rx = x - inf.l; if (rx >= f.x - 1e-9 && rx + iw <= f.x + f.w + 1e-9) xs.add(rx); }
      for (const y of py) { const ry = y - inf.b; if (ry >= f.y - 1e-9 && ry + ih <= f.y + f.h + 1e-9) ys.add(ry); }
      for (const x of xs) for (const y of ys) {
        const r = { x, y, w: iw, h: ih };
        const pr = { x: x + inf.l, y: y + inf.b, w: pw, h: ph };
        if (!inside(pr, U)) continue;
        if (!p.fits(r)) continue;
        let ok = true; let soft = softRot;
        for (const z of it.c.zones) {
          if (zoneViolated(pr, z, p.W, p.H)) { if (z.hard) { ok = false; break; } soft += z.weight; }
        }
        if (!ok) continue;
        for (const v of sideViolations(it.c, pr, rot, p.W, p.H)) { if (v.hard) { ok = false; break; } soft += v.weight; }
        if (!ok) continue;
        if (pairCl.length) for (const u of p.used) { if (pairClearance(it.c, pr, rot, u.it.c, u.pr, u.rot).need) { ok = false; break; } }
        if (!ok) continue;
        let h: number;
        const gx = fx ? (p.W - (pr.x + pw)) : pr.x;           // distance from fill corner
        const gy = fy ? (p.H - (pr.y + ph)) : pr.y;
        switch (heur) {
          case 'gravity': h = (gy + ph) / p.H + gx / (p.W * 50); break;
          case 'bssf': h = Math.min(f.w - iw, f.h - ih) / Math.max(p.W, p.H) + (gy + gx) / (p.W + p.H) * 0.01; break;
          case 'baf': h = (f.w * f.h - iw * ih) / (p.W * p.H) + (gy + gx) / (p.W + p.H) * 0.01; break;
          case 'contact': h = 1 - contactScore(p, r) / (2 * (iw + ih)) + (gy / p.H) * 0.05 + (gx / p.W) * 0.01; break;
        }
        let score = h + soft + gravityTerm(it.c, pr, p.W, p.H);
        if (s.rowAlign) {
          // same row = side by side; prefer neighbours with the same bottom line and height
          let pen = 0;
          for (const u of p.used) {
            const q = u.pr;
            if (Math.min(q.y + q.h, pr.y + ph) - Math.max(q.y, pr.y) <= 1e-6) continue;
            if (Math.min(Math.abs(q.x + q.w - pr.x), Math.abs(pr.x + pw - q.x)) > 1.6) continue;
            pen += Math.abs(q.y - pr.y) < 0.01 && Math.abs(q.h - ph) < 0.01 ? -1 : 1;
          }
          score += pen * (s.rowAlign / 100) * 0.3;
        }
        if (!best || score < best.score - 1e-12) best = { r, pr, rot, score, soft };
      }
    }
  }
  return best;
}

// ---------------- sheet filling ----------------

function realArea(W: number, H: number, s: NestSettings): Rect {
  const m = s.margins;
  return { x: m.left, y: m.bottom, w: W - m.left - m.right, h: H - m.top - m.bottom };
}
/** Packing space = usable area grown by the largest clearance, so panels can still sit flush on the margins. */
function makePacker(W: number, H: number, s: NestSettings, emax: number) {
  const U = realArea(W, H, s);
  return new Packer(W, H, { x: U.x - emax, y: U.y - emax, w: U.w + 2 * emax, h: U.h + 2 * emax }, s, U);
}
const maxInfl = (it: Item) => Math.max(...Object.values(it.infl).flatMap(i => [i.l, i.r, i.b, i.t]));

interface FillResult { packer: Packer; placed: Set<string>; soft: number }

function fillSheet(def: SheetDef, items: Item[], heur: Heur, s: NestSettings, seed?: SheetLayout, byIid?: Map<string, Item>): FillResult {
  let emax = 0;
  for (const it of items) emax = Math.max(emax, maxInfl(it));
  if (seed && byIid) for (const pl of seed.placements) { const it = byIid.get(pl.iid); if (it) emax = Math.max(emax, maxInfl(it)); }
  const packer = makePacker(def.w, def.h, s, emax);
  const placed = new Set<string>(); let soft = 0;
  const counts = new Map<string, number>();
  if (seed && byIid) {
    for (const pl of seed.placements) {
      const it = byIid.get(pl.iid); if (!it) continue;
      const inf = it.infl[pl.rot] ?? it.infl[0];
      const r = { x: pl.x - inf.l, y: pl.y - inf.b, w: pl.w + inf.l + inf.r, h: pl.h + inf.b + inf.t };
      packer.place(r); packer.used.push({ r, it, rot: pl.rot, pr: { x: pl.x, y: pl.y, w: pl.w, h: pl.h } });
      placed.add(pl.iid);
      soft += orientPenalty(it.c, pl.rot);
      for (const v of sideViolations(it.c, pl, pl.rot, def.w, def.h)) if (!v.hard) soft += v.weight;
      for (const mx of it.c.maxPerSheet) counts.set(mx.ruleId, (counts.get(mx.ruleId) || 0) + 1);
    }
  }
  let minW = Infinity;
  for (const it of items) minW = Math.min(minW, Math.min(it.w, it.h));
  // pass 1: panels tied to a zone (e.g. "04 below the middle"); pass 2: free panels fill what is left (e.g. the top)
  const constrained = (it: Item) => it.c.zones.some(z => z.hard) || it.c.sideRules.some(r => r.hard && r.kind === 'zone');
  const order = items.some(constrained) && items.some(it => !constrained(it)) ? [...items.filter(constrained), ...items.filter(it => !constrained(it))] : items;
  for (const it of order) {
    if (it.c.sheetIds && !it.c.sheetIds.includes(def.id)) continue;
    if (it.c.maxPerSheet.some(mx => (counts.get(mx.ruleId) || 0) >= mx.value)) continue;
    if (!packer.free.some(f => f.w >= minW - 1e-9 && f.h >= minW - 1e-9)) break;
    const c = bestPosition(packer, it, heur);
    if (!c) continue;
    packer.place(c.r);
    packer.used.push({ r: c.r, it, rot: c.rot, pr: c.pr });
    placed.add(it.iid); soft += c.soft;
    for (const mx of it.c.maxPerSheet) counts.set(mx.ruleId, (counts.get(mx.ruleId) || 0) + 1);
  }
  return { packer, placed, soft };
}

// ---------------- ceiling-aware stacking ----------------

interface Ceil { rot: Rot; w: number; h: number; yMax: number }
const ceilCache = new WeakMap<PanelConstraints, Map<string, Ceil | null>>();
/**
 * Highest bottom y a panel may take on this sheet without breaking a hard zone rule
 * (e.g. "the 04 return can't enter the top half"). Sampled; side-on-border rules are ignored here.
 */
function ceilingOf(it: Item, def: SheetDef, s: NestSettings): Ceil | null {
  let m = ceilCache.get(it.c); if (!m) { m = new Map(); ceilCache.set(it.c, m); }
  const key = `${def.w}x${def.h}`;
  if (m.has(key)) return m.get(key)!;
  const U = realArea(def.w, def.h, s);
  const zoneRules = { ...it.c, sideRules: it.c.sideRules.filter(r => r.kind === 'zone' && r.hard) };
  let best: Ceil | null = null;
  if (zoneRules.sideRules.length || it.c.zones.some(z => z.hard)) {
    for (const rot of it.c.rotations) {
      const { w, h } = placedSize(it.w, it.h, rot);
      if (w > U.w + 1e-9 || h > U.h + 1e-9) continue;
      let yMax = -1;
      for (let y = U.y; y <= U.y + U.h - h + 1e-9; y += 0.25) {
        const r = { x: U.x, y, w, h };
        const bad = it.c.zones.some(z => z.hard && zoneViolated(r, z, def.w, def.h)) || sideViolations(zoneRules, r, rot, def.w, def.h).some(v => v.hard);
        if (bad) { if (yMax >= 0) break; else continue; }
        yMax = y;
      }
      if (yMax >= 0 && (!best || yMax > best.yMax)) best = { rot, w, h, yMax };
    }
  }
  m.set(key, best);
  return best;
}

/**
 * Orders for sheets where some panels can't sit high (a ceiling on their bottom edge):
 * a bottom row of low panels first, so a row of tall panels still starts under the ceiling
 * and reaches up into the free top. Returns several item orders to try.
 */
function stackOrders(def: SheetDef, items: Item[], s: NestSettings): Item[][] {
  const U = realArea(def.w, def.h, s);
  const C: { it: Item; c: Ceil }[] = [];
  for (const it of items) {
    if (it.c.sheetIds && !it.c.sheetIds.includes(def.id)) continue;
    const c = ceilingOf(it, def, s);
    if (c && c.yMax < U.y + U.h - c.h - 0.5) C.push({ it, c });
  }
  if (C.length < 2) return [];
  const clr = (x: { it: Item; c: Ceil }) => { const i = x.it.infl[x.c.rot]; return { lr: i.l + i.r, t: i.t, b: i.b }; };
  const heights = [...new Set(C.map(x => +x.c.h.toFixed(2)))].sort((a, b) => a - b);
  const out: Item[][] = [];
  const seen = new Set<string>();
  for (const hb of heights.slice(0, 8)) {
    const pickRow = (pool: typeof C, cap: number) => {
      const row: typeof C = []; let used = 0;
      for (const x of pool) { const ww = x.c.w + clr(x).lr; if (used + ww <= cap + 1e-6) { row.push(x); used += ww; } }
      return row;
    };
    const bottom = pickRow(C.filter(x => x.c.h <= hb + 0.01).sort((a, b) => (b.c.h - a.c.h) || (b.c.w - a.c.w)), U.w + 1);
    if (!bottom.length) continue;
    const bTop = Math.max(...bottom.map(x => x.c.h + clr(x).t));
    const inB = new Set(bottom.map(x => x.it.iid));
    const top = pickRow(C.filter(x => !inB.has(x.it.iid) && x.c.yMax >= U.y + bTop + clr(x).b - 0.3 && U.y + bTop + clr(x).b + x.c.h <= U.y + U.h + 1e-6)
      .sort((a, b) => (b.c.h - a.c.h) || (b.c.w - a.c.w)), U.w + 1);
    if (!top.length) continue;
    const k = [...bottom, ...top].map(x => x.it.uid).join(',');
    if (seen.has(k)) continue; seen.add(k);
    const lead = new Set([...inB, ...top.map(x => x.it.iid)]);
    const restC = C.filter(x => !lead.has(x.it.iid)).map(x => x.it);
    const inC = new Set(C.map(x => x.it.iid));
    out.push([...bottom.map(x => x.it), ...top.map(x => x.it), ...restC, ...items.filter(it => !inC.has(it.iid))]);
  }
  return out;
}

// ---------------- grid ("cuadriculado") sheets ----------------

/** Rows of equal height, panels side by side: the layout the shop prefers (clean cuts). */
export function isGridLayout(pls: { x: number; y: number; w: number; h: number }[], E = 0.05, hTol = E) {
  if (pls.length < 2) return true;
  const rows: { y: number; h: number; top: number }[] = [];
  for (const p of pls) {
    const r = rows.find(q => Math.abs(q.y - p.y) < E || Math.abs(q.top - (p.y + p.h)) < E);
    if (r) { if (Math.abs(r.h - p.h) > hTol + 1e-6) return false; r.h = Math.max(r.h, p.h); r.y = Math.min(r.y, p.y); r.top = Math.max(r.top, p.y + p.h); }
    else rows.push({ y: p.y, h: p.h, top: p.y + p.h });
  }
  rows.sort((a, b) => a.y - b.y);
  for (let i = 1; i < rows.length; i++) if (rows[i].y < rows[i - 1].top - E) return false;
  return true;
}

type GridPl = { uid: string; x: number; y: number; w: number; h: number; rot: Rot };
const gridCache = new Map<string, GridPl[] | null>();

/**
 * Best "grid" for one sheet: rows of panels of the same height, side by side, rows stacked from the
 * side the panels are pulled to. Searches which height goes in which row (respecting every hard
 * rule, e.g. low rows first so taller rows still start under the 04 ceiling).
 */
function gridFill(def: SheetDef, items: Item[], s: NestSettings): GridPl[] | null {
  const counts = countBy(items);
  const key = def.id + '|' + def.w + 'x' + def.h + '|' + (s.gridTol ?? 0.1) + '|' + [...counts].sort().map(([u, c]) => `${u}:${c}`).join(',');
  if (gridCache.has(key)) return gridCache.get(key)!;
  if (gridCache.size > 4000) gridCache.clear();
  const U = realArea(def.w, def.h, s);
  type G = { it: Item; rot: Rot; w: number; h: number; inf: Infl };
  // one representative per uid (identical panels behave the same), with its count
  const reps: { g: G; n: number }[] = [];
  for (const [u, n] of counts) {
    const it = items.find(i => i.uid === u)!;
    if (it.c.sheetIds && !it.c.sheetIds.includes(def.id)) continue;
    // every rotation that keeps the soft preferences as well as the best one does (e.g. 0° and 90° for a free panel)
    const best = Math.min(...it.c.rotations.map(r => orientPenalty(it.c, r)));
    const seenWH = new Set<string>();
    for (const rot of it.c.rotations) {
      if (orientPenalty(it.c, rot) > best + 1e-9) continue;
      const d = placedSize(it.w, it.h, rot);
      if (d.w > U.w + 1e-6 || d.h > U.h + 1e-6) continue;
      const k = d.w.toFixed(3) + 'x' + d.h.toFixed(3);
      if (seenWH.has(k)) continue; seenWH.add(k);
      reps.push({ g: { it, rot, w: d.w, h: d.h, inf: it.infl[rot] }, n });
    }
  }
  if (reps.length === 0) { gridCache.set(key, null); return null; }
  const dirs = reps.map(r => r.g.it.c.gravity?.dir);
  const fromTop = dirs.filter(d => d === 'top').length > dirs.filter(d => d === 'bottom').length;
  // height classes, biggest total area first
  // rows: panels whose heights differ at most gridTol share a row (row height = the tallest)
  const tolH = s.gridTol ?? 0.1;
  const hs = [...new Set(reps.map(r => +r.g.h.toFixed(3)))].sort((a, b) => a - b);
  const classes = new Map<string, { h: number; reps: typeof reps }>();
  for (const h0 of hs) {
    const members = reps.filter(r => r.g.h >= h0 - 1e-6 && r.g.h <= h0 + tolH + 1e-6);
    const h = Math.max(...members.map(r => r.g.h));
    classes.set(h0.toFixed(3), { h, reps: members });
  }
  const cls = [...classes.values()].sort((a, b) => b.reps.reduce((x, r) => x + r.n * r.g.w * r.g.h, 0) - a.reps.reduce((x, r) => x + r.n * r.g.w * r.g.h, 0)).slice(0, 6);
  for (const c of cls) c.reps.sort((a, b) => b.g.w - a.g.w || a.g.it.uid.localeCompare(b.g.it.uid));
  const borderTols = [...new Set(reps.flatMap(r => r.g.it.c.sideRules.filter(x => x.kind === 'notOnBorder' && x.hard).map(x => x.tol)))];
  // exact separations asked between facing sides (rules "sin common line" / "separado X mm")
  const pairCls = [...new Set(reps.flatMap(r => r.g.it.c.pairRules.map(x => x.clearance)))].filter(v => v > 0);

  const ok = (g: G, r: Rect, placed: { g: G; r: Rect }[]) => {
    if (!inside(r, U)) return false;
    const c = g.it.c;
    if (c.zones.some(z => z.hard && zoneViolated(r, z, def.w, def.h))) return false;
    if (sideViolations(c, r, g.rot, def.w, def.h).some(v => v.hard)) return false;
    const a = g.inf;
    const ra = { x: r.x - a.l + 1e-4, y: r.y - a.b + 1e-4, w: r.w + a.l + a.r - 2e-4, h: r.h + a.b + a.t - 2e-4 };
    for (const p of placed) {
      const b = p.g.inf;
      if (intersects(ra, { x: p.r.x - b.l + 1e-4, y: p.r.y - b.b + 1e-4, w: p.r.w + b.l + b.r - 2e-4, h: p.r.h + b.b + b.t - 2e-4 })) return false;
      if (pairClearance(c, r, g.rot, p.g.it.c, p.r, p.g.rot).need) return false;
    }
    return true;
  };

  let best: { area: number; pls: { g: G; r: Rect }[] } = { area: 0, pls: [] };
  let nodes = 0;
  const left = new Map(reps.map(r => [r.g.it.uid, r.n]));
  const dfs = (edge: number, first: boolean, placed: { g: G; r: Rect }[], area: number, room: number, raw = edge) => {
    if (++nodes > 2500) return;
    if (area > best.area + 1e-6) best = { area, pls: [...placed] };
    if (area + room * U.w <= best.area + 1e-6) return;
    for (const c of cls) {
      if (!c.reps.some(r => left.get(r.g.it.uid)! > 0)) continue;
      const infB = Math.max(...c.reps.map(r => r.g.inf.b)), infT = Math.max(...c.reps.map(r => r.g.inf.t));
      const y0 = fromTop ? (first ? U.y + U.h - c.h : edge - infT - c.h) : (first ? U.y : edge + infB);
      // a row may have to sit a set distance from the previous one (facing sides with a separation rule)
      const ys = [y0, ...(first ? borderTols.map(t => fromTop ? U.y + U.h - t - 1e-3 - c.h : U.y + t + 1e-3) : pairCls.map(cl => fromTop ? raw - cl - c.h : raw + cl))]
        .filter((v, i, a) => a.findIndex(w => Math.abs(w - v) < 1e-4) === i && (fromTop ? v <= y0 + 1e-9 : v >= y0 - 1e-9));
      let rowBest: { row: { g: G; r: Rect }[]; take: Map<string, number>; y: number; a: number } | null = null;
      for (const y of ys) {
      if (y < U.y - 1e-6 || y + c.h > U.y + U.h + 1e-6) continue;
      // fill the row left to right
      const row: { g: G; r: Rect }[] = [];
      const take = new Map<string, number>();
      let x = U.x; let lastRight = U.x;
      for (const r of c.reps) {
        while ((left.get(r.g.it.uid)! - (take.get(r.g.it.uid) ?? 0)) > 0) {
          const starts = row.length ? [x + r.g.inf.l, ...pairCls.map(cl => lastRight + cl)] : [U.x, ...borderTols.map(t => U.x + t + 1e-3)];
          let put: Rect | null = null;
          for (const sx of starts) {
            // within a row: bottoms aligned (or tops, when stacking from the top)
            const rr = { x: sx, y: fromTop ? y + c.h - r.g.h : y, w: r.g.w, h: r.g.h };
            if (rr.x + rr.w > U.x + U.w + 1e-6) continue;
            if (ok(r.g, rr, [...placed, ...row])) { put = rr; break; }
          }
          if (!put) break;
          row.push({ g: r.g, r: put }); take.set(r.g.it.uid, (take.get(r.g.it.uid) ?? 0) + 1);
          if (row.length > 40) break;
          x = put.x + put.w + r.g.inf.r; lastRight = put.x + put.w;
        }
      }
      const ra = row.reduce((a, p) => a + p.g.it.area, 0);
      if (row.length && (!rowBest || ra > rowBest.a + 1e-6)) rowBest = { row, take, y, a: ra };
      }
      if (!rowBest) continue;
      const { row, take, y } = rowBest;
      for (const [u, k] of take) left.set(u, left.get(u)! - k);
      const rowArea = row.reduce((a, p) => a + p.g.it.area, 0);
      const next = fromTop ? y - Math.max(...row.map(p => p.g.inf.b)) : y + c.h + Math.max(...row.map(p => p.g.inf.t));
      const room2 = fromTop ? next - U.y : U.y + U.h - next;
      dfs(next, false, [...placed, ...row], area + rowArea, Math.max(0, room2), fromTop ? y : y + c.h);
      for (const [u, k] of take) left.set(u, left.get(u)! + k);
    }
  };
  dfs(fromTop ? U.y + U.h : U.y, true, [], 0, U.h);
  const res = best.pls.length ? best.pls.map(p => ({ uid: p.g.it.uid, x: +p.r.x.toFixed(4), y: +p.r.y.toFixed(4), w: p.r.w, h: p.r.h, rot: p.g.rot })) : null;
  gridCache.set(key, res);
  return res;
}

function sheetMatches(def: SheetDef, mat: string) {
  if (!def.material) return true;
  return def.material.split(/[,;]/).map(x => x.trim().toUpperCase()).some(m => m && mat.toUpperCase().includes(m));
}

interface Solution { sheets: SheetLayout[]; unplaced: Layout['unplaced']; soft: number; cost: number; usedArea: number; sheetArea: number }

function signature(sh: SheetLayout) {
  return sh.sheetId + ':' + sh.placements.map(p => `${p.uid}@${p.x.toFixed(2)},${p.y.toFixed(2)},${p.rot}`).sort().join('|');
}

/** "Filas escalonadas": while choosing between candidate nestings, aligned cuts between rows cost like a broken preference (×10 if the rule is required) */
function staggerPenalty(pls: Placement[], byIid: Map<string, Item>, def: SheetDef, s: NestSettings) {
  if (!pls.some(p => byIid.get(p.iid)?.c.stagger)) return 0;
  const cu = new Map(pls.map(p => [p.uid, byIid.get(p.iid)?.c]));
  return staggerConflicts(pls, u => cu.get(u), def.w, def.h, s).reduce((a, k) => a + (k.rule.hard ? 10 : 1) * k.rule.weight, 0);
}

/** set by nest() while its first pass runs: reports progress as sheets are filled */
let progressTick: ((sheets: number) => void) | null = null;

function solve(groups: Map<string, Item[]>, heur: Heur, input: NestInput, seeds: SheetLayout[], byIid: Map<string, Item>): Solution {
  const s = input.settings;
  const W = input.weights ?? { soft: 50, uniqueLayout: 400, compact: 100 };
  const stock = new Map<string, number>();
  for (const d of input.sheets) if (d.stock !== null && d.stock !== undefined) stock.set(d.id, d.stock);
  const sheets: SheetLayout[] = []; const unplaced: Solution['unplaced'] = [];
  let soft = 0, usedArea = 0, sheetArea = 0, n = 0;
  const seedByPart = new Map<string, SheetLayout[]>();
  for (const sd of seeds) { const a = seedByPart.get(sd.partition) || []; a.push(sd); seedByPart.set(sd.partition, a); }

  const commit = (def: SheetDef, fr: FillResult, part: string) => {
    const pls: Placement[] = fr.packer.used.map(u => ({ iid: u.it.iid, uid: u.it.uid, x: +u.pr.x.toFixed(4), y: +u.pr.y.toFixed(4), w: u.pr.w, h: u.pr.h, rot: u.rot }));
    sheets.push({ id: `S${++n}`, sheetId: def.id, w: def.w, h: def.h, partition: part, placements: pls });
    progressTick?.(sheets.length);
    if (stock.has(def.id)) stock.set(def.id, stock.get(def.id)! - 1);
    soft += fr.soft + staggerPenalty(pls, byIid, def, s); sheetArea += def.w * def.h;
    usedArea += fr.packer.used.reduce((a, u) => a + u.it.area, 0);
  };

  for (const [part, items0] of groups) {
    let remaining = [...items0];
    const mat = items0[0]?.mat ?? '';
    const defs = input.sheets.filter(d => d.enabled && sheetMatches(d, mat));
    // seeded sheets first
    for (const sd of seedByPart.get(part) || []) {
      const def = input.sheets.find(d => d.id === sd.sheetId) ?? { id: sd.sheetId, name: '', w: sd.w, h: sd.h, enabled: true, stock: null, material: '' };
      const fr = fillSheet(def, remaining, heur, s, sd, byIid);
      remaining = remaining.filter(it => !fr.placed.has(it.iid));
      // locked placements keep their lock flag
      const before = sheets.length; commit(def, fr, part);
      const locked = new Set(sd.placements.filter(p => p.locked).map(p => p.iid));
      for (const pl of sheets[before].placements) if (locked.has(pl.iid)) pl.locked = true;
    }
    let guard = 0;
    while (remaining.length && guard++ < 5000) {
      const avail = defs.filter(d => !stock.has(d.id) || stock.get(d.id)! > 0);
      const remCount = countBy(remaining);
      const cands: { def: SheetDef; fr: FillResult; util: number; all: boolean; r: number; grid: boolean }[] = [];
      const tryFill = (def: SheetDef, items: Item[], seedSh?: SheetLayout) => {
        const fr = fillSheet(def, items, heur, s, seedSh, byIid);
        if (!fr.placed.size) return;
        const area = fr.packer.used.reduce((a, u) => a + u.it.area, 0);
        const util = area / (def.w * def.h);
        // how many times this exact sheet can be repeated with what is left
        let r = Infinity;
        for (const [u, c] of countBy(fr.packer.used.map(x => x.it))) r = Math.min(r, Math.floor((remCount.get(u) || 0) / c));
        if (stock.has(def.id)) r = Math.min(r, stock.get(def.id)!);
        r = Math.max(1, isFinite(r) ? r : 1);
        if (!s.repeatSheets || util < (s.repeatMinUtil ?? 0) / 100) r = 1;
        const placedN = fr.packer.used.length;
        const grid = (s.gridWeight ?? 0) > 0 && isGridLayout(fr.packer.used.map(u => u.pr), 0.05, s.gridTol ?? 0.1);
        cands.push({ def, fr, util, all: placedN === remaining.length, r, grid });
      };
      for (const def of avail) {
        tryFill(def, remaining);
        for (const o of stackOrders(def, remaining, s)) tryFill(def, o);
        if ((s.gridWeight ?? 0) > 0) {
          const g = gridFill(def, remaining, s);
          if (g) {
            // map the grid (by panel) onto concrete pieces
            const pool = new Map<string, Item[]>();
            for (const it of remaining) { const a = pool.get(it.uid) || []; a.push(it); pool.set(it.uid, a); }
            const pls: Placement[] = g.map(q => ({ ...q, iid: pool.get(q.uid)!.shift()!.iid, locked: true }));
            const seedSh: SheetLayout = { id: 'g', sheetId: def.id, w: def.w, h: def.h, partition: '', placements: pls };
            const usedI = new Set(pls.map(p => p.iid));
            tryFill(def, [], seedSh);                                                   // pure grid
            tryFill(def, remaining.filter(it => !usedI.has(it.iid)), seedSh);          // grid + fill the leftovers
          }
        }
        if (s.repeatSheets) {
          // also try sheets led by the most repeated panels (same panel as many times as it fits)
          const areaOf = new Map(remaining.map(it => [it.uid, it.area]));
          const top = [...remCount].filter(([, c]) => c >= 2).sort((a, b) => b[1] * areaOf.get(b[0])! - a[1] * areaOf.get(a[0])!).slice(0, 3);
          for (const [u] of top) {
            const own = remaining.filter(i => i.uid === u);
            const solo = fillSheet(def, own, heur, s);
            const k = solo.placed.size;
            if (!k) continue;
            const r0 = Math.floor(own.length / k);
            if (r0 < 2) { tryFill(def, [...own, ...remaining.filter(i => i.uid !== u)]); continue; }
            for (const rr of [r0, Math.max(2, Math.floor(r0 / 2))]) {
              const extra: Item[] = [];
              for (const [v, c] of remCount) {
                if (v === u || c < rr) continue;
                extra.push(...remaining.filter(i => i.uid === v).slice(0, Math.floor(c / rr)));
              }
              tryFill(def, [...own.slice(0, k), ...extra]);
            }
          }
        }
      }
      // Material first: a repeatable sheet may only win if it wastes at most `tol` more than the fullest option.
      const uBest = Math.max(0, ...cands.map(c => c.util));
      const w = s.repeatSheets ? (s.repeatWeight ?? 40) / 100 : 0;
      const tol = w * 0.3;
      // grid sheets (rows of equal height) may give up some material to look clean, up to G
      const G = ((s.gridWeight ?? 0) / 100) * 0.15;
      let best: { def: SheetDef; fr: FillResult; m: number; r: number } | null = null;
      for (const c of cands) {
        if (c.util < uBest - tol - (c.grid ? G : 0) - 1e-9 && !c.all) continue;
        const m = (c.all ? 10 : 0) + c.util - c.fr.soft * 0.001 + (c.r > 1 ? w * 0.08 * Math.log2(c.r) : 0) + (c.grid ? G : 0);
        if (!best || m > best.m) best = { def: c.def, fr: c.fr, m, r: c.r };
      }
      const chosen = best as { def: SheetDef; fr: FillResult; m: number; r: number } | null;
      if (!chosen) {
        const it = remaining.shift()!;
        const noStock = !avail.length && defs.length > 0;
        const reason = !defs.length ? T('No hay tamaños de lámina seleccionados para este material')
          : noStock ? T('Se acabó la cantidad disponible de láminas')
          : it.c.sheetIds ? T('No cabe en las láminas permitidas por sus reglas')
          : T('No cabe en ninguna lámina con las reglas duras actuales');
        unplaced.push({ iid: it.iid, uid: it.uid, reason, kind: noStock || !defs.length ? 'stock' : 'fit' });
        continue;
      }
      remaining = remaining.filter(it => !chosen!.fr.placed.has(it.iid));
      commit(chosen.def, chosen.fr, part);
      // repeat the same sheet with other copies of the same panels
      for (let k = 1; k < chosen.r; k++) {
        const proto = sheets[sheets.length - 1];
        const pool = new Map<string, Item[]>();
        for (const it of remaining) { const a = pool.get(it.uid) || []; a.push(it); pool.set(it.uid, a); }
        if (proto.placements.some(pl => !(pool.get(pl.uid)?.length))) break;
        const used = new Set<string>();
        const pls = proto.placements.map(pl => { const it = pool.get(pl.uid)!.shift()!; used.add(it.iid); return { ...pl, iid: it.iid, locked: undefined }; });
        sheets.push({ ...proto, id: `S${++n}`, placements: pls });
        if (stock.has(chosen.def.id)) stock.set(chosen.def.id, stock.get(chosen.def.id)! - 1);
        soft += chosen.fr.soft; sheetArea += chosen.def.w * chosen.def.h;
        usedArea += pls.reduce((a, pl) => a + (byIid.get(pl.iid)?.area ?? 0), 0);
        remaining = remaining.filter(it => !used.has(it.iid));
      }
    }
  }
  // cost
  const uniq = new Set(sheets.map(signature)).size;
  const last = sheets[sheets.length - 1];
  let compact = 0;
  if (last && last.placements.length) {
    const fx = s.fillFrom.includes('R'), fy = s.fillFrom.includes('T');
    let x1 = 0, y1 = 0;
    for (const p of last.placements) {
      x1 = Math.max(x1, fx ? last.w - p.x : p.x + p.w);
      y1 = Math.max(y1, fy ? last.h - p.y : p.y + p.h);
    }
    compact = Math.min(x1 / last.w, y1 / last.h);
  }
  const cost = unplaced.length * 1e9 + sheetArea + soft * W.soft + uniq * W.uniqueLayout + compact * W.compact;
  return { sheets, unplaced, soft, cost, usedArea, sheetArea };
}

function countBy(items: Item[]) { const m = new Map<string, number>(); for (const it of items) m.set(it.uid, (m.get(it.uid) || 0) + 1); return m; }

// ---------------- driver ----------------

export interface NestProgress { iteration: number; bestCost: number; sheets: number; elapsed: number; unplaced?: number; extended?: boolean }

function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const inflTable = (c: PanelConstraints, s: NestSettings) => ({ 0: inflation(c, 0, s), 90: inflation(c, 90, s), 180: inflation(c, 180, s), 270: inflation(c, 270, s) }) as Record<Rot, Infl>;

export function buildItems(input: NestInput): { items: Item[]; excluded: string[]; cons: Map<string, PanelConstraints> } {
  const s = input.settings;
  const items: Item[] = []; const excluded: string[] = [];
  const cons = new Map<string, PanelConstraints>();
  for (const p of input.panels) {
    const c = constraintsFor(p, input.rules, s);
    cons.set(p.uid, c);
    if (c.exclude || p.qty <= 0) { excluded.push(p.uid); continue; }
    const w = p.blankW + c.dw, h = p.blankH + c.dh;
    if (!(w > 0 && h > 0)) { excluded.push(p.uid); continue; }
    const part = partitionKey(p, [...s.partitionBy, ...c.separate], s);
    for (let k = 1; k <= Math.round(p.qty); k++) {
      items.push({ iid: `${p.uid}#${k}`, uid: p.uid, w, h, c, area: w * h, infl: inflTable(c, s), part, mat: `${p.material} ${p.mtl}` });
    }
  }
  return { items, excluded, cons };
}

export function nest(input: NestInput, onProgress?: (p: NestProgress) => void, shouldStop?: () => boolean): Layout {
  const t0 = Date.now();
  const { items: allItems } = buildItems(input);
  // frozen sheets consume their pieces first and are returned untouched
  const frozen = (input.frozen ?? []).map(sh => ({ ...sh, locked: true, placements: sh.placements.map(p => ({ ...p })) }));
  const pool = new Map<string, Item[]>();
  for (const it of allItems) { const a = pool.get(it.uid) || []; a.push(it); pool.set(it.uid, a); }
  const consumed = new Set<string>();
  let frozenUsed = 0, frozenArea = 0;
  for (const sh of frozen) {
    frozenArea += sh.w * sh.h;
    for (const pl of sh.placements) {
      const arr = pool.get(pl.uid) || [];
      const i = Math.max(0, arr.findIndex(it => it.iid === pl.iid));
      const it = arr[i];
      if (it) { arr.splice(i, 1); consumed.add(it.iid); pl.iid = it.iid; frozenUsed += it.area; }
      else frozenUsed += pl.w * pl.h;
    }
  }
  const items = allItems.filter(it => !consumed.has(it.iid));
  // frozen sheets use up stock too
  if (frozen.length) input = { ...input, sheets: input.sheets.map(d => d.stock === null || d.stock === undefined ? d : { ...d, stock: Math.max(0, d.stock - frozen.filter(f => f.sheetId === d.id).length) }) };
  const byIid = new Map(items.map(i => [i.iid, i]));
  const seeds = (input.seed ?? []).map(sd => ({ ...sd, placements: sd.placements.filter(p => p.locked && byIid.has(p.iid)) })).filter(sd => sd.placements.length);
  const seeded = new Set(seeds.flatMap(sd => sd.placements.map(p => p.iid)));
  const groups = new Map<string, Item[]>();
  for (const it of items) { if (seeded.has(it.iid)) continue; const a = groups.get(it.part) || []; a.push(it); groups.set(it.part, a); }
  for (const sd of seeds) if (!groups.has(sd.partition)) groups.set(sd.partition, []);

  const key = (it: Item, k: 'area' | 'long' | 'h' | 'w' | 'per') =>
    k === 'area' ? it.area : k === 'long' ? Math.max(it.w, it.h) : k === 'h' ? it.h : k === 'w' ? it.w : it.w + it.h;
  const sorter = (k: 'area' | 'long' | 'h' | 'w' | 'per') => (arr: Item[]) =>
    [...arr].sort((a, b) => (b.c.priority - a.c.priority) || (key(b, k) - key(a, k)) || a.uid.localeCompare(b.uid) || a.iid.localeCompare(b.iid));
  const orders = (['area', 'long', 'h', 'w', 'per'] as const).map(sorter);

  let best: Solution | null = null; let bestOrderIdx = 0; let bestHeur: Heur = 'gravity';
  let iter = 0;
  // With quantity limits, placing every panel comes first: keep searching (up to 6× the time, max 45 s) while pieces are left out.
  const limited = !input.noExtend && input.sheets.some(d => d.enabled && d.stock !== null && d.stock !== undefined);
  const hardStop = Math.max(input.settings.timeMs, Math.min(input.settings.timeMs * 6, 45000));
  const keepGoing = () => {
    const el = Date.now() - t0;
    if (el < input.settings.timeMs) return true;
    return limited && !!best && best.unplaced.length > 0 && el < hardStop;
  };
  const report = () => onProgress?.({ iteration: iter, bestCost: best?.cost ?? 0, sheets: best?.sheets.length ?? 0, elapsed: Date.now() - t0, unplaced: best?.unplaced.length ?? 0, extended: Date.now() - t0 > input.settings.timeMs });
  // big jobs (thousands of pieces) take seconds per pass: report each pass, and while the first one
  // is running report the sheets it has filled so far, so the screen never sits at "0 combinations"
  let lastTick = 0;
  progressTick = (n: number) => {
    if (best || !onProgress) return;
    const now = Date.now(); if (now - lastTick < 600) return; lastTick = now;
    onProgress({ iteration: 0, bestCost: 0, sheets: n, elapsed: now - t0, unplaced: 0 });
  };
  first: for (let oi = 0; oi < orders.length; oi++) for (const h of HEURS) {
    const ordered = new Map([...groups].map(([k, g]) => [k, orders[oi](g)] as [string, Item[]]));
    const sol = solve(ordered, h, input, seeds, byIid); iter++;
    if (!best || sol.cost < best.cost) { best = sol; bestOrderIdx = oi; bestHeur = h; }
    report();
    const el = Date.now() - t0;
    // stop trying start orders when the time is (mostly) used; slow passes may stop after 1 or 2
    if ((el > input.settings.timeMs * 0.6 && iter >= 4) || (el > input.settings.timeMs && iter >= 2) || el > input.settings.timeMs * 1.5) break first;
  }
  progressTick = null;
  // local search on per-group orderings: swap blocks of identical panels
  const rnd = mulberry32(12345);
  let curOrders = new Map<string, Item[]>();
  for (const [k, g] of groups) curOrders.set(k, orders[bestOrderIdx](g));
  let curCost = best!.cost;
  let stale = 0;
  while (keepGoing() && !(shouldStop?.())) {
    // stuck while pieces are still out: restart from another base order
    if (best!.unplaced.length && ++stale > 30) {
      stale = 0;
      const oi = Math.floor(rnd() * orders.length);
      curOrders = new Map([...groups].map(([k, g]) => [k, orders[oi](g)] as [string, Item[]]));
      curCost = Infinity;
    }
    const next = new Map<string, Item[]>();
    for (const [k, arr] of curOrders) {
      const a = [...arr];
      if (a.length > 2) {
        const moves = 1 + Math.floor(rnd() * 3);
        for (let m = 0; m < moves; m++) {
          // move a block of same-uid items (keeps identical panels together)
          const i = Math.floor(rnd() * a.length);
          let i0 = i, i1 = i; while (i0 > 0 && a[i0 - 1].uid === a[i].uid) i0--; while (i1 < a.length - 1 && a[i1 + 1].uid === a[i].uid) i1++;
          const take = rnd() < 0.5 ? a.splice(i0, i1 - i0 + 1) : a.splice(i, 1);
          let j = Math.floor(rnd() * (a.length + 1));
          // keep priority tiers ordered
          const pr = take[0].c.priority;
          while (j > 0 && a[j - 1].c.priority < pr) j--;
          while (j < a.length && a[j].c.priority > pr) j++;
          a.splice(j, 0, ...take);
        }
      }
      next.set(k, a);
    }
    const h = rnd() < 0.7 ? bestHeur : HEURS[Math.floor(rnd() * HEURS.length)];
    const sol = solve(next, h, input, seeds, byIid);
    iter++;
    if (sol.cost <= curCost) { curCost = sol.cost; curOrders = next; }
    if (sol.cost < best!.cost) { if (sol.unplaced.length < best!.unplaced.length) stale = 0; best = sol; bestHeur = h; report(); }
    if (iter % 10 === 0) report();
  }
  const b = best!;
  explainUnplaced(b.unplaced, input);
  {
    const consOf = (id: string) => byIid.get(id)?.c;
    const done = new Map<string, Placement[]>();   // identical sheets get the identical arrangement
    for (const sh of b.sheets) {
      const sig = signature(sh);
      const prev = done.get(sig);
      if (prev) {
        const pool = new Map<string, Placement[]>();
        for (const pl of sh.placements) { const a = pool.get(pl.uid) || []; a.push(pl); pool.set(pl.uid, a); }
        sh.placements = prev.map(q => ({ ...q, iid: pool.get(q.uid)!.shift()!.iid }));
        continue;
      }
      if (input.settings.reorganize !== false) reorganizeSheet(sh, consOf, input.settings);
      alignInternalCuts(sh, consOf, input.settings);
      if ((input.settings as any).sinkLow !== false && sinkConstrained(sh, consOf, input.settings)) alignInternalCuts(sh, consOf, input.settings);
      staggerSheet(sh, consOf, input.settings);
      done.set(sig, sh.placements);
    }
  }
  // identical layouts consecutive (program once in the machine, run N times)
  const order: SheetLayout[] = []; const seen = new Map<string, SheetLayout[]>();
  for (const sh of b.sheets) { const k = signature(sh); const a = seen.get(k); if (a) a.push(sh); else seen.set(k, [sh]); }
  for (const arr of seen.values()) order.push(...arr);
  const final = [...frozen, ...order];
  final.forEach((sh, i) => { sh.id = `S${i + 1}`; });
  const usedArea = b.usedArea + frozenUsed, sheetArea = b.sheetArea + frozenArea;
  return {
    sheets: final,
    unplaced: b.unplaced,
    stats: { sheets: final.length, utilization: sheetArea ? usedArea / sheetArea : 0, usedArea, sheetArea, softPenalty: b.soft, iterations: iter, ms: Date.now() - t0 },
  };
}

// ---------------- re-arrange a finished sheet for common lines ----------------

const ovl = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/** Length of internal cuts shared between panels (touching edges and collinear edges), border cuts excluded. */
export function cutScore(pls: Placement[], W: number, H: number, s: NestSettings) {
  const U = realArea(W, H, s); const E = 0.02; const maxGap = 1 + s.gap;
  const bx = (x: number) => Math.abs(x - U.x) < E || Math.abs(x - (U.x + U.w)) < E;
  const by = (y: number) => Math.abs(y - U.y) < E || Math.abs(y - (U.y + U.h)) < E;
  let sc = 0;
  for (let i = 0; i < pls.length; i++) for (let j = i + 1; j < pls.length; j++) {
    const r = pls[i], q = pls[j];
    const vGap = Math.max(q.y - (r.y + r.h), r.y - (q.y + q.h));
    const hGap = Math.max(q.x - (r.x + r.w), r.x - (q.x + q.w));
    if (vGap <= maxGap && ovl(r.x, r.x + r.w, q.x, q.x + q.w) > E) {
      if (Math.abs(r.x - q.x) < E && !bx(r.x)) sc += 0.5 * Math.min(r.h, q.h);
      if (Math.abs(r.x + r.w - (q.x + q.w)) < E && !bx(r.x + r.w)) sc += 0.5 * Math.min(r.h, q.h);
    }
    if (hGap <= maxGap && ovl(r.y, r.y + r.h, q.y, q.y + q.h) > E) {
      if (Math.abs(r.y - q.y) < E && !by(r.y)) sc += 0.5 * Math.min(r.w, q.w);
      if (Math.abs(r.y + r.h - (q.y + q.h)) < E && !by(r.y + r.h)) sc += 0.5 * Math.min(r.w, q.w);
    }
    // touching panels: one cut serves both (common line) — worth the most
    if (Math.abs(hGap) < E) sc += 2 * ovl(r.y, r.y + r.h, q.y, q.y + q.h);
    if (Math.abs(vGap) < E) sc += 2 * ovl(r.x, r.x + r.w, q.x, q.x + q.w);
  }
  return sc;
}

function softOf(pls: Placement[], consOf: (iid: string) => PanelConstraints | undefined, W: number, H: number) {
  let soft = 0;
  for (const pl of pls) {
    const c = consOf(pl.iid); if (!c) continue;
    for (const v of sideViolations(c, pl, pl.rot, W, H)) if (!v.hard) soft += v.weight;
    for (const z of c.zones) if (!z.hard && zoneViolated(pl, z, W, H)) soft += z.weight;
  }
  return soft;
}

/**
 * After the optimizer: try to lay the same panels out again in rows (shelves) so they share
 * more cut lines — e.g. two panels of the same height side by side on one line. The new
 * arrangement is kept only if it obeys every hard rule, keeps the soft ones and shares more cuts.
 */
export function reorganizeSheet(sh: SheetLayout, consOf: (iid: string) => PanelConstraints | undefined, s: NestSettings, force = false): boolean {
  const pls = sh.placements; const n = pls.length;
  if (n < 2 || n > 14 || pls.some(p => p.trial || (p.locked && !force))) return false;
  const W = sh.w, H = sh.h, U = realArea(W, H, s);
  const it = pls.map(pl => ({ pl, c: consOf(pl.iid), inf: inflation(consOf(pl.iid), pl.rot, s) }));
  type It = typeof it[number];
  const okAt = (x: It, r: Rect, placed: { x: It; r: Rect }[]) => {
    if (!inside(r, U)) return false;
    const c = x.c;
    if (c) {
      if (c.zones.some(z => z.hard && zoneViolated(r, z, W, H))) return false;
      if (sideViolations(c, r, x.pl.rot, W, H).some(v => v.hard)) return false;
    }
    const a = x.inf;
    const ra = { x: r.x - a.l + 1e-4, y: r.y - a.b + 1e-4, w: r.w + a.l + a.r - 2e-4, h: r.h + a.b + a.t - 2e-4 };
    for (const p of placed) {
      const b = p.x.inf;
      if (intersects(ra, { x: p.r.x - b.l + 1e-4, y: p.r.y - b.b + 1e-4, w: p.r.w + b.l + b.r - 2e-4, h: p.r.h + b.b + b.t - 2e-4 })) return false;
      if (pairClearance(c, r, x.pl.rot, p.x.c, p.r, p.x.pl.rot).need) return false;
    }
    return true;
  };
  const gravOf = (arr: Placement[]) => arr.reduce((a, pl) => { const c = consOf(pl.iid); return a + (c ? gravityTerm(c, pl, W, H) : 0); }, 0);
  const evalPls = (arr: Placement[]) => {
    const tmp: SheetLayout = { ...sh, placements: arr.map(p => ({ ...p })) };
    alignInternalCuts(tmp, consOf, s);
    return { pls: tmp.placements, sc: cutScore(tmp.placements, W, H, s), soft: softOf(tmp.placements, consOf, W, H), grav: gravOf(tmp.placements) };
  };
  const dirs = it.map(x => x.c?.gravity?.dir);
  const gTop = dirs.includes('top') && !dirs.includes('bottom');
  const gRight = dirs.includes('right') && !dirs.includes('left');
  const orig = evalPls(pls);
  let best = orig;

  // item orders to try (deterministic: seeded by the sheet content)
  let seed = 0; for (const p of pls) for (const ch of p.uid) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const rnd = mulberry32(seed);
  const orders: It[][] = [
    [...it].sort((a, b) => b.pl.h - a.pl.h || b.pl.w - a.pl.w),
    [...it].sort((a, b) => a.pl.h - b.pl.h || b.pl.w - a.pl.w),
    [...it].sort((a, b) => b.pl.w * b.pl.h - a.pl.w * a.pl.h),
    [...it].sort((a, b) => b.pl.w - a.pl.w),
  ];
  for (let k = 0; k < 24; k++) { const a = [...it]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } orders.push(a); }

  const perms = (m: number): number[][] => {
    if (m > 4) { const id = [...Array(m).keys()]; return [id, [...id].reverse()]; }
    const out: number[][] = [];
    const rec = (cur: number[], rest: number[]) => { if (!rest.length) { out.push(cur); return; } rest.forEach((v, i) => rec([...cur, v], rest.filter((_, k) => k !== i))); };
    rec([], [...Array(m).keys()]);
    return out;
  };
  const seen = new Set<string>();
  for (const cols of [false, true]) for (const order of orders) {
    // first-fit shelves: rows (filled along X) or columns (stacked along Y, columns side by side)
    const along = (x: It) => cols ? x.pl.h + x.inf.b + x.inf.t : x.pl.w + x.inf.l + x.inf.r;
    const cap = cols ? U.h : U.w;
    const shelves: It[][] = [];
    const used: number[] = [];
    for (const x of order) {
      const ww = along(x);
      let k = shelves.findIndex((_, i) => used[i] + ww <= cap + 1e-6);
      if (k < 0) { shelves.push([]); used.push(0); k = shelves.length - 1; }
      shelves[k].push(x); used[k] += ww;
    }
    // in a column, low panels go first (bottom): taller ones above still start under any ceiling
    if (cols) for (const sh2 of shelves) sh2.sort((p, q) => p.pl.h - q.pl.h);
    const key = (cols ? 'c' : 'r') + shelves.map(r => r.map(x => x.pl.uid).join(',')).join('|');
    if (seen.has(key)) continue; seen.add(key);
    for (const pm of perms(shelves.length)) {
      const placed: { x: It; r: Rect }[] = [];
      // shelves start from the side the panels are pulled to (e.g. horizontals glued to the top)
      const sEnd = cols ? gRight : gTop, aEnd = cols ? gTop : gRight;
      const S = cols ? { lo: U.x, hi: U.x + U.w, size: (x: It) => x.pl.w, iLo: (x: It) => x.inf.l, iHi: (x: It) => x.inf.r }
                     : { lo: U.y, hi: U.y + U.h, size: (x: It) => x.pl.h, iLo: (x: It) => x.inf.b, iHi: (x: It) => x.inf.t };
      const A = cols ? { lo: U.y, hi: U.y + U.h, size: (x: It) => x.pl.h, iLo: (x: It) => x.inf.b, iHi: (x: It) => x.inf.t }
                     : { lo: U.x, hi: U.x + U.w, size: (x: It) => x.pl.w, iLo: (x: It) => x.inf.l, iHi: (x: It) => x.inf.r };
      let o0 = sEnd ? S.hi : S.lo; let ok = true; let firstShelf = true;
      for (const si of pm) {
        const shelf = shelves[si];
        const thick = Math.max(...shelf.map(S.size));
        let a0 = aEnd ? A.hi : A.lo; let far = o0; let firstItem = true;
        for (const x of shelf) {
          // clearances are between panels, not against the sheet border
          const sz = S.size(x), az = A.size(x);
          const s0 = sEnd ? (firstShelf ? S.hi - sz : o0 - S.iHi(x) - sz) : (firstShelf ? S.lo : o0 + S.iLo(x));
          const s1 = sEnd ? s0 - (thick - sz) : s0 + (thick - sz);      // other side of the shelf
          const a = aEnd ? (firstItem ? A.hi - az : a0 - A.iHi(x) - az) : (firstItem ? A.lo : a0 + A.iLo(x));
          firstItem = false;
          const mk = (s: number): Rect => cols ? { x: s, y: a, w: x.pl.w, h: x.pl.h } : { x: a, y: s, w: x.pl.w, h: x.pl.h };
          const r = okAt(x, mk(s0), placed) ? mk(s0) : okAt(x, mk(s1), placed) ? mk(s1) : null;
          if (!r) { ok = false; break; }
          placed.push({ x, r });
          const rs = cols ? r.x : r.y;
          a0 = aEnd ? a - A.iLo(x) : a + az + A.iHi(x);
          far = sEnd ? Math.min(far, rs - S.iLo(x)) : Math.max(far, rs + sz + S.iHi(x));
        }
        if (!ok) break;
        o0 = far; firstShelf = false;
      }
      if (!ok) continue;
      const cand = evalPls(placed.map(p => ({ ...p.x.pl, x: +p.r.x.toFixed(4), y: +p.r.y.toFixed(4) })));
      if (cand.soft <= orig.soft + 1e-9 && cand.grav <= orig.grav + 1e-3 && cand.sc > best.sc + 1) best = cand;
    }
  }
  if (best !== orig) { sh.placements = best.pls; return true; }
  return false;
}

// ---------------- panels with a "stay low" rule go to the bottom ----------------

/** +1 = the panel's rules want it low (e.g. "the 04 return can't enter the top half"), -1 = high, 0 = no preference. */
function heightPref(c: PanelConstraints | undefined, W: number, H: number): number {
  if (!c) return 0;
  let v = 0;
  const add = (zone: any, mode: 'inside' | 'outside', w: number) => {
    const r = zoneRect(zone, W, H); const cy = r.y + r.h / 2;
    if (Math.abs(cy - H / 2) < 0.01 * H) return;
    const upper = cy > H / 2;
    v += (mode === 'outside' ? (upper ? 1 : -1) : (upper ? -1 : 1)) * w;
  };
  for (const r of c.sideRules) if (r.kind === 'zone' && (r as any).zone) add((r as any).zone, (r as any).mode, r.hard ? 2 : 1);
  for (const z of c.zones) add(z.zone, z.forbid ? 'outside' : 'inside', z.hard ? 2 : 1);
  return Math.sign(v);
}

/**
 * Valid layouts can still put a short free panel under a panel that has to stay low (it fits under
 * the half anyway). The shop prefers the constrained one at the bottom: wherever the sheet splits
 * into stacked bands with straight cuts (whole sheet, or inside a column), try re-ordering the bands
 * so the "stay low" panels go down. Kept only if every hard rule still holds and nothing else gets worse.
 */
export function sinkConstrained(sh: SheetLayout, consOf: (iid: string) => PanelConstraints | undefined, s: NestSettings): boolean {
  const pls = sh.placements; const W = sh.w, H = sh.h, U = realArea(W, H, s);
  if (pls.length < 2 || pls.some(p => p.trial)) return false;
  const pref = new Map(pls.map(p => [p.iid, heightPref(consOf(p.iid), W, H)]));
  if (![...pref.values()].some(v => v !== 0)) return false;
  const lowCost = (arr: Placement[]) => arr.reduce((a, p) => { const v = pref.get(p.iid)!; return a + (v > 0 ? p.y : v < 0 ? H - p.y - p.h : 0); }, 0);
  const valid = (arr: Placement[]) => {
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]; const c = consOf(p.iid);
      if (!inside(p, U)) return false;
      if (c) {
        if (c.zones.some(z => z.hard && zoneViolated(p, z, W, H))) return false;
        if (sideViolations(c, p, p.rot, W, H).some(v => v.hard)) return false;
      }
      const a = inflation(c, p.rot, s);
      const ra = { x: p.x - a.l + 1e-4, y: p.y - a.b + 1e-4, w: p.w + a.l + a.r - 2e-4, h: p.h + a.b + a.t - 2e-4 };
      for (let j = i + 1; j < arr.length; j++) {
        const q = arr[j]; const cq = consOf(q.iid); const b = inflation(cq, q.rot, s);
        if (intersects(ra, { x: q.x - b.l + 1e-4, y: q.y - b.b + 1e-4, w: q.w + b.l + b.r - 2e-4, h: q.h + b.b + b.t - 2e-4 })) return false;
        if (pairClearance(c, p, p.rot, cq, q, q.rot).need) return false;
      }
    }
    return true;
  };
  const gravOf = (arr: Placement[]) => arr.reduce((a, pl) => { const c = consOf(pl.iid); return a + (c ? gravityTerm(c, pl, W, H) : 0); }, 0);
  const E = 0.02;
  /** split a set of panels into bands along an axis (straight cuts that cross no panel) */
  const bands = (set: Placement[], vert: boolean) => {
    const lo = (p: Placement) => vert ? p.y : p.x, hi = (p: Placement) => vert ? p.y + p.h : p.x + p.w;
    const sorted = [...set].sort((a, b) => lo(a) - lo(b));
    const out: { items: Placement[]; lo: number; hi: number }[] = [];
    for (const p of sorted) {
      const last = out[out.length - 1];
      if (last && lo(p) < last.hi - E) { last.items.push(p); last.hi = Math.max(last.hi, hi(p)); }
      else out.push({ items: [p], lo: lo(p), hi: hi(p) });
    }
    return out;
  };
  const perms = (m: number): number[][] => {
    const out: number[][] = [];
    const rec = (cur: number[], rest: number[]) => { if (!rest.length) { out.push(cur); return; } rest.forEach((v, i) => rec([...cur, v], rest.filter((_, k) => k !== i))); };
    rec([], [...Array(m).keys()]);
    return out;
  };
  let cur = pls.map(p => ({ ...p }));
  let changed = false;
  const baseSoft = softOf(cur, consOf, W, H), baseGrav = gravOf(cur);
  // walk the cut tree: horizontal bands (re-orderable), inside each band vertical columns, inside those bands again…
  const visit = (iids: Set<string>, depth: number) => {
    if (depth > 6 || iids.size < 2) return;
    const set = cur.filter(p => iids.has(p.iid));
    const hb = bands(set, true);
    if (hb.length > 1) {
      if (hb.length <= 5 && hb.some(b => b.items.some(p => pref.get(p.iid)))) {
        const gaps = hb.slice(1).map((b, i) => b.lo - hb[i].hi);
        const start = hb[0].lo;
        let best = { arr: cur, cost: lowCost(cur) };
        for (const pm of perms(hb.length)) {
          if (pm.every((v, i) => v === i)) continue;
          let y = start; const shift = new Map<string, number>();
          pm.forEach((bi, k) => { const b = hb[bi]; for (const p of b.items) shift.set(p.iid, y - b.lo); y += (b.hi - b.lo) + (k < gaps.length ? gaps[k] : 0); });
          const arr = cur.map(p => shift.has(p.iid) ? { ...p, y: +(p.y + shift.get(p.iid)!).toFixed(4) } : p);
          const cost = lowCost(arr);
          if (cost > best.cost - 0.5) continue;
          // (same bands, same cuts — only their order changes, so the cut count is not re-checked)
          if (softOf(arr, consOf, W, H) > baseSoft + 1e-9 || gravOf(arr) > baseGrav + 0.05) continue;
          if (!valid(arr)) continue;
          best = { arr, cost };
        }
        if (best.arr !== cur) { cur = best.arr; changed = true; }
      }
      for (const b of hb) visit(new Set(b.items.map(p => p.iid)), depth + 1);
      return;
    }
    const vb = bands(set, false);
    if (vb.length > 1) for (const b of vb) visit(new Set(b.items.map(p => p.iid)), depth + 1);
  };
  visit(new Set(cur.map(p => p.iid)), 0);
  if (changed) sh.placements = cur;
  return changed;
}


// ---------------- staggered rows ----------------

/** Every hard rule still holds for this arrangement of a sheet (margins, zones, sides, overlaps, pair clearances). */
function sheetHardValid(arr: Placement[], consOf: (iid: string) => PanelConstraints | undefined, W: number, H: number, s: NestSettings) {
  const U = realArea(W, H, s);
  for (let i = 0; i < arr.length; i++) {
    const p = arr[i]; const c = consOf(p.iid);
    if (!inside(p, U)) return false;
    if (c) {
      if (c.zones.some(z => z.hard && zoneViolated(p, z, W, H))) return false;
      if (sideViolations(c, p, p.rot, W, H).some(v => v.hard)) return false;
    }
    const a = inflation(c, p.rot, s);
    const ra = { x: p.x - a.l + 1e-4, y: p.y - a.b + 1e-4, w: p.w + a.l + a.r - 2e-4, h: p.h + a.b + a.t - 2e-4 };
    for (let j = i + 1; j < arr.length; j++) {
      const q = arr[j]; const cq = consOf(q.iid); const b = inflation(cq, q.rot, s);
      if (intersects(ra, { x: q.x - b.l + 1e-4, y: q.y - b.b + 1e-4, w: q.w + b.l + b.r - 2e-4, h: q.h + b.b + b.t - 2e-4 })) return false;
      if (pairClearance(c, p, p.rot, cq, q, q.rot).need) return false;
    }
  }
  return true;
}

/**
 * Rule "Filas escalonadas": the vertical cuts of a row must not continue into the row above or
 * below. Row by row (bands with a straight horizontal cut between them), try sliding the row into
 * free space, mirroring it, or changing the order of its panels, and keep whatever leaves fewest
 * aligned cuts without breaking a hard rule or adding soft penalties.
 */
export function staggerSheet(sh: SheetLayout, consOf: (iid: string) => PanelConstraints | undefined, s: NestSettings): boolean {
  const W = sh.w, H = sh.h, U = realArea(W, H, s);
  if (sh.placements.length < 2 || sh.placements.some(p => p.trial || p.locked)) return false;
  const byUid = new Map(sh.placements.map(p => [p.uid, consOf(p.iid)]));
  if (![...byUid.values()].some(c => c?.stagger)) return false;
  const conflicts = (arr: Placement[]) => staggerConflicts(arr, u => byUid.get(u), W, H, s).length;
  const gravOf = (arr: Placement[]) => arr.reduce((a, pl) => { const c = consOf(pl.iid); return a + (c ? gravityTerm(c, pl, W, H) : 0); }, 0);
  const score = (arr: Placement[]) => conflicts(arr) * 1000 + softOf(arr, consOf, W, H) * 10 + gravOf(arr);
  let cur = sh.placements.map(p => ({ ...p }));
  let curScore = score(cur);
  if (curScore < 1000) return false;
  const E = 0.02;
  const bandsOf = (arr: Placement[]) => {
    const sorted = [...arr].sort((a, b) => a.y - b.y);
    const out: { ids: Set<string>; lo: number; hi: number }[] = [];
    for (const p of sorted) {
      const last = out[out.length - 1];
      if (last && p.y < last.hi - E) { last.ids.add(p.iid); last.hi = Math.max(last.hi, p.y + p.h); }
      else out.push({ ids: new Set([p.iid]), lo: p.y, hi: p.y + p.h });
    }
    return out;
  };
  let changed = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const band of bandsOf(cur)) {
      const mine = cur.filter(p => band.ids.has(p.iid));
      if (!mine.some(p => byUid.get(p.uid)?.stagger)) continue;
      const others = cur.filter(p => !band.ids.has(p.iid));
      const x0 = Math.min(...mine.map(p => p.x)), x1 = Math.max(...mine.map(p => p.x + p.w));
      // arrangements of the row: as is, mirrored, and (one-line rows) other panel orders keeping the gaps
      const variants: Placement[][] = [mine, mine.map(p => ({ ...p, x: +(x0 + x1 - p.x - p.w).toFixed(4) }))];
      const oneLine = mine.every(p => Math.abs(p.y - mine[0].y) < E) || mine.every(p => Math.abs(p.y + p.h - mine[0].y - mine[0].h) < E);
      if (oneLine && mine.length > 1 && mine.length <= 8) {
        const seq = [...mine].sort((a, b) => a.x - b.x);
        const gaps = seq.slice(1).map((p, i) => p.x - (seq[i].x + seq[i].w));
        const pack = (order: Placement[]) => { let x = x0; return order.map((p, i) => { const q = { ...p, x: +x.toFixed(4) }; x += p.w + (gaps[i] ?? 0); return q; }); };
        const orders: Placement[][] = [];
        for (let k = 1; k < seq.length; k++) orders.push([...seq.slice(k), ...seq.slice(0, k)]);
        for (let i = 0; i + 1 < seq.length; i++) { const o = [...seq]; [o[i], o[i + 1]] = [o[i + 1], o[i]]; orders.push(o); }
        for (const o of orders) variants.push(pack(o));
      }
      let best = { arr: cur, sc: curScore };
      for (const v of variants) {
        const vx0 = Math.min(...v.map(p => p.x)), vx1 = Math.max(...v.map(p => p.x + p.w));
        const slackL = vx0 - U.x, slackR = U.x + U.w - vx1;
        const shifts = new Set<number>([0]);
        if (slackR > E) shifts.add(slackR);
        if (slackL > E) shifts.add(-slackL);
        const near = others.filter(q => Math.abs(q.y - band.hi) < s.gap + 0.1 || Math.abs(q.y + q.h - band.lo) < s.gap + 0.1);
        const minOff = Math.max(...mine.map(p => byUid.get(p.uid)?.stagger?.min ?? 0), ...near.map(p => byUid.get(p.uid)?.stagger?.min ?? 0));
        for (const q of near) for (const eq of [q.x, q.x + q.w]) for (const p of v) for (const ep of [p.x, p.x + p.w])
          for (const d of [eq - ep + minOff + 0.01, eq - ep - minOff - 0.01]) if (d <= slackR + 1e-6 && d >= -slackL - 1e-6) shifts.add(+d.toFixed(4));
        for (const d of shifts) {
          const moved = v.map(p => ({ ...p, x: +(p.x + d).toFixed(4) }));
          const arr = [...others, ...moved];
          const sc = score(arr);
          if (sc < best.sc - 1e-6 && sheetHardValid(arr, consOf, W, H, s)) best = { arr, sc };
        }
      }
      if (best.arr !== cur) { cur = best.arr; curScore = best.sc; changed = true; }
      if (curScore < 1000) break;
    }
    if (curScore < 1000) break;
  }
  if (changed) {
    const order = new Map(sh.placements.map((p, i) => [p.iid, i]));
    sh.placements = cur.sort((a, b) => order.get(a.iid)! - order.get(b.iid)!);
  }
  return changed;
}

// ---------------- internal cut alignment ----------------

/**
 * Slide panels sideways (or up/down) so their inner edges line up with the panels above/below
 * or beside them: one straight internal cut instead of a jagged one, and the leftover strip
 * goes to the sheet border where it's trimmed anyway. Never breaks a hard rule.
 */
export function alignInternalCuts(sh: SheetLayout, consOf: (iid: string) => PanelConstraints | undefined, s: NestSettings) {
  const U = realArea(sh.w, sh.h, s);
  const E = 0.02;
  const pls = sh.placements;
  if (pls.length < 2) return;
  const onBorderX = (x: number) => Math.abs(x - U.x) < E || Math.abs(x - (U.x + U.w)) < E;
  const onBorderY = (y: number) => Math.abs(y - U.y) < E || Math.abs(y - (U.y + U.h)) < E;
  const ov = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const maxGap = 1 + s.gap;

  const valid = (i: number, r: Rect) => {
    const pl = pls[i]; const c = consOf(pl.iid);
    if (!inside(r, U)) return false;
    if (c) {
      if (c.zones.some(z => z.hard && zoneViolated(r, z, sh.w, sh.h))) return false;
      if (sideViolations(c, r, pl.rot, sh.w, sh.h).some(v => v.hard)) return false;
    }
    const a = inflation(c, pl.rot, s);
    const ra = { x: r.x - a.l + 1e-4, y: r.y - a.b + 1e-4, w: r.w + a.l + a.r - 2e-4, h: r.h + a.b + a.t - 2e-4 };
    for (let j = 0; j < pls.length; j++) {
      if (j === i) continue;
      const q = pls[j]; const cq = consOf(q.iid); const b = inflation(cq, q.rot, s);
      const rb = { x: q.x - b.l + 1e-4, y: q.y - b.b + 1e-4, w: q.w + b.l + b.r - 2e-4, h: q.h + b.b + b.t - 2e-4 };
      if (intersects(ra, rb)) return false;
      if (pairClearance(c, r, pl.rot, cq, q, q.rot).need) return false;
    }
    return true;
  };
  // shared internal cut length of panel i at rect r
  const score = (i: number, r: Rect) => {
    let sc = 0;
    for (let j = 0; j < pls.length; j++) {
      if (j === i) continue;
      const q = pls[j];
      // stacked (above/below): collinear left/right edges = one vertical cut
      const vGap = Math.max(q.y - (r.y + r.h), r.y - (q.y + q.h));
      if (vGap <= maxGap && ov(r.x, r.x + r.w, q.x, q.x + q.w) > E) {
        if (Math.abs(r.x - q.x) < E && !onBorderX(r.x)) sc += Math.min(r.h, q.h);
        if (Math.abs(r.x + r.w - (q.x + q.w)) < E && !onBorderX(r.x + r.w)) sc += Math.min(r.h, q.h);
      }
      // side by side: collinear top/bottom edges = one horizontal cut
      const hGap = Math.max(q.x - (r.x + r.w), r.x - (q.x + q.w));
      if (hGap <= maxGap && ov(r.y, r.y + r.h, q.y, q.y + q.h) > E) {
        if (Math.abs(r.y - q.y) < E && !onBorderY(r.y)) sc += Math.min(r.w, q.w);
        if (Math.abs(r.y + r.h - (q.y + q.h)) < E && !onBorderY(r.y + r.h)) sc += Math.min(r.w, q.w);
      }
      // touching neighbours share the cut between them
      if (Math.abs(hGap) < E) sc += 0.5 * ov(r.y, r.y + r.h, q.y, q.y + q.h);
      if (Math.abs(vGap) < E) sc += 0.5 * ov(r.x, r.x + r.w, q.x, q.x + q.w);
    }
    return sc;
  };
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < pls.length; i++) {
      const pl = pls[i];
      if (pl.locked) continue;
      const c = consOf(pl.iid);
      const g = c?.gravity?.dir;
      const cur: Rect = { x: pl.x, y: pl.y, w: pl.w, h: pl.h };
      let best = { r: cur, sc: score(i, cur) };
      const cands: Rect[] = [];
      for (let j = 0; j < pls.length; j++) {
        if (j === i) continue;
        const q = pls[j];
        const stg = !!(c?.stagger || consOf(q.iid)?.stagger);   // staggered rows: never line up cuts with the row above / below
        if (g !== 'left' && g !== 'right' && !stg) for (const x of [q.x, q.x + q.w - pl.w]) cands.push({ ...cur, x });
        if (g !== 'top' && g !== 'bottom') for (const y of [q.y, q.y + q.h - pl.h]) cands.push({ ...cur, y });
      }
      for (const r of cands) {
        if (Math.abs(r.x - cur.x) < E && Math.abs(r.y - cur.y) < E) continue;
        const sc = score(i, r);
        if (sc > best.sc + 0.5 && valid(i, r)) best = { r, sc };
      }
      if (best.r !== cur) { pl.x = +best.r.x.toFixed(4); pl.y = +best.r.y.toFixed(4); moved = true; }
    }
    if (!moved) break;
  }
}

/** Group identical sheets (same size and same placements) -> [{sheet, count, indexes}] */
export function groupIdentical(layout: Layout) {
  const m = new Map<string, { sheet: SheetLayout; count: number; ids: string[] }>();
  for (const sh of layout.sheets) {
    const k = signature(sh);
    const e = m.get(k);
    if (e) { e.count++; e.ids.push(sh.id); } else m.set(k, { sheet: sh, count: 1, ids: [sh.id] });
  }
  return [...m.values()];
}

/** Find a legal spot for one panel on an existing sheet (used by manual editing). */
export function tryPlace(sheet: SheetLayout, panel: Panel, c: PanelConstraints, s: NestSettings, iid: string, consOf: (uid: string) => PanelConstraints | undefined, exceptIid?: string): Placement | null {
  const w = panel.blankW + c.dw, h = panel.blankH + c.dh;
  const it: Item = { iid, uid: panel.uid, w, h, c, area: w * h, infl: inflTable(c, s), part: '', mat: '' };
  let emax = maxInfl(it);
  for (const pl of sheet.placements) { const ci = consOf(pl.uid); if (ci) emax = Math.max(emax, ...Object.values(inflTable(ci, s)).flatMap(i => [i.l, i.r, i.b, i.t])); }
  const packer = makePacker(sheet.w, sheet.h, s, emax);
  for (const pl of sheet.placements) {
    if (pl.iid === exceptIid) continue;
    const inf = inflation(consOf(pl.uid), pl.rot, s);
    packer.place({ x: pl.x - inf.l, y: pl.y - inf.b, w: pl.w + inf.l + inf.r, h: pl.h + inf.b + inf.t });
  }
  for (const heur of ['gravity', 'contact'] as Heur[]) {
    const b = bestPosition(packer, it, heur);
    if (b) return { iid, uid: panel.uid, x: +b.pr.x.toFixed(4), y: +b.pr.y.toFixed(4), w: b.pr.w, h: b.pr.h, rot: b.rot };
  }
  return null;
}

export interface SheetSuggestion { w: number; h: number; id: string; add: number; stillMissing: number; sheets: number }

/**
 * When the stock limits leave pieces unplaced: for each size, how many extra sheets of that size
 * would let everything fit (other sizes keep their limits).
 */
export function suggestSheets(input: NestInput, catalog: SheetSize[], timeMs = 700): SheetSuggestion[] {
  const sizes = new Map<string, SheetSize>();
  for (const d of input.sheets) if (d.enabled) sizes.set(`${d.h}x${d.w}`, { w: d.w, h: d.h });
  for (const c of catalog) sizes.set(`${c.h}x${c.w}`, c);
  const out: SheetSuggestion[] = [];
  for (const [key, sz] of sizes) {
    const existing = input.sheets.find(d => d.enabled && d.w === sz.w && d.h === sz.h);
    const id = existing?.id ?? `sh${key}`;
    const sheets = existing
      ? input.sheets.map(d => d.id === id ? { ...d, stock: null } : d)
      : [...input.sheets, { id, name: `${sz.h} × ${sz.w}`, w: sz.w, h: sz.h, enabled: true, stock: null, material: '' }];
    const lay = nest({ ...input, sheets, settings: { ...input.settings, timeMs }, noExtend: true });
    const used = lay.sheets.filter(sh => sh.sheetId === id).length;
    const add = used - (existing?.stock ?? 0);
    const stillMissing = lay.unplaced.filter(u => u.kind === 'stock').length;
    if (add > 0) out.push({ w: sz.w, h: sz.h, id, add, stillMissing, sheets: lay.sheets.length });
  }
  return out.sort((a, b) => (a.stillMissing - b.stillMissing) || (a.add * a.w * a.h - b.add * b.w * b.h));
}

/** For pieces that fit nowhere, find which hard rule blocks them (by dropping one rule at a time on an empty sheet). */
function explainUnplaced(unplaced: Layout['unplaced'], input: NestInput) {
  const s = input.settings;
  const defs = input.sheets.filter(d => d.enabled);
  if (!defs.length) return;
  const big = defs.reduce((a, d) => (d.w * d.h > a.w * a.h ? d : a));
  const empty: SheetLayout = { id: 'x', sheetId: big.id, w: big.w, h: big.h, partition: '', placements: [] };
  const cache = new Map<string, string>();
  for (const u of unplaced) {
    if (u.kind !== 'fit') continue;
    if (cache.has(u.uid)) { u.reason = cache.get(u.uid)!; continue; }
    const p = input.panels.find(x => x.uid === u.uid); if (!p) continue;
    const c = constraintsFor(p, input.rules, s);
    let reason = u.reason;
    if (Math.min(p.blankW, p.blankH) > Math.min(big.w, big.h) - s.margins.top - s.margins.bottom || Math.max(p.blankW, p.blankH) > big.w - s.margins.left - s.margins.right) {
      reason = T`El desarrollo (${p.blankW.toFixed(2)} × ${p.blankH.toFixed(2)}) no cabe en la lámina más grande seleccionada`;
    } else if (!tryPlace(empty, p, c, s, u.iid, () => undefined)) {
      const blockers: string[] = [];
      for (const r of input.rules.filter(r => c.rules.includes(r.id))) {
        const c2 = constraintsFor(p, input.rules.filter(x => x.id !== r.id), s);
        if (tryPlace(empty, p, c2, s, u.iid, () => undefined)) blockers.push(`«${r.name}»`);
      }
      reason = blockers.length
        ? T`Imposible con ${blockers.join(' + ')}: ni en una lámina vacía de ${big.h} × ${big.w} se puede cumplir`
        : T('Las reglas combinadas no dejan ninguna posición válida, ni en una lámina vacía');
    }
    u.reason = reason; cache.set(u.uid, reason);
  }
}
