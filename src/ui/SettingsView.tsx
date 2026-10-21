import { T, Tn, getLang } from '../i18n';
import { setLanguage } from '../store';
import { AppearancePicker } from './AppearancePicker';
import React, { useMemo } from 'react';
import { useStore, setSettings, updateProject, reUnfold, toast } from '../store';
import { calibrateAllowances, sideKey, FIELDS } from '../core/panels';
import { defaultProject, uid } from '../core/defaults';
import type { Side, Project } from '../core/types';
import { I } from './icons';
import { SheetPicker } from './SheetPicker';
import { saveTextFile, openTextFile } from '../platform';
import { projectJson } from './exporters';

export function SettingsView() {
  const project = useStore(s => s.project);
  const panels = useStore(s => s.panels);
  const flats = useStore(s => s.flats);
  const { settings } = project;
  const learned = useMemo(() => calibrateAllowances(panels, flats), [panels, flats]);
  const allowRows = useMemo(() => {
    const keys = new Map<string, { depth: string; side: Side; code: string; n: number }>();
    for (const p of panels) for (const side of ['T', 'B', 'L', 'R'] as Side[]) {
      const code = p[`edge${side}` as 'edgeT'];
      const k = sideKey(p.depth, side, code);
      const e = keys.get(k) || { depth: p.depth, side, code, n: 0 }; e.n += p.qty; keys.set(k, e);
    }
    for (const k of Object.keys(project.edgeAllowances)) if (!keys.has(k)) { const [depth, side, code] = k.split('|'); keys.set(k, { depth, side: side as Side, code, n: 0 }); }
    return [...keys.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [panels, project.edgeAllowances]);
  const m = settings.margins;
  const setAllow = (k: string, v: number | null) => updateProject(p => { const e = { ...p.edgeAllowances }; if (v === null || isNaN(v)) delete e[k]; else e[k] = v; return { ...p, edgeAllowances: e }; }, { rebuild: true });

  const exportProject = async () => { const p = await saveTextFile('proyecto-nesting.json', projectJson(project), [{ name: 'JSON', extensions: ['json'] }]); if (p) toast(T('Configuración exportada')); };
  const importProject = async () => {
    const t = await openTextFile(['json']); if (!t) return;
    try { const d = JSON.parse(t) as Project; if (!d.rules || !d.sheets) throw new Error(T('No es un archivo de configuración')); updateProject(() => ({ ...defaultProject(), ...d }), { rebuild: true }); toast(T('Configuración cargada')); }
    catch (e: any) { toast(T`No se pudo cargar: ${e.message}`, 'err'); }
  };

  return (
    <div className="view-pad">
      <div className="settings-grid">
        <section className="block">
          <header><h3>{T("Apariencia")}</h3><span className="muted" style={{ fontSize: 12.5 }}>{T("Color de acento y tema claro / oscuro")}</span></header>
          <div className="body" style={{ display: 'grid', gap: 12 }}>
            <AppearancePicker />
            <div className="row" style={{ gap: 10 }}>
              <span className="label">{T("Idioma")}</span>
              <div className="seg" role="radiogroup" aria-label={T("Idioma de la aplicación")}>
                <button aria-pressed={getLang() === 'en'} onClick={() => setLanguage('en')}>English</button>
                <button aria-pressed={getLang() === 'es'} onClick={() => setLanguage('es')}>Español</button>
              </div>
            </div>
          </div>
        </section>
        <section className="block">
          <header><h3>{T("Láminas de este nesting")}</h3><span className="muted" style={{ fontSize: 12.5 }}>{T("Tamaño “alto × largo”; máx = cantidad disponible")}</span></header>
          <div className="body"><SheetPicker compact /></div>
        </section>
        <section className="block">
          <header><h3>{T("Catálogo de tamaños")}</h3><span className="muted" style={{ fontSize: 12.5 }}>{T("Lo que aparece en el menú desplegable")}</span></header>
          <div className="body">
            <div className="chips">{project.sheetCatalog.map(c => (
              <span key={`${c.h}x${c.w}`} className="pill" style={{ fontSize: 13, padding: '3px 8px' }}>{c.h} × {c.w}
                <button className="iconbtn" style={{ width: 18, height: 18 }} title={T("Quitar del catálogo")} onClick={() => updateProject(p => ({ ...p, sheetCatalog: p.sheetCatalog.filter(x => x !== c) }))}><I.x /></button>
              </span>))}
            </div>
            <span className="muted" style={{ fontSize: 12.5 }}>{T("Para agregar un tamaño nuevo usa “Otro tamaño…” en el menú de láminas.")}</span>
          </div>
        </section>

        <section className="block">
          <header><h3>Nesting</h3></header>
          <div className="body form">
            <span>{T("Separación entre piezas (pulg.)")}</span><input id="gap" type="number" step={0.0625} min={0} value={settings.gap} onChange={e => setSettings({ gap: Math.max(0, +e.target.value) })} />
            <span>{T("Margen izquierdo (pinzas)")}</span><input id="ml" type="number" step={0.125} min={0} value={m.left} onChange={e => setSettings({ margins: { ...m, left: +e.target.value } })} />
            <span>{T("Margen derecho")}</span><input id="mr" type="number" step={0.125} min={0} value={m.right} onChange={e => setSettings({ margins: { ...m, right: +e.target.value } })} />
            <span>{T("Margen superior")}</span><input id="mt" type="number" step={0.125} min={0} value={m.top} onChange={e => setSettings({ margins: { ...m, top: +e.target.value } })} />
            <span>{T("Margen inferior")}</span><input id="mb" type="number" step={0.125} min={0} value={m.bottom} onChange={e => setSettings({ margins: { ...m, bottom: +e.target.value } })} />
            <span>{T("Llenar desde la esquina")}</span>
            <div className="seg">{(['BL', 'TL', 'BR', 'TR'] as const).map(c => <button key={c} aria-pressed={settings.fillFrom === c} onClick={() => setSettings({ fillFrom: c })}>{({ BL: T('Inf. izq.'), TL: T('Sup. izq.'), BR: T('Inf. der.'), TR: T('Sup. der.') })[c]}</button>)}</div>
            <span>{T("Permitir girar las piezas 90°, 180° y 270° (si ninguna regla lo impide)")}</span><span className="switch"><input id="rot" type="checkbox" checked={settings.allowRotate} onChange={e => setSettings({ allowRotate: e.target.checked })} /><span /></span>
            <span>{T("Tiempo de búsqueda (s)")}</span><input id="tms" type="number" step={0.5} min={0.5} max={60} value={settings.timeMs / 1000} onChange={e => setSettings({ timeMs: Math.max(500, +e.target.value * 1000) })} />
            <p className="help">{T("Más tiempo prueba más órdenes y heurísticas. Con 2–3 s suele bastar; para trabajos grandes usa 10–20 s.")}</p>
            <span>{T("Panel horizontal cuando")}</span>
            <div className="seg"><button aria-pressed={settings.horizontalWhen === 'A>=B'} onClick={() => setSettings({ horizontalWhen: 'A>=B' })}>A ≥ B</button><button aria-pressed={settings.horizontalWhen === 'A>B'} onClick={() => setSettings({ horizontalWhen: 'A>B' })}>A &gt; B</button></div>
            <span>{T("Origen para coordenadas exportadas")}</span>
            <div className="seg"><button aria-pressed={settings.originForExport === 'BL'} onClick={() => setSettings({ originForExport: 'BL' })}>{T("Inf. izq.")}</button><button aria-pressed={settings.originForExport === 'TL'} onClick={() => setSettings({ originForExport: 'TL' })}>{T("Sup. izq.")}</button></div>
          </div>
        </section>

        <section className="block">
          <header><h3>{T("Nunca mezclar en una lámina")}</h3></header>
          <div className="body">
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{T("Dos paneles sólo comparten lámina si coinciden en todos estos campos. Para separar por reglas específicas usa la acción “Separar láminas por campo”.")}</p>
            <div className="chips">
              {FIELDS.filter(f => ['job', 'mtl', 'thk', 'material', 'finish', 'type', 'depth', 'bomSheet', 'grain'].includes(f.key)).map(f => {
                const on = settings.partitionBy.includes(f.key);
                return <button key={f.key} className="chip" style={on ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined} aria-pressed={on} onClick={() => setSettings({ partitionBy: on ? settings.partitionBy.filter(x => x !== f.key) : [...settings.partitionBy, f.key] })}>{f.label}</button>;
              })}
            </div>
          </div>
        </section>

        <section className="block">
          <header><h3>{T("Desdoblado de STEP")}</h3></header>
          <div className="body form">
            <span>{T("K por ángulo de doblez")}</span>
            <div className="ktable">
              {(settings.kTable ?? []).map((e, i) => (
                <div key={i} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                  <input type="number" step={1} min={1} max={180} value={e.deg} aria-label={T("Ángulo")} style={{ width: 70 }} onChange={ev => setSettings({ kTable: (settings.kTable ?? []).map((x, j) => j === i ? { ...x, deg: +ev.target.value } : x) })} /><span className="muted">°  K</span>
                  <input type="number" step={0.01} min={0} max={0.6} value={e.k} aria-label="K" style={{ width: 70 }} onChange={ev => setSettings({ kTable: (settings.kTable ?? []).map((x, j) => j === i ? { ...x, k: +ev.target.value } : x) })} />
                  <button className="iconbtn" title={T("Quitar")} onClick={() => setSettings({ kTable: (settings.kTable ?? []).filter((_, j) => j !== i) })}><I.x /></button>
                </div>
              ))}
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => setSettings({ kTable: [...(settings.kTable ?? []), { deg: 45, k: settings.kFactor }] })}><I.plus /> {T("Ángulo")}</button>
                <button className="btn sm ghost" title={T("Valores calibrados contra los DXF de Salvagnini (3006, 3062, 3067, 3072, 3077): diferencia menor a 0.005 in")} onClick={() => setSettings({ kTable: [{ deg: 90, k: 0.30 }, { deg: 135, k: 0.47 }, { deg: 180, k: 0.40 }] })}>{T("Valores de Salvagnini")}</button>
              </div>
            </div>
            <p className="help">{T("Desarrollo de cada doblez = (radio interior + K·espesor) × ángulo. Cada doblez usa el K de su ángulo (interpolado entre los de la tabla). Los valores de Salvagnini (90° 0.30, 135° 0.47, 180° 0.40) dejan el desarrollo igual al de Salvagnini con menos de 0.005\" de diferencia.")}</p>
            <span>{T("Factor K si la tabla está vacía")}</span><input id="kf" type="number" step={0.01} min={0} max={0.5} value={settings.kFactor} onChange={e => setSettings({ kFactor: Math.min(0.5, Math.max(0, +e.target.value)) })} />
            <span /><button className="btn sm" onClick={() => reUnfold()}><I.rotate /> {T("Recalcular STEP con estos K")}</button>
            <span>{T("Espejo por defecto")}</span>
            <label className="row" style={{ gap: 8 }}><span className="switch"><input id="mir" type="checkbox" checked={settings.mirrorDefault ?? false} onChange={e => setSettings({ mirrorDefault: e.target.checked })} /><span /></span><span className="muted">{T("Todos los paneles reflejados respecto a una línea horizontal (arriba ↔ abajo), como los muestra Salvagnini. Se puede cambiar por marca con ⇅ Espejo (tecla F).")}</span></label>
          </div>
        </section>

        <section className="block" style={{ gridColumn: '1 / -1' }}>
          <header><h3>{T("Holgura de desarrollo por condición de borde")}</h3><span className="muted" style={{ fontSize: 12.5 }}>{T("Lo que cada borde suma a A o B en el blank. Se aprende de los STEP; se usa en paneles sin STEP.")}</span></header>
          <div className="tbl-wrap" style={{ maxHeight: 360 }}>
            <table className="tbl">
              <thead><tr><th>Depth</th><th>{T("Lado")}</th><th>{T("Código")}</th><th className="r">{T("Piezas")}</th><th className="r">{T("Aprendido de STEP")}</th><th className="r">{T("Valor manual")}</th><th>{T("Usado")}</th></tr></thead>
              <tbody>{allowRows.map(([k, r]) => {
                const man = project.edgeAllowances[k];
                const lv = learned[k];
                return <tr key={k}>
                  <td>{r.depth}</td><td>{({ T: T('Superior'), B: T('Inferior'), L: T('Izquierdo'), R: T('Derecho') })[r.side]}</td><td><span className="edge">{r.code}</span></td>
                  <td className="r num">{r.n}</td>
                  <td className="r num">{lv !== undefined ? lv.toFixed(4) : <span className="faint">—</span>}</td>
                  <td className="r"><input type="number" step={0.0625} placeholder="auto" value={man ?? ''} onChange={e => setAllow(k, e.target.value === '' ? null : +e.target.value)} /></td>
                  <td>{man !== undefined ? <span className="pill acc">{T("manual")}</span> : lv !== undefined ? <span className="pill ok">STEP</span> : <span className="pill warn">= Z</span>}</td>
                </tr>;
              })}</tbody>
            </table>
            {!allowRows.length && <p className="muted" style={{ padding: 12 }}>{T("Carga BOM para ver las condiciones de borde.")}</p>}
          </div>
        </section>

        <section className="block">
          <header><h3>{T("Configuración")}</h3></header>
          <div className="body">
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{T("Reglas, láminas y ajustes se guardan solos en este equipo. Exporta un archivo para respaldarlos o compartirlos con otro programador.")}</p>
            <div className="row">
              <button className="btn" onClick={exportProject}><I.download /> {T("Exportar configuración")}</button>
              <button className="btn" onClick={importProject}><I.upload /> {T("Cargar configuración")}</button>
              <button className="btn danger" onClick={() => { updateProject(() => defaultProject(), { rebuild: true }); toast(T('Configuración restablecida')); }}>{T("Restablecer")}</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
