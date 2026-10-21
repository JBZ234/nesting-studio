import { T, Tn } from '../i18n';
import React, { useEffect, useMemo } from 'react';
import { useStore, confirmSetup, skipSetup, activePanels } from '../store';
import { SheetPicker } from './SheetPicker';
import { sheetName } from '../core/defaults';
import { I } from './icons';

/** After choosing a folder: confirm sheet sizes and quantities before the first nesting. */
export function SetupDialog() {
  const pending = useStore(s => s.pendingSetup);
  const state = useStore(s => s);
  const sheets = useStore(s => s.project.sheets);
  const label = useStore(s => s.sourceLabel);
  const info = useMemo(() => {
    const ps = activePanels(state);
    let pieces = 0, area = 0, excluded = 0;
    for (const p of ps) {
      const c = state.cons.get(p.uid);
      if (!c || c.exclude || p.qty <= 0) { excluded += p.qty; continue; }
      pieces += p.qty; area += p.qty * (p.blankW + c.dw) * (p.blankH + c.dh);
    }
    return { marks: ps.length, pieces, area, excluded };
  }, [state.panels, state.cons, state.jobFilter]);

  useEffect(() => {
    if (!pending) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') skipSetup(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [pending]);
  if (!pending || !state.panels.length) return null;

  const on = sheets.filter(d => d.enabled);
  const unlimited = on.some(d => d.stock === null);
  const stockArea = on.reduce((a, d) => a + (d.stock ?? 0) * d.w * d.h, 0);
  const needAt = (u: number) => info.area / u;              // sheet area needed at utilization u
  const enough = unlimited || stockArea >= needAt(0.7);
  const tight = !unlimited && stockArea >= needAt(0.85) && stockArea < needAt(0.7);
  const big = on.reduce((a, d) => (d.w * d.h > a.w * a.h ? d : a), on[0] ?? { w: 0, h: 0 });
  return (
    <div className="ud-backdrop">
      <div className="ud setup" role="dialog" aria-modal="true" aria-label={T("Láminas para este nesting")}>
        <header className="ud-head">
          <div>
            <h2>{T("Láminas para este nesting")}</h2>
            <span className="muted">{label}</span>
          </div>
          <button className="btn sm ghost" onClick={skipSetup} aria-label={T("Cerrar sin calcular")}><I.x /></button>
        </header>
        <div className="setup-body">
          <div className="setup-stats">
            <div className="stat"><b>{info.pieces}</b><span>{T("piezas a anidar")}</span></div>
            <div className="stat"><b>{info.marks}</b><span>{T("marcas")}</span></div>
            <div className="stat"><b>{(info.area / 144).toFixed(0)}</b><span>{T("pies² de desarrollo")}</span></div>
            {info.excluded > 0 && <div className="stat"><b>{info.excluded}</b><span>{T("excluidas por reglas")}</span></div>}
          </div>
          <p className="muted" style={{ margin: 0 }}>{T("Elige los tamaños que vas a usar y cuántas láminas tienes de cada uno. Deja la cantidad vacía si no hay límite.")}</p>
          <SheetPicker />
          {on.length > 0 && <div className={`setup-check ${unlimited || enough ? 'ok' : tight ? 'warn' : 'bad'}`}>
            {unlimited
              ? <span>{T("Hay tamaños sin límite: todas las piezas tendrán lámina. Con un 70% de aprovechamiento serían unas")} <b>{Math.ceil(needAt(0.7) / (big.w * big.h))}</b> {T("láminas de")} {sheetName(big)}.</span>
              : <span>{T("Área disponible")} <b>{(stockArea / 144).toFixed(0)} {T("pies²")}</b> {T("para")} <b>{(info.area / 144).toFixed(0)} {T("pies²")}</b> {T("de piezas:")} {enough
                  ? <>{T("alcanza con un aprovechamiento de")} {(info.area / stockArea * 100).toFixed(0)}{T("% o más.")}</>
                  : tight ? <>{T("queda justo: necesitas un")} {(info.area / stockArea * 100).toFixed(0)}{T("% de aprovechamiento. Puede que falten láminas.")}</>
                  : <>{T("no alcanza ni aprovechando el 85%. Agrega láminas o algunas piezas quedarán sin ubicar.")}</>}</span>}
          </div>}
        </div>
        <footer className="ud-foot">
          <button className="btn sm ghost" onClick={skipSetup}>{T("Ahora no")}</button>
          <span className="grow" />
          <button className="btn primary" disabled={!on.length} onClick={confirmSetup}><I.play /> {T("Calcular nesting")}</button>
        </footer>
      </div>
    </div>
  );
}
