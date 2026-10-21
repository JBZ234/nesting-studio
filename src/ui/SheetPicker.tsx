import { T, Tn } from '../i18n';
import React, { useMemo, useState } from 'react';
import { useStore, setSheets, updateProject, addSheetStock, applyTune, dismissTune } from '../store';
import { makeSheet, sheetName } from '../core/defaults';
import type { SheetSize } from '../core/types';
import { I } from './icons';

/** Sizes used by this nesting, each with its quantity limit, plus a dropdown fed by the catalog. */
export function SheetPicker({ compact = false }: { compact?: boolean }) {
  const sheets = useStore(s => s.project.sheets);
  const catalog = useStore(s => s.project.sheetCatalog);
  const layout = useStore(s => s.layout);
  const [custom, setCustom] = useState(false);
  const [ch, setCh] = useState(60); const [cw, setCw] = useState(144);
  const used = useMemo(() => {
    const m = new Map<string, number>();
    layout?.sheets.forEach(sh => m.set(sh.sheetId, (m.get(sh.sheetId) || 0) + 1));
    return m;
  }, [layout]);
  const selected = sheets.filter(d => d.enabled);
  const available = catalog.filter(c => !selected.some(d => d.w === c.w && d.h === c.h));

  const add = (sz: SheetSize) => setSheets(ss => {
    const ex = ss.find(d => d.w === sz.w && d.h === sz.h);
    return ex ? ss.map(d => d === ex ? { ...d, enabled: true } : d) : [...ss, makeSheet(sz)];
  });
  const addCustom = () => {
    if (!(cw > 0 && ch > 0)) return;
    const sz = { w: Math.max(cw, ch), h: Math.min(cw, ch) };
    updateProject(p => ({ ...p, sheetCatalog: p.sheetCatalog.some(c => c.w === sz.w && c.h === sz.h) ? p.sheetCatalog : [...p.sheetCatalog, sz].sort((a, b) => a.h - b.h || a.w - b.w) }));
    add(sz); setCustom(false);
  };

  return (
    <div className="sheet-picker" style={{ display: 'grid', gap: 6 }}>
      {selected.map(d => {
        const u = used.get(d.id) || 0;
        const over = d.stock !== null && u >= d.stock;
        return (
          <div key={d.id} className="sp-row">
            <b className="num">{sheetName(d)}</b>
            <label className="sp-qty" title={T("Cantidad disponible de esta lámina (vacío = sin límite)")}>
              <input id={`stk-${d.id}`} type="number" min={0} placeholder={T("máx ∞")} aria-label={T`Cantidad máxima de ${sheetName(d)}`} value={d.stock ?? ''}
                onChange={e => setSheets(ss => ss.map(x => x.id === d.id ? { ...x, stock: e.target.value === '' ? null : Math.max(0, Math.round(+e.target.value)) } : x))} />
            </label>
            <span className={`pill num ${over ? 'warn' : ''}`} title={T("Láminas usadas en el resultado actual")}>{u}{d.stock !== null ? `/${d.stock}` : ''}</span>
            <button className="iconbtn" title={T("Quitar de este nesting")} onClick={() => setSheets(ss => ss.filter(x => x.id !== d.id))}><I.x /></button>
          </div>
        );
      })}
      {!selected.length && <span className="viol soft">{T("Elige al menos un tamaño de lámina.")}</span>}
      {!custom ? (
        <select id={compact ? 'addsheet-c' : 'addsheet'} value="" aria-label={T("Agregar tamaño de lámina")}
          onChange={e => { const v = e.target.value; if (v === 'custom') setCustom(true); else if (v) { const [h, w] = v.split('x').map(Number); add({ w, h }); } }}>
          <option value="">{T("+ Agregar tamaño de lámina…")}</option>
          {available.map(c => <option key={`${c.h}x${c.w}`} value={`${c.h}x${c.w}`}>{sheetName(c)}</option>)}
          <option value="custom">{T("Otro tamaño…")}</option>
        </select>
      ) : (
        <div className="row" style={{ gap: 4 }}>
          <input type="number" value={ch} onChange={e => setCh(+e.target.value)} style={{ width: 60 }} aria-label={T("Alto")} />
          <span>×</span>
          <input type="number" value={cw} onChange={e => setCw(+e.target.value)} style={{ width: 66 }} aria-label={T("Largo")} />
          <button className="btn sm primary" onClick={addCustom}>{T("Agregar")}</button>
          <button className="btn sm ghost" onClick={() => setCustom(false)}>{T("Cancelar")}</button>
        </div>
      )}
    </div>
  );
}

