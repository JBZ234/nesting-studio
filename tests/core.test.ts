import { readFileSync, readdirSync } from 'fs';
import { parseBomWorkbook } from '../src/core/bom';
import { unfoldStepText } from '../src/core/unfold';
import { buildPanels, calibrateAllowances } from '../src/core/panels';
import { defaultProject } from '../src/core/defaults';
import { nest, groupIdentical, buildItems } from '../src/core/nest';
import { validateLayout } from '../src/core/rules';

const dir = 'samples';
const boms = readdirSync(dir).filter(f => /\.xlsx?$/i.test(f)).map(f => parseBomWorkbook(readFileSync(`${dir}/${f}`), f));
for (const b of boms) console.log('BOM', b.file, b.header.job, b.header.material, b.header.thickness, 'panels', b.panels.length, 'qty', b.panels.reduce((a, p) => a + p.qty, 0), 'count', b.header.panelCount, b.warnings);
const steps = readdirSync(dir).filter(f => /\.(step|stp)$/i.test(f)).map(f => ({ file: f, flat: unfoldStepText(readFileSync(`${dir}/${f}`, 'utf8'), f) }));
const proj = defaultProject();
proj.settings.timeMs = +(process.env.T || 1500);
const { panels, flats, warnings } = buildPanels(boms, steps, proj);
console.log('warnings', warnings);
console.log('allowances', calibrateAllowances(panels, flats));
for (const p of panels.filter(p => p.stepFile)) console.log('STEP panel', p.mark, p.type, p.A, p.B, '->', p.blankW, p.blankH);
// estimated vs step for step panels (leave-one-out-ish check)
let assert = (c: boolean, m: string) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } };
for (const job of [...new Set(panels.map(p => p.job))]) {
  const ps = panels.filter(p => p.job === job);
  const { cons } = buildItems({ panels: ps, rules: proj.rules, sheets: proj.sheets, settings: proj.settings });
  const lay = nest({ panels: ps, rules: proj.rules, sheets: proj.sheets, settings: proj.settings });
  const v = validateLayout(lay, new Map(ps.map(p => [p.uid, p])), cons, proj.settings, proj.sheets);
  const hard = [...v.values()].flat().filter(x => x.hard);
  const placed = lay.sheets.reduce((a, s) => a + s.placements.length, 0);
  const qty = ps.filter(p => !cons.get(p.uid)?.exclude).reduce((a, p) => a + p.qty, 0);
  console.log(`JOB ${job}: qty ${qty} placed ${placed} unplaced ${lay.unplaced.length} sheets ${lay.stats.sheets} (${groupIdentical(lay).length} únicas) util ${(lay.stats.utilization * 100).toFixed(1)}% iters ${lay.stats.iterations} ${lay.stats.ms}ms hardViol ${hard.length}`, lay.unplaced.map(u => u.uid.split('|')[1] + ': ' + u.reason));
  assert(placed + lay.unplaced.length === qty, 'count mismatch ' + job);
  assert(hard.length === 0, 'hard violations ' + JSON.stringify(hard.slice(0, 3)));
}
