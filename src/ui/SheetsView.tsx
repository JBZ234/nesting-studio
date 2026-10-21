import React, { useEffect, useMemo, useState } from 'react';
import { flipMark, releaseOrient, reorganizeCurrent, setRules, toast, freezeSheets, previewOnSheet, useStore, setState, getState, rotatePlacement, toggleLock, unplace, placeOnSheet, movePlacement, lockSheet, nudgeMany, lockMany, unplaceMany, addEmptySheet, deleteSheet, runNest, undo, redo } from '../store';
import { SheetCanvas, ColorMode, partFill } from './SheetCanvas';
import { groupIdentical } from '../core/nest';
import { I } from './icons';
import { SheetPicker, StockBanner, OptimizePanel, TuneBanner } from './SheetPicker';
import { facing } from '../core/rules';
import { orientationOf } from '../core/panels';
import { storage } from '../platform';
import type { SheetLayout, Layout } from '../core/types';
import { UnplacedDetail } from './UnplacedDetail';
import { UnlockMenu } from './UnlockMenu';
import { sideVariant } from '../core/diagnose';

/** Same mark + same reason -> one row with a count. */
function groupUnplaced(list: Layout['unplaced']) {
  const m = new Map<string, { key: string; uid: string; reason: string; iids: string[] }>();
  for (const u of list) { const k = u.uid + '|' + u.reason; const g = m.get(k); if (g) g.iids.push(u.iid); else m.set(k, { key: k, uid: u.uid, reason: u.reason, iids: [u.iid] }); }
  return [...m.values()];
}

