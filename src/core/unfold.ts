// Sheet-metal unfolder working on a StepModel.
// Strategy: pick the biggest planar face (panel face), walk the G1-continuous
// "skin" across cylindrical bends and unroll each bend at its neutral radius
// (r_inner + K*t). Result is the 2D flat pattern seen from the panel front.

import { StepModel, Face, Edge, Vec3, v, edgePolyline, edgeMidpoint, loopPoints, loadStepModel } from './step';

export type P2 = [number, number];

export interface FlatSegment { a: P2; b: P2; kind: 'cut' | 'bend' | 'hole' }

export interface FlatPattern {
  width: number;          // blank size along model X (A direction)
  height: number;         // blank size along model Y (B direction)
  segments: FlatSegment[]; // normalized: bbox min at (0,0); y up
  baseBox: { x0: number; y0: number; x1: number; y1: number }; // panel face extents in flat coords
  thickness: number;
  kFactor: number;
  bends: number;
  facesUnfolded: number;
  facesSkipped: number;
  warnings: string[];
  model3d: { min: Vec3; max: Vec3 };
  bendInfo?: { ri: number; rn: number; theta: number; dir: 'x' | 'y'; at: number }[]; // per unfolded bend face
}

export interface UnfoldOptions {
  kFactor?: number;        // neutral axis position (0..0.5)
  kTable?: { deg: number; k: number }[]; // K by bend angle (degrees); interpolated, clamped at the ends
  thickness?: number;      // inches, overrides detection
  maxSegments?: number;
}

interface PlaneMap { kind: 'plane'; o3: Vec3; e1: Vec3; e2: Vec3; o2: P2; m1: P2; m2: P2 }
interface CylMap { kind: 'cyl'; q: Vec3; axisO: Vec3; a: Vec3; r1: Vec3; s: number; rn: number; F: P2; a2: P2; d2: P2 }
type FaceMap = PlaneMap | CylMap;

const add2 = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul2 = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];

function planeNormal(f: Face): Vec3 {
  if (f.surface.kind !== 'plane') return [0, 0, 1];
  return f.surface.pl.z;
}

function faceNormalAt(f: Face, p: Vec3): Vec3 | null {
  const s = f.surface;
  if (s.kind === 'plane') return s.pl.z;
  if (s.kind === 'cylinder') {
    const d = v.sub(p, s.pl.o);
    const radial = v.sub(d, v.mul(s.pl.z, v.dot(d, s.pl.z)));
    return v.norm(radial);
  }
  return null;
}

function planeArea(f: Face): number {
  if (f.surface.kind !== 'plane') return 0;
  const { pl } = f.surface;
  let area = 0;
  for (const l of f.loops) {
    const pts = loopPoints(l);
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const px = v.dot(v.sub(p, pl.o), pl.x), py = v.dot(v.sub(p, pl.o), pl.y);
      const qx = v.dot(v.sub(q, pl.o), pl.x), qy = v.dot(v.sub(q, pl.o), pl.y);
      a += px * qy - qx * py;
    }
    area += (l.outer ? 1 : -1) * Math.abs(a / 2);
  }
  return area;
}

function faceCentroid(f: Face): Vec3 {
  let s: Vec3 = [0, 0, 0]; let n = 0;
  for (const l of f.loops) if (l.outer) for (const p of loopPoints(l)) { s = v.add(s, p); n++; }
  return n ? v.mul(s, 1 / n) : s;
}

function isLineAlong(e: Edge, a: Vec3): boolean {
  const d = v.sub(e.v2, e.v1); const L = v.len(d);
  if (L < 1e-6) return false;
  if (e.curve.kind !== 'line' && e.curve.kind !== 'bspline') return false;
  return Math.abs(v.dot(v.mul(d, 1 / L), a)) > 0.999;
}

