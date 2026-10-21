/// <reference lib="webworker" />
import { nest, NestInput, suggestSheets } from './nest';
import type { SheetSize } from './types';
import { unfoldStepText } from './unfold';
import { tuneSettings, TuneSummary } from './tune';

type Msg =
  | { kind: 'nest'; id: number; input: NestInput }
  | { kind: 'unfold'; id: number; file: string; text: string; kFactor: number; kTable?: { deg: number; k: number }[] }
  | { kind: 'suggest'; id: number; input: NestInput; catalog: SheetSize[] }
  | { kind: 'tune'; id: number; input: NestInput; base: TuneSummary };

self.onmessage = (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.kind === 'nest') {
    try {
      const layout = nest(m.input, p => (self as any).postMessage({ kind: 'progress', id: m.id, progress: p }));
      (self as any).postMessage({ kind: 'nestDone', id: m.id, layout });
    } catch (e: any) {
      (self as any).postMessage({ kind: 'error', id: m.id, error: String(e?.message || e) });
    }
  } else if (m.kind === 'tune') {
    try { (self as any).postMessage({ kind: 'tuneDone', id: m.id, result: tuneSettings(m.input, m.base, (i, n) => (self as any).postMessage({ kind: 'tuneStep', id: m.id, i, n })) }); }
    catch (e: any) { (self as any).postMessage({ kind: 'tuneDone', id: m.id, result: null, error: String(e?.message || e) }); }
  } else if (m.kind === 'suggest') {
    try { (self as any).postMessage({ kind: 'suggestDone', id: m.id, suggestions: suggestSheets(m.input, m.catalog) }); }
    catch (e: any) { (self as any).postMessage({ kind: 'suggestDone', id: m.id, suggestions: [], error: String(e?.message || e) }); }
  } else if (m.kind === 'unfold') {
    try {
      const flat = unfoldStepText(m.text, m.file, { kFactor: m.kFactor, kTable: m.kTable });
      (self as any).postMessage({ kind: 'unfoldDone', id: m.id, file: m.file, flat });
    } catch (e: any) {
      (self as any).postMessage({ kind: 'unfoldDone', id: m.id, file: m.file, error: String(e?.message || e) });
    }
  }
};
