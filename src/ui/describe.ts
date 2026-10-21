import { T, Tn } from '../i18n';
import type { Cond, Action, ZoneDef, Op, Anchor, EdgeSel, Dir } from '../core/types';
import { FIELDS } from '../core/panels';

export const OPS: { op: Op; label: string; kinds: string[] }[] = [
  { op: '=', label: T('es igual a'), kinds: ['text', 'edge', 'number', 'bool'] },
  { op: '!=', label: T('no es'), kinds: ['text', 'edge', 'number', 'bool'] },
  { op: 'startsWith', label: T('empieza con'), kinds: ['text', 'edge'] },
  { op: 'endsWith', label: T('termina en'), kinds: ['text', 'edge'] },
  { op: 'contains', label: T('contiene'), kinds: ['text', 'edge'] },
  { op: 'notContains', label: T('no contiene'), kinds: ['text', 'edge'] },
  { op: 'in', label: T('está en la lista'), kinds: ['text', 'edge', 'number'] },
  { op: 'notIn', label: T('no está en la lista'), kinds: ['text', 'edge', 'number'] },
  { op: '>', label: T('mayor que'), kinds: ['number'] },
  { op: '>=', label: T('mayor o igual a'), kinds: ['number'] },
  { op: '<', label: T('menor que'), kinds: ['number'] },
  { op: '<=', label: T('menor o igual a'), kinds: ['number'] },
  { op: 'between', label: T('entre'), kinds: ['number'] },
  { op: 'empty', label: T('está vacío'), kinds: ['text', 'edge', 'number'] },
  { op: 'notEmpty', label: T('tiene valor'), kinds: ['text', 'edge', 'number'] },
  { op: 'regex', label: T('coincide con regex'), kinds: ['text', 'edge'] },
];

export const ANCHORS: { a: Anchor; label: string }[] = [
  { a: 'TL', label: T('Esquina superior izquierda') }, { a: 'TC', label: T('Arriba al centro') }, { a: 'TR', label: T('Esquina superior derecha') },
  { a: 'ML', label: T('Centro izquierda') }, { a: 'MR', label: T('Centro derecha') },
  { a: 'BL', label: T('Esquina inferior izquierda') }, { a: 'BC', label: T('Abajo al centro') }, { a: 'BR', label: T('Esquina inferior derecha') },
  { a: 'TH', label: T('Mitad superior') }, { a: 'BH', label: T('Mitad inferior') }, { a: 'LH', label: T('Mitad izquierda') }, { a: 'RH', label: T('Mitad derecha') },
  { a: 'T', label: T('Franja superior') }, { a: 'B', label: T('Franja inferior') }, { a: 'L', label: T('Franja izquierda') }, { a: 'R', label: T('Franja derecha') },
  { a: 'custom', label: T('Rectángulo personalizado') },
];

export const ACTION_TYPES: { type: Action['type']; label: string; help: string; group: string }[] = [
  { type: 'edgeFacing', label: T('Lado hacia una dirección'), help: T('Gira el panel para que un lado (p. ej. 04) quede arriba, abajo, izquierda o derecha.'), group: T('Lados del panel') },
  { type: 'edgeNotOnBorder', label: T('Lado no puede ir en el borde'), help: T('Ese lado no puede quedar contra el filo de la lámina.'), group: T('Lados del panel') },
  { type: 'edgeZone', label: T('Retorno de un lado dentro / fuera de una zona'), help: T('La franja del retorno con ese código (del doblez al corte) tiene que quedar (o no) en la zona. El resto del panel sí puede pasar.'), group: T('Lados del panel') },
  { type: 'edgeClearance', label: T('Lado separado X mm'), help: T('Ese lado queda al menos a X mm del borde de la lámina y de los lados de otros paneles que tenga enfrente (caras paralelas).'), group: T('Lados del panel') },
  { type: 'edgeNoCommonLine', label: T('Lado sin common line'), help: T('Ese lado no comparte línea de corte con ciertos lados del panel vecino (o con ninguno): se deja separación.'), group: T('Lados del panel') },
  { type: 'gravity', label: T('Pegar hacia un borde'), help: T('El panel busca quedar pegado arriba, abajo, izquierda o derecha.'), group: T('Ubicación') },
  { type: 'forbidZone', label: T('Prohibir zona de la lámina'), help: T('Ninguna parte del panel puede tocar esta zona.'), group: T('Ubicación') },
  { type: 'requireZone', label: T('Obligar / preferir zona'), help: T('El panel debe quedar en (o tocar) esta zona.'), group: T('Ubicación') },
  { type: 'orientation', label: T('Orientación en la lámina'), help: T('Controla si A va a lo largo de X o de Y.'), group: T('Orientación') },
  { type: 'gap', label: T('Separación extra'), help: T('Holgura adicional alrededor del panel.'), group: T('Ubicación') },
  { type: 'priority', label: T('Prioridad de colocación'), help: T('Mayor prioridad se coloca primero.'), group: T('Orden') },
  { type: 'sheets', label: T('Limitar tamaños de lámina'), help: T('Sólo se puede anidar en estos tamaños.'), group: T('Láminas') },
  { type: 'separateBy', label: T('Separar láminas por campo'), help: T('Paneles con distinto valor no comparten lámina.'), group: T('Láminas') },
  { type: 'maxPerSheet', label: T('Máximo por lámina'), help: T('Límite de piezas de esta regla en una misma lámina.'), group: T('Láminas') },
  { type: 'blankAdjust', label: T('Ajustar desarrollo'), help: T('Suma/resta al ancho/alto del blank.'), group: T('Pieza') },
  { type: 'exclude', label: T('Excluir del nesting'), help: T('No se anida.'), group: T('Pieza') },
];

