import React, { useEffect, useMemo } from 'react';
import { useStore, setRules, updateProject, addSheetStock, setState, placeOnSheet, previewOnSheet } from '../store';
import { diagnosePanel, Preview } from '../core/diagnose';
import { facing } from '../core/rules';
import { orientationOf } from '../core/panels';
import { flatPaths } from './SheetCanvas';
import type { FlatPattern } from '../core/unfold';
import type { Panel, Rot, Rule, Dir, Cond } from '../core/types';
import { I } from './icons';

const SIDES = ['T', 'B', 'L', 'R'] as const;
const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

/** SVG transform that maps flat-pattern coords (x along A, y up) into a placed rect (SVG y down). */
function flatTransform(rot: Rot, x: number, ySvgTop: number, h: number, f: FlatPattern) {
  const B = ySvgTop + h;
  return rot === 0 ? `matrix(1 0 0 -1 ${x} ${B})`
    : rot === 90 ? `matrix(0 -1 -1 0 ${x + f.height} ${B})`
    : rot === 180 ? `matrix(-1 0 0 1 ${x + f.width} ${B - f.height})`
    : `matrix(0 1 1 0 ${x} ${B - f.width})`;
}

/** The panel alone, A along X, with edge codes and blank dimensions. */
function PanelDrawing({ p, flat }: { p: Panel; flat?: FlatPattern }) {
  const W = p.blankW, H = p.blankH;
  const pad = Math.max(W, H) * 0.16;
  const fs = Math.max(W, H) * 0.045;
  const sw = Math.max(W, H) / 400;
  const fp = flat ? flatPaths(flat) : null;
  return (
    <svg className="ud-svg" viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2.4 * pad}`} role="img" aria-label={`Panel ${p.mark}, desarrollo ${f2(W)} por ${f2(H)} pulgadas`}>
      <rect x={0} y={0} width={W} height={H} fill="var(--part)" stroke="var(--part-edge)" strokeWidth={sw * 1.5} />
      {fp && flat && <g transform={flatTransform(0, 0, 0, H, flat)}>
        <path d={fp.cut} stroke="var(--part-edge)" strokeWidth={sw} fill="none" />
        <path d={fp.bend} stroke="var(--bad)" strokeWidth={sw * 0.8} strokeDasharray={`${sw * 4} ${sw * 3}`} fill="none" opacity={0.75} />
      </g>}
      <g fontFamily="var(--f-mono)" fontWeight={700} fill="var(--accent)" fontSize={fs} textAnchor="middle">
        <text x={W / 2} y={-fs * 0.5}>T {p.edgeT}</text>
        <text x={W / 2} y={H + fs * 1.3}>B {p.edgeB}</text>
        <text x={-fs * 0.6} y={H / 2} transform={`rotate(-90 ${-fs * 0.6} ${H / 2})`}>L {p.edgeL}</text>
        <text x={W + fs * 0.6} y={H / 2} transform={`rotate(90 ${W + fs * 0.6} ${H / 2})`}>R {p.edgeR}</text>
      </g>
      <g fontFamily="var(--f-display)" textAnchor="middle" fill="var(--part-ink)">
        <text x={W / 2} y={H / 2 - fs * 0.2} fontSize={fs * 1.6} fontWeight={700}>{p.mark}</text>
        <text x={W / 2} y={H / 2 + fs * 1.3} fontSize={fs * 0.9} fontFamily="var(--f-mono)" fill="var(--part-ink-2)">{f2(W)} × {f2(H)}"</text>
      </g>
      {/* dimension lines */}
      <g stroke="var(--muted)" strokeWidth={sw} fill="var(--muted)" fontFamily="var(--f-mono)" fontSize={fs * 0.85}>
        <line x1={0} y1={H + fs * 2.4} x2={W} y2={H + fs * 2.4} />
        <line x1={0} y1={H + fs * 2} x2={0} y2={H + fs * 2.8} /><line x1={W} y1={H + fs * 2} x2={W} y2={H + fs * 2.8} />
        <text x={W / 2} y={H + fs * 3.5} textAnchor="middle" stroke="none">desarrollo {f2(W)}" (A = {p.A})</text>
        <line x1={W + fs * 2.4} y1={0} x2={W + fs * 2.4} y2={H} />
        <line x1={W + fs * 2} y1={0} x2={W + fs * 2.8} y2={0} /><line x1={W + fs * 2} y1={H} x2={W + fs * 2.8} y2={H} />
        <text x={W + fs * 3.4} y={H / 2} textAnchor="middle" stroke="none" transform={`rotate(90 ${W + fs * 3.4} ${H / 2})`}>{f2(H)}" (B = {p.B})</text>
      </g>
    </svg>
  );
}

/** A sheet with the panel where it would go, zones and the sides that break a rule. */
function MiniSheet({ pv, p, flat }: { pv: Preview; p: Panel; flat?: FlatPattern }) {
  const settings = useStore(s => s.project.settings);
  const flip = useStore(s => s.cons.get(p.uid)?.flip ?? false);
  const { w: W, h: H } = pv.sheet; const pl = pv.placement; const m = settings.margins;
  const pad = Math.max(W, H) * 0.06;
  const fs = Math.max(W, H) * 0.028;
  const sw = Math.max(W, H) / 500;
  const y = H - pl.y - pl.h;
  const fp = flat ? flatPaths(flat) : null;
  const seg = (d: Dir) => d === 'left' ? [pl.x, y, pl.x, y + pl.h] : d === 'right' ? [pl.x + pl.w, y, pl.x + pl.w, y + pl.h] : d === 'top' ? [pl.x, y, pl.x + pl.w, y] : [pl.x, y + pl.h, pl.x + pl.w, y + pl.h];
  const pos: Record<Dir, [number, number, 'start' | 'middle' | 'end']> = {
    top: [pl.x + pl.w / 2, y + fs * 1.1, 'middle'], bottom: [pl.x + pl.w / 2, y + pl.h - fs * 0.4, 'middle'],
    left: [pl.x + fs * 0.4, y + pl.h / 2, 'start'], right: [pl.x + pl.w - fs * 0.4, y + pl.h / 2, 'end'],
  };
  return (
    <svg className="ud-svg" viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad + fs}`} role="img" aria-label={`Vista en lámina ${H} por ${W}`}>
      <rect x={0} y={0} width={W} height={H} fill="var(--sheet)" stroke="var(--sheet-edge)" strokeWidth={sw * 2} />
      <rect x={m.left} y={m.top} width={W - m.left - m.right} height={H - m.top - m.bottom} fill="none" stroke="var(--sheet-edge)" strokeWidth={sw} strokeDasharray={`${sw * 6} ${sw * 4}`} />
      {pv.zones.map((z, i) => (
        <g key={i}>
          <rect x={z.r.x} y={H - z.r.y - z.r.h} width={z.r.w} height={z.r.h} fill={z.forbid ? 'var(--zone-bad)' : 'var(--zone-good)'} />
          <text x={z.r.x + z.r.w - fs * 0.4} y={H - z.r.y - z.r.h + fs * 1.1} textAnchor="end" fontSize={fs * 0.8} fill="var(--muted)" fontFamily="var(--f-display)">{z.name}</text>
        </g>
      ))}
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--muted)" strokeWidth={sw} strokeDasharray={`${sw * 3} ${sw * 3}`} />
      <text x={fs * 0.3} y={H / 2 - fs * 0.35} fontSize={fs * 0.75} textAnchor="start" fill="var(--muted)" fontFamily="var(--f-mono)">mitad {f2(H / 2)}"</text>
      <rect x={pl.x} y={y} width={pl.w} height={pl.h} fill="var(--part)" fillOpacity={0.85} stroke={pv.ok ? 'var(--part-edge)' : 'var(--bad)'} strokeWidth={sw * (pv.ok ? 1.5 : 2.5)} />
      {fp && flat && <g transform={flatTransform(pl.rot, pl.x, y, pl.h, flat)}><g transform={flip ? `matrix(1 0 0 -1 0 ${flat.height})` : undefined}>
        <path d={fp.cut} stroke="var(--part-edge)" strokeWidth={sw} fill="none" />
        <path d={fp.bend} stroke="var(--bad)" strokeWidth={sw * 0.8} strokeDasharray={`${sw * 4} ${sw * 3}`} fill="none" opacity={0.6} />
      </g></g>}
      {pv.hotSides.map(d => {
        const sd = SIDES.find(x => facing(x, pl.rot, flip) === d)!;
        const dep = Math.min(p.returns?.[sd] ?? 0, d === 'left' || d === 'right' ? pl.w : pl.h);
        const col = pv.ok ? 'var(--ok)' : 'var(--bad)';
        if (dep > 0.01) {
          const r = d === 'left' ? [pl.x, y, dep, pl.h] : d === 'right' ? [pl.x + pl.w - dep, y, dep, pl.h] : d === 'top' ? [pl.x, y, pl.w, dep] : [pl.x, y + pl.h - dep, pl.w, dep];
          return <rect key={d} x={r[0]} y={r[1]} width={r[2]} height={r[3]} fill={col} fillOpacity={0.35} stroke={col} strokeWidth={sw * 1.5} />;
        }
        const [x1, y1, x2, y2] = seg(d); return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={sw * 6} strokeLinecap="round" />;
      })}
      <g fontFamily="var(--f-mono)" fontWeight={700} fontSize={fs * 0.85} fill="var(--accent)">
        {SIDES.map(sd => { const [tx, ty, an] = pos[facing(sd, pl.rot, flip)]; return <text key={sd} x={tx} y={ty} textAnchor={an} dominantBaseline="middle">{p[`edge${sd}` as 'edgeT']}</text>; })}
      </g>
      <text x={pl.x + pl.w / 2} y={y + pl.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={fs * 1.3} fontWeight={700} fill="var(--part-ink)" fontFamily="var(--f-display)">{p.mark}</text>
      <g fontFamily="var(--f-mono)" fill="var(--muted)" fontSize={fs * 0.85}>
        <text x={W / 2} y={H + fs * 1.4} textAnchor="middle">{W}"</text>
        <text x={-fs * 0.6} y={H / 2} textAnchor="middle" transform={`rotate(-90 ${-fs * 0.6} ${H / 2})`}>{H}"</text>
        <text x={pl.x + pl.w / 2} y={y + pl.h / 2 + fs * 1.4} textAnchor="middle" fill="var(--part-ink-2)">{f2(pl.w)} × {f2(pl.h)} · {pl.rot}°</text>
      </g>
    </svg>
  );
}

