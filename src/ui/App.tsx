import { T, Tn } from '../i18n';
import React, { useEffect, useState } from 'react';
import { useStore, setState, runNest, stopNest, setAuto, undo, redo, getState, toast, saveSession, openSession, sessionName } from '../store';
import type { View } from '../store';
import type { Layout } from '../core/types';
import { I, Logo } from './icons';
import { SourcesView } from './SourcesView';
import { SheetsView } from './SheetsView';
import { RulesView } from './RulesView';
import { PanelsView } from './PanelsView';
import { SettingsView } from './SettingsView';
import { SetupDialog } from './SetupDialog';
import { layoutCsv, layoutDxf } from './exporters';
import { saveTextFile, isTauri, storage } from '../platform';
import { layoutPdf } from './pdf';
import { applyAppearance, useTheme } from './appearance';
import { AppearancePicker } from './AppearancePicker';
import { ReleasePicker } from './ReleasePicker';

const NAV: { v: View; label: string; icon: () => JSX.Element }[] = [
  { v: 'sources', label: T('Archivos'), icon: I.folder },
  { v: 'sheets', label: T('Láminas'), icon: I.sheets },
  { v: 'rules', label: T('Reglas'), icon: I.rules },
  { v: 'panels', label: T('Paneles'), icon: I.panels },
  { v: 'settings', label: T('Ajustes'), icon: I.settings },
];

