import React from 'react';
import { ACCENTS, setAccent, setTheme, useAccent, useTheme } from './appearance';

const THEMES = [['light', 'Claro'], ['dark', 'Oscuro'], ['system', 'Sistema']] as const;

/**
 * Accent swatches + light/dark/system.
 * `collapsible`: shows only the current colour and theme; on hover (or keyboard focus) it unfolds
 * over its neighbours, so nothing around it moves.
 */
export function AppearancePicker({ collapsible = false }: { collapsible?: boolean }) {
  const accent = useAccent(); const theme = useTheme();
  const body = (live: boolean) => (
    <>
      <div className="swatches" role={live ? 'radiogroup' : undefined} aria-label={live ? 'Color de acento' : undefined}>
        {ACCENTS.map((a, i) => (
          <button key={a.id} role="radio" aria-checked={accent === a.id} title={a.name} tabIndex={live ? 0 : -1}
            className={`swatch opt ${accent === a.id ? 'cur' : ''}`} style={{ background: `linear-gradient(135deg, ${a.dark} 0 50%, ${a.light} 50% 100%)`, ['--i' as any]: i }}
            onClick={() => setAccent(a.id)} />
        ))}
      </div>
      <div className="seg theme-seg" role={live ? 'radiogroup' : undefined} aria-label={live ? 'Tema' : undefined}>
        {THEMES.map(([t, l], i) => (
          <button key={t} aria-pressed={theme === t} tabIndex={live ? 0 : -1} className={`opt ${theme === t ? 'cur' : ''}`} style={{ ['--i' as any]: i }} onClick={() => setTheme(t)}>{l}</button>
        ))}
      </div>
    </>
  );
  if (!collapsible) return <div className="appearance">{body(true)}</div>;
  return (
    <div className="ap" title="">
      <div className="appearance ap-ghost" aria-hidden="true">{body(false)}</div>
      <div className="appearance ap-live">{body(true)}</div>
    </div>
  );
}