export function SheetsView() {
  const layout = useStore(s => s.layout);
  const selSheet = useStore(s => s.selSheet);
  const selIid = useStore(s => s.selIid);
  const selMulti = useStore(s => s.selMulti);
  useEffect(() => { if (getState().selMulti.length) setState({ selMulti: [] }); }, [selSheet]);
  const nesting = useStore(s => s.nesting);
  const panels = useStore(s => s.panels);
  const violations = useStore(s => s.violations);
  const sheetsDef = useStore(s => s.project.sheets);
  const [grouped, setGrouped] = useState(() => storage.get('ns.grouped', true));
  const [showZones, setShowZones] = useState(true);
  const [showFlat, setShowFlat] = useState(true);
  const [colorMode, setColorMode] = useState<ColorMode>(() => storage.get('ns.color', 'type'));
  const [fitKey, setFitKey] = useState(0);
  const [q, setQ] = useState('');
  const [onlyHits, setOnlyHits] = useState(() => storage.get('ns.onlyHits', true));
  useEffect(() => storage.set('ns.onlyHits', onlyHits), [onlyHits]);
  useEffect(() => storage.set('ns.color', colorMode), [colorMode]);
  useEffect(() => storage.set('ns.grouped', grouped), [grouped]);

  const groups = useMemo(() => layout ? groupIdentical(layout) : [], [layout]);
  const sheet: SheetLayout | undefined = layout?.sheets[selSheet];

  // keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const st = getState(); const L = st.layout; if (!L) return;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) return;   // handled globally (App)
      if (e.key === 'PageDown') { setState({ selSheet: Math.min(L.sheets.length - 1, st.selSheet + 1), selIid: null }); e.preventDefault(); return; }
      if (e.key === 'PageUp') { setState({ selSheet: Math.max(0, st.selSheet - 1), selIid: null }); e.preventDefault(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); const ids = L.sheets[st.selSheet]?.placements.map(p => p.iid) ?? []; setState({ selMulti: ids.length > 1 ? ids : [], selIid: ids[ids.length - 1] ?? null }); return; }
      const step = e.shiftKey ? 1 : 0.125;
      if (st.selMulti.length > 1) {
        const ids = st.selMulti, si = st.selSheet;
        if (e.key === 'l' || e.key === 'L') { const sh = L.sheets[si]; lockMany(si, ids, !sh.placements.filter(p => ids.includes(p.iid)).every(p => p.locked)); }
        else if (e.key === 'Delete' || e.key === 'Backspace') unplaceMany(si, ids);
        else if (e.key === 'ArrowLeft') nudgeMany(si, ids, -step, 0);
        else if (e.key === 'ArrowRight') nudgeMany(si, ids, step, 0);
        else if (e.key === 'ArrowUp') nudgeMany(si, ids, 0, step);
        else if (e.key === 'ArrowDown') nudgeMany(si, ids, 0, -step);
        else if (e.key === 'Escape') setState({ selIid: null, selMulti: [] });
        else return;
        e.preventDefault(); return;
      }
      const iid = st.selIid; if (!iid) return;
      const sh = L.sheets[st.selSheet]; const pl = sh?.placements.find(p => p.iid === iid); if (!pl) return;
      if (e.key === 'r' || e.key === 'R') rotatePlacement(st.selSheet, iid);
      else if (e.key === 'f' || e.key === 'F') flipMark(pl.uid);
      else if (e.key === 'l' || e.key === 'L') toggleLock(st.selSheet, iid);
      else if (e.key === 'Delete' || e.key === 'Backspace') unplace(st.selSheet, iid);
      else if (e.key === 'ArrowLeft') movePlacement(st.selSheet, iid, pl.x - step, pl.y);
      else if (e.key === 'ArrowRight') movePlacement(st.selSheet, iid, pl.x + step, pl.y);
      else if (e.key === 'ArrowUp') movePlacement(st.selSheet, iid, pl.x, pl.y + step);
      else if (e.key === 'ArrowDown') movePlacement(st.selSheet, iid, pl.x, pl.y - step);
      else if (e.key === 'Escape') setState({ selIid: null });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!panels.length) return <div className="empty"><div><h2>Todavía no hay paneles</h2><p>Abre una carpeta con los STEP y los BOM en la pestaña Archivos.</p><button className="btn primary" onClick={() => setState({ view: 'sources' })}><I.folder /> Ir a Archivos</button></div></div>;
  if (!layout) return <div className="empty"><div>{nesting ? <><div className="spin" style={{ margin: '0 auto 12px' }} /><h2>Calculando el nesting…</h2><p>{nesting.iteration} combinaciones evaluadas</p></> : <><h2>Sin resultado</h2><p>Pulsa Optimizar para calcular las láminas.</p><button className="btn primary" onClick={() => runNest()}><I.play /> Optimizar</button></>}</div></div>;

  // search by mark: which sheets have it
  const qq = q.trim().toUpperCase();
  const pmS = new Map(panels.map(p => [p.uid, p]));
  const hitUids = new Set(qq ? panels.filter(p => p.mark.toUpperCase().includes(qq)).map(p => p.uid) : []);
  const exactUids = new Set(qq ? panels.filter(p => p.mark.toUpperCase() === qq).map(p => p.uid) : []);
  const hlUids = exactUids.size ? exactUids : hitUids;   // "306" finds 3060-3069; "3067" only 3067
  const hitsOf = (sh: SheetLayout) => sh.placements.filter(p => hlUids.has(p.uid)).length;
  const hitSheets = qq ? layout.sheets.map((sh, i) => ({ i, n: hitsOf(sh) })).filter(x => x.n) : [];
  const hitPieces = hitSheets.reduce((a, x) => a + x.n, 0);
  const hitUnplaced = qq ? layout.unplaced.filter(u => hlUids.has(u.uid)).length : 0;
  const hitMarks = [...hlUids].map(u => pmS.get(u)?.mark).filter(Boolean) as string[];
  const goNext = () => { if (!hitSheets.length) return; const nx = hitSheets.find(x => x.i > selSheet) ?? hitSheets[0]; setState({ selSheet: nx.i, selIid: layout.sheets[nx.i].placements.find(p => hlUids.has(p.uid))?.iid ?? null }); };

  const totalViol = [...violations.values()].flat();
  const hardCount = totalViol.filter(v => v.hard).length;
  const softCount = totalViol.length - hardCount;
  const listItems0 = grouped
    ? groups.map(g => ({ idx: layout.sheets.findIndex(s => s.id === g.ids[0]), count: g.count, idxs: g.ids.map(id => layout.sheets.findIndex(s => s.id === id)) }))
    : layout.sheets.map((_, i) => ({ idx: i, count: 1, idxs: [i] }));
  const listItems = qq && onlyHits ? listItems0.filter(it => hitsOf(layout.sheets[it.idx]) > 0) : listItems0;
  const sheetUtil = (sh: SheetLayout) => sh.placements.reduce((a, p) => a + (p.trial ? 0 : p.w * p.h), 0) / (sh.w * sh.h);
  const pm = new Map(panels.map(p => [p.uid, p]));
  const curGroup = groups.find(g => sheet && g.ids.includes(sheet.id));
  const excludedPanels = panels.filter(p => getState().cons.get(p.uid)?.exclude && p.include);
  const excludedQty = excludedPanels.reduce((a, p) => a + p.qty, 0);
  const excludedTypes = [...new Set(excludedPanels.map(p => p.type))].join(', ');

  return (
    <div className="sheets-view">
      <aside className="sheet-list" aria-label="Láminas">
        <div className="pane-h">
          <h3>Láminas</h3><span className="pill">{layout.sheets.length}</span>
          {layout.sheets.some(s => s.locked) && <button className="btn sm ghost" title="Desbloquear todas las láminas" onClick={() => freezeSheets(layout.sheets.filter(s => s.locked).map(s => s.id), false)}><I.unlock /> {layout.sheets.filter(s => s.locked).length}</button>}
          <span className="grow" />
          <label className="row" style={{ gap: 6, fontSize: 12.5 }} title="Agrupa láminas idénticas: programas una vez en Salvagnini y la corres N veces">
            <span className="muted">Agrupar</span>
            <span className="switch"><input id="grp" type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} /><span /></span>
          </label>
        </div>
        <details className="insp-sec" open style={{ borderBottom: '1px solid var(--line-soft)' }}>
          <summary className="label">Láminas de este nesting</summary>
          <SheetPicker />
        </details>
        <details className="insp-sec" style={{ borderBottom: '1px solid var(--line-soft)' }}>
          <summary className="label">Optimización</summary>
          <OptimizePanel />
        </details>
        <div className="search-box">
          <div className="search-row">
            <input id="mark-search" type="search" placeholder="Buscar marca, p. ej. 3067" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') goNext(); if (e.key === 'Escape') setQ(''); }} aria-label="Buscar marca en las láminas" />
            {qq && <button className="btn sm" title="Siguiente lámina con esta marca (Enter)" disabled={!hitSheets.length} onClick={goNext}>Ir ›</button>}
          </div>
          {qq && <>
            {hitSheets.length
              ? <span className="muted" style={{ fontSize: 12.5 }}>{hitMarks.length === 1 ? <b style={{ color: 'var(--fg)' }}>{hitMarks[0]}</b> : `${hitMarks.length} marcas`}: {hitPieces} {hitPieces === 1 ? 'pieza' : 'piezas'} en {hitSheets.length} {hitSheets.length === 1 ? 'lámina' : 'láminas'}{hitUnplaced ? ` · ${hitUnplaced} sin ubicar` : ''}</span>
              : <span className="muted" style={{ fontSize: 12.5 }}>{hitMarks.length ? `No está en ninguna lámina${hitUnplaced ? ` (${hitUnplaced} sin ubicar)` : ''}` : 'Ninguna marca coincide'}</span>}
            {hitSheets.length > 0 && <div className="chips">{hitSheets.slice(0, 40).map(x => <button key={x.i} className="chip" aria-pressed={x.i === selSheet} style={x.i === selSheet ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined} onClick={() => setState({ selSheet: x.i, selIid: layout.sheets[x.i].placements.find(p => hlUids.has(p.uid))?.iid ?? null })}>{x.i + 1}{x.n > 1 ? ` ×${x.n}` : ''}</button>)}</div>}
            <label className="only-hits"><span className="switch"><input id="only-hits" type="checkbox" checked={onlyHits} onChange={e => setOnlyHits(e.target.checked)} /><span /></span>Mostrar sólo las láminas donde está</label>
          </>}
        </div>
        <div className="items">
          {listItems.map(it => {
            const sh = layout.sheets[it.idx];
            const v = sh.placements.some(p => violations.get(p.iid)?.some(x => x.hard));
            const active = it.idxs.includes(selSheet);
            return (
              <button key={sh.id} className="sheet-thumb" aria-selected={active} onClick={() => setState({ selSheet: it.idx, selIid: null })}>
                <div className="t">
                  <b className="num">{it.idxs.length > 1 ? `${it.idxs[0] + 1}–${it.idxs[it.idxs.length - 1] + 1}` : it.idx + 1}</b>
                  {it.count > 1 && <span className="mult">×{it.count}</span>}
                  {it.idxs.some(i => layout.sheets[i].locked) && <span className="lock-badge" title="Bloqueada: se mantiene al optimizar"><I.lock /></span>}
                  <span className="muted num">{sh.w}×{sh.h}</span>
                  <span className="grow" />
                  {qq && hitsOf(sh) > 0 && <span className="pill acc" title="Piezas de la marca buscada en esta lámina">{hitsOf(sh)}</span>}
                  {v && <span className="pill bad">!</span>}
                  <span className="num muted">{Math.round(sheetUtil(sh) * 100)}%</span>
                </div>
                <SheetCanvas sheet={sh} sheetIdx={it.idx} layout={layout} thumb colorMode={colorMode} highlight={qq ? hlUids : undefined} />
              </button>
            );
          })}
          {layout.unplaced.length > 0 && <div className="viol"><b>{layout.unplaced.length} piezas sin ubicar</b><span>Revísalas en el inspector.</span></div>}
        </div>
      </aside>

      <section className="stage">
        <StockBanner />
        <TuneBanner />
        <div className="stage-bar">
          <h2>{curGroup && curGroup.count > 1
            ? <>Láminas {layout.sheets.findIndex(x => x.id === curGroup.ids[0]) + 1}–{layout.sheets.findIndex(x => x.id === curGroup.ids[curGroup.ids.length - 1]) + 1} <span className="repeat-badge" title="Programa esta lámina una vez y córrela N veces">×{curGroup.count} iguales</span></>
            : <>Lámina {selSheet + 1}</>}</h2>
          <div className="stats">
            <div className="stat"><b>{layout.stats.sheets}</b><span>Láminas</span></div>
            <div className="stat"><b>{groups.length}</b><span>Layouts únicos</span></div>
            <div className="stat"><b>{(layout.stats.utilization * 100).toFixed(1)}%</b><span>Aprovechamiento</span></div>
            <div className="stat"><b style={{ color: hardCount ? 'var(--bad)' : 'var(--ok)' }}>{hardCount}</b><span>Infracciones</span></div>
            {excludedQty > 0 && <div className="stat" title={`Excluidas por reglas: ${excludedTypes}`}><b className="muted">{excludedQty}</b><span>Excluidas</span></div>}
            {softCount > 0 && <div className="stat"><b style={{ color: 'var(--warn)' }}>{softCount}</b><span>Preferencias</span></div>}
          </div>
          <span className="grow" />
          <div className="row" style={{ gap: 4 }}>
            {sheet && (() => {
              const ids = curGroup ? curGroup.ids : [sheet.id];
              const on = ids.every(id => layout.sheets.find(x => x.id === id)?.locked);
              return <button className={`btn sm ${on ? 'primary' : ''}`} onClick={() => freezeSheets(ids, !on)} title="Una lámina bloqueada se conserva tal cual al optimizar, aunque cambien las reglas">
                {on ? <><I.lock /> Bloqueada{ids.length > 1 ? ` (×${ids.length})` : ''}</> : <><I.unlock /> Bloquear{ids.length > 1 ? ` ×${ids.length}` : ''}</>}
              </button>;
            })()}
            <UnlockMenu disabled={false} />
            <select id="colormode" value={colorMode} onChange={e => setColorMode(e.target.value as ColorMode)} aria-label="Colorear por" style={{ height: 30 }}>
              <option value="type">Color: tipo</option><option value="mark">Color: marca</option><option value="rule">Color: regla</option><option value="job">Color: job</option><option value="orient">Color: H/V</option>
            </select>
            <button className={`iconbtn ${showZones ? 'on' : ''}`} title="Mostrar zonas de reglas" onClick={() => setShowZones(!showZones)}><I.zone /></button>
            <button className={`iconbtn ${showFlat ? 'on' : ''}`} title="Mostrar desarrollo real (STEP)" onClick={() => setShowFlat(!showFlat)}><I.layers /></button>
            <button className="iconbtn" title="Ajustar a la vista (doble clic)" onClick={() => setFitKey(k => k + 1)}><I.fit /></button>
          </div>
        </div>
        <div className="canvas-wrap">
          {sheet && <SheetCanvas sheet={sheet} sheetIdx={selSheet} layout={layout} interactive showZones={showZones} showFlat={showFlat} colorMode={colorMode} selectedIid={selIid} onSelect={iid => setState({ selIid: iid, selMulti: [] })}
            selectedSet={selMulti} onSelectMany={(ids, add) => { const all = add ? [...new Set([...selMulti, ...(selIid && !selMulti.length ? [selIid] : []), ...ids])] : ids; setState({ selMulti: all.length > 1 ? all : [], selIid: all.length ? all[all.length - 1] : null }); }} fitKey={fitKey} highlight={qq ? hlUids : undefined} />}
          <div className="legend">
            {[...new Set(sheet?.placements.map(p => colorMode === 'type' ? pm.get(p.uid)?.type : colorMode === 'job' ? pm.get(p.uid)?.job : colorMode === 'orient' ? ((pm.get(p.uid)?.A ?? 0) >= (pm.get(p.uid)?.B ?? 0) ? 'H' : 'V') : null).filter(Boolean))].slice(0, 8).map(k => {
              const sample = sheet!.placements.map(p => pm.get(p.uid)!).find(p => p && (colorMode === 'type' ? p.type : colorMode === 'job' ? p.job : (p.A >= p.B ? 'H' : 'V')) === k);
              return <span key={String(k)}><i className="sw" style={{ background: partFill(sample, colorMode) }} />{String(k)}</span>;
            })}
            <span><i className="sw" style={{ background: 'var(--zone-bad)' }} />Zona prohibida</span>
          </div>
          <div className="hint" title="Barrido azul (izquierda → derecha): piezas completamente dentro. Barrido verde (derecha → izquierda): piezas que toque. Ctrl+clic agrega o quita. Para mover la vista: rueda presionada, clic derecho o Alt + arrastrar.">Barrido en vacío: <b style={{ color: 'rgb(40,110,230)' }}>→</b> dentro / <b style={{ color: 'rgb(30,160,70)' }}>←</b> toca · <span className="kbd">Ctrl</span>+clic agrega · clic derecho mueve la vista · <span className="kbd">R</span> rotar · <span className="kbd">F</span> espejo · <span className="kbd">L</span> fijar · <span className="kbd">Supr</span> retirar · <span className="kbd">Shift</span> sin imán</div>
        </div>
      </section>

      <Inspector />
    </div>
  );
}

