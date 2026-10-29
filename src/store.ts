import { T, Tn, getLang, setLangRaw, Lang } from './i18n';
import { useSyncExternalStore } from 'react';
import type { Project, Panel, Layout, SheetLayout, Placement, Rule, SheetDef, NestSettings, Violation, Action } from './core/types';
import type { BomResult } from './core/bom';
import { parseBomWorkbook } from './core/bom';
import type { FlatPattern } from './core/unfold';
import { buildPanels, StepEntry, releaseCodes } from './core/panels';
import { buildItems, tryPlace, NestProgress, SheetSuggestion, reorganizeSheet, alignInternalCuts, sinkConstrained, cutScore } from './core/nest';
import { makeSheet } from './core/defaults';
import type { Rot, SheetSize } from './core/types';
import type { PanelConstraints } from './core/rules';
import { validateLayout, constraintsFor, placedSize, normalizeRule } from './core/rules';
import { sideVariant } from './core/diagnose';
import { summarize, TuneResult } from './core/tune';
import { migrateProject } from './core/defaults';
import { SourceFile, storage, isTauri, saveTextFile, writeTextTo, openTextFileWithPath } from './platform';
import EngineWorker from './core/worker?worker&inline';

export type View = 'sources' | 'sheets' | 'rules' | 'panels' | 'settings';

export interface State {
  project: Project;
  boms: BomResult[];
  steps: StepEntry[];
  stepSources: SourceFile[];
  sourceLabel: string;
  folder: string | null;
  loading: { done: number; total: number; msg: string } | null;
  panels: Panel[];
  flats: Record<string, FlatPattern>;
  buildWarnings: string[];
  cons: Map<string, PanelConstraints>;
  jobFilter: string[];          // empty = all jobs
  layout: Layout | null;
  violations: Map<string, Violation[]>;
  layoutEdited: boolean;
  nesting: NestProgress | null;
  nestError: string | null;
  autoNest: boolean;
  view: View;
  selSheet: number;
  selIid: string | null;
  selMulti: string[];     // window / Ctrl selection (group) on the current sheet
  relView: string;        // release being viewed ('all' = every release nested together)
  relCache: Record<string, RelSnap>;   // the nesting of the other releases while one is viewed
  selRule: string | null;
  selPanel: string | null;
  toast: { msg: string; kind: 'ok' | 'warn' | 'err'; t: number } | null;
  undo: Layout[];
  redo: Layout[];
  suggestions: SheetSuggestion[] | null;   // null = not needed
  suggesting: boolean;
  presetsRev?: number;
  sessionPath: string | null;     // .nesting file this work was opened from / saved to
  dirty: boolean;                 // changes since the last save
  pendingSetup: boolean;          // folder just loaded: confirm sheets & quantities before the first nesting
  tune: { running: boolean; step?: string; result: TuneResult | null; key: string } | null;
}

const saved = storage.get<any>('ns.project', null);
let project: Project = migrateProject(saved);
export const migratedFromV1 = !!saved && saved.version !== 2;
if (migratedFromV1) storage.set('ns.project', project);

// One-time fix asked by the user: "04 below the middle" rules written as a whole-panel zone
// become a rule about the 04 return only (the strip from the bend to the cut edge).
let migratedRet04: string[] = [];
if (!storage.get('ns.mig.ret04', false)) {
  const isHalfZone = (a: Action) => (a.type === 'forbidZone' && (a.zone.anchor === 'TH' || a.zone.anchor === 'T')) || (a.type === 'requireZone' && (a.zone.anchor === 'BH' || a.zone.anchor === 'B'));
  const rules = project.rules.map(r => {
    if (!/04/.test(r.name + JSON.stringify(r.when)) || !r.actions.some(isHalfZone)) return r;
    const v = sideVariant(r); if (!v) return r;
    migratedRet04.push(r.name); return v.rule;
  });
  if (migratedRet04.length) { project = { ...project, rules }; storage.set('ns.project', project); }
  storage.set('ns.mig.ret04', true);
}

let state: State = {
  project, boms: [], steps: [], stepSources: [], sourceLabel: '', folder: storage.get<string | null>('ns.folder', null),
  loading: null, panels: [], flats: {}, buildWarnings: [], cons: new Map(), jobFilter: [],
  layout: null, violations: new Map(), layoutEdited: false, nesting: null, nestError: null,
  autoNest: storage.get('ns.auto', true), view: 'sources', selSheet: 0, selIid: null, selMulti: [], relView: 'all', relCache: {}, selRule: project.rules[0]?.id ?? null, selPanel: null,
  toast: null, undo: [], redo: [], suggestions: null, suggesting: false, tune: null, sessionPath: null, dirty: false, pendingSetup: false,
};

const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach(l => l());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => sel(state));
}

if (migratedRet04.length) setTimeout(() => toast(T`Regla actualizada: ${migratedRet04.map(n => `«${n}»`).join(', ')} ahora mira sólo el retorno 04, no el panel completo.`), 1200);

// ---------------- rule presets ----------------

export interface RulePreset { id: string; name: string; savedAt: number; rules: Rule[]; margins: NestSettings['margins']; gap: number; auto?: boolean }
export const getPresets = () => storage.get<RulePreset[]>('ns.presets', []);
const putPresets = (ps: RulePreset[]) => { storage.set('ns.presets', ps); setState({ presetsRev: (state.presetsRev ?? 0) + 1 }); };
const snapshot = (): Pick<RulePreset, 'rules' | 'margins' | 'gap'> => ({ rules: structuredClone(state.project.rules), margins: { ...state.project.settings.margins }, gap: state.project.settings.gap });
export const presetMatches = (p: RulePreset) => JSON.stringify(p.rules) === JSON.stringify(state.project.rules) && JSON.stringify(p.margins) === JSON.stringify(state.project.settings.margins) && p.gap === state.project.settings.gap;

