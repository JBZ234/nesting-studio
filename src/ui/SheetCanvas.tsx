import { T, Tn } from '../i18n';
import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { SheetLayout, Panel, Layout, Rule } from '../core/types';
import type { FlatPattern } from '../core/unfold';
import type { PanelConstraints } from '../core/rules';
import { zoneRect, facing } from '../core/rules';
import { orientationOf } from '../core/panels';
import { getState, setPositions, commitDrag, useStore, releaseList } from '../store';

const HUES = [208, 28, 152, 280, 350, 95, 190, 48, 320, 120, 240, 5];
export function hashHue(s: string) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return HUES[h % HUES.length]; }
export type ColorMode = 'type' | 'mark' | 'job' | 'rule' | 'orient';
export function partFill(p: Panel | undefined, mode: ColorMode, cons?: PanelConstraints, rules?: Rule[]): string {
  if (!p) return 'var(--part)';
  if (mode === 'rule') {
    const r = rules?.find(r => cons?.rules.includes(r.id));
    return r ? `color-mix(in srgb, ${r.color} 38%, var(--part))` : 'var(--part)';
  }
  const key = mode === 'type' ? p.type : mode === 'mark' ? p.mark : mode === 'job' ? p.job : (p.A >= p.B ? 'H' : 'V');
  return `color-mix(in srgb, hsl(${hashHue(key)} 62% 52%) 30%, var(--part))`;
}

const pathCache = new WeakMap<FlatPattern, { cut: string; bend: string }>();
export function flatPaths(f: FlatPattern) {
  let c = pathCache.get(f);
  if (c) return c;
  let cut = '', bend = '';
  for (const s of f.segments) {
    const d = `M${s.a[0].toFixed(3)} ${s.a[1].toFixed(3)}L${s.b[0].toFixed(3)} ${s.b[1].toFixed(3)}`;
    if (s.kind === 'bend') bend += d; else cut += d;
  }
  c = { cut, bend }; pathCache.set(f, c);
  return c;
}

interface Props {
  sheet: SheetLayout;
  sheetIdx: number;
  layout: Layout;
  interactive?: boolean;
  showZones?: boolean;
  showFlat?: boolean;
  showLabels?: boolean;
  colorMode?: ColorMode;
  thumb?: boolean;
  selectedIid?: string | null;
  onSelect?: (iid: string | null) => void;
  /** group selection (window or Ctrl+click). `add` = keep what was already selected */
  selectedSet?: string[];
  onSelectMany?: (iids: string[], add: boolean) => void;
  fitKey?: number;
  highlight?: Set<string>;   // marks found by the search
}

