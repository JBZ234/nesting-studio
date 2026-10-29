import { T } from '../i18n';
import React from 'react';
import { useStore, releaseList, setRelView } from '../store';
import { WasteReport } from './WasteReport';

/**
 * Several releases loaded: pick which one's nesting is on screen (or all of them nested together),
 * with that nesting's utilization shown big.
 */
export function ReleasePicker() {
  useStore(s => s.boms); useStore(s => s.steps);
  const relView = useStore(s => s.relView);
  const panels = useStore(s => s.panels);
  const layout = useStore(s => s.layout);
  const nesting = useStore(s => s.nesting);
  const rels = releaseList();
  if (rels.length < 2) return null;
  const pieces = (r: string) => panels.filter(p => r === 'all' || p.rel === r).reduce((a, p) => a + p.qty, 0);
  const util = layout?.stats.utilization;
  return (
    <div className="rel-picker">
      <label className="rel-select">
        <span className="label">{T("Release")}</span>
        <select value={relView} onChange={e => setRelView(e.target.value)} aria-label={T("Release que se ve")}>
          <option value="all">{T`Todos los releases (${rels.length})`}</option>
          {rels.map(r => <option key={r} value={r}>{r} · {T`${pieces(r)} piezas`}</option>)}
        </select>
      </label>
      <div className="rel-util" title={T("Aprovechamiento del nesting que estás viendo: área de las piezas sobre el área de las láminas usadas")}>
        <b className={nesting ? 'busy' : ''}>{util != null && !(nesting && !layout) ? `${(util * 100).toFixed(1)}%` : '—'}</b>
        <span>{nesting ? T("calculando…") : relView === 'all' ? T("aprovechamiento · todos") : T`aprovechamiento · ${relView}`}</span>
      </div>
      <WasteReport />
    </div>
  );
}