export function savePreset(name: string) {
  const n = name.trim(); if (!n) return;
  const ps = getPresets();
  const ex = ps.find(p => !p.auto && p.name.toLowerCase() === n.toLowerCase());
  const entry: RulePreset = { id: ex?.id ?? `p${Date.now().toString(36)}`, name: n, savedAt: Date.now(), ...snapshot() };
  putPresets(ex ? ps.map(p => p === ex ? entry : p) : [...ps, entry]);
  storage.set('ns.activePreset', entry.id);
  toast(ex ? T`Preset «${n}» actualizado` : T`Preset «${n}» guardado (${entry.rules.length} reglas)`);
}
export function overwritePreset(id: string) {
  const ps = getPresets(); const p = ps.find(x => x.id === id); if (!p) return;
  putPresets(ps.map(x => x.id === id ? { ...x, savedAt: Date.now(), ...snapshot() } : x));
  storage.set('ns.activePreset', id);
  toast(T`Preset «${p.name}» actualizado con las reglas actuales`);
}
export function loadPreset(id: string) {
  const ps = getPresets(); const p = ps.find(x => x.id === id); if (!p) return;
  // keep what was there, in case the load was a mistake
  const backup: RulePreset = { id: 'auto', name: T`Antes de cargar «${p.name}»`, savedAt: Date.now(), auto: true, ...snapshot() };
  putPresets([...ps.filter(x => x.id !== 'auto'), backup]);
  updateProject(pr => ({ ...pr, rules: structuredClone(p.rules).map(normalizeRule), settings: { ...pr.settings, margins: { ...p.margins }, gap: p.gap } }));
  storage.set('ns.activePreset', id);
  setState({ selRule: p.rules[0]?.id ?? null });
  toast(T`Preset «${p.name}» cargado. Lo anterior quedó en «Antes de cargar…».`);
}
export function deletePreset(id: string) {
  putPresets(getPresets().filter(x => x.id !== id));
  if (storage.get('ns.activePreset', '') === id) storage.set('ns.activePreset', '');
}
export const activePresetId = () => storage.get<string>('ns.activePreset', '');

export function toast(msg: string, kind: 'ok' | 'warn' | 'err' = 'ok') {
  setState({ toast: { msg, kind, t: Date.now() } });
  setTimeout(() => { if (state.toast && Date.now() - state.toast.t >= 3900) setState({ toast: null }); }, 4000);
}

// ---------------- project mutations ----------------

let saveTimer: any;
export function updateProject(fn: (p: Project) => Project, opts: { rebuild?: boolean; noNest?: boolean } = {}) {
  const next = fn(state.project);
  setState({ project: next, dirty: true });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.set('ns.project', state.project), 300);
  if (opts.rebuild) rebuildPanels(opts.noNest); else recomputeConstraints(opts.noNest);
}
export const setRules = (fn: (r: Rule[]) => Rule[]) => updateProject(p => ({ ...p, rules: fn(p.rules) }));
export const setSheets = (fn: (r: SheetDef[]) => SheetDef[]) => updateProject(p => ({ ...p, sheets: fn(p.sheets) }));
export const setSettings = (patch: Partial<NestSettings>) => updateProject(p => ({ ...p, settings: { ...p.settings, ...patch } }));
export function setOverride(uid: string, patch: Project['overrides'][string] | null) {
  updateProject(p => {
    const o = { ...p.overrides };
    if (patch === null) delete o[uid]; else o[uid] = { ...(o[uid] || {}), ...patch };
    return { ...p, overrides: o };
  }, { rebuild: true });
}

// ---------------- sources ----------------

let unfoldPool: Worker[] = [];
function pool(): Worker[] {
  if (!unfoldPool.length) {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) unfoldPool.push(new EngineWorker());
  }
  return unfoldPool;
}

async function unfoldAll(files: SourceFile[], kFactor: number, onDone: (n: number) => void): Promise<StepEntry[]> {
  const workers = pool();
  const out: StepEntry[] = [];
  let next = 0, done = 0;
  await Promise.all(workers.map(w => new Promise<void>(resolve => {
    const run = async () => {
      if (next >= files.length) { resolve(); return; }
      const f = files[next++];
      let text: string;
      try { text = await f.readText(); } catch (e: any) { out.push({ file: f.name, error: String(e?.message || e), ...(f.rel ? { rel: f.rel } : {}) }); onDone(++done); run(); return; }
      const id = Math.random();
      const handler = (ev: MessageEvent) => {
        if (ev.data.kind !== 'unfoldDone' || ev.data.id !== id) return;
        w.removeEventListener('message', handler);
        out.push({ file: f.name, flat: ev.data.flat, error: ev.data.error, ...(f.rel ? { rel: f.rel } : {}) });
        onDone(++done); run();
      };
      w.addEventListener('message', handler);
      w.postMessage({ lang: getLang(), kind: 'unfold', id, file: f.name, text, kFactor, kTable: state.project.settings.kTable });
    };
    run();
  })));
  return out;
}

// ---------------- save / open the whole work (.nesting) ----------------

const SESSION_FORMAT = 'nesting-studio-session';

export function sessionName() {
  const p = state.sessionPath; if (!p) return null;
  return p.split(/[\\/]/).pop()!.replace(/\.nesting$/i, '');
}

/** Everything needed to see the work exactly as it is: BOM data, unfolded STEP, rules, sheets and the layout. */
function sessionJson() {
  const round = (_k: string, v: unknown) => typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e5) / 1e5 : v;
  return JSON.stringify({
    format: SESSION_FORMAT, version: 1, savedAt: new Date().toISOString(),
    sourceLabel: state.sourceLabel, folder: state.folder,
    project: state.project, boms: state.boms, steps: state.steps,
    layout: state.layout, layoutEdited: state.layoutEdited, jobFilter: state.jobFilter,
    view: state.view, selSheet: state.selSheet, autoNest: state.autoNest,
    // several releases: the one on screen and the nesting of the others (without undo history)
    relView: state.relView,
    relCache: Object.fromEntries(Object.entries(state.relCache).map(([k, v]) => [k, { layout: v.layout, layoutEdited: v.layoutEdited, selSheet: v.selSheet, sig: v.sig }])),
  }, round);
}

export async function saveSession(asNew = false): Promise<boolean> {
  if (!state.panels.length && !state.boms.length) { toast(T('No hay nada que guardar todavía: abre una carpeta primero'), 'warn'); return false; }
  const json = sessionJson();
  try {
    let path = state.sessionPath;
    if (isTauri && path && !asNew) await writeTextTo(path, json);
    else {
      const base = sessionName() ?? (state.sourceLabel.split(/[\\/]/).filter(Boolean).pop() || 'nesting');
      path = await saveTextFile(`${base.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'nesting'}.nesting`, json, [{ name: T('Trabajo de Nesting Studio'), extensions: ['nesting'] }]);
      if (!path) return false;
    }
    setState({ sessionPath: path, dirty: false });
    toast(T`Guardado${isTauri ? ` en ${path}` : ''} (${(json.length / 1e6).toFixed(1)} MB)`);
    return true;
  } catch (e: any) { toast(T`No se pudo guardar: ${e?.message || e}`, 'err'); return false; }
}

