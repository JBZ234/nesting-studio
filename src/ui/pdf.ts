import { T, Tn, getLang } from '../i18n';
import type { Layout, Panel, NestSettings } from '../core/types';
import type { FlatPattern } from '../core/unfold';
import { groupIdentical } from '../core/nest';
import { facing } from '../core/rules';

/** zlib (deflate) with the browser's built-in compressor — no extra library needed */
async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const cs = new (globalThis as any).CompressionStream('deflate');
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

/** ASCII85 (keeps the compressed streams as plain text) */
function a85(b: Uint8Array) {
  let out = '';
  for (let i = 0; i < b.length; i += 4) {
    const k = Math.min(4, b.length - i);
    let v = 0; for (let j = 0; j < 4; j++) v = v * 256 + (j < k ? b[i + j] : 0);
    if (v === 0 && k === 4) { out += 'z'; continue; }
    const c: string[] = []; for (let j = 0; j < 5; j++) { c.unshift(String.fromCharCode(33 + (v % 85))); v = Math.floor(v / 85); }
    out += c.slice(0, k + 1).join('');
  }
  // line breaks keep editors happy
  return out.replace(/(.{120})/g, '$1\n') + '~>';
}

/**
 * Vector PDF with every sheet (one page each, landscape Letter) plus a summary page.
 * Hand-written PDF 1.4: lines, rectangles and Helvetica text only. Text goes as hex strings
 * (WinAnsi), so the whole file is plain ASCII and can be saved like any text file.
 */

const PW = 792, PH = 612;          // Letter landscape, points
const HUES = [208, 28, 152, 280, 350, 95, 190, 48, 320, 120, 240, 5];
const hue = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return HUES[h % HUES.length]; };
function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
/** pale fill like the screen (30% of the colour over white) */
const fillFor = (key: string): [number, number, number] => hslRgb(hue(key), 0.62, 0.52).map(c => 1 - 0.3 * (1 - c)) as [number, number, number];

const n = (v: number) => (Math.abs(v) < 1e-6 ? 0 : +v.toFixed(3)).toString();
function hexText(t: string) {
  const map: Record<string, number> = { '€': 0x80, '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85 };
  let h = '';
  for (const ch of t) { let c = map[ch] ?? ch.charCodeAt(0); if (c > 255) c = 63; h += c.toString(16).padStart(2, '0'); }
  return `<${h}>`;
}
/** Helvetica widths (approx., per 1000 em) good enough to centre labels */
const W_HELV: Record<string, number> = { ' ': 278, '.': 278, ',': 278, ':': 278, '·': 278, '×': 584, '"': 355, '-': 333, '(': 333, ')': 333, '/': 278, '%': 889, '#': 556 };
const textW = (t: string, size: number, bold = false) => [...t].reduce((a, ch) => a + (W_HELV[ch] ?? (/[0-9]/.test(ch) ? 556 : /[A-Z]/.test(ch) ? 680 : /[il]/.test(ch) ? 240 : 540)), 0) / 1000 * size * (bold ? 1.06 : 1);

class Page {
  ops: string[] = [];
  rgbF(c: number[]) { this.ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} rg`); return this; }
  rgbS(c: number[]) { this.ops.push(`${n(c[0])} ${n(c[1])} ${n(c[2])} RG`); return this; }
  lw(w: number) { this.ops.push(`${n(w)} w`); return this; }
  dash(a?: number[]) { this.ops.push(a ? `[${a.map(n).join(' ')}] 0 d` : '[] 0 d'); return this; }
  rect(x: number, y: number, w: number, h: number, mode: 'S' | 'f' | 'B') { this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re ${mode}`); return this; }
  line(x1: number, y1: number, x2: number, y2: number) { this.ops.push(`${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`); return this; }
  path(segs: [number, number, number, number][]) {
    if (!segs.length) return this;
    // batch into one path (much smaller file)
    this.ops.push(segs.map(s => `${n(s[0])} ${n(s[1])} m ${n(s[2])} ${n(s[3])} l`).join(' ') + ' S');
    return this;
  }
  text(x: number, y: number, size: number, t: string, o: { bold?: boolean; align?: 'l' | 'c' | 'r'; color?: number[] } = {}) {
    const w = textW(t, size, o.bold);
    const dx = o.align === 'c' ? -w / 2 : o.align === 'r' ? -w : 0;
    this.ops.push(`BT /${o.bold ? 'F2' : 'F1'} ${n(size)} Tf ${o.color ? `${o.color.map(n).join(' ')} rg ` : '0 0 0 rg '}${n(x + dx)} ${n(y)} Td ${hexText(t)} Tj ET`);
    return this;
  }
}