const fl = (k: string) => FIELDS.find(f => f.key === k)?.label ?? k;
const opl = (o: Op) => OPS.find(x => x.op === o)?.label ?? o;
const fmt = (n: number) => `${+n.toFixed(3)}"`;

export function describeCond(c: Cond, top = true): string {
  if (c.kind === 'expr') return T`expresión: ${c.expr}`;
  if (c.kind === 'cond') {
    if (c.op === 'empty' || c.op === 'notEmpty') return `${fl(c.field)} ${opl(c.op)}`;
    if (c.op === 'between') return T`${fl(c.field)} entre ${c.value} y ${c.value2 ?? '?'}`;
    return `${fl(c.field)} ${opl(c.op)} ${c.value}`;
  }
  if (!c.items.length) return top ? T('Todos los paneles') : T('(vacío)');
  const j = c.mode === 'all' ? ' y ' : ' o ';
  const s = c.items.map(i => describeCond(i, false)).join(j);
  const w = top ? s : `(${s})`;
  return c.not ? `NO ${w}` : w;
}

export function describeZone(z: ZoneDef) {
  const a = ANCHORS.find(x => x.a === z.anchor)?.label.toLowerCase() ?? z.anchor;
  if (['TH', 'BH', 'LH', 'RH'].includes(z.anchor)) return T`la ${a}`;
  const size = z.anchor === 'T' || z.anchor === 'B' ? fmt(z.h) : z.anchor === 'L' || z.anchor === 'R' ? fmt(z.w) : `${fmt(z.w)}×${fmt(z.h)}`;
  return `${a} (${size}${z.anchor === 'custom' ? T` en ${fmt(z.x ?? 0)},${fmt(z.y ?? 0)}` : ''})`;
}

export const DIRS: { d: Dir; label: string; short: string }[] = [
  { d: 'top', label: T('hacia arriba'), short: T('Arriba') }, { d: 'bottom', label: T('hacia abajo'), short: T('Abajo') },
  { d: 'left', label: T('hacia la izquierda'), short: T('Izquierda') }, { d: 'right', label: T('hacia la derecha'), short: T('Derecha') },
];
const dirl = (d: Dir) => DIRS.find(x => x.d === d)!.label;
export function describeEdge(e: EdgeSel) {
  const codes = e.codes.split(/[,;| ]+/).filter(Boolean);
  const c = codes.length ? (codes.length > 1 ? T`los lados ${codes.slice(0, -1).join(', ')} y ${codes[codes.length - 1]}` : T`el lado ${codes[0]}`) : T('cualquier lado');
  const pos = e.sides?.length && e.sides.length < 4 ? T` (sólo ${e.sides.map(s => ({ T: T('superior'), B: T('inferior'), L: T('izquierdo'), R: T('derecho') })[s]).join('/')} del BOM)` : '';
  return c + pos;
}

export function describeAction(a: Action): string {
  const st = (s: 'hard' | 'soft', w: number) => s === 'hard' ? '' : T` · preferencia (peso ${w})`;
  switch (a.type) {
    case 'forbidZone': return T`No puede ir en ${describeZone(a.zone)}${st(a.strength, a.weight)}`;
    case 'requireZone': return `${a.zone.test === 'inside' ? T('Debe quedar dentro de') : T('Debe tocar')} ${describeZone(a.zone)}${st(a.strength, a.weight)}`;
    case 'orientation': return ({ A_X: T('A a lo largo de X'), A_Y: T('A a lo largo de Y'), long_X: T('Lado largo en X'), long_Y: T('Lado largo en Y'), free: T('Rotación libre') }[a.mode]) + st(a.strength, a.weight);
    case 'gap': return T`Separación extra ${fmt(a.value)}`;
    case 'priority': return T`Prioridad ${a.value > 0 ? '+' : ''}${a.value}`;
    case 'sheets': return T`Sólo láminas: ${a.ids.join(', ') || T('(ninguna)')}`;
    case 'separateBy': return T`Lámina exclusiva por ${fl(a.field)}`;
    case 'maxPerSheet': return T`Máximo ${a.value} por lámina`;
    case 'exclude': return T('Excluir del nesting');
    case 'blankAdjust': return T`Desarrollo ${a.dw >= 0 ? '+' : ''}${a.dw}" × ${a.dh >= 0 ? '+' : ''}${a.dh}"`;
    case 'edgeFacing': return `${cap(describeEdge(a.edge))} va ${dirl(a.dir)}${st(a.strength, a.weight)}`;
    case 'edgeNotOnBorder': return T`${cap(describeEdge(a.edge))} no puede quedar en el borde de la lámina (a menos de ${fmt(a.tol)})${st(a.strength, a.weight)}`;
    case 'edgeZone': return T`El retorno ${describeEdge(a.edge).replace(/^el /, T('del ')).replace(/^los /, T('de los ')).replace(/^cualquier/, T('de cualquier'))} ${a.mode === 'inside' ? T('debe quedar en') : T('no puede entrar en')} ${describeZone(a.zone)}${st(a.strength, a.weight)}`;
    case 'edgeNoCommonLine': return (a.withCodes ?? '').trim()
      ? T`${cap(describeEdge(a.edge))} sin common line con lados ${a.withCodes} de otro panel (separación ${fmt(a.clearance)})`
      : T`${cap(describeEdge(a.edge))} sin common line (separación ${fmt(a.clearance)})`;
    case 'edgeClearance': return T`${cap(describeEdge(a.edge))} a ${a.mm} mm como mínimo ${[a.border && T('del borde de la lámina'), a.panels && T('de los lados de otros paneles que tenga enfrente')].filter(Boolean).join(' y ') || T('(no aplica: marca borde o paneles)')}`;
    case 'gravity': return T`Pegado ${dirl(a.dir)} (fuerza ${a.weight})`;
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