export function openSessionText(text: string, path: string) {
  let d: any;
  try { d = JSON.parse(text); } catch { toast(T('El archivo no es un trabajo de Nesting Studio'), 'err'); return; }
  if (d?.format !== SESSION_FORMAT) { toast(T('El archivo no es un trabajo de Nesting Studio'), 'err'); return; }
  nestWorker?.terminate(); nestWorker = null; clearTimeout(nestTimer); clearTimeout(watchdog);
  tuneWorker?.terminate(); tuneWorker = null;
  const project = migrateProject(d.project);
  setState({
    project, boms: d.boms ?? [], steps: d.steps ?? [], stepSources: [], sourceLabel: d.sourceLabel ?? '', folder: d.folder ?? null,
    jobFilter: d.jobFilter ?? [], layout: null, layoutEdited: !!d.layoutEdited, undo: [], redo: [], nesting: null, nestError: null,
    suggestions: null, suggesting: false, tune: null, selIid: null, selMulti: [], selRule: project.rules[0]?.id ?? null,
    relView: d.relView ?? 'all',
    relCache: Object.fromEntries(Object.entries(d.relCache ?? {}).map(([k, v]: [string, any]) => [k, { layout: v.layout ?? null, undo: [], redo: [], layoutEdited: !!v.layoutEdited, selSheet: v.selSheet ?? 0, sig: v.sig ?? '' }])),
  });
  lastSig = null;
  storage.set('ns.project', project);
  // rebuild panels and constraints without re-optimizing: the saved layout is shown as it was
  const { panels, flats, warnings } = buildPanels(state.boms, state.steps, state.project);
  const bw = state.boms.flatMap(b => b.warnings.map(w => `${b.file}: ${w}`));
  setState({ panels, flats, buildWarnings: [...bw, ...warnings] });
  const { cons } = buildItems({ panels: activePanels(), rules: project.rules, sheets: project.sheets, settings: project.settings });
  const layout: Layout | null = d.layout ?? null;
  setState({ cons, layout, selSheet: Math.min(d.selSheet ?? 0, Math.max(0, (layout?.sheets.length ?? 1) - 1)), view: d.view && d.view !== 'sources' ? d.view : (layout ? 'sheets' : 'sources'), sessionPath: path, dirty: false });
  revalidate();
  if (!layout && panels.length) scheduleNest(true);
  const when = d.savedAt ? new Date(d.savedAt).toLocaleString((getLang() === 'en' ? 'en-US' : 'es-CO'), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  toast(T`Trabajo abierto${when ? T` (guardado ${when})` : ''}: ${layout?.sheets.length ?? 0} láminas, ${panels.length} marcas`);
}

export async function openSession() {
  if (state.dirty && state.panels.length && !window.confirm(T('Hay cambios sin guardar. ¿Abrir otro trabajo de todas formas?'))) return;
  const f = await openTextFileWithPath(['nesting'], T('Trabajo de Nesting Studio'));
  if (f) openSessionText(f.text, f.path);
}

/** Sheets & quantities confirmed for a freshly loaded folder: run the first nesting. */
export function confirmSetup() { setState({ pendingSetup: false }); runNest({ keepLocked: false }); }
export function skipSetup() { setState({ pendingSetup: false }); }

/**
 * Several releases in one folder: when two or more subfolders each have their own BOM and STEP
 * files (e.g. Releases/RLS#8, Releases/RLS#9…), returns them as groups. A single release folder
 * (with "1 - BOM" and "2 - PPP" inside) is not split.
 */
function splitReleases(files: SourceFile[], folder: string | null) {
  const root = folder ? folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : null;
  const rel = (f: SourceFile) => {
    const pth = f.path.replace(/\\/g, '/');
    if (root && pth.toLowerCase().startsWith(root + '/')) return pth.slice(root.length + 1);
    return root ? pth : pth.split('/').slice(1).join('/'); // browser: path starts with the picked folder's name
  };
  const groups = new Map<string, SourceFile[]>();
  for (const f of files) {
    const parts = rel(f).split('/');
    if (parts.length < 2) continue;
    const g = groups.get(parts[0]) ?? []; g.push(f); groups.set(parts[0], g);
  }
  const full = [...groups].filter(([, g]) => g.some(f => f.kind === 'bom') && g.some(f => f.kind === 'step'));
  return full.length >= 2 ? full.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })) : null;
}