export function SheetCanvas(p: Props) {
  const { sheet } = p;
  const panels = useStore(s => s.panels);
  const flats = useStore(s => s.flats);
  const cons = useStore(s => s.cons);
  const rules = useStore(s => s.project.rules);
  const settings = useStore(s => s.project.settings);
  const violations = useStore(s => s.violations);
  useStore(s => s.boms);
  const multiRel = releaseList().length > 1;   // several releases loaded: every piece shows its project + release code
  const pm = useMemo(() => new Map(panels.map(x => [x.uid, x])), [panels]);
  const W = sheet.w, H = sheet.h;
  const pad = p.thumb ? 1 : Math.max(W, H) * 0.05;
  const full = { x: -pad, y: -pad, w: W + 2 * pad, h: H + 2 * pad };
  const [vb, setVb] = useState(full);
  useEffect(() => { setVb(full); /* eslint-disable-next-line */ }, [W, H, p.fitKey]);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ iids: string[]; sx: number; sy: number; orig: Record<string, { x: number; y: number }>; before: Layout; moved: boolean } | null>(null);
  const win = useRef<{ sx: number; sy: number; add: boolean } | null>(null);
  const [winRect, setWinRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pan = useRef<{ sx: number; sy: number; vb: typeof vb } | null>(null);

  const toSheet = useCallback((ev: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!; const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const m = svg.getScreenCTM(); if (!m) return { x: 0, y: 0 };
    const q = pt.matrixTransform(m.inverse());
    return { x: q.x, y: H - q.y };
  }, [H]);

  // zones relevant to the panels on this sheet (or to the selected one)
  const zones = useMemo(() => {
    if (!p.showZones) return [];
    const seen = new Map<string, { r: ReturnType<typeof zoneRect>; forbid: boolean; hard: boolean; name: string; color: string }>();
    const uids = p.selectedIid ? sheet.placements.filter(x => x.iid === p.selectedIid).map(x => x.uid) : [...new Set(sheet.placements.map(x => x.uid))];
    for (const u of uids) for (const z of cons.get(u)?.zones ?? []) {
      const k = z.ruleId + JSON.stringify(z.zone);
      if (!seen.has(k)) seen.set(k, { r: zoneRect(z.zone, W, H), forbid: z.forbid, hard: z.hard, name: z.ruleName, color: rules.find(r => r.id === z.ruleId)?.color ?? '#c33' });
    }
    return [...seen.values()];
  }, [p.showZones, p.selectedIid, sheet, cons, W, H, rules]);

  const multi = p.selectedSet && p.selectedSet.length > 1 ? new Set(p.selectedSet) : null;

  /** snap the group's bounding box (x,y,w,h) to borders and to the other pieces' edges */
  const snap = (skip: Set<string>, x: number, y: number, w: number, h: number, free: boolean) => {
    if (free) return { x, y };
    const tol = vb.w / 90;
    const g = settings.gap;
    const xs = [settings.margins.left, W - settings.margins.right - w];
    const ys = [settings.margins.bottom, H - settings.margins.top - h];
    for (const q of sheet.placements) {
      if (skip.has(q.iid)) continue;
      xs.push(q.x + q.w + g, q.x - g - w, q.x, q.x + q.w - w); ys.push(q.y + q.h + g, q.y - g - h, q.y, q.y + q.h - h);
    }
    let bx = x, by = y, dx = tol, dy = tol;
    for (const c of xs) if (Math.abs(c - x) < dx) { dx = Math.abs(c - x); bx = c; }
    for (const c of ys) if (Math.abs(c - y) < dy) { dy = Math.abs(c - y); by = c; }
    return { x: bx, y: by };
  };

  const onPartDown = (ev: React.PointerEvent, iid: string) => {
    if (!p.interactive) { p.onSelect?.(iid); return; }
    if (ev.button === 1 || ev.button === 2 || ev.altKey) { ev.stopPropagation(); (ev.target as Element).setPointerCapture?.(ev.pointerId); pan.current = { sx: ev.clientX, sy: ev.clientY, vb }; return; }   // pan
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
      // Ctrl+click: add / remove this piece from the group
      const cur = new Set(p.selectedSet && p.selectedSet.length ? p.selectedSet : p.selectedIid ? [p.selectedIid] : []);
      if (cur.has(iid)) cur.delete(iid); else cur.add(iid);
      p.onSelectMany?.([...cur], false);
      return;
    }
    const group = multi?.has(iid) ? [...multi] : [iid];
    if (group.length === 1) p.onSelect?.(iid);
    const s = toSheet(ev);
    const orig: Record<string, { x: number; y: number }> = {};
    for (const q of sheet.placements) if (group.includes(q.iid)) orig[q.iid] = { x: q.x, y: q.y };
    drag.current = { iids: group, sx: s.x, sy: s.y, orig, before: getState().layout!, moved: false };
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  };
  const onMove = (ev: React.PointerEvent) => {
    if (drag.current) {
      const d = drag.current; const s = toSheet(ev);
      if (!d.moved && Math.hypot(s.x - d.sx, s.y - d.sy) < vb.w / 400) return;
      d.moved = true;
      // bounding box of the group at its original place
      const pls = sheet.placements.filter(q => d.iids.includes(q.iid));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of pls) { const o = d.orig[q.iid]; x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + q.w); y1 = Math.max(y1, o.y + q.h); }
      const sn = snap(new Set(d.iids), x0 + (s.x - d.sx), y0 + (s.y - d.sy), x1 - x0, y1 - y0, ev.shiftKey);
      const dx = sn.x - x0, dy = sn.y - y0;
      const pos: Record<string, { x: number; y: number }> = {};
      for (const k of d.iids) pos[k] = { x: d.orig[k].x + dx, y: d.orig[k].y + dy };
      setPositions(p.sheetIdx, pos, true);
    } else if (win.current) {
      const s = toSheet(ev);
      setWinRect({ x0: win.current.sx, y0: win.current.sy, x1: s.x, y1: s.y });
    } else if (pan.current) {
      const svg = svgRef.current!; const r = svg.getBoundingClientRect();
      const k = Math.max(pan.current.vb.w / r.width, pan.current.vb.h / r.height);
      setVb({ ...pan.current.vb, x: pan.current.vb.x - (ev.clientX - pan.current.sx) * k, y: pan.current.vb.y - (ev.clientY - pan.current.sy) * k });
    }
  };
  const onUp = (ev: React.PointerEvent) => {
    if (drag.current?.moved) commitDrag(drag.current.before);
    if (win.current) {
      const w = win.current; const s = toSheet(ev);
      const tiny = Math.hypot(s.x - w.sx, s.y - w.sy) < vb.w / 300;
      if (tiny) { if (!w.add) { p.onSelect?.(null); p.onSelectMany?.([], false); } }
      else {
        const crossing = s.x < w.sx;   // right→left = green (touching); left→right = blue (fully inside)
        const X0 = Math.min(w.sx, s.x), X1 = Math.max(w.sx, s.x), Y0 = Math.min(w.sy, s.y), Y1 = Math.max(w.sy, s.y);
        const hit = sheet.placements.filter(q => crossing
          ? q.x < X1 && q.x + q.w > X0 && q.y < Y1 && q.y + q.h > Y0
          : q.x >= X0 - 1e-6 && q.x + q.w <= X1 + 1e-6 && q.y >= Y0 - 1e-6 && q.y + q.h <= Y1 + 1e-6).map(q => q.iid);
        p.onSelectMany?.(hit, w.add);
      }
      setWinRect(null);
    }
    drag.current = null; pan.current = null; win.current = null;
  };
  const onBgDown = (ev: React.PointerEvent) => {
    if (p.thumb) return;
    ev.preventDefault();   // no text selection while sweeping
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    if (p.interactive && ev.button === 0 && !ev.altKey) {
      const s = toSheet(ev);
      win.current = { sx: s.x, sy: s.y, add: ev.ctrlKey || ev.metaKey || ev.shiftKey };
      return;
    }
    if (!p.interactive) p.onSelect?.(null);
    pan.current = { sx: ev.clientX, sy: ev.clientY, vb };
  };
  const onWheel = (ev: React.WheelEvent) => {
    if (p.thumb) return;
    const svg = svgRef.current!; const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    const f = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
    const nw = Math.min(full.w * 3, Math.max(full.w / 25, vb.w * f));
    const k = nw / vb.w;
    setVb({ x: q.x - (q.x - vb.x) * k, y: q.y - (q.y - vb.y) * k, w: vb.w * k, h: vb.h * k });
  };

  const m = settings.margins;
  const fs = p.thumb ? 0 : Math.max(1.1, Math.min(2.6, vb.w / 70));
  const vSheet = violations;
  const sw = p.thumb ? 0.6 : vb.w / 700;

  return (
    <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
      onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onDoubleClick={() => setVb(full)} onContextMenu={e => { if (!p.thumb) e.preventDefault(); }}
      style={{ userSelect: 'none', touchAction: 'none' }} role={p.thumb ? 'img' : 'application'} aria-label={T`Lámina ${p.sheetIdx + 1}, ${W}×${H} pulgadas, ${sheet.placements.length} piezas`}>
      <defs>
        <pattern id={`trial${p.thumb ? 't' : ''}`} width={p.thumb ? 4 : 2.4} height={p.thumb ? 4 : 2.4} patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
          <line x1="0" y1="0" x2="0" y2={p.thumb ? 4 : 2.4} stroke="var(--bad)" strokeWidth={p.thumb ? 1.6 : 0.5} opacity={0.5} />
        </pattern>
        <pattern id={`hatch${p.thumb ? 't' : ''}`} width={p.thumb ? 3 : 1.6} height={p.thumb ? 3 : 1.6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="100%" height="100%" fill="var(--sheet)" />
          <line x1="0" y1="0" x2="0" y2={p.thumb ? 3 : 1.6} stroke="var(--sheet-hatch)" strokeWidth={p.thumb ? 1.4 : 0.7} />
        </pattern>
      </defs>
      <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="transparent" onPointerDown={onBgDown} />
      {/* sheet */}
      <rect x={0} y={0} width={W} height={H} fill={`url(#hatch${p.thumb ? 't' : ''})`} stroke="var(--sheet-edge)" strokeWidth={sw * 2} onPointerDown={onBgDown} />
      <rect x={m.left} y={m.top} width={W - m.left - m.right} height={H - m.top - m.bottom} fill="var(--sheet)" stroke="var(--sheet-edge)" strokeWidth={sw} strokeDasharray={p.thumb ? undefined : `${sw * 6} ${sw * 4}`} pointerEvents="none" />
      {/* zones */}
      {zones.map((z, i) => (
        <g key={i} pointerEvents="none">
          <rect x={z.r.x} y={H - z.r.y - z.r.h} width={z.r.w} height={z.r.h} fill={z.forbid ? 'var(--zone-bad)' : 'var(--zone-good)'} stroke={z.color} strokeWidth={sw * 1.5} strokeDasharray={z.hard ? undefined : `${sw * 5} ${sw * 3}`} />
          {!p.thumb && <text x={z.r.x + fs * 0.4} y={H - z.r.y - z.r.h + fs * 1.1} fontSize={fs * 0.8} fill={z.color} fontFamily="var(--f-display)" fontWeight={600}>{z.forbid ? '⊘ ' : '✓ '}{z.name}</text>}
        </g>
      ))}
      {/* parts */}
      {sheet.placements.map(pl => {
        const pan = pm.get(pl.uid);
        const vs = vSheet.get(pl.iid) || [];
        const hard = vs.some(v => v.hard), soft = !hard && vs.length > 0;
        const sel = multi ? multi.has(pl.iid) : pl.iid === p.selectedIid;
        const y = H - pl.y - pl.h;
        const f = p.showFlat && !p.thumb ? flats[pl.uid] : undefined;
        let flatEl: React.ReactNode = null;
        if (f) {
          const fp = flatPaths(f);
          // flat coords: x along A (width), y up. Map into the placed rect (y down in SVG).
          const B = y + pl.h; // svg y of the blank's bottom edge
          const tr = pl.rot === 0 ? `matrix(1 0 0 -1 ${pl.x} ${B})`
            : pl.rot === 90 ? `matrix(0 -1 -1 0 ${pl.x + f.height} ${B})`
            : pl.rot === 180 ? `matrix(-1 0 0 1 ${pl.x + f.width} ${B - f.height})`
            : `matrix(0 1 1 0 ${pl.x} ${B - f.width})`;
          const mir = cons.get(pl.uid)?.flip ? `matrix(1 0 0 -1 0 ${f.height})` : undefined;
          flatEl = (
            <g transform={tr} pointerEvents="none"><g transform={mir}>
              <path d={fp.cut} stroke="var(--part-edge)" strokeWidth={sw * 1.1} fill="none" />
              <path d={fp.bend} stroke="var(--bad)" strokeWidth={sw * 0.8} strokeDasharray={`${sw * 4} ${sw * 3}`} fill="none" opacity={0.7} />
            </g></g>
          );
        }
        if (!f && p.showFlat && !p.thumb && pan?.returns) {
          // estimated panel: show where the returns fold (face = inner rectangle)
          const ins: Record<string, number> = {};
          for (const sd of ['T', 'B', 'L', 'R'] as const) ins[facing(sd, pl.rot, cons.get(pl.uid)?.flip)] = Math.min(pan.returns[sd] ?? 0, Math.min(pl.w, pl.h) / 2);
          const x0 = pl.x + ins.left, x1 = pl.x + pl.w - ins.right, y0 = y + ins.top, y1 = y + pl.h - ins.bottom;
          flatEl = <g pointerEvents="none" stroke="var(--bad)" strokeWidth={sw * 0.8} strokeDasharray={`${sw * 4} ${sw * 3}`} opacity={0.6}>
            {ins.left > 0.01 && <line x1={x0} y1={y} x2={x0} y2={y + pl.h} />}{ins.right > 0.01 && <line x1={x1} y1={y} x2={x1} y2={y + pl.h} />}
            {ins.top > 0.01 && <line x1={pl.x} y1={y0} x2={pl.x + pl.w} y2={y0} />}{ins.bottom > 0.01 && <line x1={pl.x} y1={y1} x2={pl.x + pl.w} y2={y1} />}
          </g>;
        }
        const label = pan?.mark ?? pl.uid;
        const lfs = Math.min(fs * 1.5, pl.h / 3.2, pl.w / Math.max(4, label.length * 0.75));
        return (
          <g key={pl.iid} onPointerDown={ev => onPartDown(ev, pl.iid)} style={{ cursor: p.interactive ? 'grab' : 'pointer' }}>
            {pl.trial && <rect x={pl.x} y={y} width={pl.w} height={pl.h} fill={`url(#trial${p.thumb ? 't' : ''})`} pointerEvents="none" />}
            <rect x={pl.x} y={y} width={pl.w} height={pl.h} fillOpacity={pl.trial ? 0.55 : 1} strokeDasharray={pl.trial ? `${sw * 8} ${sw * 4}` : undefined}
              fill={f ? `color-mix(in srgb, ${partFill(pan, p.colorMode ?? 'type', cons.get(pl.uid), rules)} 55%, transparent)` : partFill(pan, p.colorMode ?? 'type', cons.get(pl.uid), rules)}
              stroke={hard ? 'var(--bad)' : sel ? 'var(--sel)' : soft ? 'var(--warn)' : 'var(--part-edge)'}
              strokeWidth={hard || sel ? sw * 3.2 : soft ? sw * 2.4 : sw * 1.1} />
            {flatEl}
            {sel && hard && <rect x={pl.x + sw * 3} y={y + sw * 3} width={Math.max(0, pl.w - sw * 6)} height={Math.max(0, pl.h - sw * 6)} fill="none" stroke="var(--sel)" strokeWidth={sw * 2.2} strokeDasharray={`${sw * 6} ${sw * 3}`} pointerEvents="none" />}
            {p.highlight?.has(pl.uid) && <rect x={pl.x - sw * 2} y={y - sw * 2} width={pl.w + sw * 4} height={pl.h + sw * 4} fill="color-mix(in srgb, var(--sel) 22%, transparent)" stroke="var(--sel)" strokeWidth={p.thumb ? 2 : sw * 5} pointerEvents="none" className="hit-glow" />}
            {p.showLabels !== false && !p.thumb && lfs > 0.5 && (
              <g pointerEvents="none" fontFamily="var(--f-display)" textAnchor="middle">
                {multiRel && pan?.rel && <text x={pl.x + pl.w / 2} y={y + pl.h / 2 - lfs * 1.05} fontSize={lfs * 0.5} fontWeight={800} letterSpacing={lfs * 0.04} fill="var(--accent)" dominantBaseline="middle" fontFamily="var(--f-mono)">{pan.rel}</text>}
                <text x={pl.x + pl.w / 2} y={y + pl.h / 2 - lfs * 0.25} fontSize={lfs} fontWeight={700} fill="var(--part-ink)" dominantBaseline="middle">{label}</text>
                {pan && <text x={pl.x + pl.w / 2} y={y + pl.h / 2 + lfs * 0.62} fontSize={lfs * 0.5} fontWeight={700} letterSpacing={lfs * 0.06} fill={orientationOf(pan, settings) === 'H' ? 'var(--sel)' : 'var(--accent)'} dominantBaseline="middle">{orientationOf(pan, settings) === 'H' ? 'HORIZONTAL' : 'VERTICAL'}</text>}
                {lfs > 0.9 && <text x={pl.x + pl.w / 2} y={y + pl.h / 2 + lfs * 1.3} fontSize={lfs * 0.62} fill="var(--part-ink-2)" fontFamily="var(--f-mono)" dominantBaseline="middle">{pl.w.toFixed(2)}×{pl.h.toFixed(2)}{pl.rot ? ` · ${pl.rot}°` : ''}{cons.get(pl.uid)?.flip ? T(' · espejo') : ''}{cons.get(pl.uid)?.fixedRot != null ? T(' · giro fijo') : ''}</text>}
                {pan && (() => {
                  const efs = Math.min(lfs * 0.62, pl.w / 8, pl.h / 5);
                  if (efs < 0.45 || Math.min(pl.w, pl.h) < 15) return null;
                  const pos: Record<string, [number, number, 'start' | 'middle' | 'end']> = {
                    top: [pl.x + pl.w / 2, y + efs * 1.15, 'middle'], bottom: [pl.x + pl.w / 2, y + pl.h - efs * 0.45, 'middle'],
                    left: [pl.x + efs * 0.45, y + pl.h / 2 - lfs * 0.9, 'start'], right: [pl.x + pl.w - efs * 0.45, y + pl.h / 2 - lfs * 0.9, 'end'],
                  };
                  return (['T', 'B', 'L', 'R'] as const).map(sd => {
                    const [tx, ty, an] = pos[facing(sd, pl.rot, cons.get(pl.uid)?.flip)];
                    return <text key={sd} x={tx} y={ty} fontSize={efs} textAnchor={an} fontFamily="var(--f-mono)" fontWeight={700} fill="var(--accent)">{pan[`edge${sd}` as 'edgeT']}</text>;
                  });
                })()}
                {pl.trial && <text x={pl.x + pl.w / 2} y={y + pl.h / 2 - lfs * (multiRel ? 1.7 : 1.25)} fontSize={lfs * 0.55} fontWeight={800} letterSpacing={lfs * 0.08} fill="var(--bad)" dominantBaseline="middle">{T("PRUEBA · BORRAR")}</text>}
                {pl.locked && !pl.trial && <text x={pl.x + lfs * 0.5} y={y + lfs * 0.9} fontSize={lfs * 0.8} textAnchor="start" fill="var(--part-ink-2)">🔒</text>}
              </g>
            )}
          </g>
        );
      })}
      {/* selection window: blue = left→right (fully inside), green = right→left (touching) */}
      {winRect && (() => {
        const cr = winRect.x1 < winRect.x0;
        const x = Math.min(winRect.x0, winRect.x1), yy = H - Math.max(winRect.y0, winRect.y1);
        return <rect x={x} y={yy} width={Math.abs(winRect.x1 - winRect.x0)} height={Math.abs(winRect.y1 - winRect.y0)} pointerEvents="none"
          fill={cr ? 'rgba(40,180,80,0.14)' : 'rgba(40,110,230,0.14)'} stroke={cr ? 'rgb(30,160,70)' : 'rgb(40,110,230)'} strokeWidth={sw * 1.5}
          strokeDasharray={cr ? `${sw * 6} ${sw * 4}` : undefined} />;
      })()}
      {/* dimensions */}
      {!p.thumb && (
        <g fontFamily="var(--f-mono)" fill="var(--muted)" fontSize={fs * 0.8} pointerEvents="none">
          <text x={W / 2} y={H + fs * 1.4} textAnchor="middle">{W}"</text>
          <text x={-fs * 0.7} y={H / 2} textAnchor="middle" transform={`rotate(-90 ${-fs * 0.7} ${H / 2})`}>{H}"</text>
          <circle cx={0} cy={settings.originForExport === 'BL' ? H : 0} r={fs * 0.35} fill="var(--accent)" />
          <text x={fs * 0.6} y={settings.originForExport === 'BL' ? H + fs * 1.4 : -fs * 0.5} fontSize={fs * 0.7} fill="var(--accent)">0,0</text>
        </g>
      )}
    </svg>
  );
}