async function buildPdf(pages: Page[], title: string): Promise<string> {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add(''); const pagesId = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids: number[] = [];
  for (const p of pages) {
    const raw = p.ops.join('\n');
    let body: string, filter: string;
    try { body = a85(await zlib(new TextEncoder().encode(raw))); filter = '[/ASCII85Decode /FlateDecode]'; }
    catch { body = a85(new TextEncoder().encode(raw)); filter = '/ASCII85Decode'; }   // no compressor: bigger file, same drawing
    const cs = add(`<< /Length ${body.length} /Filter ${filter} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${cs} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${hexText(title)} /Producer (Nesting Studio) >>`);
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

export interface PdfOpts { title: string; colorBy?: 'type' | 'mark' | 'job' | 'orient'; showFlat?: boolean; onlySheet?: number }

export function layoutPdf(layout: Layout, panels: Panel[], flats: Record<string, FlatPattern>, s: NestSettings, flipOf: (uid: string) => boolean, o: PdfOpts): Promise<string> {
  const pm = new Map(panels.map(p => [p.uid, p]));
  const groups = groupIdentical(layout);
  const layoutNo = new Map<string, number>(); const sameAs = new Map<string, number[]>();
  groups.forEach((g, i) => g.ids.forEach(id => { layoutNo.set(id, i + 1); sameAs.set(id, g.ids.map(x => layout.sheets.findIndex(sh => sh.id === x) + 1)); }));
  const date = new Date().toLocaleDateString((getLang() === 'en' ? 'en-US' : 'es-CO'), { year: 'numeric', month: 'short', day: 'numeric' });
  const pages: Page[] = [];
  const realPls = (i: number) => layout.sheets[i].placements.filter(p => !p.trial);
  const utilOf = (i: number) => { const sh = layout.sheets[i]; return realPls(i).reduce((a, pl) => { const p = pm.get(pl.uid); return a + (p ? p.blankW * p.blankH : pl.w * pl.h); }, 0) / (sh.w * sh.h); };

  // ---------- summary ----------
  if (o.onlySheet === undefined) {
    const pg = new Page(); pages.push(pg);
    pg.text(40, PH - 50, 20, o.title, { bold: true });
    pg.text(40, PH - 70, 10, T`${date} · ${layout.sheets.length} láminas · ${groups.length} acomodos distintos · aprovechamiento ${(layout.stats.utilization * 100).toFixed(1)}% · ${layout.sheets.reduce((a, _, i) => a + realPls(i).length, 0)} piezas${layout.unplaced.length ? T` · ${layout.unplaced.length} sin ubicar` : ''}`, { color: [0.35, 0.35, 0.35] });
    const bySize = new Map<string, number>(); layout.sheets.forEach(sh => bySize.set(`${sh.w} × ${sh.h}"`, (bySize.get(`${sh.w} × ${sh.h}"`) || 0) + 1));
    pg.text(40, PH - 86, 10, T('Láminas por tamaño: ') + [...bySize].map(([k, v]) => `${k}: ${v}`).join('   '), { color: [0.35, 0.35, 0.35] });
    const cols = [40, 95, 165, 235, 290, 355];
    const head = [T('Lámina'), T('Tamaño'), T('Acomodo'), T('Piezas'), T('Aprov.'), T('Contenido')];
    let y = PH - 115; let col = 0;
    const rowH = 13;
    const drawHead = () => { head.forEach((h, k) => pg.text(cols[k] + col, y, 8.5, h, { bold: true })); pg.lw(0.5).rgbS([0.6, 0.6, 0.6]).line(40, y - 4, PW - 40, y - 4); y -= rowH + 2; };
    drawHead();
    let cur = pg;
    layout.sheets.forEach((sh, i) => {
      if (y < 40) { cur = new Page(); pages.push(cur); y = PH - 50; head.forEach((h, k) => cur.text(cols[k], y, 8.5, h, { bold: true })); cur.lw(0.5).rgbS([0.6, 0.6, 0.6]).line(40, y - 4, PW - 40, y - 4); y -= rowH + 2; }
      const cnt = new Map<string, number>(); for (const pl of realPls(i)) { const pp = pm.get(pl.uid); const m = pp ? (pp.rel ? `${pp.rel} ${pp.mark}` : pp.mark) : pl.uid; cnt.set(m, (cnt.get(m) || 0) + 1); }
      let content = [...cnt].map(([m, c]) => c > 1 ? `${m} ×${c}` : m).join(', ');
      while (content.length > 4 && textW(content, 8) > PW - 40 - cols[5]) content = content.slice(0, -4) + '…';
      const same = (sameAs.get(sh.id) ?? []).length;
      const vals = [String(i + 1), `${sh.w} × ${sh.h}`, `${layoutNo.get(sh.id)}${same > 1 ? ` (×${same})` : ''}`, String(realPls(i).length), `${(utilOf(i) * 100).toFixed(1)}%`, content];
      vals.forEach((v, k) => cur.text(cols[k], y, 8, v, { bold: k === 0 }));
      y -= rowH;
    });
  }

  // ---------- one page per sheet ----------
  layout.sheets.forEach((sh, i) => {
    if (o.onlySheet !== undefined && o.onlySheet !== i) return;
    const same = sameAs.get(sh.id) ?? [];
    // identical sheets: one page only (the first of the group), titled with all their numbers
    if (o.onlySheet === undefined && same.length > 1 && same[0] !== i + 1) return;
    const pg = new Page(); pages.push(pg);
    const title = same.length > 1 ? T`Lámina ${same.join('-')}` : T`Lámina ${i + 1}`;
    const info = T`de ${layout.sheets.length} · ${sh.w} × ${sh.h}" · ${realPls(i).length} piezas · aprovechamiento ${(utilOf(i) * 100).toFixed(1)}%${sh.locked ? T(' · bloqueada') : ''}`;
    let tfs = 18; while (tfs > 9 && textW(title, tfs, true) + 12 + textW(info, 11) > PW - 72 - 150) tfs -= 1;
    pg.text(36, PH - 40, tfs, title, { bold: true });
    pg.text(36 + textW(title, tfs, true) + 12, PH - 40, 11, info, { color: [0.3, 0.3, 0.3] });
    pg.text(PW - 36, PH - 40, 9, `${o.title} · ${date}`, { align: 'r', color: [0.45, 0.45, 0.45] });
    if (same.length > 1) pg.text(36, PH - 58, 12, T`Se repite ${same.length} veces — cortar ${same.length} láminas iguales (acomodo ${layoutNo.get(sh.id)})`, { bold: true, color: [0.75, 0.35, 0.05] });
    // fit the sheet into the drawing area (y up, like the sheet)
    const ax = 36, ay = 58, aw = PW - 72, ah = PH - 58 - 76;
    const k = Math.min(aw / sh.w, ah / sh.h);
    const ox = ax + (aw - sh.w * k) / 2, oy = ay + (ah - sh.h * k) / 2;
    const X = (x: number) => ox + x * k, Y = (y: number) => oy + y * k;
    // sheet + margins
    pg.rgbF([0.97, 0.97, 0.95]).rgbS([0.25, 0.25, 0.25]).lw(1.2).dash().rect(X(0), Y(0), sh.w * k, sh.h * k, 'B');
    const m = s.margins;
    pg.rgbS([0.6, 0.6, 0.6]).lw(0.4).dash([3, 2]).rect(X(m.left), Y(m.bottom), (sh.w - m.left - m.right) * k, (sh.h - m.top - m.bottom) * k, 'S').dash();
    // dimensions
    pg.text(X(sh.w / 2), Y(0) - 14, 9, `${sh.w}"`, { align: 'c', color: [0.4, 0.4, 0.4] });
    pg.ops.push(`q 0 1 -1 0 ${n(X(0) - 8)} ${n(Y(sh.h / 2))} cm`); pg.text(0, 0, 9, `${sh.h}"`, { align: 'c', color: [0.4, 0.4, 0.4] }); pg.ops.push('Q');
    for (const pl of realPls(i)) {
      const p = pm.get(pl.uid);
      const key = !p ? pl.uid : o.colorBy === 'mark' ? p.mark : o.colorBy === 'job' ? p.job : o.colorBy === 'orient' ? (p.A >= p.B ? 'H' : 'V') : p.type;
      pg.rgbF(fillFor(key)).rgbS([0.2, 0.2, 0.25]).lw(0.6).rect(X(pl.x), Y(pl.y), pl.w * k, pl.h * k, 'B');
      const f = o.showFlat !== false ? flats[pl.uid] : undefined;
      const fl = flipOf(pl.uid);
      if (f) {
        const map = (u: number, v0: number): [number, number] => {
          const v = fl ? f.height - v0 : v0;
          const [x, y] = pl.rot === 0 ? [pl.x + u, pl.y + v] : pl.rot === 90 ? [pl.x + f.height - v, pl.y + u] : pl.rot === 180 ? [pl.x + f.width - u, pl.y + f.height - v] : [pl.x + v, pl.y + f.width - u];
          return [X(x), Y(y)];
        };
        const cut: [number, number, number, number][] = [], bend: [number, number, number, number][] = [];
        for (const sg of f.segments) { const a = map(sg.a[0], sg.a[1]), b = map(sg.b[0], sg.b[1]); (sg.kind === 'bend' ? bend : cut).push([a[0], a[1], b[0], b[1]]); }
        pg.rgbS([0.1, 0.1, 0.1]).lw(0.45).path(cut);
        pg.rgbS([0.8, 0.15, 0.15]).lw(0.35).dash([2.5, 1.8]).path(bend).dash();
      }
      // labels
      const label = p?.mark ?? pl.uid;
      const relCode = p?.rel;
      const W = pl.w * k, H = pl.h * k;
      const fs = Math.max(4, Math.min(16, H / 3.2, W / Math.max(3, label.length * 0.7)));
      const cx = X(pl.x + pl.w / 2), cy = Y(pl.y + pl.h / 2);
      pg.text(cx, cy + fs * 0.1, fs, label, { bold: true, align: 'c', color: [0.1, 0.1, 0.15] });
      if (relCode) { const rfs = Math.min(fs * 0.55, W / (relCode.length * 0.7)); if (rfs >= 3) pg.text(cx, cy + fs * 1.05, rfs, relCode, { bold: true, align: 'c', color: [0.25, 0.4, 0.65] }); }
      const sub = `${pl.w.toFixed(2)} × ${pl.h.toFixed(2)}${pl.rot ? ` · ${pl.rot}°` : ''}${fl ? T(' · espejo') : ''}`;
      const sfs = Math.min(fs * 0.55, W / (sub.length * 0.55));
      if (sfs >= 3.2) pg.text(cx, cy - fs * 0.75, sfs, sub, { align: 'c', color: [0.3, 0.3, 0.3] });
      // edge codes on each side
      if (p) {
        const efs = Math.min(fs * 0.55, W / 9, H / 5);
        if (efs >= 3.2) for (const sd of ['T', 'B', 'L', 'R'] as const) {
          const code = p[`edge${sd}` as 'edgeT']; if (!code) continue;
          const d = facing(sd, pl.rot, fl);
          const pad = efs * 0.5;
          if (d === 'top') pg.text(cx, Y(pl.y + pl.h) - efs - pad * 0.4, efs, code, { align: 'c', bold: true, color: [0.75, 0.35, 0.05] });
          else if (d === 'bottom') pg.text(cx, Y(pl.y) + pad, efs, code, { align: 'c', bold: true, color: [0.75, 0.35, 0.05] });
          else if (d === 'left') pg.text(X(pl.x) + pad, cy + fs * 0.9, efs, code, { bold: true, color: [0.75, 0.35, 0.05] });
          else pg.text(X(pl.x + pl.w) - pad, cy + fs * 0.9, efs, code, { align: 'r', bold: true, color: [0.75, 0.35, 0.05] });
        }
      }
    }
    // origin + contents
    pg.rgbF([0.75, 0.35, 0.05]).rect(X(0) - 2, (s.originForExport === 'BL' ? Y(0) : Y(sh.h)) - 2, 4, 4, 'f');
    const cnt = new Map<string, number>(); for (const pl of realPls(i)) { const pp = pm.get(pl.uid); const mk = pp ? (pp.rel ? `${pp.rel} ${pp.mark}` : pp.mark) : pl.uid; cnt.set(mk, (cnt.get(mk) || 0) + 1); }
    let content = T('Contenido: ') + [...cnt].map(([mk, c]) => c > 1 ? `${mk} ×${c}` : mk).join(', ');
    while (content.length > 14 && textW(content, 9) > PW - 72) content = content.slice(0, -4) + '…';
    pg.text(36, 24, 9, content, { color: [0.3, 0.3, 0.3] });
    pg.text(PW - 36, 24, 8, T('Línea continua: corte · roja punteada: doblez · naranja: condición de cada lado'), { align: 'r', color: [0.5, 0.5, 0.5] });
  });
  return buildPdf(pages, o.title);
}