/** Code of a release from its BOMs: job + release number (26100R8), or the folder name. */
function releaseCode(boms: BomResult[], fallback: string) {
  const cnt = new Map<string, number>();
  for (const b of boms) if (b.header.job && b.header.release) { const k = `${b.header.job}R${String(b.header.release).replace(/^0+(?=\d)/, '')}`; cnt.set(k, (cnt.get(k) ?? 0) + b.panels.length + 1); }
  const best = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0];
  return (best ?? fallback).replace(/[#~|\s]+/g, '');
}

async function readBoms(bomFiles: SourceFile[], onDone: () => void) {
  const boms: BomResult[] = [];
  for (const f of bomFiles) {
    try { boms.push(parseBomWorkbook(await f.readBytes(), f.name)); }
    catch (e: any) { boms.push({ file: f.name, header: { job: '', jobName: '', release: '', material: '', alloy: '', thickness: '', finish: '', finishCode: '', panelCount: 0, date: '' }, panels: [], warnings: [T`No se pudo leer: ${e?.message || e}`] }); }
    onDone();
  }
  return boms;
}

/**
 * Open a folder. `append` adds it as one more release to what's loaded (several releases).
 * A folder holding several releases loads each one as its own release.
 */
export async function loadSources(files: SourceFile[], label: string, folder: string | null = null, opts: { append?: boolean } = {}) {
  const bomFiles = files.filter(f => f.kind === 'bom');
  const stepFiles = files.filter(f => f.kind === 'step');
  const total = bomFiles.length + stepFiles.length;
  if (!total) { toast(T('No se encontraron archivos .step/.stp ni BOM .xls/.xlsx en esa carpeta'), 'warn'); return; }
  const groups = splitReleases(files, folder);
  const append = !!opts.append && state.boms.length > 0;
  const multi = !!groups || append;
  setState({ loading: { done: 0, total, msg: T('Leyendo BOM…') }, ...(append ? {} : { sourceLabel: label, folder }) });
  if (folder && !append) storage.set('ns.folder', folder);
  let done = 0;
  const tick = () => setState({ loading: { done: ++done, total, msg: T('Leyendo BOM…') } });
  // release code of every file
  const parts: { name: string; files: SourceFile[] }[] = groups ? groups.map(([name, g]) => ({ name, files: g })) : [{ name: label.split(/[\\/]/).filter(Boolean).pop() || label, files }];
  let boms: BomResult[] = [];
  const taken = new Set(append ? releaseCodes(state.boms, state.steps) : []);
  const newSteps: SourceFile[] = [];
  for (const part of parts) {
    const pb = await readBoms(part.files.filter(f => f.kind === 'bom'), tick);
    if (multi) {
      let code = releaseCode(pb, part.name);
      if (taken.has(code)) { let k = 2; while (taken.has(`${code}-${k}`)) k++; code = `${code}-${k}`; }
      taken.add(code);
      for (const b of pb) b.rel = code;
      for (const f of part.files) if (f.kind === 'step') newSteps.push({ ...f, rel: code });
    } else newSteps.push(...part.files.filter(f => f.kind === 'step'));
    boms.push(...pb);
  }
  setState({ loading: { done, total, msg: T`Desdoblando ${stepFiles.length} STEP…` } });
  let steps = await unfoldAll(newSteps, state.project.settings.kFactor, n => setState({ loading: { done: done + n, total, msg: T`Desdoblando STEP ${n}/${stepFiles.length}` } }));
  let stepSources = newSteps;
  if (append) {
    // what was loaded before becomes a release too
    let oldB = state.boms, oldS = state.steps, oldSrc = state.stepSources;
    if (!releaseCodes(oldB, oldS).length) {
      const code = releaseCode(oldB, (state.sourceLabel || 'R1').split(/[\\/]/).filter(Boolean).pop() || 'R1');
      oldB = oldB.map(b => ({ ...b, rel: code })); oldS = oldS.map(x => ({ ...x, rel: code })); oldSrc = oldSrc.map(f => ({ ...f, rel: code }));
    }
    boms = [...oldB, ...boms]; steps = [...oldS, ...steps]; stepSources = [...oldSrc, ...stepSources];
  }
  const codes = releaseCodes(boms, steps);
  const sourceLabel = codes.length > 1 ? `${(append ? state.sourceLabel.replace(/ \(.*\)$/, '') : label).split(/[\\/]/).filter(Boolean).pop()} (${codes.join(' + ')})` : (append ? state.sourceLabel : label);
  setState({ boms, steps, stepSources, sourceLabel, loading: null, layout: null, layoutEdited: false, undo: [], redo: [], jobFilter: [], relView: 'all', relCache: {}, sessionPath: null, dirty: true, pendingSetup: true });
  rebuildPanels();
  const np = state.panels.reduce((a, p) => a + p.qty, 0);
  toast(codes.length > 1
    ? T`${codes.length} releases cargados: ${np} paneles. Elige arriba qué release ver o todos juntos.`
    : T`${boms.length} BOM, ${steps.filter(s => s.flat).length}/${steps.length} STEP desdoblados, ${np} paneles`);
  setState({ view: 'sheets' });
}

/** Take a release out of the work. */
export function removeRelease(code: string) {
  const boms = state.boms.filter(b => b.rel !== code), steps = state.steps.filter(x => x.rel !== code), stepSources = state.stepSources.filter(f => f.rel !== code);
  const codes = releaseCodes(boms, steps);
  const base = state.sourceLabel.replace(/ \(.*\)$/, '');
  const relCache = { ...state.relCache }; delete relCache[code]; delete relCache.all;   // "all" changes without it
  setState({ boms, steps, stepSources, sourceLabel: codes.length > 1 ? `${base} (${codes.join(' + ')})` : base, relCache, dirty: true });
  if (state.relView === code || state.relView === 'all') setState({ relView: 'all', layout: null, undo: [], redo: [], layoutEdited: false });
  rebuildPanels();
  toast(T`Release ${code} quitado`);
}

export function loadPrepared(boms: BomResult[], steps: StepEntry[], label: string) {
  setState({ boms, steps, stepSources: [], sourceLabel: label, layout: null, layoutEdited: false, undo: [], redo: [], jobFilter: [] });
  rebuildPanels();
  setState({ view: 'sheets' });
}

export async function reUnfold() {
  if (!state.stepSources.length) { toast(T('Para recalcular con otro factor K hay que volver a abrir la carpeta'), 'warn'); return; }
  const files = state.stepSources;
  setState({ loading: { done: 0, total: files.length, msg: T('Desdoblando de nuevo…') } });
  const steps = await unfoldAll(files, state.project.settings.kFactor, n => setState({ loading: { done: n, total: files.length, msg: T`Desdoblando STEP ${n}/${files.length}` } }));
  setState({ steps, loading: null });
  rebuildPanels();
}

// ---------------- derived ----------------

export function activePanels(s: State = state) {
  let ps = s.jobFilter.length ? s.panels.filter(p => s.jobFilter.includes(p.job)) : s.panels;
  if (s.relView !== 'all') ps = ps.filter(p => p.rel === s.relView);
  return ps;
}

// ---------------- several releases ----------------

/** One release's nesting, kept while another release is on screen. */
export interface RelSnap { layout: Layout | null; undo: Layout[]; redo: Layout[]; layoutEdited: boolean; selSheet: number; sig: string }
/** what the nesting depends on: if it changed while the release was hidden, it's recalculated */
const nestSig = () => JSON.stringify([state.project.rules, state.project.sheets, state.project.settings, state.project.overrides, state.jobFilter]);

/** Release codes loaded (empty when there's only one release). */
export function releaseList(s: State = state) {
  return releaseCodes(s.boms, s.steps);
}

/** Show the nesting of one release, or of all of them together ('all'). */
export function setRelView(key: string) {
  if (key === state.relView) return;
  if (state.nesting) stopNest();
  tuneWorker?.terminate(); tuneWorker = null;
  const cur: RelSnap = { layout: state.layout, undo: state.undo, redo: state.redo, layoutEdited: state.layoutEdited, selSheet: state.selSheet, sig: lastSig ?? nestSig() };
  const relCache = { ...state.relCache, [state.relView]: cur };
  const nx = relCache[key];
  setState({ relView: key, relCache, layout: nx?.layout ?? null, undo: nx?.undo ?? [], redo: nx?.redo ?? [], layoutEdited: nx?.layoutEdited ?? false, selSheet: nx?.selSheet ?? 0, selIid: null, selMulti: [], tune: null, suggestions: null, nestError: null });
  lastSig = nx?.sig ?? null;
  recomputeConstraints(true);
  // first time on this release, or rules / sheets changed meanwhile: calculate it
  if (!state.layout) runNest();
  else if (nx && nx.sig !== nestSig() && state.autoNest) runNest({ keepLocked: true });
}
let lastSig: string | null = null;


export function rebuildPanels(noNest = false) {
  const { panels, flats, warnings } = buildPanels(state.boms, state.steps, state.project);
  const bw = state.boms.flatMap(b => b.warnings.map(w => `${b.file}: ${w}`));
  setState({ panels, flats, buildWarnings: [...bw, ...warnings] });
  recomputeConstraints(noNest);
}

export function recomputeConstraints(noNest = false) {
  const ps = activePanels();
  const { cons } = buildItems({ panels: ps, rules: state.project.rules, sheets: state.project.sheets, settings: state.project.settings });
  setState({ cons });
  revalidate();
  if (!noNest) scheduleNest();
}

export function revalidate() {
  if (!state.layout) { setState({ violations: new Map() }); return; }
  const pm = new Map(state.panels.map(p => [p.uid, p]));
  setState({ violations: validateLayout(state.layout, pm, state.cons, state.project.settings, state.project.sheets) });
}

// ---------------- nesting ----------------

let nestWorker: Worker | null = null;
let nestTimer: any; let nestId = 0;

export function scheduleNest(force = false) {
  clearTimeout(nestTimer);
  if (state.pendingSetup) return;
  if (!state.autoNest && !force) { if (state.layout) setState({}); return; }
  nestTimer = setTimeout(() => runNest(), force ? 0 : 450);
}

let watchdog: any;
let tuneWorker: Worker | null = null;
const settingsKey = () => { const s = state.project.settings; return JSON.stringify([s.repeatSheets, s.repeatWeight, s.repeatMinUtil, s.rowAlign, s.gridWeight, s.timeMs, state.project.rules.length]); };

/** In the background, try other slider values; if one is clearly better, offer it. */
function runTune(input: any, layout: Layout) {
  tuneWorker?.terminate();
  const key = settingsKey();
  if (storage.get('ns.tuneDismissed', '') === key) { setState({ tune: null }); return; }
  tuneWorker = new EngineWorker();
  const id = Math.random();
  setState({ tune: { running: true, result: null, key } });
  tuneWorker.onmessage = (ev: MessageEvent) => {
    const m = ev.data; if (m.id !== id) return;
    if (m.kind === 'tuneStep') setState({ tune: { running: true, result: null, key, step: `${m.i}/${m.n}` } });
    if (m.kind === 'tuneDone') { setState({ tune: { running: false, result: m.result, key } }); tuneWorker?.terminate(); tuneWorker = null; }
  };
  tuneWorker.onerror = () => { setState({ tune: null }); tuneWorker?.terminate(); tuneWorker = null; };
  tuneWorker.postMessage({ lang: getLang(), kind: 'tune', id, input, base: summarize(layout) });
}
export function applyTune() {
  const r = state.tune?.result; if (!r) return;
  setState({ tune: null });
  updateProject(p => ({ ...p, settings: { ...p.settings, ...r.patch } }));
  scheduleNest(true);
  toast(T('Valores de optimización cambiados. Recalculando…'));
}
export function dismissTune() { if (state.tune) storage.set('ns.tuneDismissed', state.tune.key); setState({ tune: null }); }

export function runNest(opts: { keepLocked?: boolean } = { keepLocked: true }) {
  const ps = activePanels();
  if (!ps.length) { setState({ layout: null, nesting: null }); return; }
  if (state.pendingSetup) setState({ pendingSetup: false });
  if (nestWorker) nestWorker.terminate();
  tuneWorker?.terminate(); tuneWorker = null; if (state.tune) setState({ tune: null });
  nestWorker = new EngineWorker();
  const id = ++nestId;
  const noTrial = (sh: SheetLayout) => ({ ...sh, placements: sh.placements.filter(p => !p.trial) });
  const frozen = opts.keepLocked && state.layout ? state.layout.sheets.filter(sh => sh.locked).map(noTrial) : [];
  const seed = opts.keepLocked && state.layout
    ? state.layout.sheets.filter(sh => !sh.locked && sh.placements.some(p => p.locked && !p.trial)).map(sh => ({ ...sh, placements: sh.placements.filter(p => p.locked && !p.trial) }))
    : [];
  setState({ nesting: { iteration: 0, bestCost: 0, sheets: 0, elapsed: 0 }, nestError: null });
  nestWorker.onmessage = (ev: MessageEvent) => {
    const m = ev.data; if (m.id !== id) return;
    if (m.kind === 'progress') setState({ nesting: m.progress });
    else if (m.kind === 'nestDone') {
      const prev = state.layout;
      lastSig = nestSig();
      setState({ dirty: true, layout: m.layout, nesting: null, layoutEdited: false, undo: prev ? [...state.undo.slice(-40), prev] : state.undo, redo: [], selSheet: Math.min(state.selSheet, Math.max(0, m.layout.sheets.length - 1)) });
      revalidate();
      nestWorker?.terminate(); nestWorker = null;
      if (m.layout.unplaced.some((u: any) => u.kind === 'stock')) runSuggest(); else setState({ suggestions: null, suggesting: false });
      clearTimeout(watchdog);
      runTune({ panels: ps, rules: state.project.rules, sheets: state.project.sheets, settings: state.project.settings, seed, frozen }, m.layout);
    } else if (m.kind === 'error') { setState({ nesting: null, nestError: m.error }); toast(T`Error en el nesting: ${m.error}`, 'err'); }
  };
  nestWorker.onerror = (e: ErrorEvent) => { setState({ nesting: null, nestError: e.message || T('El motor de nesting no pudo iniciar') }); toast(T`Error en el motor de nesting: ${e.message || T('no pudo iniciar')}`, 'err'); console.error('worker error', e.message, e.filename, e.lineno); };
  nestWorker.postMessage({ lang: getLang(), kind: 'nest', id, input: { panels: ps, rules: state.project.rules, sheets: state.project.sheets, settings: state.project.settings, seed, frozen } });
  // safety net: the engine has time limits, but never leave the app "calculating" forever
  clearTimeout(watchdog);
  const limit = Math.max(state.project.settings.timeMs * 6, 45000) + 60000;
  watchdog = setTimeout(() => {
    if (id !== nestId || !nestWorker) return;
    nestWorker.terminate(); nestWorker = null;
    setState({ nesting: null, nestError: T('El cálculo superó el tiempo máximo') });
    toast(T`El cálculo pasó de ${Math.round(limit / 1000)} s y se detuvo. Baja el tiempo de búsqueda o revisa las reglas.`, 'err');
  }, limit);
}

let sugWorker: Worker | null = null;
export function runSuggest() {
  sugWorker?.terminate();
  sugWorker = new EngineWorker();
  const id = Math.random();
  setState({ suggesting: true, suggestions: [] });
  sugWorker.onmessage = (ev: MessageEvent) => {
    if (ev.data.kind !== 'suggestDone' || ev.data.id !== id) return;
    setState({ suggestions: ev.data.suggestions, suggesting: false });
    sugWorker?.terminate(); sugWorker = null;
  };
  sugWorker.postMessage({ lang: getLang(), kind: 'suggest', id, catalog: state.project.sheetCatalog, input: { panels: activePanels(), rules: state.project.rules, sheets: state.project.sheets, settings: state.project.settings, frozen: state.layout?.sheets.filter(sh => sh.locked) ?? [] } });
}

/** Add `n` more sheets of a size to this nesting (creates the size if it was not selected). */
export function addSheetStock(size: SheetSize, n: number) {
  updateProject(p => {
    const ex = p.sheets.find(d => d.w === size.w && d.h === size.h);
    const sheets = ex
      ? p.sheets.map(d => d === ex ? { ...d, enabled: true, stock: d.stock === null ? null : d.stock + n } : d)
      : [...p.sheets, makeSheet(size, n)];
    return { ...p, sheets };
  });
  setState({ suggestions: null });
  scheduleNest(true);
}

export function stopNest() { nestWorker?.terminate(); nestWorker = null; setState({ nesting: null }); }

// ---------------- manual layout editing ----------------

function commitLayout(next: Layout, edited = true) {
  const sheetArea = next.sheets.reduce((a, s) => a + s.w * s.h, 0);
  const pm = new Map(state.panels.map(p => [p.uid, p]));
  const usedArea = next.sheets.reduce((a, s) => a + s.placements.reduce((b, pl) => { if (pl.trial) return b; const p = pm.get(pl.uid); return b + (p ? p.blankW * p.blankH : pl.w * pl.h); }, 0), 0);
  next = { ...next, stats: { ...next.stats, sheets: next.sheets.length, sheetArea, usedArea, utilization: sheetArea ? usedArea / sheetArea : 0 } };
  setState({ dirty: true, layout: next, layoutEdited: edited || state.layoutEdited, undo: state.layout ? [...state.undo.slice(-60), state.layout] : state.undo, redo: [] });
  revalidate();
}

const cloneLayout = (l: Layout): Layout => ({ ...l, sheets: l.sheets.map(s => ({ ...s, placements: s.placements.map(p => ({ ...p })) })), unplaced: [...l.unplaced] });

export function undo() {
  if (!state.undo.length) return;
  const prev = state.undo[state.undo.length - 1];
  setState({ layout: prev, undo: state.undo.slice(0, -1), redo: state.layout ? [...state.redo, state.layout] : state.redo });
  revalidate();
}
export function redo() {
  if (!state.redo.length) return;
  const nx = state.redo[state.redo.length - 1];
  setState({ layout: nx, redo: state.redo.slice(0, -1), undo: state.layout ? [...state.undo, state.layout] : state.undo });
  revalidate();
}

export function movePlacement(sheetIdx: number, iid: string, x: number, y: number, live = false) {
  if (!state.layout) return;
  const l = live ? { ...state.layout, sheets: [...state.layout.sheets] } : cloneLayout(state.layout);
  const sh = { ...l.sheets[sheetIdx], placements: l.sheets[sheetIdx].placements.map(p => p.iid === iid ? { ...p, x: +x.toFixed(4), y: +y.toFixed(4), locked: true } : p) };
  l.sheets[sheetIdx] = sh;
  if (live) { setState({ layout: l }); revalidate(); }
  else commitLayout(l);
}

/** Move several pieces at once (group drag / arrows). `pos` = new x,y per iid. */
export function setPositions(sheetIdx: number, pos: Record<string, { x: number; y: number }>, live = false) {
  if (!state.layout) return;
  const l = live ? { ...state.layout, sheets: [...state.layout.sheets] } : cloneLayout(state.layout);
  l.sheets[sheetIdx] = { ...l.sheets[sheetIdx], placements: l.sheets[sheetIdx].placements.map(p => pos[p.iid] ? { ...p, x: +pos[p.iid].x.toFixed(4), y: +pos[p.iid].y.toFixed(4), locked: true } : p) };
  if (live) { setState({ layout: l }); revalidate(); }
  else commitLayout(l);
}
export function nudgeMany(sheetIdx: number, iids: string[], dx: number, dy: number) {
  const sh = state.layout?.sheets[sheetIdx]; if (!sh) return;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const p of sh.placements) if (iids.includes(p.iid)) pos[p.iid] = { x: p.x + dx, y: p.y + dy };
  setPositions(sheetIdx, pos);
}
export function lockMany(sheetIdx: number, iids: string[], lock: boolean) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  l.sheets[sheetIdx].placements.forEach(p => { if (iids.includes(p.iid)) p.locked = lock || undefined; });
  commitLayout(l, false);
}
export function unplaceMany(sheetIdx: number, iids: string[]) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  const sh = l.sheets[sheetIdx];
  for (const p of sh.placements) if (iids.includes(p.iid)) l.unplaced.push(p.trial ? { iid: p.iid, uid: p.uid, reason: p.trial.reason, kind: p.trial.kind } : { iid: p.iid, uid: p.uid, reason: T('Retirado manualmente') });
  sh.placements = sh.placements.filter(p => !iids.includes(p.iid));
  commitLayout(l);
  setState({ selIid: null, selMulti: [] });
}

