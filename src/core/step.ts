import { T, Tn } from '../i18n';
// Minimal, dependency-free STEP (ISO-10303-21, AP203/AP214) B-rep reader.
// Only what is needed to unfold sheet-metal parts: planes, cylinders,
// lines, circles, B-spline curves, topology (faces/loops/edges/vertices).

export type Vec3 = [number, number, number];

export const v = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: Vec3) => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  dist: (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

// ---------- low level parsing ----------

type Arg = number | string | Ref | Enum | Arg[] | null | Typed;
interface Ref { ref: number }
interface Enum { enum: string }
interface Typed { type: string; args: Arg[] }

export interface RawEntity {
  id: number;
  type: string; // for complex entities: "COMPLEX"
  args: Arg[];
  parts?: { type: string; args: Arg[] }[]; // complex entity parts
}

function tokenizeArgs(s: string, pos: { i: number }): Arg[] {
  // assumes s[pos.i] === '('
  const out: Arg[] = [];
  pos.i++; // skip (
  while (pos.i < s.length) {
    const c = s[pos.i];
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === ',') { pos.i++; continue; }
    if (c === ')') { pos.i++; return out; }
    if (c === '(') { out.push(tokenizeArgs(s, pos)); continue; }
    if (c === "'") {
      let j = pos.i + 1; let str = '';
      while (j < s.length) {
        if (s[j] === "'") { if (s[j + 1] === "'") { str += "'"; j += 2; continue; } break; }
        str += s[j++];
      }
      out.push(str); pos.i = j + 1; continue;
    }
    if (c === '#') {
      let j = pos.i + 1; while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
      out.push({ ref: parseInt(s.slice(pos.i + 1, j), 10) }); pos.i = j; continue;
    }
    if (c === '.') {
      const j = s.indexOf('.', pos.i + 1);
      out.push({ enum: s.slice(pos.i + 1, j) }); pos.i = j + 1; continue;
    }
    if (c === '*' || c === '$') { out.push(null); pos.i++; continue; }
    if ((c >= '0' && c <= '9') || c === '-' || c === '+') {
      let j = pos.i + 1;
      while (j < s.length && /[0-9eE.+\-]/.test(s[j])) j++;
      out.push(parseFloat(s.slice(pos.i, j))); pos.i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = pos.i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const name = s.slice(pos.i, j);
      while (s[j] === ' ') j++;
      pos.i = j;
      if (s[j] === '(') { out.push({ type: name, args: tokenizeArgs(s, pos) }); }
      else out.push({ enum: name });
      continue;
    }
    pos.i++;
  }
  return out;
}

export function parseStepEntities(text: string): Map<number, RawEntity> {
  const map = new Map<number, RawEntity>();
  const dataStart = text.indexOf('DATA;');
  const body = dataStart >= 0 ? text.slice(dataStart + 5) : text;
  // split on ';' that terminate entities. Strings may contain ';' -> handle quotes.
  let i = 0; const n = body.length;
  let stmtStart = 0; let inStr = false;
  while (i < n) {
    const c = body[i];
    if (c === "'") inStr = !inStr;
    else if (c === ';' && !inStr) {
      const stmt = body.slice(stmtStart, i).trim();
      stmtStart = i + 1;
      if (stmt.startsWith('#')) {
        const eq = stmt.indexOf('=');
        const id = parseInt(stmt.slice(1, eq), 10);
        let rest = stmt.slice(eq + 1).trim();
        if (rest.startsWith('(')) {
          // complex entity: ( A(...) B(...) )
          const parts: { type: string; args: Arg[] }[] = [];
          const pos = { i: 0 };
          const toks = tokenizeArgs(rest, pos);
          for (const t of toks) if (t && typeof t === 'object' && 'type' in (t as any)) parts.push(t as Typed);
            else if (t && typeof t === 'object' && 'enum' in (t as any)) parts.push({ type: (t as Enum).enum, args: [] });
          map.set(id, { id, type: 'COMPLEX', args: [], parts });
        } else {
          const p = rest.indexOf('(');
          const type = rest.slice(0, p).trim();
          const pos = { i: p };
          const args = tokenizeArgs(rest, pos);
          map.set(id, { id, type, args });
        }
      } else if (stmt === 'ENDSEC') break;
    }
    i++;
  }
  return map;
}