/** Banner shown when the quantity limits leave pieces without a sheet. */
export function StockBanner() {
  const layout = useStore(s => s.layout);
  const suggestions = useStore(s => s.suggestions);
  const suggesting = useStore(s => s.suggesting);
  const [pick, setPick] = useState<string>('');
  const [n, setN] = useState<number | ''>('');
  const missing = layout?.unplaced.filter(u => u.kind === 'stock').length ?? 0;
  if (!missing) return null;
  const list = suggestions ?? [];
  const cur = list.find(s => s.id === pick) ?? list[0];
  const qty = n === '' ? cur?.add ?? 1 : n;
  return (
    <div className="stock-banner" role="status">
      <I.warn />
      <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
        <b>{T("Faltan láminas:")} {missing} {T("piezas sin ubicar por el límite de cantidad.")}</b>
        {suggesting ? <span className="row muted" style={{ gap: 6 }}><span className="spin" /> {T("Calculando cuántas láminas agregar…")}</span>
          : cur ? (
            <div className="row" style={{ gap: 6 }}>
              <span>{T("Sugerencia: agregar")}</span>
              <input id="sug-n" type="number" min={1} value={qty} onChange={e => setN(e.target.value === '' ? '' : Math.max(1, +e.target.value))} style={{ width: 56 }} aria-label={T("Cantidad a agregar")} />
              <span>{T("láminas de")}</span>
              <select id="sug-size" value={cur.id} onChange={e => { setPick(e.target.value); setN(''); }} aria-label={T("Tamaño a agregar")}>
                {list.map(s => <option key={s.id} value={s.id}>{sheetName(s)} (+{s.add}{s.stillMissing ? T`, faltan ${s.stillMissing}` : ''})</option>)}
              </select>
              <button className="btn sm primary" onClick={() => { addSheetStock({ w: cur.w, h: cur.h }, qty); setN(''); setPick(''); }}>{T("Agregar y optimizar")}</button>
            </div>
          ) : <span className="muted">{T("Ningún tamaño del catálogo alcanza: revisa las reglas o agrega un tamaño mayor.")}</span>}
      </div>
    </div>
  );
}