/** Commit a live drag (push the pre-drag layout to undo). */
export function commitDrag(before: Layout) {
  if (!state.layout) return;
  setState({ undo: [...state.undo.slice(-60), before], redo: [], layoutEdited: true });
  revalidate();
}

export function rotatePlacement(sheetIdx: number, iid: string) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  const sh = l.sheets[sheetIdx];
  const p = sh.placements.find(q => q.iid === iid); if (!p) return;
  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const nw = p.h, nh = p.w;
  Object.assign(p, { w: nw, h: nh, rot: ((p.rot + 90) % 360) as Rot, x: +(cx - nw / 2).toFixed(4), y: +(cy - nh / 2).toFixed(4), locked: true });
  commitLayout(l);
  // remembered for the whole mark: re-optimizing keeps this rotation
  setOrient(p.uid, { fixedRot: p.rot });
}

/** Manual orientation of a mark (rotation / mirror), kept when re-optimizing. Doesn't re-nest by itself. */
function setOrient(uid: string, patch: { flip?: boolean | null; fixedRot?: Rot | null }) {
  updateProject(pr => {
    const o = { ...pr.overrides }; const cur: any = { ...(o[uid] || {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete cur[k]; else cur[k] = v; }
    if (Object.keys(cur).length) o[uid] = cur; else delete o[uid];
    return { ...pr, overrides: o };
  }, { rebuild: true, noNest: true });
}
/** Mirror a mark (all its pieces) about a horizontal line, or undo it. */
export function flipMark(uid: string) {
  const c = state.cons.get(uid); if (!c) return;
  setOrient(uid, { flip: !c.flip });
  toast(T`${state.panels.find(p => p.uid === uid)?.mark ?? ''}: ${!c.flip ? T('en espejo') : T('sin espejo')} (se mantiene al optimizar)`);
}
/** Forget manual rotation and mirror of a mark (back to the default and the optimizer's choice). */
export function releaseOrient(uid: string) { setOrient(uid, { flip: null, fixedRot: null }); toast(T('Giro y espejo vuelven a lo automático')); }
export function releaseAllOrient() {
  updateProject(pr => {
    const o: typeof pr.overrides = {};
    for (const [u, v] of Object.entries(pr.overrides)) { const { flip, fixedRot, ...rest } = v as any; void flip; void fixedRot; if (Object.keys(rest).length) o[u] = rest; }
    return { ...pr, overrides: o };
  }, { rebuild: true, noNest: true });
  toast(T('Se quitaron los giros y espejos puestos a mano'));
}

/** How many things are held: fixed pieces, frozen sheets, rotations / mirrors set by hand. */
export function lockCounts() {
  const L = state.layout;
  const pieces = L ? L.sheets.reduce((a, sh) => a + sh.placements.filter(p => p.locked && !p.trial).length, 0) : 0;
  const sheets = L ? L.sheets.filter(sh => sh.locked).length : 0;
  const ov = Object.values(state.project.overrides) as any[];
  return { pieces, sheets, rots: ov.filter(o => o.fixedRot != null).length, flips: ov.filter(o => o.flip != null).length };
}
/**
 * Release everything and optimize from scratch: fixed pieces, frozen sheets and rotations fixed by hand
 * (and, if asked, the mirrors set by hand too).
 */
export function unlockAll(alsoFlips = false) {
  const c = lockCounts();
  if (c.rots || (alsoFlips && c.flips)) updateProject(pr => {
    const o: typeof pr.overrides = {};
    for (const [u, v] of Object.entries(pr.overrides)) { const cur: any = { ...v }; delete cur.fixedRot; if (alsoFlips) delete cur.flip; if (Object.keys(cur).length) o[u] = cur; }
    return { ...pr, overrides: o };
  }, { rebuild: true, noNest: true });
  if (state.layout) {
    const l = cloneLayout(state.layout);
    for (const sh of l.sheets) { sh.locked = undefined; for (const p of sh.placements) p.locked = undefined; }
    commitLayout(l, false);
  }
  setState({ selIid: null, selMulti: [] });
  runNest({ keepLocked: false });
  const parts = [c.pieces && T`${c.pieces} piezas fijadas`, c.sheets && T`${c.sheets} láminas bloqueadas`, c.rots && T`${c.rots} giros a mano`, alsoFlips && c.flips && T`${c.flips} espejos a mano`].filter(Boolean);
  toast(parts.length ? T`Se soltó todo (${parts.join(', ')}). Optimizando desde cero…` : T('No había nada bloqueado. Optimizando desde cero…'));
}

export function toggleLock(sheetIdx: number, iid: string) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  const p = l.sheets[sheetIdx].placements.find(q => q.iid === iid); if (!p) return;
  p.locked = !p.locked;
  commitLayout(l, false);
}

/** Freeze whole sheets: they stay exactly as they are when re-optimizing, even if rules change. */
export function freezeSheets(ids: string[], on: boolean) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  for (const sh of l.sheets) if (ids.includes(sh.id)) sh.locked = on || undefined;
  commitLayout(l, false);
  toast(on ? T`${ids.length === 1 ? T('Lámina bloqueada') : T`${ids.length} láminas bloqueadas`}: se mantienen al optimizar` : T('Lámina desbloqueada'));
}

