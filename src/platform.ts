import { T, Tn } from './i18n';
// Abstraction over Tauri (desktop) and plain browser.
export const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

export interface SourceFile {
  name: string;      // file name only
  path: string;      // full path (tauri) or relative path (web)
  rel?: string;      // release it belongs to, when several releases are loaded
  size: number;
  kind: 'step' | 'bom' | 'other';
  readText: () => Promise<string>;
  readBytes: () => Promise<Uint8Array>;
}

const kindOf = (name: string): SourceFile['kind'] =>
  /\.(step|stp)$/i.test(name) ? 'step' : /\.(xls|xlsx|xlsm)$/i.test(name) && !name.startsWith('~$') ? 'bom' : 'other';

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Desktop: native folder picker and recursive scan. */
export async function pickFolderTauri(): Promise<{ folder: string; files: SourceFile[] } | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const folder = await open({ directory: true, multiple: false, title: T('Carpeta con STEP y BOM') });
  if (!folder || Array.isArray(folder)) return null;
  return { folder, files: await scanFolderTauri(folder) };
}

export async function scanFolderTauri(folder: string): Promise<SourceFile[]> {
  const list = await invoke<{ path: string; name: string; size: number }[]>('scan_folder', { path: folder });
  return list.map(f => ({
    name: f.name, path: f.path, size: f.size, kind: kindOf(f.name),
    readText: async () => new TextDecoder().decode(new Uint8Array(await invoke<ArrayBuffer>('read_file', { path: f.path }))),
    readBytes: async () => new Uint8Array(await invoke<ArrayBuffer>('read_file', { path: f.path })),
  })).filter(f => f.kind !== 'other');
}

export async function startupFolder(): Promise<string | null> {
  if (!isTauri) return null;
  try { return await invoke<string | null>('startup_folder'); } catch { return null; }
}

/** Browser: files from <input webkitdirectory> or drag & drop. */
export function filesFromFileList(list: FileList | File[]): SourceFile[] {
  return Array.from(list).map(f => ({
    name: f.name, path: (f as any).webkitRelativePath || f.name, size: f.size, kind: kindOf(f.name),
    readText: () => f.text(),
    readBytes: async () => new Uint8Array(await f.arrayBuffer()),
  })).filter(f => f.kind !== 'other');
}

/** Save a text file: native dialog on desktop, download in browser. */
export async function saveTextFile(defaultName: string, content: string, filters?: { name: string; extensions: string[] }[], mime = 'text/plain'): Promise<string | null> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: defaultName, filters });
    if (!path) return null;
    await invoke('write_text', { path, contents: content });
    return path;
  }
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = defaultName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return defaultName;
}

/** Desktop: write straight to a known path (no dialog). */
export async function writeTextTo(path: string, content: string) { await invoke('write_text', { path, contents: content }); }

/** Like openTextFile, but also returns where the file was (desktop) or its name (browser). */
export async function openTextFileWithPath(exts: string[], name = T('Archivo')): Promise<{ text: string; path: string } | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const p = await open({ multiple: false, filters: [{ name, extensions: exts }] });
    if (!p || Array.isArray(p)) return null;
    return { text: await readTextAt(p), path: p };
  }
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = exts.map(e => '.' + e).join(',');
    inp.onchange = async () => { const f = inp.files?.[0]; resolve(f ? { text: await f.text(), path: f.name } : null); };
    inp.click();
  });
}
export async function readTextAt(path: string) { return new TextDecoder().decode(new Uint8Array(await invoke<ArrayBuffer>('read_file', { path }))); }
export async function startupFile(): Promise<string | null> {
  if (!isTauri) return null;
  try { return await invoke<string | null>('startup_file'); } catch { return null; }
}

export async function openTextFile(exts: string[]): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const p = await open({ multiple: false, filters: [{ name: T('Archivo'), extensions: exts }] });
    if (!p || Array.isArray(p)) return null;
    return new TextDecoder().decode(new Uint8Array(await invoke<ArrayBuffer>('read_file', { path: p })));
  }
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = exts.map(e => '.' + e).join(',');
    inp.onchange = async () => resolve(inp.files?.[0] ? await inp.files[0].text() : null);
    inp.click();
  });
}

export const storage = {
  get<T>(k: string, def: T): T { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) as T : def; } catch { return def; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