// ---------- geometric model ----------

export interface Placement { o: Vec3; z: Vec3; x: Vec3; y: Vec3 }

export type Curve =
  | { kind: 'line'; p: Vec3; d: Vec3 }
  | { kind: 'circle'; pl: Placement; r: number }
  | { kind: 'bspline'; degree: number; ctrl: Vec3[]; knots: number[]; weights?: number[] }
  | { kind: 'other' };

export type Surface =
  | { kind: 'plane'; pl: Placement }
  | { kind: 'cylinder'; pl: Placement; r: number }
  | { kind: 'other'; type: string };

export interface Edge {
  id: number;
  v1: Vec3; v2: Vec3;
  curve: Curve;
  sameSense: boolean;
  faces: number[]; // indexes of faces using this edge
  _poly?: Vec3[];
}

export interface LoopEdge { edge: Edge; forward: boolean }
export interface Loop { outer: boolean; edges: LoopEdge[] }
export interface Face {
  index: number;
  id: number;
  surface: Surface;
  sameSense: boolean;
  loops: Loop[];
}

export interface StepModel {
  name: string;
  unitToInch: number; // multiply model coordinates by this to get inches
  faces: Face[];
  edges: Map<number, Edge>;
  bbox: { min: Vec3; max: Vec3 };
  warnings: string[];
}

