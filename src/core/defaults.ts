import type { Project, Rule, SheetDef, NestSettings, SheetSize, Action } from './types';
import { normalizeRule } from './rules';

export const uid = (p = 'r') => `${p}${Math.random().toString(36).slice(2, 9)}`;

/** Sizes offered in the dropdown, written "H × W" like the shop does (48 × 120 = 48" tall, 120" long). */
export const DEFAULT_CATALOG: SheetSize[] = [
  { h: 48, w: 78 }, { h: 48, w: 96 }, { h: 48, w: 105 }, { h: 48, w: 120 }, { h: 48, w: 130 },
  { h: 60, w: 96 }, { h: 60, w: 105 }, { h: 60, w: 120 }, { h: 60, w: 130 },
];

export const sheetId = (s: SheetSize) => `sh${s.h}x${s.w}`;
export const sheetName = (s: SheetSize) => `${s.h} × ${s.w}`;
export const makeSheet = (s: SheetSize, stock: number | null = null): SheetDef => ({ id: sheetId(s), name: sheetName(s), w: s.w, h: s.h, enabled: true, stock, material: '' });

export const DEFAULT_SHEETS: SheetDef[] = [makeSheet({ h: 60, w: 120 }), makeSheet({ h: 48, w: 120 })];

export const DEFAULT_SETTINGS: NestSettings = {
  gap: 0,                                                   // 0 = common line between panels
  margins: { top: 2, bottom: 0.3, left: 0.3, right: 0.3 },
  fillFrom: 'BL',
  allowRotate: true,
  timeMs: 3000,
  kFactor: 0.4,
  horizontalWhen: 'A>=B',
  partitionBy: ['job', 'mtl', 'thk'],
  originForExport: 'BL',
  repeatSheets: true,
  repeatWeight: 30,
  repeatMinUtil: 70,
  rowAlign: 60,
  gridWeight: 60,
  gridTol: 0.1,
  mirrorDefault: true,
  kTable: [{ deg: 90, k: 0.30 }, { deg: 135, k: 0.47 }, { deg: 180, k: 0.40 }],
};

export const RULE_COLORS = ['#e4572e', '#2e86ab', '#a23b72', '#f18f01', '#3bb273', '#7768ae', '#c73e1d', '#1b998b'];

const all = (): Rule['when'] => ({ kind: 'group', mode: 'all', items: [] });
const edge = (codes: string, sides: ('T' | 'B' | 'L' | 'R')[] = []) => ({ codes, sides });

/** The shop's own rules (the 7 rules given by the programmer). */
export const DEFAULT_RULES: Rule[] = [
  {
    id: 'r_02_border', name: 'Los lados 02 no van en los bordes de la lámina', enabled: true, color: RULE_COLORS[0],
    notes: 'Un lado 02 no puede quedar contra ningún borde de la lámina. “En el borde” = a menos de la distancia indicada del filo.',
    appliesTo: 'both', when: all(), actions: [{ type: 'edgeNotOnBorder', edge: edge('02'), tol: 3, strength: 'hard', weight: 10 }],
  },
  {
    id: 'r_v_04_down', name: 'Verticales: la condición 04 hacia abajo', enabled: true, color: RULE_COLORS[1],
    appliesTo: 'V', when: all(), actions: [{ type: 'edgeFacing', edge: edge('04'), dir: 'bottom', strength: 'hard', weight: 10 }],
  },
  {
    id: 'r_v_04_half', name: 'Verticales: ningún lateral 04 pasa de la mitad hacia arriba', enabled: true, color: RULE_COLORS[2],
    notes: 'Lateral = lados L y R del BOM. El lado 04 tiene que quedar completo en la mitad inferior de la lámina.',
    appliesTo: 'V', when: all(), actions: [{ type: 'edgeZone', edge: edge('04', ['L', 'R']), zone: { anchor: 'BH', w: 0, h: 0, test: 'inside' }, mode: 'inside', strength: 'hard', weight: 10 }],
  },
  {
    id: 'r_common_line', name: 'Common line, excepto lados 04 y 08', enabled: true, color: RULE_COLORS[3],
    notes: 'Los paneles van pegados compartiendo la línea de corte. Los lados 04 y 08 no pueden compartirla: se les deja separación.',
    appliesTo: 'both', when: all(), actions: [{ type: 'edgeNoCommonLine', edge: edge('04, 08'), clearance: 0.5 }],
  },
  {
    id: 'r_h_top', name: 'Horizontales pegados arriba', enabled: true, color: RULE_COLORS[4],
    appliesTo: 'H', when: all(), actions: [{ type: 'gravity', dir: 'top', weight: 60 }],
  },
  {
    id: 'r_v_bottom', name: 'Verticales pegados abajo', enabled: true, color: RULE_COLORS[5],
    appliesTo: 'V', when: all(), actions: [{ type: 'gravity', dir: 'bottom', weight: 60 }],
  },
  {
    id: 'r_h_01_up', name: 'Horizontales: la condición 01 hacia arriba', enabled: true, color: RULE_COLORS[6],
    appliesTo: 'H', when: all(), actions: [{ type: 'edgeFacing', edge: edge('01'), dir: 'top', strength: 'hard', weight: 10 }],
  },
];

