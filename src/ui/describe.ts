import type { Cond, Action, ZoneDef, Op, Anchor, EdgeSel, Dir } from '../core/types';
import { FIELDS } from '../core/panels';

export const OPS: { op: Op; label: string; kinds: string[] }[] = [
  { op: '=', label: 'es igual a', kinds: ['text', 'edge', 'number', 'bool'] },
  { op: '!=', label: 'no es', kinds: ['text', 'edge', 'number', 'bool'] },
  { op: 'startsWith', label: 'empieza con', kinds: ['text', 'edge'] },
  { op: 'endsWith', label: 'termina en', kinds: ['text', 'edge'] },
  { op: 'contains', label: 'contiene', kinds: ['text', 'edge'] },
  { op: 'notContains', label: 'no contiene', kinds: ['text', 'edge'] },
  { op: 'in', label: 'está en la lista', kinds: ['text', 'edge', 'number'] },
  { op: 'notIn', label: 'no está en la lista', kinds: ['text', 'edge', 'number'] },
  { op: '>', label: 'mayor que', kinds: ['number'] },
  { op: '>=', label: 'mayor o igual a', kinds: ['number'] },
  { op: '<', label: 'menor que', kinds: ['number'] },
  { op: '<=', label: 'menor o igual a', kinds: ['number'] },
  { op: 'between', label: 'entre', kinds: ['number'] },
  { op: 'empty', label: 'está vacío', kinds: ['text', 'edge', 'number'] },
  { op: 'notEmpty', label: 'tiene valor', kinds: ['text', 'edge', 'number'] },
  { op: 'regex', label: 'coincide con regex', kinds: ['text', 'edge'] },
];

export const ANCHORS: { a: Anchor; label: string }[] = [
  { a: 'TL', label: 'Esquina superior izquierda' }, { a: 'TC', label: 'Arriba al centro' }, { a: 'TR', label: 'Esquina superior derecha' },
  { a: 'ML', label: 'Centro izquierda' }, { a: 'MR', label: 'Centro derecha' },
  { a: 'BL', label: 'Esquina inferior izquierda' }, { a: 'BC', label: 'Abajo al centro' }, { a: 'BR', label: 'Esquina inferior derecha' },
  { a: 'TH', label: 'Mitad superior' }, { a: 'BH', label: 'Mitad inferior' }, { a: 'LH', label: 'Mitad izquierda' }, { a: 'RH', label: 'Mitad derecha' },
  { a: 'T', label: 'Franja superior' }, { a: 'B', label: 'Franja inferior' }, { a: 'L', label: 'Franja izquierda' }, { a: 'R', label: 'Franja derecha' },
  { a: 'custom', label: 'Rectángulo personalizado' },
];

export const ACTION_TYPES: { type: Action['type']; label: string; help: string; group: string }[] = [
  { type: 'edgeFacing', label: 'Lado hacia una dirección', help: 'Gira el panel para que un lado (p. ej. 04) quede arriba, abajo, izquierda o derecha.', group: 'Lados del panel' },
  { type: 'edgeNotOnBorder', label: 'Lado no puede ir en el borde', help: 'Ese lado no puede quedar contra el filo de la lámina.', group: 'Lados del panel' },
  { type: 'edgeZone', label: 'Retorno de un lado dentro / fuera de una zona', help: 'La franja del retorno con ese código (del doblez al corte) tiene que quedar (o no) en la zona. El resto del panel sí puede pasar.', group: 'Lados del panel' },
  { type: 'edgeClearance', label: 'Lado separado X mm', help: 'Ese lado queda al menos a X mm del borde de la lámina y de los lados de otros paneles que tenga enfrente (caras paralelas).', group: 'Lados del panel' },
  { type: 'edgeNoCommonLine', label: 'Lado sin common line', help: 'Ese lado no comparte línea de corte con ciertos lados del panel vecino (o con ninguno): se deja separación.', group: 'Lados del panel' },
  { type: 'gravity', label: 'Pegar hacia un borde', help: 'El panel busca quedar pegado arriba, abajo, izquierda o derecha.', group: 'Ubicación' },
  { type: 'forbidZone', label: 'Prohibir zona de la lámina', help: 'Ninguna parte del panel puede tocar esta zona.', group: 'Ubicación' },
  { type: 'requireZone', label: 'Obligar / preferir zona', help: 'El panel debe quedar en (o tocar) esta zona.', group: 'Ubicación' },
  { type: 'orientation', label: 'Orientación en la lámina', help: 'Controla si A va a lo largo de X o de Y.', group: 'Orientación' },
  { type: 'gap', label: 'Separación extra', help: 'Holgura adicional alrededor del panel.', group: 'Ubicación' },
  { type: 'priority', label: 'Prioridad de colocación', help: 'Mayor prioridad se coloca primero.', group: 'Orden' },
  { type: 'sheets', label: 'Limitar tamaños de lámina', help: 'Sólo se puede anidar en estos tamaños.', group: 'Láminas' },
  { type: 'separateBy', label: 'Separar láminas por campo', help: 'Paneles con distinto valor no comparten lámina.', group: 'Láminas' },
  { type: 'maxPerSheet', label: 'Máximo por lámina', help: 'Límite de piezas de esta regla en una misma lámina.', group: 'Láminas' },
  { type: 'blankAdjust', label: 'Ajustar desarrollo', help: 'Suma/resta al ancho/alto del blank.', group: 'Pieza' },
  { type: 'exclude', label: 'Excluir del nesting', help: 'No se anida.', group: 'Pieza' },
];