export function App() {
  const view = useStore(s => s.view);
  const toastS = useStore(s => s.toast);
  const nesting = useStore(s => s.nesting);
  const auto = useStore(s => s.autoNest);
  const layout = useStore(s => s.layout);
  const panels = useStore(s => s.panels);
  const jobFilter = useStore(s => s.jobFilter);
  const label = useStore(s => s.sourceLabel);
  const nUndo = useStore(s => s.undo.length);
  const nRedo = useStore(s => s.redo.length);
  const edited = useStore(s => s.layoutEdited);
  const rulesOn = useStore(s => s.project.rules.filter(r => r.enabled).length);
  const theme = useTheme();
  const [look, setLook] = useState(false);
  const [menu, setMenu] = useState(false);
  const sessionPath = useStore(s => s.sessionPath);
  const dirty = useStore(s => s.dirty);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      const t = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && (t as HTMLInputElement).type !== 'checkbox' && (t as HTMLInputElement).type !== 'range';
      if (!typing && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (!typing && key === 'z') { e.preventDefault(); undo(); }
      else if (key === 's') { e.preventDefault(); saveSession(e.shiftKey); }
      else if (key === 'o') { e.preventDefault(); openSession(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  const sName = sessionPath ? sessionName() : null;
  useEffect(() => { document.title = `${sName ? `${sName}${dirty ? ' •' : ''} — ` : ''}Nesting Studio`; }, [sName, dirty]);
  useEffect(() => { applyAppearance(); }, []);

  const jobs = [...new Set(panels.map(p => p.job))].filter(Boolean).sort();
  const toggleJob = (j: string) => {
    const cur = getState().jobFilter;
    const next = cur.includes(j) ? cur.filter(x => x !== j) : [...cur, j];
    setState({ jobFilter: next.length === jobs.length ? [] : next, layout: null, selSheet: 0, selIid: null });
    import('../store').then(m => m.recomputeConstraints());
  };

  /** Trial (preview) pieces never go to the machine. */
  const exportable = (l: Layout) => {
    const n = l.sheets.reduce((a, sh) => a + sh.placements.filter(p => p.trial).length, 0);
    if (n) toast(`${n} ${n === 1 ? T('pieza de prueba no se exportó') : T('piezas de prueba no se exportaron')}`, 'warn');
    return n ? { ...l, sheets: l.sheets.map(sh => ({ ...sh, placements: sh.placements.filter(p => !p.trial) })) } : l;
  };
  const exportCsv = async () => {
    const s0 = getState(); if (!s0.layout) return;
    const s = { ...s0, layout: exportable(s0.layout) };
    const p = await saveTextFile(`nesting-${new Date().toISOString().slice(0, 10)}.csv`, layoutCsv(s.layout, s.panels, s.project.settings), [{ name: 'CSV', extensions: ['csv'] }]);
    if (p) toast(T`Coordenadas guardadas${isTauri ? ` en ${p}` : ''}`);
    setMenu(false);
  };
  const exportDxf = async (only?: number) => {
    const s0 = getState(); if (!s0.layout) return;
    const s = { ...s0, layout: exportable(s0.layout) };
    const name = only !== undefined ? `lamina-${only + 1}.dxf` : `nesting-${new Date().toISOString().slice(0, 10)}.dxf`;
    const p = await saveTextFile(name, layoutDxf(s.layout, s.panels, s.flats, s.project.settings, only), [{ name: 'DXF', extensions: ['dxf'] }]);
    if (p) toast(T`DXF guardado${isTauri ? ` en ${p}` : ''}`);
    setMenu(false);
  };
  const exportPdf = async (only?: number) => {
    const s0 = getState(); if (!s0.layout) return;
    const L = exportable(s0.layout);
    const title = sessionName() ?? 'Nesting';
    const name = only !== undefined ? `${title}-lamina-${only + 1}.pdf` : `${title}-laminas.pdf`;
    const pdf = await layoutPdf(L, s0.panels, s0.flats, s0.project.settings, uid => !!s0.cons.get(uid)?.flip, { title, onlySheet: only, colorBy: (storage.get('ns.color', 'type') as any) === 'rule' ? 'type' : storage.get('ns.color', 'type') as any });
    const p = await saveTextFile(name, pdf, [{ name: 'PDF', extensions: ['pdf'] }], 'application/pdf');
    if (p) toast(T`PDF guardado${isTauri ? ` en ${p}` : ''}`);
    setMenu(false);
  };

  return (
    <div className="app">
      <nav className="rail" aria-label={T("Secciones")}>
        <div className="brand"><Logo /></div>
        {NAV.map(n => (
          <button key={n.v} aria-current={view === n.v ? 'page' : undefined} onClick={() => setState({ view: n.v })}>
            <n.icon />{n.label}
            {n.v === 'rules' && <span className="badge pill acc" style={{ fontSize: 10, padding: '0 5px' }}>{rulesOn}</span>}
          </button>
        ))}
        <span className="spacer" />
        <div style={{ position: 'relative' }}>
          <button onClick={() => setLook(!look)} aria-expanded={look} title={T("Colores y tema")}>
            {theme === 'dark' ? <I.moon /> : <I.sun />}{theme === 'system' ? 'Auto' : theme === 'dark' ? T('Oscuro') : T('Claro')}
          </button>
          {look && <div className="pane look-pop" onMouseLeave={() => setLook(false)}><span className="label">{T("Apariencia")}</span><AppearancePicker /></div>}
        </div>
      </nav>

      <header className="topbar">
        <h1>Nesting Studio</h1>
        <span className="src" title={sessionPath ?? label}>{sName ? <><b style={{ color: 'var(--fg)' }}>{sName}</b>{dirty && <span title={T("Cambios sin guardar")} style={{ color: 'var(--accent)' }}> •</span>}<span className="muted"> · {label}</span></> : (label || T('Sin carpeta abierta'))}</span>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn sm" title={T("Abrir un trabajo guardado (Ctrl+O)")} onClick={openSession}><I.folder /> {T("Abrir")}</button>
          <button className={`btn sm ${dirty && panels.length ? 'primary-soft' : ''}`} title={sessionPath ? T`Guardar en ${sessionPath} (Ctrl+S). Mayús+Ctrl+S: guardar como…` : T('Guardar este trabajo en un archivo .nesting (Ctrl+S)')} disabled={!panels.length} onClick={() => saveSession(false)}><I.download /> {T("Guardar")}</button>
          {sessionPath && <button className="btn sm ghost" title={T("Guardar como otro archivo (Mayús+Ctrl+S)")} disabled={!panels.length} onClick={() => saveSession(true)}>{T("Guardar como…")}</button>}
        </div>
        <ReleasePicker />
        {jobs.length > 1 && <div className="row" style={{ gap: 4 }} role="group" aria-label={T("Jobs incluidos")}>
          <span className="label">Jobs</span>
          {jobs.map(j => { const on = !jobFilter.length || jobFilter.includes(j); return <button key={j} className="chip" aria-pressed={on} title={jobFilter.length ? T('Clic para incluir o quitar este job') : T('Clic para trabajar sólo con este job')} style={on ? { background: 'var(--accent-soft)', fontWeight: 700 } : { opacity: .55 }} onClick={() => toggleJob(j)}>{j}</button>; })}
        </div>}
        {nesting ? <div className="nestbar"><span className="spin" /> <span className="num">{nesting.iteration}</span> {T("combinaciones ·")} {nesting.sheets || '…'} {T("láminas")}{nesting.extended && nesting.unplaced ? <> · <b>{T("buscando ubicar")} {nesting.unplaced} {nesting.unplaced === 1 ? 'pieza' : 'piezas'} {T("más")}</b></> : null} <button className="btn sm" onClick={stopNest}><I.stop /> {T("Detener")}</button></div>
          : edited && <span className="pill acc" title={T("Las piezas movidas a mano quedan fijadas")}>{T("editado a mano")}</span>}
        <AppearancePicker collapsible />
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn" title={T("Deshacer (Ctrl+Z)")} disabled={!nUndo} onClick={undo}><I.undo /></button>
          <button className="iconbtn" title={T("Rehacer (Ctrl+Y o Ctrl+Shift+Z)")} disabled={!nRedo} onClick={redo}><I.redo /></button>
        </div>
        <label className="row" style={{ gap: 6, fontSize: 13 }} title={T("Re-optimiza automáticamente al cambiar reglas, paneles o láminas")}>
          <span className="switch"><input id="auto" type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /><span /></span><span className="muted">Auto</span>
        </label>
        <button className="btn primary" disabled={!panels.length} onClick={() => runNest({ keepLocked: true })} title={T("Optimiza respetando las piezas fijadas")}><I.play /> {T("Optimizar")}</button>
        <div style={{ position: 'relative' }}>
          <button className="btn" disabled={!layout} onClick={() => setMenu(!menu)} aria-expanded={menu}><I.download /> {T("Exportar")}</button>
          {menu && layout && <div className="pane" style={{ position: 'absolute', right: 0, top: 38, zIndex: 20, padding: 6, display: 'grid', gap: 2, width: 260, boxShadow: 'var(--shadow)' }} onMouseLeave={() => setMenu(false)}>
            <button className="btn ghost" onClick={exportCsv}>{T("Coordenadas por pieza (CSV)")}</button>
            <button className="btn ghost" onClick={() => exportDxf()}>{T("Todas las láminas (DXF)")}</button>
            <button className="btn ghost" onClick={() => exportDxf(getState().selSheet)}>{T("Lámina actual (DXF)")}</button>
            <button className="btn ghost" onClick={() => exportPdf()}>{T("Todas las láminas (PDF)")}</button>
            <button className="btn ghost" onClick={() => exportPdf(getState().selSheet)}>{T("Lámina actual (PDF)")}</button>
            {isTauri && <button className="btn ghost" onClick={() => { setMenu(false); setTimeout(() => window.print(), 50); }}><I.print /> {T("Imprimir lámina actual")}</button>}
          </div>}
        </div>
      </header>

      <main className="main">
        {view === 'sources' && <SourcesView />}
        {view === 'sheets' && <SheetsView />}
        {view === 'rules' && <RulesView />}
        {view === 'panels' && <PanelsView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <SetupDialog />
      {toastS && <div className={`toast ${toastS.kind}`} role="status">{toastS.msg}</div>}
    </div>
  );
}