export function lockSheet(sheetIdx: number, lock: boolean) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  l.sheets[sheetIdx].placements.forEach(p => { p.locked = lock; });
  commitLayout(l, false);
}

export function unplace(sheetIdx: number, iid: string) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  const sh = l.sheets[sheetIdx];
  const p = sh.placements.find(q => q.iid === iid); if (!p) return;
  sh.placements = sh.placements.filter(q => q.iid !== iid);
  l.unplaced.push(p.trial ? { iid, uid: p.uid, reason: p.trial.reason, kind: p.trial.kind } : { iid, uid: p.uid, reason: T('Retirado manualmente') });
  commitLayout(l);
  setState({ selIid: null });
}

/** Place a panel instance (from another sheet or the unplaced tray) on a target sheet. */
export function placeOnSheet(targetIdx: number, iid: string): boolean {
  if (!state.layout) return false;
  const l = cloneLayout(state.layout);
  const target = l.sheets[targetIdx];
  let uidOf = l.unplaced.find(u => u.iid === iid)?.uid;
  let fromIdx = -1;
  if (!uidOf) { fromIdx = l.sheets.findIndex(s => s.placements.some(p => p.iid === iid)); uidOf = l.sheets[fromIdx]?.placements.find(p => p.iid === iid)?.uid; }
  const panel = state.panels.find(p => p.uid === uidOf); const c = uidOf ? state.cons.get(uidOf) : undefined;
  if (!panel || !c || !target) return false;
  const pl = tryPlace(target, panel, c, state.project.settings, iid, u => state.cons.get(u), iid);
  if (!pl) { toast(T`No hay espacio legal para ${panel.mark} en la lámina ${targetIdx + 1}`, 'warn'); return false; }
  pl.locked = true;
  if (fromIdx >= 0) l.sheets[fromIdx].placements = l.sheets[fromIdx].placements.filter(p => p.iid !== iid);
  else l.unplaced = l.unplaced.filter(u => u.iid !== iid);
  target.placements = [...target.placements.filter(p => p.iid !== iid), pl];
  l.sheets = l.sheets.filter(s => s.placements.length || l.sheets.indexOf(s) === targetIdx);
  commitLayout(l);
  setState({ selSheet: l.sheets.indexOf(target), selIid: iid });
  return true;
}