const fl = (k: string) => FIELDS.find(f => f.key === k)?.label ?? k;
const opl = (o: Op) => OPS.find(x => x.op === o)?.label ?? o;
const fmt = (n: number) => `${+n.toFixed(3)}"`;

export function describeCond(c: Cond, top = true): string {
  if (c.kind === 'expr') return `expresión: ${c.expr}`;
  if (c.kind === 'cond') {
    if (c.op === 'empty' || c.op === 'notEmpty') return `${fl(c.field)} ${opl(c.op)}`;
    if (c.op === 'between') return `${fl(c.field)} entre ${c.value} y ${c.value2 ?? '?'}`;
    return `${fl(c.field)} ${opl(c.op)} ${c.value}`;
  }
  if (!c.items.length) return top ? 'Todos los paneles' : '(vacío)';
  const j = c.mode === 'all' ? ' y ' : ' o ';
  const s = c.items.map(i => describeCond(i, false)).join(j);
  const w = top ? s : `(${s})`;
  return c.not ? `NO ${w}` : w;
}

export function describeZone(z: ZoneDef) {
  const a = ANCHORS.find(x => x.a === z.anchor)?.label.toLowerCase() ?? z.anchor;
  if (['TH', 'BH', 'LH', 'RH'].includes(z.anchor)) return `la ${a}`;
  const size = z.anchor === 'T' || z.anchor === 'B' ? fmt(z.h) : z.anchor === 'L' || z.anchor === 'R' ? fmt(z.w) : `${fmt(z.w)}×${fmt(z.h)}`;
  return `${a} (${size}${z.anchor === 'custom' ? ` en ${fmt(z.x ?? 0)},${fmt(z.y ?? 0)}` : ''})`;
}

export const DIRS: { d: Dir; label: string; short: string }[] = [
  { d: 'top', label: 'hacia arriba', short: 'Arriba' }, { d: 'bottom', label: 'hacia abajo', short: 'Abajo' },
  { d: 'left', label: 'hacia la izquierda', short: 'Izquierda' }, { d: 'right', label: 'hacia la derecha', short: 'Derecha' },
];
const dirl = (d: Dir) => DIRS.find(x => x.d === d)!.label;
export function describeEdge(e: EdgeSel) {
  const codes = e.codes.split(/[,;| ]+/).filter(Boolean);
  const c = codes.length ? (codes.length > 1 ? `los lados ${codes.slice(0, -1).join(', ')} y ${codes[codes.length - 1]}` : `el lado ${codes[0]}`) : 'cualquier lado';
  const pos = e.sides?.length && e.sides.length < 4 ? ` (sólo ${e.sides.map(s => ({ T: 'superior', B: 'inferior', L: 'izquierdo', R: 'derecho' })[s]).join('/')} del BOM)` : '';
  return c + pos;
}

