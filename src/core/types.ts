import type { FlatPattern } from './unfold';

export type Side = 'T' | 'B' | 'L' | 'R';            // panel side as named in the BOM
export type Dir = 'top' | 'bottom' | 'left' | 'right';  // direction on the sheet
export type Rot = 0 | 90 | 180 | 270;                  // CCW rotation of the blank on the sheet

export interface Panel {
  uid: string;              // job|mark
  mark: string;
  job: string;
  release: string;
  qty: number;
  include: boolean;
  type: string;             // FLAT, CORN, FASF, TTFL ...
  depth: string;            // "125", "125-400"
  edgeT: string; edgeB: string; edgeL: string; edgeR: string;
  mtl: string;              // AL, ZI ...
  thk: string;              // gauge code "08"
  A: number; B: number;
  C?: number; X?: number; Y?: number; Z?: number; Z1?: number;
  grain: string; notes: string; options: string;
  material: string; alloy: string; thickness: string; finish: string; finishCode: string;
  bomFile: string; bomSheet: string;
  rel?: string;             // project + release code (e.g. 26100R8) when several releases are loaded
  stepFile?: string;
  blankW: number;           // flat blank along A (sheet X at rot 0)
  blankH: number;
  blankSource: 'step' | 'estimado' | 'manual';
  returns?: Record<Side, number>;
  flip?: boolean;           // mirror set by hand (otherwise the default from Ajustes)
  fixedRot?: Rot;           // rotation set by hand: the optimizer keeps it // depth of the return (flange) strip on each side of the blank, from the face to the cut edge
  extra: Record<string, string | number>;
}

export interface SheetDef {
  id: string;
  name: string;
  w: number;   // along machine X
  h: number;   // along machine Y
  enabled: boolean;
  stock: number | null; // null = unlimited
  material: string;     // '' = any, otherwise matches panel material key
}

export type Anchor = 'TL' | 'TC' | 'TR' | 'ML' | 'MR' | 'BL' | 'BC' | 'BR' | 'T' | 'B' | 'L' | 'R' | 'TH' | 'BH' | 'LH' | 'RH' | 'custom';

export interface ZoneDef {
  anchor: Anchor;
  w: number; h: number;     // for bands T/B only h is used, L/R only w
  x?: number; y?: number;   // custom: from sheet bottom-left
  test: 'intersects' | 'inside' | 'touches'; // how the panel relates to the zone
}

export type Strength = 'hard' | 'soft';

/** Which panel sides an action talks about: by edge code ("02", "04, 08") and/or BOM position. */
export interface EdgeSel { codes: string; sides: Side[] }

export type Action =
  | { type: 'forbidZone'; zone: ZoneDef; strength: Strength; weight: number }
  | { type: 'requireZone'; zone: ZoneDef; strength: Strength; weight: number }
  | { type: 'orientation'; mode: 'A_X' | 'A_Y' | 'long_X' | 'long_Y' | 'free'; strength: Strength; weight: number }
  | { type: 'gap'; value: number }
  | { type: 'priority'; value: number }
  | { type: 'sheets'; ids: string[] }
  | { type: 'separateBy'; field: string }
  | { type: 'maxPerSheet'; value: number }
  | { type: 'exclude' }
  | { type: 'blankAdjust'; dw: number; dh: number }
  | { type: 'edgeFacing'; edge: EdgeSel; dir: Dir; strength: Strength; weight: number }
  | { type: 'edgeNotOnBorder'; edge: EdgeSel; tol: number; strength: Strength; weight: number }
  | { type: 'edgeZone'; edge: EdgeSel; zone: ZoneDef; mode: 'inside' | 'outside'; part?: 'return' | 'edge'; strength: Strength; weight: number }
  | { type: 'edgeClearance'; edge: EdgeSel; mm: number; border: boolean; panels: boolean }   // side at least `mm` from the sheet edge / from facing sides of other panels
  | { type: 'edgeNoCommonLine'; edge: EdgeSel; clearance: number; withCodes?: string } // withCodes empty = with any neighbour
  | { type: 'gravity'; dir: Dir; weight: number };

export type Op = '=' | '!=' | 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'in' | 'notIn' | '>' | '>=' | '<' | '<=' | 'between' | 'empty' | 'notEmpty' | 'regex';

export type Cond =
  | { kind: 'cond'; field: string; op: Op; value: string; value2?: string }
  | { kind: 'group'; mode: 'all' | 'any'; not?: boolean; items: Cond[] }
  | { kind: 'expr'; expr: string };

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  color: string;
  notes?: string;
  appliesTo: 'H' | 'V' | 'both';  // panel orientation the rule is for
  when: Cond & { kind: 'group' };
  actions: Action[];
}

export interface NestSettings {
  gap: number;
  margins: { top: number; bottom: number; left: number; right: number };
  fillFrom: 'BL' | 'TL' | 'BR' | 'TR';
  allowRotate: boolean;
  timeMs: number;
  kFactor: number;
  horizontalWhen: 'A>=B' | 'A>B';
  partitionBy: string[];     // fields that must match to share a sheet
  originForExport: 'BL' | 'TL';
  repeatSheets: boolean;   // repeat identical sheets when quantities allow
  repeatWeight: number;    // 0..100 how much material may be traded for repeatable sheets
  repeatMinUtil: number;   // % minimum utilization for a sheet to be repeated
  rowAlign: number;        // 0..100 preference for rows of equal height
  mirrorDefault?: boolean;  // all panels mirrored about a horizontal line (as Salvagnini shows them)
  kTable?: { deg: number; k: number }[]; // K factor by bend angle (calibration); other angles interpolate, kFactor if empty
  gridWeight?: number;
  gridTol?: number;        // inches of height difference still treated as the same row     // 0..100 preference for grid sheets (rows of equal height)
  reorganize?: boolean;    // after optimizing, re-arrange each sheet for more common lines (default on)
}

export interface Placement {
  iid: string;      // instance id: uid#n
  uid: string;
  x: number; y: number;  // bottom-left of the blank, from sheet bottom-left, inches (y up)
  w: number; h: number;  // as placed (after rotation)
  rot: Rot;
  locked?: boolean;
  trial?: { reason: string; kind?: 'stock' | 'fit' }; // preview placed by hand: always an error, removed when re-optimizing
}

export interface SheetLayout {
  id: string;
  sheetId: string;
  w: number; h: number;
  partition: string;
  placements: Placement[];
  locked?: boolean;        // frozen: kept as is when re-optimizing
}

export interface Layout {
  sheets: SheetLayout[];
  unplaced: { iid: string; uid: string; reason: string; kind?: 'stock' | 'fit' }[];
  stats: { sheets: number; utilization: number; usedArea: number; sheetArea: number; softPenalty: number; iterations: number; ms: number };
}

export interface Violation { iid: string; ruleId: string; ruleName: string; hard: boolean; msg: string; penalty: number }

export interface SheetSize { w: number; h: number }

export interface Project {
  version: 3;
  sheetCatalog: SheetSize[];   // sizes offered in the dropdown
  rules: Rule[];
  sheets: SheetDef[];
  settings: NestSettings;
  edgeAllowances: Record<string, number>; // "125|T|01A" -> inches beyond A/B
  overrides: Record<string, Partial<Pick<Panel, 'qty' | 'include' | 'blankW' | 'blankH' | 'A' | 'B' | 'edgeT' | 'edgeB' | 'edgeL' | 'edgeR' | 'grain' | 'flip' | 'fixedRot'>>>;
}

export type FlatMap = Record<string, FlatPattern>;