/** Rules added in version 3 (also appended to saved projects). */
export const V3_RULES: Rule[] = [
  {
    id: 'r_only_flat', name: 'Sólo se anidan paneles FLAT', enabled: true, color: RULE_COLORS[7],
    notes: 'Las demás tipologías (CORN, FASF, TTFL, TRFL…) quedan fuera del nesting. Cambia la condición si alguna sí debe entrar.',
    appliesTo: 'both', when: { kind: 'group', mode: 'all', items: [{ kind: 'cond', field: 'type', op: '!=', value: 'FLAT' }] }, actions: [{ type: 'exclude' }],
  },
  {
    id: 'r_no_mix_hv', name: 'No mezclar horizontales y verticales en una lámina', enabled: true, color: RULE_COLORS[0],
    appliesTo: 'both', when: all(), actions: [{ type: 'separateBy', field: 'orientation' }],
  },
  {
    id: 'r_v_lying', name: 'Verticales se ubican acostados (B a lo largo de la lámina)', enabled: true, color: RULE_COLORS[1],
    notes: 'Aunque el panel sea vertical (B > A), en la lámina va acostado: la medida B a lo largo de X y la A en Y.',
    appliesTo: 'V', when: all(), actions: [{ type: 'orientation', mode: 'A_Y', strength: 'hard', weight: 10 }],
  },
  {
    id: 'r_01_right', name: 'Las 01 hacia la derecha (preferencia)', enabled: true, color: RULE_COLORS[2],
    notes: 'Preferencia: se cumple cuando no choca con una regla obligatoria.',
    appliesTo: 'both', when: all(), actions: [{ type: 'edgeFacing', edge: edge('01'), dir: 'right', strength: 'soft', weight: 30 }],
  },
];
DEFAULT_RULES.push(...V3_RULES);

/** Ready-made rule shapes offered in “Nueva desde plantilla”. */
export const RULE_TEMPLATES: { label: string; make: () => Omit<Rule, 'id' | 'color'> }[] = [
  ...DEFAULT_RULES.map(r => ({ label: r.name, make: () => { const { id, color, ...rest } = structuredClone(r); void id; void color; return rest; } })),
  { label: 'Un código de lado hacia una dirección', make: () => ({ name: 'Lado XX hacia arriba', enabled: true, appliesTo: 'both' as const, when: all(), actions: [{ type: 'edgeFacing', edge: edge(''), dir: 'top', strength: 'hard', weight: 10 } as Action] }) },
  { label: 'Zona prohibida para un tipo de panel', make: () => ({ name: 'Zona prohibida', enabled: true, appliesTo: 'both' as const, when: all(), actions: [{ type: 'forbidZone', zone: { anchor: 'TL', w: 30, h: 24, test: 'intersects' }, strength: 'hard', weight: 10 } as Action] }) },
];

export function defaultProject(): Project {
  return {
    version: 3,
    sheetCatalog: structuredClone(DEFAULT_CATALOG),
    rules: structuredClone(DEFAULT_RULES),
    sheets: structuredClone(DEFAULT_SHEETS),
    settings: structuredClone(DEFAULT_SETTINGS),
    edgeAllowances: {},
    overrides: {},
  };
}

const OLD_EXAMPLE_RULES = ['r_edge04_tl', 'r_horizontal', 'r_vertical', 'r_grain', 'r_type_sep', 'r_big_first'];

/** Upgrade a saved v1 project: drop the old example rules, add the shop rules, new sheet model and margins. */
export function migrateProject(saved: any): Project {
  const base = defaultProject();
  if (!saved) return base;
  if (saved.version === 2 || saved.version === 3) {
    let rules: Rule[] = (saved.rules || []).map(normalizeRule);
    if (saved.version === 2) rules = [...rules, ...structuredClone(V3_RULES).filter(r => !rules.some(x => x.id === r.id))];
    return { ...base, ...saved, version: 3, rules, sheetCatalog: saved.sheetCatalog?.length ? saved.sheetCatalog : base.sheetCatalog, settings: { ...base.settings, ...saved.settings, margins: { ...base.settings.margins, ...(saved.settings?.margins || {}) } } };
  }
  const custom: Rule[] = (saved.rules || []).filter((r: Rule) => !OLD_EXAMPLE_RULES.includes(r.id));
  return {
    ...base,
    rules: [...base.rules, ...custom.map(normalizeRule)],
    edgeAllowances: saved.edgeAllowances || {},
    overrides: saved.overrides || {},
    settings: { ...base.settings, kFactor: saved.settings?.kFactor ?? base.settings.kFactor, timeMs: Math.max(base.settings.timeMs, saved.settings?.timeMs ?? 0), partitionBy: saved.settings?.partitionBy ?? base.settings.partitionBy },
  };
}
