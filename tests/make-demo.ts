// Builds src/demo/demo.json from the sample BOM + STEP files (precomputed flats).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { parseBomWorkbook } from '../src/core/bom';
import { unfoldStepText } from '../src/core/unfold';
const dir = process.argv[2] || 'samples';
const boms = readdirSync(dir).filter(f => /\.xlsx?$/i.test(f)).map(f => parseBomWorkbook(readFileSync(`${dir}/${f}`), f));
const r = (n: number) => Math.round(n * 1000) / 1000;
const steps = readdirSync(dir).filter(f => /\.(step|stp)$/i.test(f)).map(f => {
  const flat = unfoldStepText(readFileSync(`${dir}/${f}`, 'utf8'), f);
  flat.segments = flat.segments.map(s => ({ kind: s.kind, a: [r(s.a[0]), r(s.a[1])], b: [r(s.b[0]), r(s.b[1])] })) as any;
  return { file: f, flat };
});
mkdirSync('src/demo', { recursive: true });
writeFileSync('src/demo/demo.json', JSON.stringify({ boms, steps }));
console.log('demo.json', (JSON.stringify({ boms, steps }).length / 1024).toFixed(0), 'KB');