function Inspector() {
  const layout = useStore(s => s.layout)!;
  const selSheet = useStore(s => s.selSheet);
  const selIid = useStore(s => s.selIid);
  const panels = useStore(s => s.panels);
  const cons = useStore(s => s.cons);
  const rules = useStore(s => s.project.rules);
  const violations = useStore(s => s.violations);
  const sheetsDef = useStore(s => s.project.sheets);
  const settings = useStore(s => s.project.settings);
  const sheet = layout.sheets[selSheet];
  const pm = useMemo(() => new Map(panels.map(p => [p.uid, p])), [panels]);
  const pl = sheet?.placements.find(p => p.iid === selIid);
  const [target, setTarget] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const selMulti = useStore(s => s.selMulti);

  const group = sheet ? sheet.placements.filter(p => selMulti.includes(p.iid)) : [];
  if (group.length > 1) {
    const ids = group.map(p => p.iid);
    const marks = new Map<string, number>(); group.forEach(g => { const m = pm.get(g.uid)?.mark ?? g.uid; marks.set(m, (marks.get(m) || 0) + 1); });
    const allLocked = group.every(g => g.locked);
    const nv = group.reduce((a, g) => a + (violations.get(g.iid)?.length ? 1 : 0), 0);
    return (
      <aside className="inspector" aria-label="Inspector">
        <div className="insp-sec">
          <div className="row"><h3 style={{ fontSize: 20 }}>{group.length} piezas seleccionadas</h3><span className="grow" /><button className="iconbtn" onClick={() => setState({ selIid: null, selMulti: [] })} title="Quitar selección (Esc)"><I.x /></button></div>
          <div className="chips">{[...marks].map(([m, n]) => <span key={m} className="chip">{m}{n > 1 ? ` ×${n}` : ''}</span>)}</div>
          {nv > 0 && <span className="muted">{nv} con avisos de reglas</span>}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => lockMany(selSheet, ids, !allLocked)}>{allLocked ? <><I.unlock /> Soltar</> : <><I.lock /> Fijar</>}</button>
            <button className="btn sm danger" onClick={() => unplaceMany(selSheet, ids)}><I.trash /> Retirar</button>
          </div>
        </div>
        <div className="insp-sec">
          <span className="label">Cómo seleccionar</span>
          <ul className="help-list">
            <li><b style={{ color: 'rgb(40,110,230)' }}>Barrido azul</b> (arrastrar de izquierda a derecha en un espacio vacío): sólo las piezas que quedan completamente dentro.</li>
            <li><b style={{ color: 'rgb(30,160,70)' }}>Barrido verde</b> (de derecha a izquierda): todas las que el recuadro toque.</li>
            <li><b>Ctrl + clic</b> agrega o quita una pieza. Ctrl + barrido agrega al grupo. <b>Ctrl+A</b> selecciona toda la lámina.</li>
            <li>Arrastra cualquiera de las seleccionadas para moverlas juntas. Flechas: mover 1/8" (Shift: 1"). L fija, Supr retira, Esc suelta.</li>
            <li>Para desplazar la vista: rueda del mouse presionada, clic derecho o Alt + arrastrar.</li>
          </ul>
        </div>
      </aside>
    );
  }

  if (pl) {
    const p = pm.get(pl.uid); const c = cons.get(pl.uid);
    const vs = violations.get(pl.iid) || [];
    const matched = rules.filter(r => c?.rules.includes(r.id));
    const ex = settings.originForExport === 'BL' ? pl.y : sheet.h - pl.y - pl.h;
    return (
      <aside className="inspector" aria-label="Inspector">
        {pl.trial && <div className="insp-sec"><div className="viol"><b>Pieza de prueba</b><span>La pusiste para ver cómo quedaría, sin respetar reglas. No sale en la exportación y vuelve a "Sin ubicar" al optimizar.</span><span className="muted">Antes estaba sin ubicar porque: {pl.trial.reason}</span>
          <div className="row"><button className="btn sm danger" onClick={() => unplace(selSheet, pl.iid)}><I.trash /> Quitar prueba</button></div></div></div>}
        <div className="insp-sec">
          <div className="row"><h3 style={{ fontSize: 22 }}>{p?.mark}</h3><span className="pill">{p?.type}</span>{p && <span className={`otag otag-${orientationOf(p, settings)}`}>{orientationOf(p, settings) === 'H' ? 'Horizontal' : 'Vertical'}</span>}{pl.trial ? <span className="pill bad">prueba</span> : pl.locked && <span className="pill acc">fijado</span>}<span className="grow" /><button className="iconbtn" onClick={() => setState({ selIid: null })} title="Cerrar"><I.x /></button></div>
          <div className="muted" style={{ fontSize: 13 }}>Job {p?.job} · {p?.bomSheet}</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" title="Rotar 90° (R). Se mantiene al re-optimizar" onClick={() => rotatePlacement(selSheet, pl.iid)}><I.rotate /> Rotar</button>
            <button className="btn sm" title="Espejo respecto a una línea horizontal (F): arriba y abajo se intercambian. Aplica a todas las piezas de esta marca y se mantiene al re-optimizar" onClick={() => flipMark(pl.uid)}>⇅ Espejo</button>
            {(p?.flip !== undefined || p?.fixedRot !== undefined) && <button className="btn sm ghost" title="Vuelve al espejo por defecto y deja que el optimizador elija el giro" onClick={() => releaseOrient(pl.uid)}>Soltar giro/espejo</button>}
            <button className="btn sm" onClick={() => toggleLock(selSheet, pl.iid)}>{pl.locked ? <><I.unlock /> Soltar</> : <><I.lock /> Fijar</>}</button>
            <button className="btn sm danger" onClick={() => unplace(selSheet, pl.iid)}><I.trash /> Retirar</button>
          </div>
        </div>
        {vs.length > 0 && <div className="insp-sec">{vs.map((v, i) => {
          const rule = rules.find(r => r.id === v.ruleId);
          const alt = rule && v.msg.includes('zona') ? sideVariant(rule) : null;
          return <div key={i} className={`viol ${v.hard ? '' : 'soft'}`}><b>{v.ruleName}</b><span>{v.msg}</span>
            {alt && <><span className="muted">Esta regla mira <b>todo el panel</b> («Prohibir zona»), no sólo el retorno {alt.codes}. Por eso marca error aunque el {alt.codes} quede abajo.</span>
              <div className="row"><button className="btn sm primary" onClick={() => { setRules(rs => rs.map(r => r.id === rule!.id ? alt.rule : r)); toast(`«${rule!.name}» ahora mira sólo el retorno ${alt.codes}`); }}>Cambiar la regla a sólo el retorno {alt.codes}</button></div></>}
          </div>;
        })}</div>}
        <div className="insp-sec">
          <span className="label">Posición en la lámina</span>
          <div className="row">
            <label className="field grow"><span>X</span><input id="px" type="number" step={0.125} value={+pl.x.toFixed(3)} onChange={e => movePlacement(selSheet, pl.iid, +e.target.value, pl.y)} /></label>
            <label className="field grow"><span>Y (desde abajo)</span><input id="py" type="number" step={0.125} value={+pl.y.toFixed(3)} onChange={e => movePlacement(selSheet, pl.iid, pl.x, +e.target.value)} /></label>
          </div>
          <dl className="kv">
            <dt>Rotación</dt><dd>{pl.rot}°{c?.fixedRot != null ? ' (fijada a mano)' : ''} · {p ? `${p[`edge${(['T','B','L','R'] as const).find(sd => facing(sd, pl.rot, c?.flip) === 'top')!}` as 'edgeT']} arriba, ${p[`edge${(['T','B','L','R'] as const).find(sd => facing(sd, pl.rot, c?.flip) === 'bottom')!}` as 'edgeT']} abajo` : ''}</dd>
            <dt>Espejo</dt><dd>{c?.flip ? 'sí' : 'no'}{p?.flip !== undefined ? ' (a mano)' : ' (por defecto)'}</dd>
            <dt>Ocupa</dt><dd className="num">{pl.w.toFixed(3)} × {pl.h.toFixed(3)}</dd>
            <dt>Coord. exportación</dt><dd className="num">{pl.x.toFixed(3)}, {ex.toFixed(3)}</dd>
          </dl>
        </div>
        {p && <div className="insp-sec">
          <span className="label">Panel</span>
          <div className="edgebox">
            <span /><span className="edge">T {p.edgeT}</span><span />
            <span className="edge">L {p.edgeL}</span><div className="mid">{p.A >= p.B ? 'H' : 'V'}</div><span className="edge">R {p.edgeR}</span>
            <span /><span className="edge">B {p.edgeB}</span><span />
          </div>
          <dl className="kv">
            <dt>A × B</dt><dd className="num">{p.A} × {p.B}</dd>
            {p.C !== undefined && <><dt>C</dt><dd className="num">{p.C}</dd></>}
            <dt>Desarrollo</dt><dd className="num">{p.blankW.toFixed(3)} × {p.blankH.toFixed(3)}</dd>
            <dt>Fuente</dt><dd><span className={`pill ${p.blankSource === 'step' ? 'ok' : p.blankSource === 'manual' ? 'acc' : 'warn'}`}>{p.blankSource === 'step' ? 'STEP' : p.blankSource}</span></dd>
            <dt>Grain</dt><dd>{p.grain || '—'}</dd>
          </dl>
        </div>}
        <div className="insp-sec">
          <span className="label">Reglas que aplican</span>
          {matched.length ? matched.map(r => <div key={r.id} className="row" style={{ gap: 6, cursor: 'pointer', flexWrap: 'nowrap' }} onClick={() => setState({ view: 'rules', selRule: r.id })}><i className="dot" style={{ background: r.color }} /><span>{r.name}</span></div>) : <span className="muted">Ninguna</span>}
        </div>
        <div className="insp-sec">
          <span className="label">Mover a otra lámina</span>
          <div className="row">
            <select id="mvto" className="grow" value={target} onChange={e => setTarget(+e.target.value)}>
              {layout.sheets.map((s, i) => i !== selSheet && <option key={s.id} value={i}>Lámina {i + 1} ({s.placements.length} piezas)</option>)}
            </select>
            <button className="btn sm" onClick={() => placeOnSheet(target, pl.iid)}>Mover</button>
          </div>
        </div>
      </aside>
    );
  }

  // sheet summary
  const counts = new Map<string, number>();
  sheet?.placements.forEach(p => counts.set(p.uid, (counts.get(p.uid) || 0) + 1));
  const used = sheet ? sheet.placements.reduce((a, p) => a + (p.trial ? 0 : p.w * p.h), 0) : 0;
  const def = sheetsDef.find(d => d.id === sheet?.sheetId);
  return (
    <aside className="inspector" aria-label="Inspector">
      {sheet && <div className="insp-sec">
        <div className="row"><h3 style={{ fontSize: 18 }}>Lámina {selSheet + 1}</h3><span className="pill">{def?.name ?? `${sheet.w}×${sheet.h}`}</span></div>
        <dl className="kv">
          <dt>Tamaño</dt><dd className="num">{sheet.w} × {sheet.h}"</dd>
          <dt>Grupo</dt><dd style={{ whiteSpace: 'normal' }}>{sheet.partition || '—'}</dd>
          <dt>Piezas</dt><dd className="num">{sheet.placements.length}</dd>
          <dt>Aprovechamiento</dt><dd className="num">{(used / (sheet.w * sheet.h) * 100).toFixed(1)}%</dd>
        </dl>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm" title="Las piezas no se mueven, pero se pueden agregar otras en los huecos" onClick={() => lockSheet(selSheet, true)}><I.lock /> Fijar piezas</button>
          <button className="btn sm" onClick={() => lockSheet(selSheet, false)}><I.unlock /> Soltar piezas</button>
          <button className="btn sm" title="Reorganiza las piezas de esta lámina para que compartan más cortes (common line)" onClick={() => reorganizeCurrent(selSheet)}><I.layers /> Reacomodar cortes</button>
          {sheet.placements.length === 0 && <button className="btn sm danger" onClick={() => deleteSheet(selSheet)}><I.trash /> Eliminar</button>}
        </div>
        {sheet.locked && <div className="note"><b>Lámina bloqueada</b><span>Se conserva tal cual al optimizar, aunque cambien las reglas. Si ahora rompe alguna regla, sale marcada en rojo.</span></div>}
        <TopHalfNote sheetIdx={selSheet} />
      </div>}
      {sheet && <div className="insp-sec">
        <span className="label">Contenido de la lámina</span>
        <table className="tbl"><thead><tr><th>Marca</th><th>Tipo</th><th className="r">Cant.</th><th className="r">Rot.</th></tr></thead>
          <tbody>{[...counts].map(([uid, n]) => { const p = pm.get(uid); const rots = [...new Set(sheet.placements.filter(x => x.uid === uid).map(x => x.rot))].join('/'); return <tr key={uid} onClick={() => setState({ selIid: sheet.placements.find(x => x.uid === uid)!.iid })} style={{ cursor: 'pointer' }}><td><b>{p?.mark}</b></td><td>{p?.type}</td><td className="r num">{n}</td><td className="r num">{rots}°</td></tr>; })}</tbody></table>
      </div>}
      <div className="insp-sec">
        <span className="label">Sin ubicar ({layout.unplaced.length})</span>
        {layout.unplaced.length === 0 ? <span className="muted">Todas las piezas están ubicadas.</span> :
          groupUnplaced(layout.unplaced).slice(0, 60).map(g => (
            <div key={g.key} className={`viol soft up-item`} role="button" tabIndex={0} onClick={() => setDetail(g.uid)} onKeyDown={e => { if (e.key === 'Enter') setDetail(g.uid); }} title="Ver detalle">
              <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                <b>{pm.get(g.uid)?.mark ?? g.uid}</b>{g.iids.length > 1 && <span className="pill">×{g.iids.length}</span>}
              </div>
              <span>{g.reason}</span>
              <div className="up-actions">
                <button className="btn sm" onClick={e => { e.stopPropagation(); setDetail(g.uid); }}>Ver detalle</button>
                <button className="btn sm" title="Ponerla en esta lámina sin respetar reglas, marcada como error, para ver cómo quedaría" onClick={e => { e.stopPropagation(); previewOnSheet(selSheet, g.iids[0]); }}>Probar aquí</button>
                <button className="btn sm" title="Ubicarla en esta lámina sólo si hay un espacio que cumpla las reglas" onClick={e => { e.stopPropagation(); placeOnSheet(selSheet, g.iids[0]); }}>Colocar aquí</button>
              </div>
            </div>
          ))}
      </div>
      {detail && <UnplacedDetail uid={detail} onClose={() => setDetail(null)} />}
      <div className="insp-sec">
        <span className="label">Agregar lámina vacía</span>
        <div className="row">{sheetsDef.filter(d => d.enabled).map(d => <button key={d.id} className="btn sm" onClick={() => addEmptySheet(d)}><I.plus /> {d.name}</button>)}</div>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Las piezas que muevas a mano quedan fijadas y se respetan al volver a optimizar.</p>
      </div>
    </aside>
  );
}