function detectThickness(model: StepModel, base: Face): number {
  // 1) coaxial cylinder pairs
  const cyls = model.faces.filter(f => f.surface.kind === 'cylinder');
  const hist = new Map<string, number>();
  for (let i = 0; i < cyls.length; i++) for (let j = i + 1; j < cyls.length; j++) {
    const A = cyls[i].surface as any, B = cyls[j].surface as any;
    if (Math.abs(v.dot(A.pl.z, B.pl.z)) < 0.9999) continue;
    const d = v.sub(B.pl.o, A.pl.o);
    const off = v.len(v.sub(d, v.mul(A.pl.z, v.dot(d, A.pl.z))));
    if (off > 1e-3) continue;
    const dr = Math.abs(A.r - B.r);
    if (dr < 0.005 || dr > 0.5) continue;
    const k = dr.toFixed(4); hist.set(k, (hist.get(k) || 0) + 1);
  }
  let best = 0, bestN = 0;
  for (const [k, n] of hist) if (n > bestN) { bestN = n; best = parseFloat(k); }
  if (best > 0) return best;
  // 2) nearest parallel plane to the base face
  const n0 = planeNormal(base); const o0 = (base.surface as any).pl.o as Vec3;
  let tmin = Infinity;
  for (const f of model.faces) {
    if (f === base || f.surface.kind !== 'plane') continue;
    if (Math.abs(v.dot(f.surface.pl.z, n0)) < 0.9999) continue;
    const d = Math.abs(v.dot(v.sub(f.surface.pl.o, o0), n0));
    if (d > 0.005 && d < tmin) tmin = d;
  }
  return isFinite(tmin) ? tmin : 0.08;
}

