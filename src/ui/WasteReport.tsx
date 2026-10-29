import { T } from '../i18n';
import React, { useEffect, useRef, useState } from 'react';
import { useStore, releaseList, relStats, fillReport, setRelView } from '../store';
import type { RelStat } from '../store';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ft2 = (in2: number) => `${Math.round(in2 / 144).toLocaleString()} ft²`;

/**
 * Waste of each release nested on its own, of all of them one by one (summed), and of all of them
 * nested together. A mini bar graphic in the topbar; click it for the report.
 */
export function WasteReport() {
  useStore(s => s.layout); useStore(s => s.relCache); useStore(s => s.project);
  const nesting = useStore(s => s.nesting);
  const relView = useStore(s => s.relView);
  const run = useStore(s => s.reportRun);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const rels = releaseList();
  const st = relStats();

  // fill the missing releases in the background once the nesting on screen is done
  useEffect(() => {
    if (nesting || rels.length < 2) return;
    const t = setTimeout(fillReport, 1200);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  if (rels.length < 2) return null;

  const singles = rels.map(r => st[r]).filter(Boolean) as RelStat[];
  const allKnown = singles.length === rels.length;
  const sep: RelStat | null = allKnown ? singles.reduce((a, s) => ({ util: 0, sheets: a.sheets + s.sheets, usedArea: a.usedArea + s.usedArea, sheetArea: a.sheetArea + s.sheetArea, unplaced: a.unplaced + s.unplaced, edited: a.edited || s.edited }), { util: 0, sheets: 0, usedArea: 0, sheetArea: 0, unplaced: 0, edited: false }) : null;
  if (sep) sep.util = sep.sheetArea ? sep.usedArea / sep.sheetArea : 0;
  const all = st.all;
  const waste = (s?: RelStat | null) => (s ? 1 - s.util : null);
  const known = [...singles, all].filter(Boolean).map(s => 1 - s!.util);
  const max = Math.max(0.05, ...known);
  const pending = ['all', ...rels].filter(k => !st[k]).length;

  type Row = { key: string; label: string; s: RelStat | null | undefined; kind: 'rel' | 'sep' | 'all'; click?: string };
  const rows: Row[] = [
    ...rels.map(r => ({ key: r, label: r, s: st[r], kind: 'rel' as const, click: r })),
    { key: 'sep', label: T('Uno por uno (suma)'), s: sep, kind: 'sep' },
    { key: 'all', label: T('Todos juntos'), s: all, kind: 'all', click: 'all' },
  ];
  const busyKey = (k: string) => run === k || (k === relView && !!nesting) || (k === 'sep' && !allKnown && (!!run || !!nesting));

  return (
    <div className="wr" ref={box}>
      <button className={`wr-mini${open ? ' on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}
        title={T('Desperdicio por release: clic para ver el reporte')} aria-label={T('Reporte de desperdicio')}>
        <span className="wr-spark" aria-hidden="true">
          {[...rels, 'all'].map(k => {
            const w = waste(st[k]);
            return <i key={k} className={`${k === 'all' ? 'all' : ''}${w == null ? ' miss' : ''}${k === relView ? ' cur' : ''}`} style={{ height: w == null ? '30%' : `${Math.max(8, (w / max) * 100)}%` }} />;
          })}
        </span>
        <span className="wr-cap">{T('desperdicio')}</span>
      </button>
      {open && <div className="pane wr-pop" role="dialog" aria-label={T('Reporte de desperdicio')}>
        <div className="wr-head">
          <b>{T('Desperdicio por release')}</b>
          <span className="muted">{pending ? T`calculando ${pending} más…` : T('área de lámina sin piezas')}</span>
        </div>
        <div className="wr-rows">
          {rows.map(r => {
            const w = waste(r.s);
            return (
              <div key={r.key} className={`wr-row ${r.kind}${r.click === relView ? ' cur' : ''}${r.click ? ' link' : ''}`}
                onClick={r.click ? () => setRelView(r.click!) : undefined} title={r.click ? T('Ver este nesting') : T('Cada release en sus propias láminas, sumados')}>
                <span className="wr-lab">{r.kind === 'rel' ? <span className="rel-tag">{r.label}</span> : r.label}</span>
                <span className="wr-track">
                  {w != null ? <i style={{ width: `${(w / max) * 100}%` }} /> : <em className={busyKey(r.key) ? 'busy' : ''}>{busyKey(r.key) ? T('calculando…') : T('en cola')}</em>}
                </span>
                <span className="wr-val">{w != null ? pct(w) : '—'}</span>
                <span className="wr-sh">{r.s ? T`${r.s.sheets} lám.` : ''}{r.s?.unplaced ? <span className="wr-warn" title={T('Piezas sin ubicar')}> · {r.s.unplaced} ✕</span> : null}{r.s?.edited ? <span className="muted" title={T('Editado a mano')}> ✎</span> : null}</span>
              </div>
            );
          })}
        </div>
        {sep && all && <Verdict sep={sep} all={all} />}
      </div>}
    </div>
  );
}

function Verdict({ sep, all }: { sep: RelStat; all: RelStat }) {
  const dSheets = sep.sheets - all.sheets;
  const dArea = sep.sheetArea - all.sheetArea;
  const dPts = ((1 - sep.util) - (1 - all.util)) * 100;
  const better = dArea > 1;
  const worse = dArea < -1;
  return (
    <div className={`wr-verdict ${better ? 'good' : worse ? 'bad' : ''}`}>
      {better ? <>{T('Juntar los releases ahorra')} <b>{dSheets > 0 ? T`${dSheets} láminas` : ft2(dArea)}</b>{dSheets > 0 ? <> ({ft2(dArea)})</> : null} · {T`${dPts.toFixed(1)} puntos menos de desperdicio`}</>
        : worse ? <>{T('Juntar los releases gasta')} <b>{ft2(-dArea)}</b> {T('más que hacerlos uno por uno')}</>
        : T('Juntar los releases o hacerlos uno por uno da lo mismo')}
    </div>
  );
}
