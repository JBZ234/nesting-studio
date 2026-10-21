import React, { useMemo, useState } from 'react';
import { useStore, setState, setRules, activePanels, getState, toast, getPresets, savePreset, loadPreset, overwritePreset, deletePreset, presetMatches, activePresetId } from '../store';
import type { Rule, Cond, Action, Op, ZoneDef, Anchor , EdgeSel, Dir, Side } from '../core/types';
import { FIELDS } from '../core/panels';
import { checkExpr, zoneRect, ruleApplies, normalizeRule } from '../core/rules';
import { OPS, ANCHORS, ACTION_TYPES, DIRS, describeCond, describeAction, newAction } from './describe';
import { RULE_COLORS, RULE_TEMPLATES, uid } from '../core/defaults';
import { SheetRulesCard } from './SheetRulesCard';
import { I } from './icons';
import { saveTextFile, openTextFile } from '../platform';

export function RulesView() {
  const rules = useStore(s => s.project.rules);
  const selRule = useStore(s => s.selRule);
  const rule = rules.find(r => r.id === selRule) ?? rules[0];
  const [showPresets, setShowPresets] = useState(false);
  const upd = (id: string, fn: (r: Rule) => Rule) => setRules(rs => rs.map(r => r.id === id ? fn(r) : r));

  const add = () => {
    const r: Rule = { id: uid(), name: 'Nueva regla', enabled: true, appliesTo: 'both', color: RULE_COLORS[rules.length % RULE_COLORS.length], when: { kind: 'group', mode: 'all', items: [{ kind: 'cond', field: 'anyEdge', op: 'startsWith', value: '' }] }, actions: [newAction('forbidZone')] };
    setRules(rs => [...rs, r]); setState({ selRule: r.id });
  };
  const dup = (r: Rule) => { const c = { ...structuredClone(r), id: uid(), name: r.name + ' (copia)' }; setRules(rs => { const i = rs.findIndex(x => x.id === r.id); const n = [...rs]; n.splice(i + 1, 0, c); return n; }); setState({ selRule: c.id }); };
  const del = (r: Rule) => { setRules(rs => rs.filter(x => x.id !== r.id)); setState({ selRule: rules.find(x => x.id !== r.id)?.id ?? null }); };
  const move = (r: Rule, d: number) => setRules(rs => { const i = rs.findIndex(x => x.id === r.id); const j = i + d; if (j < 0 || j >= rs.length) return rs; const n = [...rs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const exportRules = async () => { const p = await saveTextFile('reglas-nesting.json', JSON.stringify(rules, null, 2), [{ name: 'JSON', extensions: ['json'] }]); if (p) toast('Reglas exportadas'); };
  const importRules = async () => {
    const t = await openTextFile(['json']); if (!t) return;
    try {
      const data = JSON.parse(t); const arr: Rule[] = Array.isArray(data) ? data : data.rules;
      if (!Array.isArray(arr)) throw new Error('El archivo no contiene una lista de reglas');
      setRules(rs => [...rs, ...arr.map(r => normalizeRule({ ...r, id: uid() }))]); toast(`${arr.length} reglas importadas`);
    } catch (e: any) { toast(`No se pudo importar: ${e.message}`, 'err'); }
  };

  return (
    <div className="rules-view">
      <aside className="rule-list" aria-label="Reglas">
        <div className="pane-h rl-head">
          <div className="rl-row">
            <h3>Reglas</h3><span className="pill">{rules.filter(r => r.enabled).length}/{rules.length} activas</span><span className="grow" />
            <button className={`btn sm ${showPresets ? 'primary' : ''}`} title="Guardar y cargar juegos de reglas" aria-expanded={showPresets} onClick={() => setShowPresets(v => !v)}><I.layers /> Presets</button>
            <button className="iconbtn" title="Importar reglas desde un archivo" onClick={importRules}><I.upload /></button>
            <button className="iconbtn" title="Exportar reglas a un archivo" onClick={exportRules}><I.download /></button>
          </div>
          <ActivePresetLine />
          {showPresets && <PresetsPanel />}
          <div className="rl-row">
            <button className="btn sm primary" onClick={add}><I.plus /> Nueva regla</button>
            <select id="tpl" value="" aria-label="Nueva regla desde plantilla" title="Crear una regla a partir de una plantilla"
              onChange={e => { const t = RULE_TEMPLATES[+e.target.value]; if (!t) return; const r: Rule = { ...t.make(), id: uid(), color: RULE_COLORS[rules.length % RULE_COLORS.length] }; setRules(rs => [...rs, r]); setState({ selRule: r.id }); }}>
              <option value="">Desde plantilla…</option>
              {RULE_TEMPLATES.map((t, i) => <option key={i} value={i}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div className="scroll" style={{ flex: 1 }}>
          <SheetRulesCard />
          {rules.map(r => (
            <div key={r.id} className={`rule-item ${r.enabled ? '' : 'disabled'}`} aria-selected={r.id === rule?.id} onClick={() => setState({ selRule: r.id })}>
              <label className="switch" onClick={e => e.stopPropagation()} title={r.enabled ? 'Desactivar' : 'Activar'}>
                <input id={`en-${r.id}`} type="checkbox" checked={r.enabled} onChange={e => upd(r.id, x => ({ ...x, enabled: e.target.checked }))} /><span />
              </label>
              <div style={{ minWidth: 0 }}>
                <div className="nm"><i className="dot" style={{ background: r.color, marginRight: 6 }} />{r.name} <OrientTag a={r.appliesTo} /></div>
                <div className="ds">{r.when.items.length ? <>Si {lcFirst(describeCond(r.when))}</> : 'Siempre'} → {lcFirst(r.actions.map(describeAction).join('; '))}</div>
              </div>
              <RuleCount rule={r} />
            </div>
          ))}
          {!rules.length && <div className="empty"><p>Sin reglas. Crea la primera con “Nueva”.</p></div>}
        </div>
        <div className="pane-h" style={{ borderTop: '1px solid var(--line-soft)', borderBottom: 0 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Las reglas se aplican en orden; si dos fijan la orientación, gana la de más abajo.</span>
        </div>
      </aside>

      {rule ? (
        <div className="editor">
          <div className="ed-head">
            <input id="rname" type="text" value={rule.name} onChange={e => upd(rule.id, r => ({ ...r, name: e.target.value }))} aria-label="Nombre de la regla" />
            <div className="ed-tools">
              <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }} role="group" aria-label="Color de la regla">
                {RULE_COLORS.map(c => <button key={c} title={c} aria-label={`Color ${c}`} onClick={() => upd(rule.id, r => ({ ...r, color: c }))} className="swatch" style={{ background: c, outline: rule.color === c ? '2px solid var(--fg)' : 'none' }} />)}
              </div>
              <span className="grow" />
              <button className="btn sm ghost" title="Subir en la lista (se aplica antes)" onClick={() => move(rule, -1)}><I.up /> Subir</button>
              <button className="btn sm ghost" title="Bajar en la lista (se aplica después)" onClick={() => move(rule, 1)}><I.down /> Bajar</button>
              <button className="btn sm ghost" onClick={() => dup(rule)}><I.copy /> Duplicar</button>
              <button className="btn sm ghost danger" onClick={() => del(rule)}><I.trash /> Eliminar</button>
            </div>
          </div>
          <textarea id="rnotes" rows={2} placeholder="Notas: por qué existe esta regla…" value={rule.notes ?? ''} onChange={e => upd(rule.id, r => ({ ...r, notes: e.target.value }))} style={{ fontFamily: 'var(--f-body)', fontSize: 13.5 }} />

          <section className="block">
            <header><h3>Aplica a</h3><span className="grow" /><span className="muted" style={{ fontSize: 12.5 }}>Horizontal o vertical según A y B del BOM (Ajustes)</span></header>
            <div className="body">
              <div className="seg orient-seg" role="radiogroup" aria-label="Orientación de los paneles a los que aplica">
                {([['H', 'Paneles horizontales'], ['V', 'Paneles verticales'], ['both', 'Ambos']] as const).map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={rule.appliesTo === v} aria-pressed={rule.appliesTo === v} onClick={() => upd(rule.id, r => ({ ...r, appliesTo: v }))}>{l}</button>
                ))}
              </div>
            </div>
          </section>

          <section className="block">
            <header><h3>Y además cumple</h3><span className="grow" /><span className="muted" style={{ fontSize: 12.5 }}>Todo sale del BOM, el nombre del STEP y el desarrollo</span></header>
            <div className="body">
              <GroupEditor g={rule.when} onChange={g => upd(rule.id, r => ({ ...r, when: g as Rule['when'] }))} root />
            </div>
          </section>

          <section className="block">
            <header><h3>Entonces</h3><span className="grow" />
              <select id="addact" value="" onChange={e => { const t = e.target.value as Action['type']; if (t) upd(rule.id, r => ({ ...r, actions: [...r.actions, newAction(t)] })); }} aria-label="Agregar acción">
                <option value="">+ Agregar acción…</option>
                {[...new Set(ACTION_TYPES.map(a => a.group))].map(g => <optgroup key={g} label={g}>{ACTION_TYPES.filter(a => a.group === g).map(a => <option key={a.type} value={a.type}>{a.label}</option>)}</optgroup>)}
              </select>
            </header>
            <div className="body">
              {rule.actions.map((a, i) => (
                <ActionEditor key={i} a={a} onChange={na => upd(rule.id, r => ({ ...r, actions: r.actions.map((x, j) => j === i ? na : x) }))} onDelete={() => upd(rule.id, r => ({ ...r, actions: r.actions.filter((_, j) => j !== i) }))} />
              ))}
              {!rule.actions.length && <span className="muted">Sin acciones: la regla no hace nada todavía.</span>}
            </div>
          </section>
        </div>
      ) : <div className="empty"><p>Selecciona o crea una regla.</p></div>}

      {rule && <MatchesPane rule={rule} />}
    </div>
  );
}

function RuleCount({ rule }: { rule: Rule }) {
  const panels = useStore(s => s.panels);
  const settings = useStore(s => s.project.settings);
  const jf = useStore(s => s.jobFilter);
  const n = useMemo(() => activePanels(getState()).filter(p => ruleApplies(rule, p, settings)).reduce((a, p) => a + p.qty, 0), [rule.when, rule.appliesTo, panels, settings, jf]);
  return <span className="pill num" title="Piezas afectadas">{n}</span>;
}

function GroupEditor({ g, onChange, root, onDelete }: { g: Cond & { kind: 'group' }; onChange: (c: Cond) => void; root?: boolean; onDelete?: () => void }) {
  const set = (items: Cond[]) => onChange({ ...g, items });
  return (
    <div className={root ? '' : 'cond-group'} style={root ? { display: 'grid', gap: 8 } : undefined}>
      <div className="gh">
        {g.items.length > 1 || !root ? <>
          <span>Se deben cumplir</span>
          <div className="seg">
            <button aria-pressed={g.mode === 'all'} onClick={() => onChange({ ...g, mode: 'all' })}>todas</button>
            <button aria-pressed={g.mode === 'any'} onClick={() => onChange({ ...g, mode: 'any' })}>alguna</button>
          </div>
          <label className="row" style={{ gap: 4 }}><input type="checkbox" checked={!!g.not} onChange={e => onChange({ ...g, not: e.target.checked })} /> invertir (NO)</label>
        </> : <span className="muted">{g.items.length ? '' : 'Sin condiciones extra: aplica a todos los paneles de la orientación elegida.'}</span>}
        <span className="grow" />
        {onDelete && <button className="iconbtn" title="Quitar grupo" onClick={onDelete}><I.x /></button>}
      </div>
      {g.items.map((c, i) => {
        const ch = (nc: Cond) => set(g.items.map((x, j) => j === i ? nc : x));
        const rm = () => set(g.items.filter((_, j) => j !== i));
        if (c.kind === 'group') return <GroupEditor key={i} g={c} onChange={ch} onDelete={rm} />;
        if (c.kind === 'expr') return <ExprEditor key={i} c={c} onChange={ch} onDelete={rm} />;
        return <CondEditor key={i} c={c} onChange={ch} onDelete={rm} />;
      })}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => set([...g.items, { kind: 'cond', field: 'type', op: '=', value: '' }])}><I.plus /> Condición</button>
        <button className="btn sm" onClick={() => set([...g.items, { kind: 'group', mode: 'any', items: [{ kind: 'cond', field: 'edgeL', op: 'startsWith', value: '' }] }])}><I.plus /> Grupo</button>
        <button className="btn sm" onClick={() => set([...g.items, { kind: 'expr', expr: "edges.some(e => fam(e) === '04') && A > 30" }])}><I.plus /> Expresión</button>
      </div>
    </div>
  );
}

function CondEditor({ c, onChange, onDelete }: { c: Cond & { kind: 'cond' }; onChange: (c: Cond) => void; onDelete: () => void }) {
  const f = FIELDS.find(x => x.key === c.field) ?? FIELDS[0];
  const ops = OPS.filter(o => o.kinds.includes(f.kind));
  const panels = useStore(s => s.panels);
  const settings = useStore(s => s.project.settings);
  const suggestions = useMemo(() => {
    const vals = new Set<string>();
    for (const p of panels) {
      const v = f.key === 'anyEdge' ? [p.edgeT, p.edgeB, p.edgeL, p.edgeR] : f.key === 'sideEdges' ? [p.edgeL, p.edgeR] : f.key === 'orientation' ? ['H', 'V'] : [String((p as any)[f.key] ?? '')];
      v.forEach(x => x && vals.add(x));
      if (vals.size > 60) break;
    }
    if (f.kind === 'edge') [...vals].forEach(v => vals.add(v.slice(0, 2)));
    return [...vals].sort();
  }, [panels, f.key, f.kind]);
  const noValue = c.op === 'empty' || c.op === 'notEmpty';
  const listId = `sug-${f.key}`;
  void settings;
  return (
    <div className="cond">
      <select id={`f-${f.key}`} value={c.field} onChange={e => { const nf = FIELDS.find(x => x.key === e.target.value)!; const okOp = OPS.find(o => o.op === c.op)?.kinds.includes(nf.kind); onChange({ ...c, field: nf.key, op: okOp ? c.op : (nf.kind === 'number' ? '>' : '=') }); }} aria-label="Campo">
        {[...new Set(FIELDS.map(x => x.group))].map(gr => <optgroup key={gr} label={gr}>{FIELDS.filter(x => x.group === gr).map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
      </select>
      <select value={c.op} onChange={e => onChange({ ...c, op: e.target.value as Op })} aria-label="Operador">
        {ops.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
      </select>
      {noValue ? <span /> : c.op === 'between'
        ? <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input type="text" value={c.value} onChange={e => onChange({ ...c, value: e.target.value })} style={{ width: '50%' }} aria-label="Desde" /><input type="text" value={c.value2 ?? ''} onChange={e => onChange({ ...c, value2: e.target.value })} style={{ width: '50%' }} aria-label="Hasta" /></div>
        : <><input type="text" list={listId} value={c.value} placeholder={c.op === 'in' || c.op === 'notIn' ? 'p.ej. 04A, 04E' : f.kind === 'edge' ? 'p.ej. 04' : ''} onChange={e => onChange({ ...c, value: e.target.value })} aria-label="Valor" /><datalist id={listId}>{suggestions.map(s => <option key={s} value={s} />)}</datalist></>}
      <button className="iconbtn" title="Quitar condición" onClick={onDelete}><I.x /></button>
    </div>
  );
}

function ExprEditor({ c, onChange, onDelete }: { c: Cond & { kind: 'expr' }; onChange: (c: Cond) => void; onDelete: () => void }) {
  const err = checkExpr(c.expr);
  return (
    <div className="cond-group">
      <div className="gh"><b style={{ fontFamily: 'var(--f-display)' }}>Expresión avanzada</b>{err ? <span className="pill bad">Error: {err}</span> : <span className="pill ok">válida</span>}<span className="grow" /><button className="iconbtn" title="Quitar" onClick={onDelete}><I.x /></button></div>
      <textarea rows={2} value={c.expr} onChange={e => onChange({ ...c, expr: e.target.value })} spellCheck={false} aria-label="Expresión" />
      <div className="code-help">Variables: <code>A</code> <code>B</code> <code>C</code> <code>Z</code> <code>T</code> <code>Bt</code> (borde inferior) <code>L</code> <code>R</code> <code>edges</code> <code>type</code> <code>mark</code> <code>qty</code> <code>blankW</code> <code>blankH</code> <code>long</code> <code>short</code> <code>area</code> <code>orientation</code> <code>grain</code> <code>job</code> y <code>fam(código)</code> → “04” de “04E”. Ej.: <code>L.startsWith('04') &amp;&amp; blankW &gt; 40</code></div>
    </div>
  );
}

function ZoneEditor({ z, onChange, hideTest }: { z: ZoneDef; onChange: (z: ZoneDef) => void; hideTest?: boolean }) {
  const half = ['TH', 'BH', 'LH', 'RH'].includes(z.anchor);
  const sheets = useStore(s => s.project.sheets);
  const sd = sheets.find(s => s.enabled) ?? sheets[0];
  const grid: Anchor[] = ['TL', 'TC', 'TR', 'ML', 'custom', 'MR', 'BL', 'BC', 'BR'];
  const r = sd ? zoneRect(z, sd.w, sd.h) : null;
  const k = sd ? 150 / sd.w : 1;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
      <div style={{ display: 'grid', gap: 6 }}>
        <span className="label">Ubicación</span>
        <div className="anchor-pick" role="group" aria-label="Ancla de la zona">
          {grid.map(a => <button key={a} title={ANCHORS.find(x => x.a === a)?.label} aria-pressed={z.anchor === a} onClick={() => onChange({ ...z, anchor: a })} />)}
        </div>
        <div className="seg">{(['T', 'B', 'L', 'R'] as Anchor[]).map(a => <button key={a} aria-pressed={z.anchor === a} title={ANCHORS.find(x => x.a === a)?.label} onClick={() => onChange({ ...z, anchor: a })}>{({ T: 'Arriba', B: 'Abajo', L: 'Izq.', R: 'Der.' } as any)[a]}</button>)}</div>
        <span className="label">Mitades</span>
        <div className="seg">{(['TH', 'BH', 'LH', 'RH'] as Anchor[]).map(a => <button key={a} aria-pressed={z.anchor === a} title={ANCHORS.find(x => x.a === a)?.label} onClick={() => onChange({ ...z, anchor: a })}>{({ TH: 'Sup.', BH: 'Inf.', LH: 'Izq.', RH: 'Der.' } as any)[a]}</button>)}</div>
      </div>
      <div className="grid2 grow" style={{ minWidth: 200 }}>
        {half && <span className="muted" style={{ fontSize: 13 }}>{ANCHORS.find(x => x.a === z.anchor)?.label} de la lámina (se adapta a cada tamaño).</span>}
        {!half && z.anchor !== 'T' && z.anchor !== 'B' && <label className="field"><span>Ancho de la zona (X, pulg.)</span><input type="number" step={0.5} value={z.w} onChange={e => onChange({ ...z, w: +e.target.value })} /></label>}
        {!half && z.anchor !== 'L' && z.anchor !== 'R' && <label className="field"><span>Alto de la zona (Y, pulg.)</span><input type="number" step={0.5} value={z.h} onChange={e => onChange({ ...z, h: +e.target.value })} /></label>}
        {z.anchor === 'custom' && <><label className="field"><span>X desde la izquierda</span><input type="number" step={0.5} value={z.x ?? 0} onChange={e => onChange({ ...z, x: +e.target.value })} /></label><label className="field"><span>Y desde abajo</span><input type="number" step={0.5} value={z.y ?? 0} onChange={e => onChange({ ...z, y: +e.target.value })} /></label></>}
        {!hideTest && <label className="field"><span>El panel…</span>
          <select value={z.test} onChange={e => onChange({ ...z, test: e.target.value as ZoneDef['test'] })}>
            <option value="intersects">toca la zona (cualquier parte)</option>
            <option value="inside">queda completo dentro</option>
          </select>
        </label>}
      </div>
      {sd && r && <svg width={150} height={sd.h * k} viewBox={`0 0 ${sd.w} ${sd.h}`} style={{ flex: 'none', borderRadius: 3 }} aria-label="Vista de la zona">
        <rect width={sd.w} height={sd.h} fill="var(--sheet)" stroke="var(--sheet-edge)" strokeWidth={sd.w / 150} />
        <rect x={r.x} y={sd.h - r.y - r.h} width={r.w} height={r.h} fill="var(--zone-bad)" stroke="var(--bad)" strokeWidth={sd.w / 120} />
        <text x={2} y={sd.h - 2} fontSize={sd.h / 7} fill="var(--muted)" fontFamily="var(--f-mono)">{sd.name}</text>
      </svg>}
    </div>
  );
}

function EdgeSelEditor({ e, onChange }: { e: EdgeSel; onChange: (e: EdgeSel) => void }) {
  const panels = useStore(st => st.panels);
  const fams = useMemo(() => [...new Set(panels.flatMap(p => [p.edgeT, p.edgeB, p.edgeL, p.edgeR]).filter(Boolean).map(c => c.slice(0, 2)))].sort(), [panels]);
  const codes = e.codes.toUpperCase().split(/[,;| ]+/).filter(Boolean);
  const toggle = (f: string) => onChange({ ...e, codes: (codes.includes(f) ? codes.filter(c => c !== f) : [...codes, f]).join(', ') });
  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(180px, 1.3fr) minmax(160px, 1fr)' }}>
      <label className="field"><span>Condición de borde (lados que empiezan con…)</span>
        <input type="text" value={e.codes} placeholder="p. ej. 04, 08" onChange={ev => onChange({ ...e, codes: ev.target.value.toUpperCase() })} />
        {fams.length > 0 && <div className="chips">{fams.map(f => <button key={f} className="chip" aria-pressed={codes.includes(f)} style={codes.includes(f) ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined} onClick={() => toggle(f)}>{f}</button>)}</div>}
      </label>
      <div className="field"><span>Mirar sólo estos lados del BOM</span>
        <div className="sidechips" role="group" aria-label="Lados del BOM">
          {(['T', 'B', 'L', 'R'] as Side[]).map(sd => <button key={sd} aria-pressed={e.sides.includes(sd)} title={({ T: 'Superior', B: 'Inferior', L: 'Izquierdo', R: 'Derecho' })[sd]} onClick={() => onChange({ ...e, sides: e.sides.includes(sd) ? e.sides.filter(x => x !== sd) : [...e.sides, sd] })}>{sd}</button>)}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{e.sides.length ? (e.sides.every(x => x === 'L' || x === 'R') && e.sides.length === 2 ? 'Laterales (L y R)' : `Sólo ${e.sides.join(', ')}`) : 'Ninguno marcado = los cuatro lados'}</span>
      </div>
    </div>
  );
}

/** Edge-code list with quick chips (codes seen in the loaded BOMs). */
function CodesPicker({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  const panels = useStore(st => st.panels);
  const fams = useMemo(() => [...new Set(panels.flatMap(p => [p.edgeT, p.edgeB, p.edgeL, p.edgeR]).filter(Boolean).map(c => c.slice(0, 2)))].sort(), [panels]);
  const codes = value.toUpperCase().split(/[,;| ]+/).filter(Boolean);
  const toggle = (f: string) => onChange((codes.includes(f) ? codes.filter(c => c !== f) : [...codes, f]).join(', '));
  return (
    <label className="field"><span>{label}</span>
      <input type="text" value={value} placeholder={placeholder} onChange={ev => onChange(ev.target.value.toUpperCase())} />
      {fams.length > 0 && <div className="chips">{fams.map(f => <button key={f} className="chip" aria-pressed={codes.includes(f)} style={codes.includes(f) ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : undefined} onClick={e => { e.preventDefault(); toggle(f); }}>{f}</button>)}</div>}
    </label>
  );
}

function DirPicker({ d, onChange, label }: { d: Dir; onChange: (d: Dir) => void; label: string }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <div className="dirpick" role="group" aria-label={label}>
        <span /><button aria-pressed={d === 'top'} onClick={() => onChange('top')} title="Arriba">↑</button><span />
        <button aria-pressed={d === 'left'} onClick={() => onChange('left')} title="Izquierda">←</button><span className="ctr">lám.</span><button aria-pressed={d === 'right'} onClick={() => onChange('right')} title="Derecha">→</button>
        <span /><button aria-pressed={d === 'bottom'} onClick={() => onChange('bottom')} title="Abajo">↓</button><span />
      </div>
      <span className="muted" style={{ fontSize: 13 }}>{label}: <b style={{ color: 'var(--fg)' }}>{DIRS.find(x => x.d === d)?.short}</b> de la lámina</span>
    </div>
  );
}

function Strength({ a, onChange }: { a: { strength: 'hard' | 'soft'; weight: number }; onChange: (p: { strength?: 'hard' | 'soft'; weight?: number }) => void }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <div className="seg">
        <button aria-pressed={a.strength === 'hard'} onClick={() => onChange({ strength: 'hard' })} title="Nunca se rompe">Obligatoria</button>
        <button aria-pressed={a.strength === 'soft'} onClick={() => onChange({ strength: 'soft' })} title="Se respeta si no cuesta láminas">Preferencia</button>
      </div>
      {a.strength === 'soft' && <label className="row" style={{ gap: 6, fontSize: 13 }}>Peso <input type="range" min={1} max={100} value={a.weight} onChange={e => onChange({ weight: +e.target.value })} /> <span className="num">{a.weight}</span></label>}
    </div>
  );
}

function ActionEditor({ a, onChange, onDelete }: { a: Action; onChange: (a: Action) => void; onDelete: () => void }) {
  const sheets = useStore(s => s.project.sheets);
  const meta = ACTION_TYPES.find(t => t.type === a.type)!;
  let body: React.ReactNode = null;
  switch (a.type) {
    case 'forbidZone': case 'requireZone':
      body = <><ZoneEditor z={a.zone} onChange={z => onChange({ ...a, zone: z })} /><Strength a={a} onChange={p => onChange({ ...a, ...p })} />
        <div className="note"><span>Esta acción mira <b>todo el panel</b>. Si sólo importa dónde queda el retorno de un lado (p. ej. el 04), cámbiala por «Retorno de un lado dentro / fuera de una zona».</span>
          <div className="row"><button className="btn sm" onClick={() => onChange({ type: 'edgeZone', edge: { codes: '', sides: [] }, zone: { ...a.zone, test: 'inside' }, mode: a.type === 'forbidZone' ? 'outside' : 'inside', strength: a.strength, weight: a.weight })}>Cambiar a sólo el retorno de un lado</button></div></div></>; break;
    case 'orientation':
      body = <><div className="seg" style={{ flexWrap: 'wrap' }}>{([['A_X', 'A a lo largo de X'], ['A_Y', 'A a lo largo de Y'], ['long_X', 'Lado largo en X'], ['long_Y', 'Lado largo en Y'], ['free', 'Libre']] as const).map(([m, l]) => <button key={m} aria-pressed={a.mode === m} onClick={() => onChange({ ...a, mode: m })}>{l}</button>)}</div><Strength a={a} onChange={p => onChange({ ...a, ...p })} /></>; break;
    case 'gap': body = <label className="row">Holgura adicional <input type="number" step={0.0625} value={a.value} onChange={e => onChange({ ...a, value: +e.target.value })} /> pulg.</label>; break;
    case 'priority': body = <label className="row">Prioridad <input type="number" step={1} value={a.value} onChange={e => onChange({ ...a, value: +e.target.value })} /> <span className="muted">(más alto = se coloca antes)</span></label>; break;
    case 'maxPerSheet': body = <label className="row">Máximo <input type="number" min={1} step={1} value={a.value} onChange={e => onChange({ ...a, value: Math.max(1, +e.target.value) })} /> piezas de esta regla por lámina</label>; break;
    case 'separateBy': body = <label className="row">Campo <select value={a.field} onChange={e => onChange({ ...a, field: e.target.value })}>{FIELDS.filter(f => f.kind !== 'edge' || f.key !== 'anyEdge').map(f => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>; break;
    case 'sheets': body = <div className="row">{sheets.map(s => <label key={s.id} className="row" style={{ gap: 4 }}><input type="checkbox" checked={a.ids.includes(s.id)} onChange={e => onChange({ ...a, ids: e.target.checked ? [...a.ids, s.id] : a.ids.filter(x => x !== s.id) })} />{s.name}</label>)}</div>; break;
    case 'blankAdjust': body = <div className="row"><label className="row">Ancho <input type="number" step={0.0625} value={a.dw} onChange={e => onChange({ ...a, dw: +e.target.value })} /></label><label className="row">Alto <input type="number" step={0.0625} value={a.dh} onChange={e => onChange({ ...a, dh: +e.target.value })} /></label></div>; break;
    case 'exclude': body = <span className="muted">Estos paneles no se anidan.</span>; break;
    case 'edgeFacing':
      body = <><EdgeSelEditor e={a.edge} onChange={e => onChange({ ...a, edge: e })} /><DirPicker d={a.dir} label="Ese lado va hacia" onChange={d => onChange({ ...a, dir: d })} /><Strength a={a} onChange={p => onChange({ ...a, ...p })} /></>; break;
    case 'edgeNotOnBorder':
      body = <><EdgeSelEditor e={a.edge} onChange={e => onChange({ ...a, edge: e })} />
        <label className="row" style={{ fontSize: 13.5 }}>Cuenta como “en el borde” si queda a menos de <input type="number" step={0.25} min={0} value={a.tol} onChange={e => onChange({ ...a, tol: Math.max(0, +e.target.value) })} style={{ width: 70 }} /> pulg. del filo de la lámina</label>
        <Strength a={a} onChange={p => onChange({ ...a, ...p })} /></>; break;
    case 'edgeZone':
      body = <><EdgeSelEditor e={a.edge} onChange={e => onChange({ ...a, edge: e })} />
        <div className="seg"><button aria-pressed={a.mode === 'inside'} onClick={() => onChange({ ...a, mode: 'inside' })}>Debe quedar dentro de</button><button aria-pressed={a.mode === 'outside'} onClick={() => onChange({ ...a, mode: 'outside' })}>No puede entrar en</button></div>
        <ZoneEditor z={a.zone} hideTest onChange={z => onChange({ ...a, zone: z })} />
        <div className="row" style={{ gap: 8, fontSize: 13.5 }}><span>Qué se mide</span>
          <div className="seg"><button aria-pressed={(a.part ?? 'return') === 'return'} onClick={() => onChange({ ...a, part: 'return' })}>Todo el retorno (del doblez al corte)</button><button aria-pressed={a.part === 'edge'} onClick={() => onChange({ ...a, part: 'edge' })}>Sólo la línea del borde</button></div></div>
        <Strength a={a} onChange={p => onChange({ ...a, ...p })} /></>; break;
    case 'edgeNoCommonLine':
      body = <><EdgeSelEditor e={a.edge} onChange={e => onChange({ ...a, edge: e })} />
        <CodesPicker label="No comparte línea de corte con estos lados del panel vecino" value={a.withCodes ?? ''} placeholder="Vacío = con ningún lado (siempre separa)" onChange={v => onChange({ ...a, withCodes: v })} />
        <label className="row" style={{ fontSize: 13.5 }}>Separación entre esos dos lados <input type="number" step={0.0625} min={0} value={a.clearance} onChange={e => onChange({ ...a, clearance: Math.max(0, +e.target.value) })} style={{ width: 80 }} /> pulg.</label>
        <span className="muted" style={{ fontSize: 12.5 }}>{(a.withCodes ?? '').trim()
          ? <>Sólo se separa cuando el lado {a.edge.codes || '…'} queda frente a un lado {a.withCodes} de otro panel. Con cualquier otro lado sí comparte common line.</>
          : <>Sin lados del vecino: ese lado nunca comparte línea de corte. Los demás lados comparten common line si la separación general en “Reglas de la lámina” es 0.</>}</span></>; break;
    case 'edgeClearance':
      body = <><EdgeSelEditor e={a.edge} onChange={e => onChange({ ...a, edge: e })} />
        <label className="row" style={{ fontSize: 13.5 }}>Separación mínima <input type="number" step={0.5} min={0} value={a.mm} onChange={e => onChange({ ...a, mm: Math.max(0, +e.target.value) })} style={{ width: 80 }} /> mm <span className="muted">({(a.mm / 25.4).toFixed(3)}")</span></label>
        <div className="row" style={{ gap: 14, fontSize: 13.5 }}>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={a.border} onChange={e => onChange({ ...a, border: e.target.checked })} /> Desde el borde de la lámina</label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={a.panels} onChange={e => onChange({ ...a, panels: e.target.checked })} /> Desde los lados de otros paneles (caras paralelas)</label>
        </div>
        <span className="muted" style={{ fontSize: 12.5 }}>Siempre obligatoria. Con otros paneles cuenta sólo el lado que queda <b>enfrente</b> (paralelo y encarado); en las esquinas no aplica. Si dos lados con esta regla quedan enfrentados, la distancia entre ellos es la mayor de las dos, no la suma.</span></>; break;
    case 'gravity':
      body = <><DirPicker d={a.dir} label="Pegado" onChange={d => onChange({ ...a, dir: d })} />
        <label className="row" style={{ gap: 6, fontSize: 13 }}>Fuerza <input type="range" min={1} max={100} value={a.weight} onChange={e => onChange({ ...a, weight: +e.target.value })} /> <span className="num">{a.weight}</span></label></>; break;
  }
  return (
    <div className="action">
      <div className="ah"><b>{meta.label}</b><span className="muted" style={{ fontSize: 12.5 }}>{meta.help}</span><span className="grow" /><button className="iconbtn" title="Quitar acción" onClick={onDelete}><I.trash /></button></div>
      {body}
    </div>
  );
}

function MatchesPane({ rule }: { rule: Rule }) {
  const panels = useStore(s => s.panels);
  const settings = useStore(s => s.project.settings);
  const jf = useStore(s => s.jobFilter);
  const [q, setQ] = useState('');
  const matched = useMemo(() => activePanels(getState()).filter(p => ruleApplies(rule, p, settings)), [rule.when, rule.appliesTo, panels, settings, jf]);
  const all = activePanels(getState());
  const pieces = matched.reduce((a, p) => a + p.qty, 0);
  const byType = new Map<string, number>(); matched.forEach(p => byType.set(p.type, (byType.get(p.type) || 0) + p.qty));
  const shown = matched.filter(p => !q || p.mark.toLowerCase().includes(q.toLowerCase()) || p.bomSheet.toLowerCase().includes(q.toLowerCase()));
  return (
    <aside className="matches" aria-label="Paneles afectados">
      <div className="pane-h"><h3>Paneles afectados</h3></div>
      <div className="insp-sec">
        <div className="stats">
          <div className="stat"><b>{matched.length}</b><span>Marcas</span></div>
          <div className="stat"><b>{pieces}</b><span>Piezas</span></div>
          <div className="stat"><b>{all.length ? Math.round(matched.length / all.length * 100) : 0}%</b><span>del total</span></div>
        </div>
        <div className="chips">{[...byType].map(([t, n]) => <span key={t} className="pill">{t} · {n}</span>)}</div>
        <input type="text" id="mq" placeholder="Filtrar marca u hoja del BOM…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="scroll" style={{ flex: 1 }}>
        <table className="tbl"><thead><tr><th>Marca</th><th>Tipo</th><th>T·B·L·R</th><th className="r">A×B</th><th className="r">Cant</th></tr></thead>
          <tbody>{shown.slice(0, 400).map(p => (
            <tr key={p.uid} style={{ cursor: 'pointer' }} onClick={() => setState({ view: 'panels', selPanel: p.uid })}>
              <td><b>{p.mark}</b></td><td>{p.type}</td>
              <td><EdgeCodes p={p} rule={rule} /></td>
              <td className="r num">{p.A}×{p.B}</td><td className="r num">{p.qty}</td>
            </tr>))}
          </tbody></table>
        {!matched.length && <div className="empty" style={{ height: 'auto', padding: 20 }}><p>Ningún panel cumple esta condición.</p></div>}
      </div>
    </aside>
  );
}

export function OrientTag({ a }: { a: Rule['appliesTo'] }) {
  const t = a === 'H' ? 'Horizontales' : a === 'V' ? 'Verticales' : 'H y V';
  return <span className={`otag otag-${a ?? 'both'}`} title={`Aplica a paneles ${a === 'H' ? 'horizontales' : a === 'V' ? 'verticales' : 'horizontales y verticales'}`}>{t}</span>;
}

const lcFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function EdgeCodes({ p, rule }: { p: { edgeT: string; edgeB: string; edgeL: string; edgeR: string }; rule?: Rule }) {
  const hits = new Set<string>();
  if (rule) {
    const walk = (c: Cond) => { if (c.kind === 'group') c.items.forEach(walk); else if (c.kind === 'cond' && c.value) {
      const keys = c.field === 'anyEdge' ? ['edgeT', 'edgeB', 'edgeL', 'edgeR'] : c.field === 'sideEdges' ? ['edgeL', 'edgeR'] : [c.field];
      for (const k of keys) { const v = String((p as any)[k] ?? '').toUpperCase(); const t = c.value.toUpperCase(); if (v && ((c.op === 'startsWith' && v.startsWith(t)) || (c.op === '=' && v === t) || (c.op === 'contains' && v.includes(t)))) hits.add(k); }
    } };
    walk(rule.when);
    for (const a of rule.actions) if ('edge' in a) {
      const codes = a.edge.codes.toUpperCase().split(/[,;| ]+/).filter(Boolean);
      for (const k of ['edgeT', 'edgeB', 'edgeL', 'edgeR'] as const) {
        if (a.edge.sides.length && !a.edge.sides.includes(k.slice(4) as Side)) continue;
        const v = String(p[k] ?? '').toUpperCase(); if (v && codes.some(c => v.startsWith(c))) hits.add(k);
      }
    }
  }
  return <span className="row" style={{ gap: 3, flexWrap: 'nowrap' }}>{(['edgeT', 'edgeB', 'edgeL', 'edgeR'] as const).map(k => <span key={k} className={`edge ${hits.has(k) ? 'hit' : ''}`}>{p[k]}</span>)}</span>;
}

const fmtDate = (t: number) => new Date(t).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Which preset is loaded, and whether the rules changed since. */
function ActivePresetLine() {
  useStore(s => s.presetsRev); useStore(s => s.project);
  const id = activePresetId();
  const p = getPresets().find(x => x.id === id && !x.auto);
  if (!p) return null;
  const same = presetMatches(p);
  return (
    <div className="rl-row preset-line">
      <span className="muted">Preset:</span><b className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</b>
      {same ? <span className="pill ok">guardado</span> : <><span className="pill warn">con cambios</span><button className="btn sm" onClick={() => overwritePreset(p.id)}>Guardar</button></>}
    </div>
  );
}

function PresetsPanel() {
  useStore(s => s.presetsRev); useStore(s => s.project);
  const presets = getPresets();
  const active = activePresetId();
  const [name, setName] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const user = presets.filter(p => !p.auto).sort((a, b) => a.name.localeCompare(b.name));
  const auto = presets.find(p => p.auto);
  const exists = user.some(p => p.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <div className="presets">
      <form className="rl-row" onSubmit={e => { e.preventDefault(); savePreset(name); setName(''); }}>
        <input id="preset-name" className="grow" placeholder="Nombre, p. ej. Aluminio 125" value={name} onChange={e => setName(e.target.value)} aria-label="Nombre del preset" style={{ minWidth: 0 }} />
        <button className="btn sm primary" type="submit" disabled={!name.trim()}>{exists ? 'Reemplazar' : 'Guardar'}</button>
      </form>
      <span className="muted" style={{ fontSize: 12 }}>Guarda todas las reglas (activas e inactivas), los márgenes y el common line.</span>
      {!user.length && <span className="muted" style={{ fontSize: 12.5 }}>Aún no tienes presets guardados.</span>}
      {user.map(p => {
        const cur = p.id === active && presetMatches(p);
        return (
          <div key={p.id} className={`preset ${p.id === active ? 'on' : ''}`}>
            <div style={{ minWidth: 0 }}>
              <b>{p.name}</b>
              <span className="muted">{p.rules.length} reglas · {fmtDate(p.savedAt)}{cur ? ' · en uso' : ''}</span>
            </div>
            <div className="preset-btns">
              <button className="btn sm" disabled={cur} onClick={() => loadPreset(p.id)}>Cargar</button>
              <button className="btn sm ghost" title="Reemplazar este preset con las reglas actuales" onClick={() => overwritePreset(p.id)}>Actualizar</button>
              {confirmDel === p.id
                ? <button className="btn sm danger" onClick={() => { deletePreset(p.id); setConfirmDel(null); }}>¿Borrar?</button>
                : <button className="iconbtn" title="Eliminar preset" onClick={() => setConfirmDel(p.id)}><I.trash /></button>}
            </div>
          </div>
        );
      })}
      {auto && <div className="preset auto">
        <div style={{ minWidth: 0 }}><b>{auto.name}</b><span className="muted">Copia automática · {fmtDate(auto.savedAt)}</span></div>
        <div className="preset-btns"><button className="btn sm" onClick={() => loadPreset(auto.id)}>Recuperar</button></div>
      </div>}
    </div>
  );
}