export function loadStepModel(text: string, fileName = ''): StepModel {
  const ents = parseStepEntities(text);
  const warnings: string[] = [];
  const get = (a: Arg) => (a && typeof a === 'object' && 'ref' in (a as any)) ? ents.get((a as Ref).ref) : undefined;

  // units
  let unitToInch = 1;
  for (const e of ents.values()) {
    if (e.type !== 'COMPLEX' || !e.parts) continue;
    const names = e.parts.map(p => p.type);
    if (!names.includes('LENGTH_UNIT')) continue;
    const conv = e.parts.find(p => p.type === 'CONVERSION_BASED_UNIT');
    const si = e.parts.find(p => p.type === 'SI_UNIT');
    if (conv) {
      const nm = String(conv.args[0] || '').toUpperCase();
      if (nm.includes('INCH')) { unitToInch = 1; break; }
      if (nm.includes('FOOT')) { unitToInch = 12; break; }
      if (nm.includes('MILLI')) { unitToInch = 1 / 25.4; break; }
    } else if (si) {
      const pref = si.args[0] && typeof si.args[0] === 'object' ? (si.args[0] as Enum).enum : null;
      if (pref === 'MILLI') { unitToInch = 1 / 25.4; }
      else if (pref === 'CENTI') { unitToInch = 1 / 2.54; }
      else if (!pref) { unitToInch = 1 / 0.0254; }
      // keep looking: files often contain a SI METRE that is only the base of an INCH conversion
    }
  }
  // If an INCH conversion exists anywhere, it wins (SolidWorks writes METRE as base unit too)
  for (const e of ents.values()) {
    if (e.type === 'COMPLEX' && e.parts?.some(p => p.type === 'CONVERSION_BASED_UNIT' && String(p.args[0]).toUpperCase().includes('INCH'))) { unitToInch = 1; break; }
  }
  const S = unitToInch;

  const point = (a: Arg): Vec3 => {
    const e = get(a)!;
    const c = e.args[1] as number[];
    return [c[0] * S, c[1] * S, (c[2] ?? 0) * S];
  };
  const dir = (a: Arg): Vec3 => {
    const e = get(a); if (!e) return [0, 0, 1];
    const c = e.args[1] as number[];
    return v.norm([c[0], c[1], c[2] ?? 0]);
  };
  const placement = (a: Arg): Placement => {
    const e = get(a)!;
    const o = point(e.args[1]);
    const z = e.args[2] ? dir(e.args[2]) : [0, 0, 1] as Vec3;
    let x = e.args[3] ? dir(e.args[3]) : (Math.abs(z[0]) < 0.9 ? [1, 0, 0] as Vec3 : [0, 1, 0] as Vec3);
    // orthogonalize
    x = v.norm(v.sub(x, v.mul(z, v.dot(x, z))));
    const y = v.cross(z, x);
    return { o, z, x, y };
  };

  const curveCache = new Map<number, Curve>();
  const curveOf = (a: Arg): Curve => {
    const e = get(a); if (!e) return { kind: 'other' };
    if (curveCache.has(e.id)) return curveCache.get(e.id)!;
    let c: Curve = { kind: 'other' };
    if (e.type === 'LINE') {
      const p = point(e.args[1]);
      const vec = get(e.args[2])!;
      c = { kind: 'line', p, d: dir(vec.args[1]) };
    } else if (e.type === 'CIRCLE') {
      c = { kind: 'circle', pl: placement(e.args[1]), r: (e.args[2] as number) * S };
    } else if (e.type === 'B_SPLINE_CURVE_WITH_KNOTS') {
      const degree = e.args[1] as number;
      const ctrl = (e.args[2] as Arg[]).map(point);
      const mults = e.args[6] as number[];
      const kv = e.args[7] as number[];
      const knots: number[] = [];
      mults.forEach((m, i) => { for (let k = 0; k < m; k++) knots.push(kv[i]); });
      c = { kind: 'bspline', degree, ctrl, knots };
    } else if (e.type === 'COMPLEX' && e.parts) {
      const bs = e.parts.find(p => p.type === 'B_SPLINE_CURVE');
      const kn = e.parts.find(p => p.type === 'B_SPLINE_CURVE_WITH_KNOTS');
      const rw = e.parts.find(p => p.type === 'RATIONAL_B_SPLINE_CURVE');
      if (bs && kn) {
        const degree = bs.args[0] as number;
        const ctrl = (bs.args[1] as Arg[]).map(point);
        const mults = kn.args[0] as number[]; const kv = kn.args[1] as number[];
        const knots: number[] = [];
        mults.forEach((m, i) => { for (let k = 0; k < m; k++) knots.push(kv[i]); });
        c = { kind: 'bspline', degree, ctrl, knots, weights: rw ? (rw.args[0] as number[]) : undefined };
      }
    } else if (e.type === 'SURFACE_CURVE' || e.type === 'SEAM_CURVE') {
      c = curveOf(e.args[1]);
    }
    curveCache.set(e.id, c);
    return c;
  };

  const surfaceOf = (a: Arg): Surface => {
    const e = get(a); if (!e) return { kind: 'other', type: '?' };
    if (e.type === 'PLANE') return { kind: 'plane', pl: placement(e.args[1]) };
    if (e.type === 'CYLINDRICAL_SURFACE') return { kind: 'cylinder', pl: placement(e.args[1]), r: (e.args[2] as number) * S };
    return { kind: 'other', type: e.type };
  };

  const edges = new Map<number, Edge>();
  const faces: Face[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  // collect faces from shells (or all ADVANCED_FACE if no shell)
  const faceIds: number[] = [];
  for (const e of ents.values()) if (e.type === 'ADVANCED_FACE' || e.type === 'FACE_SURFACE') faceIds.push(e.id);
  faceIds.sort((a, b) => a - b);

  for (const fid of faceIds) {
    const fe = ents.get(fid)!;
    const bounds = fe.args[1] as Arg[];
    const surface = surfaceOf(fe.args[2]);
    const sameSense = !(fe.args[3] && (fe.args[3] as Enum).enum === 'F');
    const face: Face = { index: faces.length, id: fid, surface, sameSense, loops: [] };
    for (const b of bounds) {
      const be = get(b); if (!be) continue;
      const le = get(be.args[1]); if (!le || le.type !== 'EDGE_LOOP') continue;
      const loop: Loop = { outer: be.type === 'FACE_OUTER_BOUND', edges: [] };
      for (const oeRef of le.args[1] as Arg[]) {
        const oe = get(oeRef)!;
        const ecRef = oe.args[3] as Ref;
        const orient = !(oe.args[4] && (oe.args[4] as Enum).enum === 'F');
        let edge = edges.get(ecRef.ref);
        if (!edge) {
          const ec = ents.get(ecRef.ref)!;
          const v1 = point(get(ec.args[1])!.args[1]);
          const v2 = point(get(ec.args[2])!.args[1]);
          edge = { id: ec.id, v1, v2, curve: curveOf(ec.args[3]), sameSense: !(ec.args[4] && (ec.args[4] as Enum).enum === 'F'), faces: [] };
          edges.set(ec.id, edge);
          for (const p of [v1, v2]) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
        }
        if (!edge.faces.includes(face.index)) edge.faces.push(face.index);
        loop.edges.push({ edge, forward: orient });
      }
      face.loops.push(loop);
    }
    if (face.loops.length && !face.loops.some(l => l.outer)) face.loops[0].outer = true;
    faces.push(face);
  }
  if (!faces.length) warnings.push(T('No se encontraron caras B-rep en el STEP'));
  return { name: fileName, unitToInch: S, faces, edges, bbox: { min, max }, warnings };
}

// ---------- curve sampling ----------

function bsplineEval(c: { degree: number; ctrl: Vec3[]; knots: number[]; weights?: number[] }, t: number): Vec3 {
  const p = c.degree; const U = c.knots; const n = c.ctrl.length - 1;
  // find span
  let k = p;
  if (t >= U[n + 1]) k = n;
  else { while (k < n && !(t >= U[k] && t < U[k + 1])) k++; }
  const w = c.weights;
  const d: number[][] = [];
  for (let j = 0; j <= p; j++) {
    const P = c.ctrl[k - p + j]; const wt = w ? w[k - p + j] : 1;
    d.push([P[0] * wt, P[1] * wt, P[2] * wt, wt]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const den = U[i + p - r + 1] - U[i];
      const a = den === 0 ? 0 : (t - U[i]) / den;
      for (let q = 0; q < 4; q++) d[j][q] = (1 - a) * d[j - 1][q] + a * d[j][q];
    }
  }
  const r = d[p];
  return [r[0] / r[3], r[1] / r[3], r[2] / r[3]];
}

/** Polyline of the edge from v1 to v2 (edge's own direction). */
export function edgePolyline(e: Edge, segPerRad = 8): Vec3[] {
  if (e._poly) return e._poly;
  let pts: Vec3[];
  const c = e.curve;
  if (c.kind === 'circle') {
    const { pl, r } = c;
    const ang = (p: Vec3) => { const d = v.sub(p, pl.o); return Math.atan2(v.dot(d, pl.y), v.dot(d, pl.x)); };
    let a1 = ang(e.v1); let a2 = ang(e.v2);
    const closed = v.dist(e.v1, e.v2) < 1e-6;
    if (e.sameSense) { if (closed) a2 = a1 + 2 * Math.PI; else while (a2 <= a1) a2 += 2 * Math.PI; }
    else { if (closed) a2 = a1 - 2 * Math.PI; else while (a2 >= a1) a2 -= 2 * Math.PI; }
    const nseg = Math.max(2, Math.ceil(Math.abs(a2 - a1) * segPerRad));
    pts = [];
    for (let i = 0; i <= nseg; i++) {
      const a = a1 + (a2 - a1) * i / nseg;
      pts.push(v.add(pl.o, v.add(v.mul(pl.x, r * Math.cos(a)), v.mul(pl.y, r * Math.sin(a)))));
    }
  } else if (c.kind === 'bspline') {
    const t0 = c.knots[c.degree]; const t1 = c.knots[c.knots.length - c.degree - 1];
    const nseg = Math.max(4, c.ctrl.length * 3);
    pts = [];
    for (let i = 0; i <= nseg; i++) pts.push(bsplineEval(c, t0 + (t1 - t0) * i / nseg));
    // orient to v1->v2
    if (v.dist(pts[0], e.v1) > v.dist(pts[pts.length - 1], e.v1)) pts.reverse();
    pts[0] = e.v1; pts[pts.length - 1] = e.v2;
  } else {
    pts = [e.v1, e.v2];
  }
  e._poly = pts;
  return pts;
}

export function edgeMidpoint(e: Edge): Vec3 {
  const p = edgePolyline(e);
  if (p.length === 2) return v.mul(v.add(p[0], p[1]), 0.5);
  return p[Math.floor(p.length / 2)];
}

/** Points of a loop in traversal order (closed, last != first). */
export function loopPoints(l: Loop): Vec3[] {
  const out: Vec3[] = [];
  for (const le of l.edges) {
    const poly = edgePolyline(le.edge);
    const seq = le.forward ? poly : [...poly].reverse();
    for (let i = 0; i < seq.length - 1; i++) out.push(seq[i]);
  }
  return out;
}

export function edgeLength(e: Edge): number {
  const p = edgePolyline(e); let L = 0;
  for (let i = 1; i < p.length; i++) L += v.dist(p[i - 1], p[i]);
  return L;
}