/** Optimizer knobs shown next to the sheets: multiplicity vs. material, row alignment, search time. */
export function OptimizePanel() {
  const s = useStore(st => st.project.settings);
  const set = (p: Partial<typeof s>) => updateProject(pr => ({ ...pr, settings: { ...pr.settings, ...p } }));
  const loss = Math.round((s.repeatWeight ?? 0) * 0.3);
  const tune = useStore(st => st.tune);
  return (
    <div className="opt-panel">
      {tune?.running && <span className="row muted" style={{ gap: 6, fontSize: 12.5 }}><span className="spin" /> {T("Probando otros valores")}{tune.step ? ` (${tune.step})` : ''}…</span>}
      {tune && !tune.running && !tune.result && <span className="muted" style={{ fontSize: 12.5 }}>{T("✓ Con estas reglas, los valores actuales ya son los mejores que encontré.")}</span>}
      <label className="row" style={{ gap: 8, fontSize: 13 }}>
        <span className="switch"><input id="o-rep" type="checkbox" checked={s.repeatSheets} onChange={e => set({ repeatSheets: e.target.checked })} /><span /></span>
        <span>{T("Repetir láminas iguales")}</span>
      </label>
      {s.repeatSheets && <>
        <label className="opt-slider">
          <span>{T("Prioridad de repetir")} <b className="num">{s.repeatWeight}</b></span>
          <input id="o-rw" type="range" min={0} max={100} step={5} value={s.repeatWeight} onChange={e => set({ repeatWeight: +e.target.value })} />
          <small className="muted">{s.repeatWeight === 0 ? T('Sólo repite si no cuesta material') : T`Acepta hasta ${loss}% menos aprovechamiento por repetir una lámina`}</small>
        </label>
        <label className="opt-slider">
          <span>{T("Aprovechamiento mínimo para repetir")} <b className="num">{s.repeatMinUtil}%</b></span>
          <input id="o-rmu" type="range" min={0} max={95} step={5} value={s.repeatMinUtil} onChange={e => set({ repeatMinUtil: +e.target.value })} />
          <small className="muted">{T("Una lámina más vacía que esto no se repite")}</small>
        </label>
      </>}
      <label className="opt-slider">
        <span>{T("Láminas cuadriculadas")} <b className="num">{s.gridWeight ? s.gridWeight : 'no'}</b></span>
        <input id="o-grid" type="range" min={0} max={100} step={5} value={s.gridWeight ?? 0} onChange={e => set({ gridWeight: +e.target.value })} />
        <small className="muted">{s.gridWeight ? T`Prefiere filas de paneles del mismo alto (cortes limpios); acepta hasta ${Math.round((s.gridWeight ?? 0) * 0.15)}% menos aprovechamiento por lámina para lograrlo` : T('Sin preferencia por láminas cuadriculadas')}</small>
      </label>
      {(s.gridWeight ?? 0) > 0 && <label className="opt-slider">
        <span>{T("Diferencia de alto en una fila")} <b className="num">{(s.gridTol ?? 0.1).toFixed(2)}"</b></span>
        <input id="o-gtol" type="range" min={0} max={1} step={0.05} value={s.gridTol ?? 0.1} onChange={e => set({ gridTol: +e.target.value })} />
        <small className="muted">{T("Paneles cuyo alto difiere hasta esto cuentan como la misma fila")}</small>
      </label>}
      <label className="opt-slider">
        <span>{T("Filas del mismo alto")} <b className="num">{s.rowAlign || 'no'}</b></span>
        <input id="o-ra" type="range" min={0} max={100} step={5} value={s.rowAlign} onChange={e => set({ rowAlign: +e.target.value })} />
      </label>
      <label className="opt-slider">
        <span>{T("Tiempo de búsqueda")} <b className="num">{(s.timeMs / 1000).toFixed(0)} s</b></span>
        <input id="o-t" type="range" min={1000} max={20000} step={1000} value={s.timeMs} onChange={e => set({ timeMs: +e.target.value })} />
      </label>
    </div>
  );
}

/** Shown when other slider values give a clearly better result. */
export function TuneBanner() {
  const tune = useStore(s => s.tune);
  const r = tune?.result;
  if (!r) return null;
  const dS = r.base.sheets - r.best.sheets, dU = r.base.unplaced - r.best.unplaced;
  const gains: string[] = [];
  if (dU > 0) gains.push(`${dU} ${dU === 1 ? T('pieza más ubicada') : T('piezas más ubicadas')}`);
  if (dS > 0) gains.push(`${dS} ${dS === 1 ? T('lámina menos') : T('láminas menos')}`);
  gains.push(T`aprovechamiento ${(r.base.util * 100).toFixed(1)}% → ${(r.best.util * 100).toFixed(1)}%`);
  if (r.best.layouts !== r.base.layouts) gains.push(T`${r.best.layouts} layouts distintos (antes ${r.base.layouts})`);
  return (
    <div className="tune-banner" role="status">
      <I.auto />
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <b>{T("Con otros valores en Optimización sale mejor:")} {gains.join(' · ')}.</b>
        <span className="muted">{r.changes.map(c => `${c.label}: ${c.from} → ${c.to}`).join(' · ')}</span>
      </div>
      <div className="row" style={{ gap: 6, flex: 'none' }}>
        <button className="btn sm primary" onClick={applyTune}>{T("Cambiar a valores óptimos")}</button>
        <button className="btn sm ghost" onClick={dismissTune}>{T("Ignorar")}</button>
      </div>
    </div>
  );
}