export function describeAction(a: Action): string {
  const st = (s: 'hard' | 'soft', w: number) => s === 'hard' ? '' : ` · preferencia (peso ${w})`;
  switch (a.type) {
    case 'forbidZone': return `No puede ir en ${describeZone(a.zone)}${st(a.strength, a.weight)}`;
    case 'requireZone': return `${a.zone.test === 'inside' ? 'Debe quedar dentro de' : 'Debe tocar'} ${describeZone(a.zone)}${st(a.strength, a.weight)}`;
    case 'orientation': return ({ A_X: 'A a lo largo de X', A_Y: 'A a lo largo de Y', long_X: 'Lado largo en X', long_Y: 'Lado largo en Y', free: 'Rotación libre' }[a.mode]) + st(a.strength, a.weight);
    case 'gap': return `Separación extra ${fmt(a.value)}`;
    case 'priority': return `Prioridad ${a.value > 0 ? '+' : ''}${a.value}`;
    case 'sheets': return `Sólo láminas: ${a.ids.join(', ') || '(ninguna)'}`;
    case 'separateBy': return `Lámina exclusiva por ${fl(a.field)}`;
    case 'maxPerSheet': return `Máximo ${a.value} por lámina`;
    case 'exclude': return 'Excluir del nesting';
    case 'blankAdjust': return `Desarrollo ${a.dw >= 0 ? '+' : ''}${a.dw}" × ${a.dh >= 0 ? '+' : ''}${a.dh}"`;
    case 'edgeFacing': return `${cap(describeEdge(a.edge))} va ${dirl(a.dir)}${st(a.strength, a.weight)}`;
    case 'edgeNotOnBorder': return `${cap(describeEdge(a.edge))} no puede quedar en el borde de la lámina (a menos de ${fmt(a.tol)})${st(a.strength, a.weight)}`;
    case 'edgeZone': return `El retorno ${describeEdge(a.edge).replace(/^el /, 'del ').replace(/^los /, 'de los ').replace(/^cualquier/, 'de cualquier')} ${a.mode === 'inside' ? 'debe quedar en' : 'no puede entrar en'} ${describeZone(a.zone)}${st(a.strength, a.weight)}`;
    case 'edgeNoCommonLine': return (a.withCodes ?? '').trim()
      ? `${cap(describeEdge(a.edge))} sin common line con lados ${a.withCodes} de otro panel (separación ${fmt(a.clearance)})`
      : `${cap(describeEdge(a.edge))} sin common line (separación ${fmt(a.clearance)})`;
    case 'edgeClearance': return `${cap(describeEdge(a.edge))} a ${a.mm} mm como mínimo ${[a.border && 'del borde de la lámina', a.panels && 'de los lados de otros paneles que tenga enfrente'].filter(Boolean).join(' y ') || '(no aplica: marca borde o paneles)'}`;
    case 'gravity': return `Pegado ${dirl(a.dir)} (fuerza ${a.weight})`;
  }
}
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function newAction(type: Action['type']): Action {
  switch (type) {
    case 'forbidZone': return { type, zone: { anchor: 'TL', w: 30, h: 24, test: 'intersects' }, strength: 'hard', weight: 10 };
    case 'requireZone': return { type, zone: { anchor: 'B', w: 30, h: 24, test: 'intersects' }, strength: 'hard', weight: 10 };
    case 'orientation': return { type, mode: 'A_X', strength: 'hard', weight: 10 };
    case 'gap': return { type, value: 0.25 };
    case 'priority': return { type, value: 10 };
    case 'sheets': return { type, ids: [] };
    case 'separateBy': return { type, field: 'type' };
    case 'maxPerSheet': return { type, value: 2 };
    case 'exclude': return { type };
    case 'blankAdjust': return { type, dw: 0, dh: 0 };
    case 'edgeFacing': return { type, edge: { codes: '', sides: [] }, dir: 'top', strength: 'hard', weight: 10 };
    case 'edgeNotOnBorder': return { type, edge: { codes: '', sides: [] }, tol: 3, strength: 'hard', weight: 10 };
    case 'edgeZone': return { type, edge: { codes: '', sides: [] }, zone: { anchor: 'BH', w: 0, h: 0, test: 'inside' }, mode: 'inside', strength: 'hard', weight: 10 };
    case 'edgeNoCommonLine': return { type, edge: { codes: '', sides: [] }, clearance: 0.5 };
    case 'edgeClearance': return { type, edge: { codes: '', sides: [] }, mm: 10, border: true, panels: true };
    case 'gravity': return { type, dir: 'bottom', weight: 60 };
  }
}