/**
 * Put an unplaced piece on a sheet just to see how it would look: ignores the rules, is always
 * flagged as an error, is left out of exports and goes back to "Sin ubicar" when re-optimizing.
 */
export function previewOnSheet(targetIdx: number, iid: string): boolean {
  if (!state.layout) return false;
  const l = cloneLayout(state.layout);
  const target = l.sheets[targetIdx];
  const u = l.unplaced.find(x => x.iid === iid);
  const panel = u && state.panels.find(p => p.uid === u.uid);
  if (!u || !panel || !target) return false;
  const s = state.project.settings;
  // a free spot (no overlap, inside the margins), ignoring every rule; else top-left over whatever is there
  const free = constraintsFor(panel, [], s);
  let pl = tryPlace(target, panel, free, s, iid, uid => state.cons.get(uid));
  if (!pl) {
    const rot = (state.cons.get(panel.uid)?.rotations[0] ?? 0) as Rot;
    const d = placedSize(panel.blankW, panel.blankH, rot);
    pl = { iid, uid: panel.uid, x: s.margins.left, y: Math.max(s.margins.bottom, target.h - s.margins.top - d.h), w: d.w, h: d.h, rot };
  }
  pl.trial = { reason: u.reason, kind: u.kind };
  l.unplaced = l.unplaced.filter(x => x.iid !== iid);
  target.placements = [...target.placements, pl];
  commitLayout(l);
  setState({ selSheet: targetIdx, selIid: iid });
  toast(T`${panel.mark} en prueba en la lámina ${targetIdx + 1}: arrástrala para ver cómo queda. Está marcada como error.`, 'warn');
  return true;
}

