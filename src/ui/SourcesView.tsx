import { T, Tn } from '../i18n';
import React, { useRef, useState } from 'react';
import { useStore, loadSources, loadPrepared, setState, toast, openSession, releaseList, removeRelease } from '../store';
import { isTauri, pickFolderTauri, scanFolderTauri, filesFromFileList } from '../platform';
import { I } from './icons';

export function SourcesView() {
  const boms = useStore(s => s.boms);
  const steps = useStore(s => s.steps);
  const loading = useStore(s => s.loading);
  const warnings = useStore(s => s.buildWarnings);
  const folder = useStore(s => s.folder);
  const label = useStore(s => s.sourceLabel);
  const panels = useStore(s => s.panels);
  const [over, setOver] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const appendNext = useRef(false);
  const openFolder = async (append = false) => {
    if (isTauri) {
      try { const r = await pickFolderTauri(); if (r) await loadSources(r.files, r.folder, r.folder, { append }); }
      catch (e: any) { toast(T`No se pudo abrir la carpeta: ${e?.message || e}`, 'err'); }
    } else { appendNext.current = append; dirInput.current?.click(); }
  };
  const rels = releaseList();
  const reopen = async () => { if (folder) try { await loadSources(await scanFolderTauri(folder), folder, folder); } catch (e: any) { toast(T`No se pudo leer ${folder}: ${e?.message || e}`, 'err'); } };
  const loadDemo = async () => {
    setState({ loading: { done: 0, total: 1, msg: T('Cargando ejemplo…') } });
    const d = (await import('../demo/demo.json')).default as any;
    setState({ loading: null });
    loadPrepared(d.boms, d.steps, T('Ejemplo: 5 BOM y 8 STEP de muestra'));
    toast(T('Ejemplo cargado: 680 piezas de 5 jobs'));
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const items = Array.from(e.dataTransfer.items || []);
    const files: File[] = [];
    const walk = async (entry: any, path = ''): Promise<void> => {
      if (!entry) return;
      if (entry.isFile) await new Promise<void>(res => entry.file((f: File) => { Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name }); files.push(f); res(); }, () => res()));
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch: any[] = [];
        do { batch = await new Promise<any[]>(res => reader.readEntries(res, () => res([]))); for (const en of batch) await walk(en, path + entry.name + '/'); } while (batch.length);
      }
    };
    if (items.length && (items[0] as any).webkitGetAsEntry) for (const it of items) await walk((it as any).webkitGetAsEntry());
    else files.push(...Array.from(e.dataTransfer.files));
    if (files.length) loadSources(filesFromFileList(files), T`${files.length} archivos arrastrados`);
  };

  const stepsOk = steps.filter(s => s.flat).length;
  const qty = panels.reduce((a, p) => a + p.qty, 0);

  return (
    <div className="view-pad" style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
      <div className={`drop ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
        <h2>{T("Abre la carpeta del release")}</h2>
        <p>{T("Lee todos los")} <b>.step</b> {T("(los desdobla) y los BOM")} <b>.xls/.xlsx</b> {T("de la carpeta y sus subcarpetas. Los STEP se ligan al BOM por la marca del nombre:")} <span className="mono">125-FLAT-01A-02A-03A-03A-AL-08_<b>2005</b>.step</span>.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => openFolder(false)} disabled={!!loading}><I.folder /> {T("Abrir carpeta…")}</button>
          {boms.length > 0 && <button className="btn" onClick={() => openFolder(true)} disabled={!!loading} title={T("Suma otro release a lo que ya está abierto para verlo por separado o nestear todos juntos")}><I.plus /> {T("Agregar release…")}</button>}
          {isTauri && folder && <button className="btn" onClick={reopen} disabled={!!loading} title={folder}><I.rotate /> {T("Recargar última carpeta")}</button>}
          {!isTauri && <button className="btn" onClick={() => fileInput.current?.click()} disabled={!!loading}>{T("Elegir archivos…")}</button>}
          <button className="btn" onClick={openSession} disabled={!!loading} title={T("Abre un trabajo guardado tal como lo dejaste")}><I.folder /> {T("Abrir trabajo guardado…")}</button>
          <button className="btn ghost" onClick={loadDemo} disabled={!!loading}>{T("Cargar ejemplo")}</button>
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>{T("o arrastra la carpeta aquí")} · {T("una carpeta con varios releases los abre todos")}</span>
        <input ref={dirInput} type="file" hidden multiple {...{ webkitdirectory: '', directory: '' } as any} onChange={e => { if (e.target.files) loadSources(filesFromFileList(e.target.files), e.target.files[0]?.webkitRelativePath.split('/')[0] || 'carpeta', null, { append: appendNext.current }); e.target.value = ''; }} />
        <input ref={fileInput} type="file" hidden multiple accept=".step,.stp,.xls,.xlsx" onChange={e => e.target.files && loadSources(filesFromFileList(e.target.files), `${e.target.files.length} archivos`)} />
        {loading && <div style={{ width: 'min(420px, 100%)', display: 'grid', gap: 6 }}>
          <div className="progress"><i style={{ width: `${(loading.done / Math.max(1, loading.total)) * 100}%` }} /></div>
          <span className="muted" style={{ fontSize: 13 }}>{loading.msg}</span>
        </div>}
      </div>

      {boms.length > 0 || steps.length > 0 ? <>
        <div className="row"><h3 style={{ fontSize: 18 }}>{label}</h3><span className="pill">{boms.length} BOM</span><span className={`pill ${stepsOk === steps.length ? 'ok' : 'warn'}`}>{stepsOk}/{steps.length} {T("STEP desdoblados")}</span><span className="pill">{panels.length} {T("marcas ·")} {qty} {T("piezas")}</span><span className="grow" /><button className="btn primary" onClick={() => setState({ view: 'sheets' })}><I.sheets /> {T("Ver láminas")}</button></div>
        {rels.length > 1 && <div className="block">
          <header><h3>{T("Releases")}</h3><span className="muted" style={{ fontSize: 12.5 }}>{T("Elige arriba, en la barra, qué release ver o todos juntos")}</span></header>
          <div className="body"><table className="tbl"><thead><tr><th>{T("Release")}</th><th className="r">BOM</th><th className="r">{T("Marcas")}</th><th className="r">{T("Piezas")}</th><th className="r">STEP</th><th /></tr></thead>
            <tbody>{rels.map(r => { const ps = panels.filter(p => p.rel === r); const st = steps.filter(x => x.rel === r); return <tr key={r}>
              <td><span className="rel-tag">{r}</span></td><td className="r num">{boms.filter(b => b.rel === r).length}</td><td className="r num">{ps.length}</td><td className="r num">{ps.reduce((a, p) => a + p.qty, 0)}</td><td className="r num">{st.filter(x => x.flat).length}/{st.length}</td>
              <td className="r"><button className="iconbtn" title={T("Quitar este release")} onClick={() => removeRelease(r)} disabled={!!loading}><I.x /></button></td></tr>; })}</tbody></table></div>
        </div>}
        <div className="cards">
          {boms.map(b => (
            <div key={b.file} className="card">
              <div className="row"><h4>Job {b.header.job || '—'}</h4><span className="pill">Rls {b.header.release}</span>{b.rel && rels.length > 1 && <span className="rel-tag">{b.rel}</span>}<span className="grow" /><span className="muted num" style={{ fontSize: 12 }}>{b.header.date}</span></div>
              <div className="muted mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{b.file}</div>
              <dl className="kv">
                <dt>Material</dt><dd>{b.header.material} {b.header.alloy}</dd>
                <dt>{T("Espesor")}</dt><dd>{b.header.thickness}</dd>
                <dt>Color</dt><dd>{b.header.finish}</dd>
                <dt>{T("Hojas de panel")}</dt><dd className="num">{new Set(b.panels.map(p => p.bomSheet)).size}</dd>
                <dt>{T("Marcas / piezas")}</dt><dd className="num">{b.panels.length} / {b.panels.reduce((a, p) => a + p.qty, 0)}</dd>
                <dt>{T("Con STEP")}</dt><dd className="num">{panels.filter(p => p.bomFile === b.file && p.stepFile).length}</dd>
              </dl>
              {b.panels.length === 0 ? <span className="pill">{T("No es un BOM de paneles: se ignora")}</span>
                : !panels.some(p => p.bomFile === b.file) && <span className="pill warn">{T("Reemplazado por un BOM más reciente: se ignora")}</span>}
              {b.warnings.length > 0 && <span className="pill warn">{b.warnings.length} {T("avisos")}</span>}
            </div>
          ))}
        </div>
        {warnings.length > 0 && <details className="block" open={warnings.length < 8}>
          <summary style={{ padding: '10px 12px' }}><b>{T("Avisos de lectura (")}{warnings.length})</b></summary>
          <ul className="warnlist" style={{ padding: '0 12px 12px 30px' }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>}
      </> : (
        <div className="steps-howto">
          <div className="s"><span className="n">{T("1 · CARPETA")}</span><b>{T("STEP + BOM juntos")}</b><span className="muted">{T("Pon los STEP del release y su BOM en una carpeta. Puede tener subcarpetas.")}</span></div>
          <div className="s"><span className="n">{T("2 · REGLAS")}</span><b>{T("Tus reglas internas")}</b><span className="muted">{T("Define condiciones con bordes, A/B, tipo, H/V… y lo que pasa: zonas prohibidas, orientación, separación.")}</span></div>
          <div className="s"><span className="n">{T("3 · LÁMINAS")}</span><b>{T("Resultado hoja a hoja")}</b><span className="muted">{T("Revisa cada lámina, mueve o rota piezas a mano y vuelve a optimizar lo demás.")}</span></div>
        </div>
      )}
    </div>
  );
}
