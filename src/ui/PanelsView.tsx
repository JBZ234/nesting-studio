import React, { useMemo, useState } from 'react';
import { useStore, setState, setOverride, activePanels, getState } from '../store';
import type { Panel } from '../core/types';
import type { FlatPattern } from '../core/unfold';
import { orientationOf } from '../core/panels';
import { describeAction } from './describe';
import { EdgeCodes } from './RulesView';
import { I } from './icons';

type SortKey = 'mark' | 'type' | 'A' | 'B' | 'blankW' | 'blankH' | 'qty' | 'job';

export function PanelsView() {
  const panels = useStore(s => s.panels);
  const jf = useStore(s => s.jobFilter);
  const cons = useStore(s => s.cons);
  const rules = useStore(s => s.project.rules);
  const settings = useStore(s => s.project.settings);
  const selPanel = useStore(s => s.selPanel);
  const overrides = useStore(s => s.project.overrides);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [src, setSrc] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; d: 1 | -1 }>({ k: 'mark', d: 1 });
  const list = useMemo(() => activePanels(getState()), [panels, jf]);
  const types = [...new Set(list.map(p => p.type))].sort();
  const rows = list
    .filter(p => !q || [p.mark, p.bomSheet, p.edgeT, p.edgeB, p.edgeL, p.edgeR, p.job].some(x => x.toLowerCase().includes(q.toLowerCase())))
    .filter(p => !type || p.type === type)
    .filter(p => !src || p.blankSource === src)
    .sort((a, b) => { const x = (a as any)[sort.k], y = (b as any)[sort.k]; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.d; });
  const th = (k: SortKey, label: string, r = false) => <th className={`sort ${r ? 'r' : ''}`} onClick={() => setSort(s => ({ k, d: s.k === k ? (s.d === 1 ? -1 : 1) : 1 }))}>{label}{sort.k === k ? (sort.d === 1 ? ' ▲' : ' ▼') : ''}</th>;
  const sel = panels.find(p => p.uid === selPanel);
  const totalQty = rows.reduce((a, p) => a + (p.include ? p.qty : 0), 0);
  const est = list.filter(p => p.blankSource === 'estimado').length;

  return (
    <div className="panels-view">
      <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
        <div className="stage-bar">
          <h2>Paneles</h2>
          <span className="pill">{rows.length} marcas · {totalQty} piezas</span>
          {est > 0 && <span className="pill warn" title="Sin STEP: desarrollo calculado con las holguras por condición de borde">{est} con desarrollo estimado</span>}
          <span className="grow" />
          <input id="pq" type="text" placeholder="Buscar marca, borde, hoja…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }} />
          <select id="pt" value={type} onChange={e => setType(e.target.value)} aria-label="Tipo"><option value="">Todos los tipos</option>{types.map(t => <option key={t}>{t}</option>)}</select>
          <select id="ps" value={src} onChange={e => setSrc(e.target.value)} aria-label="Fuente del desarrollo"><option value="">Toda fuente</option><option value="step">STEP</option><option value="estimado">Estimado</option><option value="manual">Manual</option></select>
        </div>
        <div className="tbl-wrap" style={{ flex: 1 }}>
          <table className="tbl">
            <thead><tr><th title="Incluir en el nesting">Incl.</th>{th('mark', 'Marca')}{th('job', 'Job')}{th('type', 'Tipo')}<th>T · B · L · R</th>{th('A', 'A', true)}{th('B', 'B', true)}<th>H/V</th>{th('blankW', 'Desarrollo', true)}<th>Fuente</th>{th('qty', 'Cant.', true)}<th>Reglas</th></tr></thead>
            <tbody>
              {rows.map(p => {
                const c = cons.get(p.uid);
                return (
                  <tr key={p.uid} aria-selected={p.uid === selPanel} className={p.include ? '' : 'off'} onClick={() => setState({ selPanel: p.uid })} style={{ cursor: 'pointer' }}>
                    <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={p.include} onChange={e => setOverride(p.uid, { include: e.target.checked })} aria-label={`Incluir ${p.mark}`} /></td>
                    <td><b>{p.mark}</b>{overrides[p.uid] && <span className="pill acc" style={{ marginLeft: 6 }}>editado</span>}</td>
                    <td className="muted">{p.job}</td>
                    <td>{p.type}</td>
                    <td><EdgeCodes p={p} /></td>
                    <td className="r num">{p.A}</td><td className="r num">{p.B}</td>
                    <td>{orientationOf(p, settings)}</td>
                    <td className="r num">{p.blankW.toFixed(2)} × {p.blankH.toFixed(2)}</td>
                    <td><span className={`pill ${p.blankSource === 'step' ? 'ok' : p.blankSource === 'manual' ? 'acc' : 'warn'}`}>{p.blankSource === 'step' ? 'STEP' : p.blankSource}</span></td>
                    <td className="r" onClick={e => e.stopPropagation()}><input type="number" min={0} step={1} value={p.qty} onChange={e => setOverride(p.uid, { qty: Math.max(0, Math.round(+e.target.value)) })} aria-label={`Cantidad ${p.mark}`} style={{ width: 60 }} /></td>
                    <td><span className="row" style={{ gap: 3, flexWrap: 'nowrap' }}>{rules.filter(r => c?.rules.includes(r.id)).map(r => <i key={r.id} className="dot" title={r.name} style={{ background: r.color }} />)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="empty" style={{ height: 'auto', padding: 30 }}><p>{panels.length ? 'Ningún panel coincide con el filtro.' : 'Carga una carpeta con BOM y STEP.'}</p></div>}
        </div>
      </section>
      <aside className="inspector" aria-label="Detalle del panel">
        {sel ? <PanelDetail p={sel} /> : <div className="empty"><p>Selecciona un panel para ver su desarrollo y editarlo.</p></div>}
      </aside>
    </div>
  );
}

function PanelDetail({ p }: { p: Panel }) {
  const flat = useStore(s => s.flats[p.uid]);
  const cons = useStore(s => s.cons.get(p.uid));
  const rules = useStore(s => s.project.rules);
  const layout = useStore(s => s.layout);
  const ov = useStore(s => s.project.overrides[p.uid]);
  const onSheets = layout ? layout.sheets.map((s, i) => s.placements.some(x => x.uid === p.uid) ? i : -1).filter(i => i >= 0) : [];
  const num = (k: 'A' | 'B' | 'blankW' | 'blankH', label: string, step = 0.0625) => (
    <label className="field"><span>{label}</span><input id={`d-${k}`} type="number" step={step} value={+p[k].toFixed(4)} onChange={e => setOverride(p.uid, { [k]: +e.target.value })} /></label>
  );
  const txt = (k: 'edgeT' | 'edgeB' | 'edgeL' | 'edgeR' | 'grain', label: string) => (
    <label className="field"><span>{label}</span><input id={`d-${k}`} type="text" value={p[k]} onChange={e => setOverride(p.uid, { [k]: e.target.value.toUpperCase() })} /></label>
  );
  return (
    <>
      <div className="insp-sec">
        <div className="row"><h3 style={{ fontSize: 22 }}>{p.mark}</h3><span className="pill">{p.type}</span><span className="grow" />{ov && <button className="btn sm" onClick={() => setOverride(p.uid, null)}>Deshacer ediciones</button>}</div>
        <div className="muted" style={{ fontSize: 13 }}>{p.bomFile || 'sin BOM'} · {p.bomSheet}{p.stepFile ? ` · ${p.stepFile}` : ''}</div>
        <FlatPreview p={p} flat={flat} />
        {flat && <dl className="kv">
          <dt>Espesor detectado</dt><dd className="num">{flat.thickness.toFixed(3)}"</dd>
          <dt>Factor K</dt><dd className="num">{flat.kFactor}</dd>
          <dt>Dobleces / caras</dt><dd className="num">{flat.bends} / {flat.facesUnfolded}</dd>
          {flat.warnings.length > 0 && <><dt>Avisos</dt><dd>{flat.warnings.join('; ')}</dd></>}
        </dl>}
        {!flat && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Sin STEP: el desarrollo se estima con A/B y las holguras por condición de borde (Ajustes). Puedes escribir el valor exacto abajo.</p>}
      </div>
      <div className="insp-sec">
        <span className="label">Editar (sólo en esta app, no cambia el BOM)</span>
        <div className="grid2">
          <label className="field"><span>Cantidad</span><input id="d-qty" type="number" min={0} value={p.qty} onChange={e => setOverride(p.uid, { qty: Math.max(0, Math.round(+e.target.value)) })} /></label>
          <label className="field"><span>Incluir</span><select value={p.include ? '1' : '0'} onChange={e => setOverride(p.uid, { include: e.target.value === '1' })}><option value="1">Sí</option><option value="0">No</option></select></label>
          {num('A', 'A')}{num('B', 'B')}
          {num('blankW', 'Desarrollo ancho')}{num('blankH', 'Desarrollo alto')}
          {txt('edgeT', 'Borde T')}{txt('edgeB', 'Borde B')}{txt('edgeL', 'Borde L')}{txt('edgeR', 'Borde R')}
          {txt('grain', 'Grain')}
        </div>
      </div>
      <div className="insp-sec">
        <span className="label">Reglas que aplican</span>
        {rules.filter(r => cons?.rules.includes(r.id)).map(r => (
          <div key={r.id} style={{ cursor: 'pointer' }} onClick={() => setState({ view: 'rules', selRule: r.id })}>
            <div className="row" style={{ gap: 6 }}><i className="dot" style={{ background: r.color }} /><b>{r.name}</b></div>
            <div className="muted" style={{ fontSize: 12.5, paddingLeft: 14 }}>{r.actions.map(describeAction).join(' · ')}</div>
          </div>
        ))}
        {!cons?.rules.length && <span className="muted">Ninguna</span>}
        {cons && <div className="muted" style={{ fontSize: 12.5 }}>Rotaciones permitidas: {cons.rotations.map(r => `${r}°`).join(', ')}</div>}
      </div>
      {onSheets.length > 0 && <div className="insp-sec"><span className="label">En láminas</span><div className="chips">{onSheets.map(i => <button key={i} className="chip" onClick={() => setState({ view: 'sheets', selSheet: i, selIid: layout!.sheets[i].placements.find(x => x.uid === p.uid)!.iid })}>{i + 1}</button>)}</div></div>}
    </>
  );
}

function FlatPreview({ p, flat }: { p: Panel; flat?: FlatPattern }) {
  const W = p.blankW, H = p.blankH;
  const pad = Math.max(W, H) * 0.06;
  let cut = '', bend = '', hole = '';
  if (flat) for (const s of flat.segments) {
    const d = `M${s.a[0].toFixed(3)} ${(flat.height - s.a[1]).toFixed(3)}L${s.b[0].toFixed(3)} ${(flat.height - s.b[1]).toFixed(3)}`;
    if (s.kind === 'bend') bend += d; else if (s.kind === 'hole') hole += d; else cut += d;
  }
  const fw = flat ? flat.width : W, fh = flat ? flat.height : H;
  const bb = flat?.baseBox;
  const k = Math.max(fw, fh) / 300;
  return (
    <div className="flat-prev">
      <svg viewBox={`${-pad} ${-pad} ${fw + 2 * pad} ${fh + 2 * pad + pad}`} aria-label={`Desarrollo de ${p.mark}`}>
        <rect x={0} y={0} width={fw} height={fh} fill="none" stroke="var(--accent)" strokeWidth={k} strokeDasharray={`${k * 6} ${k * 4}`} />
        {flat ? <>
          {bb && <rect x={bb.x0} y={fh - bb.y1} width={bb.x1 - bb.x0} height={bb.y1 - bb.y0} fill="var(--part)" opacity={0.6} />}
          <path d={cut} stroke="var(--fg)" strokeWidth={k * 1.4} fill="none" />
          <path d={hole} stroke="var(--sel)" strokeWidth={k * 1.2} fill="none" />
          <path d={bend} stroke="var(--bad)" strokeWidth={k} strokeDasharray={`${k * 5} ${k * 3}`} fill="none" />
        </> : <rect x={0} y={0} width={W} height={H} fill="var(--part)" stroke="var(--fg)" strokeWidth={k * 1.4} />}
        <g fontFamily="var(--f-mono)" fontSize={k * 11} fill="var(--muted)">
          <text x={fw / 2} y={fh + pad * 1.1} textAnchor="middle">{fw.toFixed(3)}" (eje A)</text>
          <text x={fw / 2} y={fh / 2} textAnchor="middle" fill="var(--faint)">{fh.toFixed(3)}"</text>
          <text x={fw / 2} y={-pad * 0.3} textAnchor="middle" fill="var(--faint)">T {p.edgeT}</text>
        </g>
      </svg>
      <div className="row" style={{ gap: 12, fontSize: 12, marginTop: 4 }}>
        <span><i className="dot" style={{ background: 'var(--fg)' }} /> corte</span>
        <span><i className="dot" style={{ background: 'var(--bad)' }} /> doblez</span>
        <span><i className="dot" style={{ background: 'var(--sel)' }} /> perforación</span>
        <span><i className="dot" style={{ background: 'var(--accent)' }} /> blank</span>
      </div>
    </div>
  );
}