/** Explains when the top of a sheet is empty because a "below the middle" rule keeps panels out. */
function TopHalfNote({ sheetIdx }: { sheetIdx: number }) {
  const layout = useStore(s => s.layout);
  const cons = useStore(s => s.cons);
  const panels = useStore(s => s.panels);
  const rules = useStore(s => s.project.rules);
  const settings = useStore(s => s.project.settings);
  const sh = layout?.sheets[sheetIdx];
  if (!sh || !sh.placements.length) return null;
  const mid = sh.h / 2;
  const topUsed = sh.placements.reduce((a, p) => a + p.w * Math.max(0, p.y + p.h - Math.max(p.y, mid)), 0);
  const free = 1 - topUsed / (sh.w * (sh.h - mid - settings.margins.top));
  if (free < 0.4) return null;
  const names = new Set<string>();
  for (const pl of sh.placements) for (const sr of cons.get(pl.uid)?.sideRules ?? []) if (sr.hard && sr.kind === 'zone') names.add(sr.ruleName);
  if (!names.size) return null;
  const pm = new Map(panels.map(p => [p.uid, p]));
  const placed = new Set(layout!.sheets.flatMap(s => s.placements.map(p => p.uid)));
  const freePanels = [...placed].filter(u => { const c = cons.get(u); return c && !c.exclude && !c.sideRules.some(sr => sr.hard && sr.kind === 'zone') && pm.get(u); });
  const noMix = rules.find(r => r.enabled && r.actions.some(a => a.type === 'separateBy' && a.field === 'orientation'));
  return (
    <div className="note">
      <b>La mitad superior queda libre ({Math.round(free * 100)}%)</b>
      <span>Por {[...names].map(n => `«${n}»`).join(', ')}, los paneles de esta lámina no pueden subir de la mitad. Arriba sólo caben paneles sin esa condición{freePanels.length ? ` (hay ${freePanels.length} marcas así en el job)` : ' y en este job no queda ninguno'}.</span>
      {noMix && <span>Los horizontales podrían llenar ese espacio, pero «{noMix.name}» lo impide. Si la desactivas para este job, ese espacio se aprovecharía.</span>}
    </div>
  );
}
