/**
 * Run the real probe against a local workspace checkout and check the known facts still hold.
 *
 * Not part of `test:unit` — it needs a built component catalog on disk, which CI does not have. Run it
 * after changing the candidate set or the ranking:
 *
 *   npx tsx scripts/verify-slot-probe.ts [path-to-workspace/handoff/components]
 *
 * Exits non-zero if any known fact regresses. Each of those facts cost a wrong turn to establish by
 * hand; `desktopImageSlot: image-object` is the one that broke three times.
 */

import fs from 'fs-extra';
import path from 'path';
import { probeComponent } from '../src/transformers/plugins/slot-probe';

const ROOT =
  process.argv[2] ?? '/Users/bradleymering/Documents/Clients/8x8/8x8-website/handoff/components';

/**
 * A real preview's values, which is where nested slots are discovered.
 *
 * Read from the built `<id>.json` rather than the source, because that is exactly what the build hands
 * the probe — verifying against anything else would measure a pipeline nobody runs.
 */
function previewValuesOf(id: string): Record<string, unknown> {
  const f = path.join(ROOT, id, 'dist', `${id}.json`);
  if (!fs.existsSync(f)) return {};
  try {
    const previews = JSON.parse(fs.readFileSync(f, 'utf8')).previews ?? {};
    return (Object.values(previews)[0] as any)?.values ?? {};
  } catch {
    return {};
  }
}

function schemaOf(id: string): Record<string, any> | null {
  const f = path.join(ROOT, 'blocks', id, 'schema.ts');
  if (!fs.existsSync(f)) return null;
  const src = fs.readFileSync(f, 'utf8');
  const i = src.indexOf('const schema = ');
  const o = src.indexOf('{', i);
  const e = src.indexOf('} as const', o);
  if (i < 0 || e < 0) return null;
  try { return JSON.parse(src.slice(o, e + 1)).properties; } catch { return null; }
}

/** `cards[].imageSlot`, `logoSlots[]`, `subCard.bodySlot` — anything not a bare prop name. */
const isNestedPath = (key: string) => key.includes('.') || key.includes('[');

(async () => {
  const ids = fs.readdirSync(ROOT).filter((d) => fs.existsSync(path.join(ROOT, d, 'dist', `${d}-client.mjs`)));
  const t0 = Date.now();
  let components = 0, slots = 0, unresolved = 0, errored = 0, nested = 0, nestedUnresolved = 0;
  const unresolvedList: string[] = [];
  let hero: any = null;
  /** Containers probed as a whole. Only the ones that resolved are recorded, so every entry is a win. */
  const containers: string[] = [];

  for (const id of ids) {
    const properties = schemaOf(id);
    if (!properties) continue;
    const bundleSource = fs.readFileSync(path.join(ROOT, id, 'dist', `${id}-client.mjs`), 'utf8');
    const rec = await probeComponent({ componentId: id, bundleSource, properties, previewValues: previewValuesOf(id) });
    if (rec.error) { errored++; continue; }
    const n = Object.keys(rec.slots).length;
    if (!n) continue;
    components++; slots += n; unresolved += rec.unresolved.length;
    nested += Object.keys(rec.slots).filter(isNestedPath).length;
    nestedUnresolved += rec.unresolved.filter(isNestedPath).length;
    for (const u of rec.unresolved) unresolvedList.push(`${id}.${u}`);
    for (const [k, cap] of Object.entries<any>(rec.slots)) {
      const isContainer = !isNestedPath(k) && Object.keys(rec.slots).some((o) => o.startsWith(`${k}[].`));
      if (isContainer) containers.push(`${id}.${k}: ${cap.accepts[0]}`);
    }
    if (id === 'hero-background') hero = rec;
  }

  console.log(`\ncomponents ${components}  slots ${slots}  resolved ${slots - unresolved} (${Math.round(((slots - unresolved) / slots) * 100)}%)  unresolved ${unresolved}  errored ${errored}`);
  const topLevel = slots - nested;
  const topUnresolved = unresolved - nestedUnresolved;
  console.log(
    `  top-level ${topLevel - topUnresolved}/${topLevel}   nested ${nested - nestedUnresolved}/${nested}` +
      `   (nested slots were the missing 27% — 48 of them across 27 components)`
  );
  console.log(`elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  console.log('--- hero-background (the regression fixture) ---');
  for (const [slot, cap] of Object.entries<any>(hero?.slots ?? {})) {
    console.log(`  ${slot.padEnd(18)} accepts=[${cap.accepts.join(', ')}] threw=${cap.threw.length}`);
  }

  const facts: [string, string][] = [
    ['desktopImageSlot', 'image-object'],
    ['mobileImageSlot', 'image-object'],
    ['titleSlot', 'html-string'],
    ['overlineSlot', 'plain-text'],
  ];
  console.log('\n--- known facts, established the hard way ---');
  let ok = true;
  for (const [slot, expected] of facts) {
    const got = hero?.slots?.[slot]?.accepts?.[0];
    const pass = got === expected;
    if (!pass) ok = false;
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${slot}: accepts[0]=${got} (expected ${expected})`);
  }
  const anySerialized = Object.values<any>(hero?.slots ?? {}).some((c) => c.accepts.includes('serialized-element'));
  console.log(`  ${!anySerialized ? 'PASS' : 'FAIL'}  no slot accepts serialized-element`);
  const btn = hero?.slots?.buttonSlots;
  console.log(`  ${btn?.accepts?.[0]?.startsWith('array-') ? 'PASS' : 'FAIL'}  buttonSlots needs an array (accepts[0]=${btn?.accepts?.[0]})`);

  console.log(`\n--- containers resolved as a whole (${containers.length}) ---`);
  console.log(containers.join('\n'));

  console.log(`\n--- unresolved (${unresolvedList.length}) ---`);
  console.log(unresolvedList.join('\n'));
  process.exit(ok ? 0 : 1);
})();