export function unfoldModel(model: StepModel, opts: UnfoldOptions = {}): FlatPattern {
  const K = opts.kFactor ?? 0.4;
  const table = (opts.kTable ?? []).filter(e => e.deg > 0 && isFinite(e.k)).sort((a, b) => a.deg - b.deg);
  const kAt = (deg: number) => {
    if (!table.length) return K;
    if (deg <= table[0].deg) return table[0].k;
    if (deg >= table[table.length - 1].deg) return table[table.length - 1].k;
    for (let i = 1; i < table.length; i++) if (deg <= table[i].deg) {
      const a = table[i - 1], b = table[i]; return a.k + (b.k - a.k) * (deg - a.deg) / (b.deg - a.deg);
    }
    return K;
  };
  const warnings: string[] = [...model.warnings];
  const planes = model.faces.filter(f => f.surface.kind === 'plane');
  if (!planes.length) throw new Error('El STEP no tiene caras planas');
  let base = planes[0]; let bestA = -1;
  for (const f of planes) { const a = planeArea(f); if (a > bestA) { bestA = a; base = f; } }

  const t = opts.thickness ?? detectThickness(model, base);

  // frame for base face: viewed from global +Z side when possible
  let n = planeNormal(base);
  const gz: Vec3 = [0, 0, 1];
  if (Math.abs(v.dot(n, gz)) > 0.5) { if (v.dot(n, gz) < 0) n = v.mul(n, -1); }
  let e1 = v.sub([1, 0, 0], v.mul(n, n[0]));
  if (v.len(e1) < 0.3) e1 = v.sub([0, 1, 0], v.mul(n, n[1]));
  e1 = v.norm(e1);
  const e2 = v.cross(n, e1);
  const maps = new Map<number, FaceMap>();
  maps.set(base.index, { kind: 'plane', o3: (base.surface as any).pl.o, e1, e2, o2: [0, 0], m1: [1, 0], m2: [0, 1] });

  const cylinders = model.faces.filter(f => f.surface.kind === 'cylinder');
  const innerRadius = (f: Face): number => {
    const s = f.surface as any; const R = s.r as number;
    for (const g of cylinders) {
      if (g === f) continue; const q = g.surface as any;
      if (Math.abs(v.dot(q.pl.z, s.pl.z)) < 0.9999) continue;
      const d = v.sub(q.pl.o, s.pl.o);
      if (v.len(v.sub(d, v.mul(s.pl.z, v.dot(d, s.pl.z)))) > 1e-3) continue;
      if (Math.abs(q.r - (R - t)) < 2e-3) return R - t; // f is the outer skin
      if (Math.abs(q.r - (R + t)) < 2e-3) return R;     // f is the inner skin
    }
    return R; // unknown: assume inner
  };

  const mapPoint = (m: FaceMap, p: Vec3): P2 => {
    if (m.kind === 'plane') {
      const d = v.sub(p, m.o3);
      const x = v.dot(d, m.e1), y = v.dot(d, m.e2);
      return add2(m.o2, add2(mul2(m.m1, x), mul2(m.m2, y)));
    }
    const d = v.sub(p, m.axisO);
    const h = v.dot(v.sub(p, m.q), m.a);
    const rp = v.norm(v.sub(d, v.mul(m.a, v.dot(d, m.a))));
    let th = m.s * Math.atan2(v.dot(v.cross(m.r1, rp), m.a), v.dot(m.r1, rp));
    if (th < -1e-6) th += 2 * Math.PI;
    return add2(m.F, add2(mul2(m.a2, h), mul2(m.d2, m.rn * Math.max(0, th))));
  };
  const mapDir = (m: PlaneMap, d: Vec3): P2 => add2(mul2(m.m1, v.dot(d, m.e1)), mul2(m.m2, v.dot(d, m.e2)));

  // BFS across tangent edges
  const queue: number[] = [base.index];
  let bends = 0;
  const tangentEdge = (e: Edge, f: Face, g: Face) => {
    const mpt = edgeMidpoint(e);
    const nf = faceNormalAt(f, mpt), ng = faceNormalAt(g, mpt);
    if (!nf || !ng) return false;
    return Math.abs(v.dot(nf, ng)) > 0.995;
  };

  while (queue.length) {
    const fi = queue.shift()!;
    const f = model.faces[fi]; const fm = maps.get(fi)!;
    for (const l of f.loops) for (const le of l.edges) {
      const e = le.edge;
      for (const gi of e.faces) {
        if (gi === fi || maps.has(gi)) continue;
        const g = model.faces[gi];
        if (g.surface.kind === 'other') continue;
        if (f.surface.kind === 'plane' && g.surface.kind === 'plane') continue;
        if (!tangentEdge(e, f, g)) continue;
        if (g.surface.kind === 'cylinder') {
          const cs = g.surface;
          const a = cs.pl.z;
          if (!isLineAlong(e, a)) continue;
          const q = e.v1;
          const d = v.sub(q, cs.pl.o);
          const axisO = v.add(cs.pl.o, v.mul(a, v.dot(d, a))); // not needed exactly
          const r1 = v.norm(v.sub(d, v.mul(a, v.dot(d, a))));
          // tangent direction leaving the parent (in 3D) and its flat image
          let t3: Vec3; let d2: P2; const F = mapPoint(fm, q); let a2: P2;
          if (fm.kind === 'plane') {
            const np = planeNormal(f);
            let c = v.norm(v.cross(np, a));
            const gc = faceCentroid(g);
            if (v.dot(v.sub(gc, q), c) < 0) c = v.mul(c, -1);
            t3 = c; d2 = mapDir(fm, c); a2 = mapDir(fm, a);
          } else {
            // parent is a cylinder: tangent at q in direction of increasing angle
            const pd = v.sub(q, fm.axisO);
            const pr = v.norm(v.sub(pd, v.mul(fm.a, v.dot(pd, fm.a))));
            t3 = v.mul(v.cross(fm.a, pr), fm.s);
            d2 = fm.d2; a2 = v.dot(a, fm.a) > 0 ? fm.a2 : mul2(fm.a2, -1);
          }
          const s = v.dot(v.cross(a, r1), t3) >= 0 ? 1 : -1;
          // bend angle of this face (around the axis, from the start edge), for the K table
          const b2 = v.cross(a, r1);
          let thMax = 0;
          for (const l of g.loops) for (const p of loopPoints(l)) {
            const dp = v.sub(p, cs.pl.o);
            let ang = Math.atan2(v.dot(dp, b2), v.dot(dp, r1)) * s;
            if (ang < -0.05) ang += 2 * Math.PI;
            if (ang < 2 * Math.PI - 0.05) thMax = Math.max(thMax, ang);
          }
          const rn = innerRadius(g) + kAt(thMax * 180 / Math.PI) * t;
          maps.set(gi, { kind: 'cyl', q, axisO: cs.pl.o, a, r1, s, rn, F, a2, d2 });
          bends++;
          queue.push(gi);
        } else if (g.surface.kind === 'plane' && fm.kind === 'cyl') {
          const a = fm.a;
          if (!isLineAlong(e, a)) continue;
          const q = e.v1;
          const F = mapPoint(fm, q);
          const np = planeNormal(g);
          let c = v.norm(v.cross(np, a));
          const pd = v.sub(q, fm.axisO);
          const pr = v.norm(v.sub(pd, v.mul(a, v.dot(pd, a))));
          const tExit = v.mul(v.cross(a, pr), fm.s);
          if (v.dot(c, tExit) < 0) c = v.mul(c, -1);
          maps.set(gi, { kind: 'plane', o3: q, e1: a, e2: c, o2: F, m1: fm.a2, m2: fm.d2 });
          queue.push(gi);
        }
      }
    }
  }
  // fold count = cylinder pairs ~ bends on one skin
  // build segments
  const segs: FlatSegment[] = [];
  const seen = new Set<number>();
  let skipped = 0;
  for (const f of model.faces) {
    const m = maps.get(f.index);
    if (!m) continue;
    for (const l of f.loops) for (const le of l.edges) {
      const e = le.edge;
      if (seen.has(e.id)) continue; seen.add(e.id);
      const both = e.faces.filter(i => maps.has(i)).length >= 2;
      const kind: FlatSegment['kind'] = both ? 'bend' : (l.outer ? 'cut' : 'hole');
      const poly = edgePolyline(e).map(p => mapPoint(m, p));
      for (let i = 1; i < poly.length; i++) segs.push({ a: poly[i - 1], b: poly[i], kind });
    }
  }
  for (const f of model.faces) if (!maps.has(f.index) && f.surface.kind === 'other') skipped++;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) for (const p of [s.a, s.b]) {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  // base face box
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  const bm = maps.get(base.index)!;
  for (const l of base.loops) if (l.outer) for (const p of loopPoints(l)) {
    const q = mapPoint(bm, p);
    bx0 = Math.min(bx0, q[0]); by0 = Math.min(by0, q[1]); bx1 = Math.max(bx1, q[0]); by1 = Math.max(by1, q[1]);
  }
  const norm = (p: P2): P2 => [p[0] - x0, p[1] - y0];
  const segments = segs.map(s => ({ ...s, a: norm(s.a), b: norm(s.b) }));
  if (maps.size < 3) warnings.push('Desdoblado parcial: no se detectaron dobleces tangentes');

  // per bend: inner radius, angle and direction (for calibration against other unfolders)
  const bendInfo: NonNullable<FlatPattern['bendInfo']> = [];
  for (const [fi, m] of maps) {
    if (m.kind !== 'cyl') continue;
    const f = model.faces[fi];
    const ps: P2[] = [];
    for (const l of f.loops) for (const p of loopPoints(l)) ps.push(mapPoint(m, p));
    if (!ps.length) continue;
    const proj = ps.map(p => p[0] * m.d2[0] + p[1] * m.d2[1]);
    const w = Math.max(...proj) - Math.min(...proj);
    const dir: 'x' | 'y' = Math.abs(m.d2[0]) > Math.abs(m.d2[1]) ? 'x' : 'y';
    const at = (dir === 'x' ? Math.min(...ps.map(p => p[0])) - x0 : Math.min(...ps.map(p => p[1])) - y0);
    bendInfo.push({ ri: innerRadius(f), rn: m.rn, theta: w / m.rn, dir, at });
  }
  return {
    bendInfo,
    width: x1 - x0, height: y1 - y0,
    segments,
    baseBox: { x0: bx0 - x0, y0: by0 - y0, x1: bx1 - x0, y1: by1 - y0 },
    thickness: t, kFactor: K, bends: Math.round(bends / 1), facesUnfolded: maps.size, facesSkipped: skipped,
    warnings, model3d: model.bbox,
  };
}

export function unfoldStepText(text: string, fileName = '', opts: UnfoldOptions = {}): FlatPattern {
  return unfoldModel(loadStepModel(text, fileName), opts);
}

/** Merge collinear-ish segments to reduce payload for rendering. */
export function simplifySegments(segs: FlatSegment[], tol = 1e-4): FlatSegment[] {
  return segs.filter(s => Math.hypot(s.a[0] - s.b[0], s.a[1] - s.b[1]) > tol);
}