/** Re-arrange the panels already on a sheet for more shared cuts (common lines). */
export function reorganizeCurrent(idx: number) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  const sh = l.sheets[idx]; if (!sh) return;
  if (sh.locked) { toast(T('La lámina está bloqueada: desbloquéala para reacomodarla'), 'warn'); return; }
  const s = state.project.settings;
  const consOf = (iid: string) => state.cons.get(iid.slice(0, iid.lastIndexOf('#')));
  const before = cutScore(sh.placements, sh.w, sh.h, s);
  const moved = reorganizeSheet(sh, consOf, s, true);
  alignInternalCuts(sh, consOf, s);
  const sunk = sinkConstrained(sh, consOf, s);
  const after = cutScore(sh.placements, sh.w, sh.h, s);
  if (!moved && !sunk && after <= before + 0.5) { toast(T('Esta lámina ya tiene los cortes más compartidos que encontré')); return; }
  commitLayout(l);
  toast(T('Lámina reacomodada para compartir más cortes (Ctrl+Z para deshacer)'));
}

export function addEmptySheet(def: SheetDef) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  const cur = l.sheets[state.selSheet];
  l.sheets.push({ id: `S${Date.now() % 100000}`, sheetId: def.id, w: def.w, h: def.h, partition: cur?.partition ?? '', placements: [] });
  commitLayout(l);
  setState({ selSheet: l.sheets.length - 1 });
}

export function deleteSheet(idx: number) {
  if (!state.layout) return;
  const l = cloneLayout(state.layout);
  const sh = l.sheets[idx]; if (!sh) return;
  for (const p of sh.placements) l.unplaced.push({ iid: p.iid, uid: p.uid, reason: T('Lámina eliminada') });
  l.sheets.splice(idx, 1);
  commitLayout(l);
  setState({ selSheet: Math.max(0, Math.min(idx, l.sheets.length - 1)) });
}

export function setAuto(v: boolean) { storage.set('ns.auto', v); setState({ autoNest: v }); if (v) scheduleNest(true); }

export type { Placement, SheetLayout };

// ---------------- language ----------------

const STASH_DB = 'ns-lang-stash';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open(STASH_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbPut(v: unknown) { const db = await idb(); await new Promise<void>((res, rej) => { const tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(v, 'stash'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function idbTake(): Promise<any> {
  const db = await idb();
  return new Promise((res) => { const tx = db.transaction('s', 'readwrite'); const st = tx.objectStore('s'); const g = st.get('stash'); g.onsuccess = () => { st.delete('stash'); res(g.result); }; g.onerror = () => res(null); });
}
export let switchingLang = false;
/** Switch language: the work in progress is kept (stashed, page reloaded in the new language, restored). */
export async function setLanguage(l: Lang) {
  if (l === getLang()) return;
  try { localStorage.setItem('ns.lang', JSON.stringify(l)); } catch { /* ignore */ }
  setLangRaw(l); switchingLang = true;
  try {
    if (state.panels.length) await idbPut({ text: sessionJson(), path: state.sessionPath, dirty: state.dirty, view: state.view, selSheet: state.selSheet });
  } catch { /* if it can't be kept, the page still reloads */ }
  location.reload();
}
/** After a language switch: bring back the work as it was. */
export async function restoreAfterLanguage() {
  try {
    const st = await idbTake(); if (!st?.text) return false;
    openSessionText(st.text, st.path ?? '');
    setState({ sessionPath: st.path ?? null, dirty: !!st.dirty, view: st.view ?? state.view, selSheet: st.selSheet ?? 0, toast: null });
    return true;
  } catch { return false; }
}
