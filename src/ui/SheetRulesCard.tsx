import { T, Tn } from '../i18n';
import React from 'react';
import { useStore, setSettings } from '../store';

/** Rules that belong to the sheet itself (not to a panel): distance to the sheet edges and common line. */
export function SheetRulesCard() {
  const s = useStore(st => st.project.settings);
  const m = s.margins;
  const num = (k: keyof typeof m, label: string) => (
    <label><span className="muted">{label}</span>
      <input id={`sm-${k}`} type="number" step={0.05} min={0} value={m[k]} onChange={e => setSettings({ margins: { ...m, [k]: Math.max(0, +e.target.value) } })} />
    </label>
  );
  return (
    <div className="rule-item" style={{ gridTemplateColumns: '1fr', cursor: 'default', background: 'color-mix(in srgb, var(--sunk) 50%, transparent)' }}>
      <div style={{ display: 'grid', gap: 8 }}>
        <div className="nm">{T("Reglas de la lámina")}</div>
        <div className="ds" style={{ marginTop: -4 }}>{T("Los paneles van pegados a")} {m.left}{T("\" de los lados,")} {m.bottom}{T("\" de abajo y")} {m.top}{T("\" desde arriba.")}</div>
        <div className="sheet-rules">
          {num('top', T('Desde arriba (pulg.)'))}{num('bottom', T('Desde abajo'))}
          {num('left', T('Lado izquierdo'))}{num('right', T('Lado derecho'))}
        </div>
        <label className="row" style={{ gap: 8, fontSize: 13 }}>
          <span className="switch"><input id="cl" type="checkbox" checked={s.gap === 0} onChange={e => setSettings({ gap: e.target.checked ? 0 : 0.5 })} /><span /></span>
          <span>{T("Common line (paneles pegados, comparten corte)")}</span>
        </label>
        {s.gap > 0 && <label className="row" style={{ gap: 6, fontSize: 13 }}>{T("Separación entre paneles")} <input id="gap2" type="number" step={0.0625} min={0} value={s.gap} onChange={e => setSettings({ gap: Math.max(0, +e.target.value) })} style={{ width: 70 }} /> {T("pulg.")}</label>}
      </div>
    </div>
  );
}
