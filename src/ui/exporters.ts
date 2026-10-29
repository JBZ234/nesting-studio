import { T, Tn } from '../i18n';
import type { Layout, Panel, NestSettings, Project } from '../core/types';
import type { FlatPattern } from '../core/unfold';
import { groupIdentical } from '../core/nest';
import { sideAt } from '../core/rules';

const f3 = (n: number) => (+n.toFixed(3)).toString();
const flipOf = (p: Panel | undefined, s: NestSettings) => p?.flip ?? s.mirrorDefault ?? false;
const csvq = (s: string | number) => { const t = String(s); return /[",;\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

/** One row per placed part. Coordinates = lower-left (or upper-left) corner of the blank. */
export function layoutCsv(layout: Layout, panels: Panel[], s: NestSettings): string {
  const pm = new Map(panels.map(p => [p.uid, p]));
  const groups = groupIdentical(layout);
  const layoutNo = new Map<string, number>();
  groups.forEach((g, i) => g.ids.forEach(id => layoutNo.set(id, i + 1)));
  const head = ['Lamina', 'Layout', 'Repeticiones', 'Lamina_W', 'Lamina_H', 'Release', T('Marca'), 'Job', T('Tipo'), 'T', 'B', 'L', 'R', 'A', 'B_dim', 'X', 'Y', T('Ancho'), T('Alto'), 'Rotacion', T('Espejo'), 'Lado_arriba', 'Lado_abajo', T('Desarrollo'), 'Bloqueado'];
  const rows = [head.join(',')];
  layout.sheets.forEach((sh, i) => {
    const g = groups.find(x => x.ids.includes(sh.id));
    for (const pl of [...sh.placements].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const p = pm.get(pl.uid);
      const y = s.originForExport === 'BL' ? pl.y : sh.h - pl.y - pl.h;
      rows.push([i + 1, layoutNo.get(sh.id) ?? '', g?.count ?? 1, sh.w, sh.h, p?.rel ?? p?.release ?? '', p?.mark ?? pl.uid, p?.job ?? '', p?.type ?? '', p?.edgeT ?? '', p?.edgeB ?? '', p?.edgeL ?? '', p?.edgeR ?? '', p?.A ?? '', p?.B ?? '', f3(pl.x), f3(y), f3(pl.w), f3(pl.h), pl.rot, flipOf(p, s) ? 'si' : 'no', p ? p[`edge${sideAt('top', pl.rot, flipOf(p, s))}` as 'edgeT'] : '', p ? p[`edge${sideAt('bottom', pl.rot, flipOf(p, s))}` as 'edgeT'] : '', p?.blankSource ?? '', pl.locked ? 'si' : ''].map(csvq).join(','));
    }
  });
  rows.push('');
  rows.push(T`# Origen de coordenadas: esquina ${s.originForExport === 'BL' ? T('inferior') : T('superior')} izquierda de la lámina, pulgadas. Rotacion antihoraria: 0 = lado T arriba, 90 = T a la izquierda, 180 = T abajo, 270 = T a la derecha. Espejo = el panel se refleja respecto a una línea horizontal (T y B se intercambian) antes de rotar.`);
  return rows.join('\r\n');
}

/** ASCII DXF (R12) with every sheet stacked vertically. Layers: LAMINA, MARGEN, BLANK, CORTE, DOBLEZ, TEXTO. */
export function layoutDxf(layout: Layout, panels: Panel[], flats: Record<string, FlatPattern>, s: NestSettings, onlySheet?: number): string {
  const pm = new Map(panels.map(p => [p.uid, p]));
  const out: string[] = [];
  const w = (...a: (string | number)[]) => { for (const x of a) out.push(String(x)); };
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => w(0, 'LINE', 8, layer, 10, f3(x1), 20, f3(y1), 30, 0, 11, f3(x2), 21, f3(y2), 31, 0);
  const rect = (layer: string, x: number, y: number, ww: number, hh: number) => { line(layer, x, y, x + ww, y); line(layer, x + ww, y, x + ww, y + hh); line(layer, x + ww, y + hh, x, y + hh); line(layer, x, y + hh, x, y); };
  const text = (x: number, y: number, h: number, t: string) => w(0, 'TEXT', 8, 'TEXTO', 10, f3(x), 20, f3(y), 30, 0, 40, f3(h), 1, t.replace(/[\r\n]/g, ' '));
  w(0, 'SECTION', 2, 'HEADER', 9, '$INSUNITS', 70, 1, 0, 'ENDSEC');
  w(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, 6);
  for (const [n, c] of [['LAMINA', 8], ['MARGEN', 9], ['BLANK', 5], ['CORTE', 7], ['DOBLEZ', 1], ['TEXTO', 3]] as const) w(0, 'LAYER', 2, n, 70, 0, 62, c, 6, 'CONTINUOUS');
  w(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  let oy = 0;
  layout.sheets.forEach((sh, i) => {
    if (onlySheet !== undefined && onlySheet !== i) return;
    rect('LAMINA', 0, oy, sh.w, sh.h);
    const m = s.margins;
    rect('MARGEN', m.left, oy + m.bottom, sh.w - m.left - m.right, sh.h - m.top - m.bottom);
    text(0, oy + sh.h + 1, 1.5, `LAMINA ${i + 1}  ${sh.w} x ${sh.h}`);
    for (const pl of sh.placements) {
      const p = pm.get(pl.uid);
      rect('BLANK', pl.x, oy + pl.y, pl.w, pl.h);
      const f = flats[pl.uid];
      if (f) {
        const fl = flipOf(p, s);
        const map = (u: number, v0: number): [number, number] => {
          const v = fl ? f.height - v0 : v0;
          return pl.rot === 0 ? [pl.x + u, oy + pl.y + v]
          : pl.rot === 90 ? [pl.x + f.height - v, oy + pl.y + u]
          : pl.rot === 180 ? [pl.x + f.width - u, oy + pl.y + f.height - v]
          : [pl.x + v, oy + pl.y + f.width - u];
        };
        for (const sg of f.segments) {
          const a = map(sg.a[0], sg.a[1]), b = map(sg.b[0], sg.b[1]);
          line(sg.kind === 'bend' ? 'DOBLEZ' : 'CORTE', a[0], a[1], b[0], b[1]);
        }
      }
      text(pl.x + 0.5, oy + pl.y + pl.h / 2, Math.min(1.2, pl.h / 5), `${p?.rel ? p.rel + ' ' : ''}${p?.mark ?? pl.uid}${pl.rot ? ` R${pl.rot}` : ''}${flipOf(p, s) ? ' E' : ''}`);
    }
    oy += sh.h + 12;
  });
  w(0, 'ENDSEC', 0, 'EOF');
  return out.join('\r\n');
}

export function projectJson(p: Project) { return JSON.stringify(p, null, 2); }