/** Add "mark is not X" to a rule, so it stops applying to that panel. */
function exceptMark(rule: Rule, mark: string): Rule {
  const items = rule.when.items;
  const ex = rule.when.mode === 'all' ? items.find((c): c is Extract<Cond, { kind: 'cond' }> => c.kind === 'cond' && c.field === 'mark' && c.op === 'notIn') : undefined;
  if (ex) return { ...rule, when: { ...rule.when, items: items.map(c => c === ex ? { ...ex, value: `${ex.value}, ${mark}` } : c) } };
  const cond: Cond = { kind: 'cond', field: 'mark', op: 'notIn', value: mark };
  if (rule.when.mode === 'all' && !rule.when.not) return { ...rule, when: { ...rule.when, items: [...items, cond] } };
  return { ...rule, when: { kind: 'group', mode: 'all', items: [rule.when, cond] } };
}

export function UnplacedDetail({ uid, onClose }: { uid: string; onClose: () => void }) {
  const panels = useStore(s => s.panels);
  const flats = useStore(s => s.flats);
  const project = useStore(s => s.project);
  const layout = useStore(s => s.layout);
  const selSheet = useStore(s => s.selSheet);
  const p = panels.find(x => x.uid === uid);
  const flat = flats[uid];
  const items = layout?.unplaced.filter(u => u.uid === uid) ?? [];
  const n = items.length;
  const dg = useMemo(() => p ? diagnosePanel(p, project.rules, project.settings, project.sheetCatalog, project.sheets) : null, [p, project]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  if (!p || !dg) return null;
  const orient = orientationOf(p, project.settings);
  const sug = dg.suggestion;
  const addN = sug ? Math.max(1, Math.ceil(n / Math.max(1, sug.perSheet))) : 0;
  const isStock = items.some(u => u.kind === 'stock');

  return (
    <div className="ud-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ud" role="dialog" aria-modal="true" aria-label={`Detalle del panel ${p.mark}`}>
        <header className="ud-head">
          <div>
            <h2>{p.mark} <span className={`pill ${orient === 'H' ? 'acc' : 'warn'}`}>{orient === 'H' ? 'HORIZONTAL' : 'VERTICAL'}</span> <span className="pill">{p.type}</span></h2>
            <span className="muted">{n} {n === 1 ? 'pieza sin ubicar' : 'piezas sin ubicar'} · {p.bomSheet || p.bomFile} · {p.blankSource === 'step' ? 'desarrollo del STEP' : `desarrollo ${p.blankSource}`}</span>
          </div>
          <button className="btn sm ghost" onClick={onClose} aria-label="Cerrar"><I.x /></button>
        </header>

        <div className="ud-grid">
          <section className="ud-card">
            <span className="label">El panel</span>
            <PanelDrawing p={p} flat={flat} />
            <dl className="kv">
              <dt>A × B</dt><dd className="num">{p.A} × {p.B}"</dd>
              <dt>Desarrollo</dt><dd className="num">{f2(p.blankW)} × {f2(p.blankH)}"</dd>
              <dt>Bordes</dt><dd className="num">T {p.edgeT} · B {p.edgeB} · L {p.edgeL} · R {p.edgeR}</dd>
              <dt>Giros permitidos</dt><dd className="num">{dg.rotations.join('°, ')}°</dd>
            </dl>
          </section>

          <section className="ud-card">
            <span className="label">Por qué no se puede ubicar</span>
            {isStock && <div className="note"><b>Faltan láminas</b><span>Esta pieza sí cabe, pero las cantidades de lámina que pusiste no alcanzan. Abajo tienes cuántas agregar.</span></div>}
            {dg.tooBig && <div className="viol"><b>No cabe en la lámina más grande</b><span>{dg.tooBig}</span></div>}
            {dg.blockers.map(b => {
              const rule = project.rules.find(r => r.id === b.ruleId);
              return (
                <div key={b.ruleId} className="viol">
                  <div className="row" style={{ flexWrap: 'nowrap' }}><i className="dot" style={{ background: rule?.color }} /><b className="grow">«{b.ruleName}»</b></div>
                  <ul className="ud-list">{b.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  {b.alt && <div className="note"><b>La regla pide que todo el panel quede en esa zona</b><span>Si lo que importa es sólo el lado {b.alt.codes}, cámbiala a «lado {b.alt.codes} dentro de la zona»: así este panel sí cabe y el lado {b.alt.codes} sigue quedando abajo.</span>
                    <div className="row"><button className="btn sm primary" onClick={() => { setRules(rs => rs.map(r => r.id === b.ruleId ? b.alt!.rule : r)); onClose(); }}>Cambiar la regla a sólo el lado {b.alt.codes}</button></div></div>}
                  <div className="row" style={{ gap: 6 }}>
                    {rule && <button className="btn sm" title={`Agrega "Panel mark no está en ${p.mark}" a la regla`} onClick={() => { setRules(rs => rs.map(r => r.id === rule.id ? exceptMark(r, p.mark) : r)); onClose(); }}>Excepción para {p.mark}</button>}
                    {rule && <button className="btn sm ghost" onClick={() => { setState({ view: 'rules', selRule: rule.id }); onClose(); }}>Ver regla</button>}
                  </div>
                </div>
              );
            })}
            {!isStock && !dg.tooBig && !dg.blockers.length && <div className="note"><b>Sí cabe sola en una lámina vacía</b><span>No entró por cómo quedaron las demás piezas o por la separación por grupo (job, material, H/V). Prueba "Colocar aquí" en otra lámina o vuelve a optimizar con más tiempo.</span></div>}
            {dg.current && <>
              <span className="label" style={{ marginTop: 6 }}>Así quedaría en {dg.current.sheet.h} × {dg.current.sheet.w}</span>
              <MiniSheet pv={dg.current} p={p} flat={flat} />
              {dg.current.issues.length > 0 && <ul className="ud-list bad">{dg.current.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </>}
          </section>

          <section className="ud-card ud-wide">
            <span className="label">Lámina sugerida</span>
            {sug ? (
              <div className="ud-sug">
                <div className="grow">
                  <b>{sug.size.h} × {sug.size.w}</b>
                  <span className="muted"> — cabe{sug.perSheet > 1 ? `n ${sug.perSheet} de este panel por lámina` : ' una por lámina'}{sug.enabled ? ' · ya está en este nesting' : ''}.</span>
                </div>
                <button className="btn sm primary" onClick={() => { addSheetStock(sug.size, addN); onClose(); }}><I.plus /> Agregar {addN} {addN === 1 ? 'lámina' : 'láminas'} {sug.size.h} × {sug.size.w}</button>
              </div>
            ) : dg.minSheet ? (<>
              {dg.altSuggestion && (() => { const a = dg.altSuggestion!; const blk = dg.blockers.find(b => b.alt); return (
                <div className="ud-sug">
                  <div className="grow">
                    <b>Recomendado: cambiar la regla a sólo el lado {a.codes}.</b>
                    <span className="muted"> Así cabe en <b>{a.size.h} × {a.size.w}</b> ({a.perSheet} {a.perSheet === 1 ? 'por lámina' : 'de este panel por lámina'}) y el lado {a.codes} queda abajo.</span>
                  </div>
                  {blk && <button className="btn sm primary" onClick={() => { setRules(rs => rs.map(r => r.id === blk.ruleId ? blk.alt!.rule : r)); onClose(); }}>Cambiar la regla</button>}
                </div>); })()}
              <div className="ud-sug alt">
                <div className="grow">
                  <b>Con la regla como está, ningún tamaño del catálogo sirve.</b>
                  <span className="muted"> La lámina más pequeña que la cumple es <b>{dg.minSheet.h} × {dg.minSheet.w}</b>.{dg.altSuggestion ? '' : ' Si no la manejas, la salida es una excepción en la regla para esta marca.'}</span>
                </div>
                <button className="btn sm" onClick={() => { updateProject(pr => ({ ...pr, sheetCatalog: [...pr.sheetCatalog, dg.minSheet!] })); addSheetStock(dg.minSheet!, n); onClose(); }}><I.plus /> Usar {dg.minSheet.h} × {dg.minSheet.w}</button>
              </div>
            </>            ) : <span className="muted">Con estas reglas no hay lámina razonable (hasta 240") donde quepa. Revisa la regla o haz una excepción.</span>}
            <div className="ud-sizes">
              {dg.sizes.map(z => (
                <span key={`${z.size.h}x${z.size.w}`} className={`ud-size ${z.ok ? 'ok' : 'no'} ${z === sug ? 'sel' : ''}`} title={z.ok ? `Caben ${z.perSheet} por lámina` : 'No cumple las reglas'}>
                  {z.ok ? '✓' : '✗'} {z.size.h} × {z.size.w}{z.ok ? ` · ${z.perSheet}` : ''}{z.enabled ? ' •' : ''}
                </span>
              ))}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>✓ cumple las reglas · número = cuántas de este panel caben solas · • = tamaño ya elegido en este nesting</span>
            <div className="ud-previews">
              {dg.altSuggestion && <div className="ud-card">
                <span className="label">Con la regla cambiada, en {dg.altSuggestion.size.h} × {dg.altSuggestion.size.w}</span>
                <MiniSheet pv={dg.altSuggestion.preview} p={p} flat={flat} />
              </div>}
              {dg.fixed && <div className="ud-card">
                <span className="label">{dg.altSuggestion ? 'Con la regla como está' : 'Así quedaría'}, en {dg.fixed.sheet.h} × {dg.fixed.sheet.w}</span>
                <MiniSheet pv={dg.fixed} p={p} flat={flat} />
              </div>}
            </div>
          </section>
        </div>

        <footer className="ud-foot">
          <button className="btn sm" disabled={!items.length} title="Sin respetar reglas, marcada como error, para ver cómo quedaría" onClick={() => { if (items[0] && previewOnSheet(selSheet, items[0].iid)) onClose(); }}>Probar una en la lámina {selSheet + 1}</button>
          <button className="btn sm" disabled={!items.length} onClick={() => { if (items[0] && placeOnSheet(selSheet, items[0].iid)) onClose(); }}>Colocar una en la lámina {selSheet + 1}</button>
          <span className="grow" />
          <button className="btn sm" onClick={onClose}>Cerrar</button>
        </footer>
      </div>
    </div>
  );
}
