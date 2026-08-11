/**
 * Apply the content-length plan to a workspace's component contracts.
 *
 * ```
 * npm run contracts:lengths -- --workspace ~/path/to/client/handoff              # dry run
 * npm run contracts:lengths -- --workspace ~/path/to/client/handoff --write
 * npm run contracts:lengths -- --workspace … --component blog_header --write     # scoped
 * ```
 *
 * `lib/content-length-plan.ts` decides *what* each limit should become; this does the editing. It exists as a
 * committed script rather than a throwaway because the job recurs: SS&C's beta registry was done on 2026-08-11 and
 * the live design system is expected to need the same pass (see "Porting the length + validation work" in
 * `docs/WORKBENCH-PLAYGROUND-ROADMAP.md`). Rewriting it would mean rediscovering the two things below the hard way.
 *
 * ---
 *
 * **Why it edits spans instead of re-serializing.** The obvious implementation — `require()` the contract, mutate,
 * `JSON.stringify` it back — is wrong twice over:
 *
 * 1. **The files are hand-formatted.** SS&C's preview arrays hold compacted one-line objects
 *    (`{ "href": "/blog/tag/trends", "text": "Trends" }`), which a re-serialize explodes across three lines.
 *    Measured: 81 of 83 files reflowed, burying a 342-field change in thousands of lines of noise.
 * 2. **They are JavaScript, not JSON.** `bar_chart.js` writes its description as a **template literal**, so a JSON
 *    scanner cannot even read the document, let alone locate spans in it.
 *
 * So: parse as real JS, replace only each `rules` object, leave every other byte untouched.
 *
 * **Why the TypeScript compiler API rather than acorn.** The original pass used acorn, which resolves in this repo
 * only *transitively* — it is not a declared dependency, so a future install could hoist it differently and break a
 * committed script. `typescript` is a devDependency and cannot go missing in a repo that builds with `tsc`. It gives
 * the same thing this needs: exact `getStart`/`getEnd` offsets over JS.
 *
 * **Two guards, because a wrong span silently corrupts a client's contract.** Each candidate span must `JSON.parse`
 * back to the rules object the plan was computed from — a mismatch skips that field rather than guessing — and the
 * rewritten file must re-parse with no syntax diagnostics before it is written. Nothing is written unless `--write`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import {
  contentLengthPlan,
  summarizePlan,
  IN_ROW_OVERRIDE,
  ROLE_LIMITS,
  type PlanAction,
  type PlanEntry,
} from '../src/app/lib/content-length-plan';

const require_ = createRequire(import.meta.url);

interface Args {
  workspace: string;
  write: boolean;
  components: string[];
  report: string;
  title: string;
  note: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { workspace: '', write: false, components: [], report: '', title: '', note: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--workspace') out.workspace = argv[++i] ?? '';
    else if (a === '--component') out.components.push(argv[++i] ?? '');
    else if (a === '--report') out.report = argv[++i] ?? '';
    else if (a === '--title') out.title = argv[++i] ?? '';
    else if (a === '--note') out.note = argv[++i] ?? '';
  }
  return out;
}

/**
 * Contract files, discovered the way the CLI does it.
 *
 * `handoff.config.js` `entries.components` is a **list of directories**, not an id map — a detail that cost a
 * confused round trip the first time (`Component "0" is not in handoff.config entries.components`). Each directory
 * holds one folder per component, and the declaration is `<folder>/<folder>.js`.
 */
function discoverContracts(workspace: string): { id: string; file: string }[] {
  let dirs: string[] = ['./integration/components', './integration/data', './integration/atoms'];
  try {
    const config = require_(path.join(workspace, 'handoff.config.js')) as {
      entries?: { components?: unknown };
    };
    const configured = config?.entries?.components;
    if (Array.isArray(configured) && configured.length) dirs = configured.map(String);
  } catch {
    console.warn('No readable handoff.config.js — falling back to integration/{components,data,atoms}.');
  }

  const out: { id: string; file: string }[] = [];
  for (const dir of dirs) {
    const base = path.resolve(workspace, dir);
    if (!fs.existsSync(base)) continue;
    for (const folder of fs.readdirSync(base)) {
      const file = path.join(base, folder, `${folder}.js`);
      if (!fs.existsSync(file)) continue;
      const mod = require_(file) as { id?: string };
      out.push({ id: mod.id ?? folder, file });
    }
  }
  return out;
}

/** A plan path (`items.*.paragraph`) → the path it occupies in the contract object. */
function planPathToObjectPath(planPath: string): string[] {
  const segs = planPath.split('.');
  const out = ['properties'];
  segs.forEach((seg, idx) => {
    if (seg === '*') {
      // The array's item schema, then that schema's own properties.
      out.push('items', 'properties');
      return;
    }
    if (idx > 0 && segs[idx - 1] !== '*') out.push('properties');
    out.push(seg);
  });
  return out;
}

function propertyName(prop: ts.ObjectLiteralElementLike): string | null {
  const name = prop.name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/** The `module.exports = { … }` right-hand side. */
function exportedObject(source: ts.SourceFile): ts.ObjectLiteralExpression | null {
  for (const stmt of source.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const expr = stmt.expression;
    if (
      ts.isBinaryExpression(expr) &&
      expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isObjectLiteralExpression(expr.right)
    ) {
      return expr.right;
    }
  }
  return null;
}

/** Walk an object literal down a path of keys, returning the value node. */
function nodeAt(root: ts.ObjectLiteralExpression, keys: string[]): ts.Node | null {
  let node: ts.Node = root;
  for (const key of keys) {
    if (!ts.isObjectLiteralExpression(node)) return null;
    const prop = node.properties.find((p) => ts.isPropertyAssignment(p) && propertyName(p) === key);
    if (!prop || !ts.isPropertyAssignment(prop)) return null;
    node = prop.initializer;
  }
  return node;
}

/** Indent a `JSON.stringify(x, null, 2)` block so it sits where the original object sat. */
function reindent(json: string, col: number): string {
  const pad = ' '.repeat(Math.max(col, 0));
  return json
    .split('\n')
    .map((line, idx) => (idx === 0 ? line : pad + line))
    .join('\n');
}

/** Only a positive integer counts as a limit — matching `limitsOf` in the plan module. */
const norm = (n: unknown): number | undefined => (Number.isInteger(n) && (n as number) > 0 ? (n as number) : undefined);

/** Every property node in a contract, ruled or not — the denominator for "N of M fields carry a limit". */
function countProperties(properties: unknown): number {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return 0;
  let n = 0;
  for (const raw of Object.values(properties as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const prop = raw as Record<string, unknown>;
    n += 1;
    n += countProperties(prop.properties);
    n += countProperties((prop.items as Record<string, unknown> | undefined)?.properties);
  }
  return n;
}

const ACTION_MEANING: Record<PlanAction, string> = {
  'remove-rule': 'a length rule on a reference — URL, icon, composite type, or config',
  'not-a-length': 'a row count or a numeric range, not a length — left exactly as authored',
  'raise-max': 'cap sits below the role floor, or below what the component already ships',
  'drop-min': 'cap is fine; the minimum is not',
  'lower-max': 'cap is several times its role floor — nominal rather than real',
  keep: 'already sensible',
  'no-basis': 'no role matched and no sample exists — left for a human',
};

const ACTION_ORDER: PlanAction[] = [
  'remove-rule',
  'not-a-length',
  'raise-max',
  'drop-min',
  'lower-max',
  'keep',
  'no-basis',
];

/**
 * The per-field record, as markdown.
 *
 * **Written from the same plan that was applied**, which is the point of it living here rather than in a second
 * script: the first version of this read a separately-generated `plan.json`, the two drifted the moment a field was
 * revised by hand, and the published document had to be repaired to stop it describing something that never shipped.
 *
 * The role-floor table is **derived from `ROLE_LIMITS`**, not typed out. The hand-written version went stale the same
 * day, when three roles were added and the table still listed the old set.
 */
function renderReport(
  entries: PlanEntry[],
  opts: { title: string; workspace: string; contracts: number; totalFields: number; applied: boolean; note: string }
): string {
  const out: string[] = [];
  const w = (line = '') => out.push(line);
  const summary = summarizePlan(entries);
  const byAction = new Map<PlanAction, number>();
  for (const e of entries) byAction.set(e.action, (byAction.get(e.action) ?? 0) + 1);

  w(`# ${opts.title}`);
  w();
  // No absolute path in the header: this document gets committed, and the run's `--workspace` is a machine path
  // that would bake somebody's home directory into it. Provenance belongs in `--note`, where it can be accurate.
  w(`_Generated ${new Date().toISOString().slice(0, 10)} by \`scripts/apply-content-length-plan.ts\``);
  w('(plan: `src/app/lib/content-length-plan.ts`).' +
    (opts.applied ? ' **Applied to the workspace it was run against.**' : ' Proposal only — nothing written.'));
  w('Re-run:_');
  w();
  w('```');
  w(`npm run contracts:lengths -- --workspace <handoff dir>${opts.applied ? ' --write' : ''} --report <path>`);
  w('```');
  w();
  w(`**${opts.contracts} components · ${opts.totalFields} fields · ${entries.length} declare a length rule.**`);
  w();
  if (opts.note) {
    // For the case a fixture run cannot know: regenerating the record of a change that already shipped.
    w(`> ${opts.note}`);
    w();
  }
  w('## Summary');
  w();
  w('| action | fields | meaning |');
  w('|---|---:|---|');
  for (const action of ACTION_ORDER) w(`| \`${action}\` | ${byAction.get(action) ?? 0} | ${ACTION_MEANING[action]} |`);
  w();
  w(`- **${summary.withMin} of ${entries.length} fields carry a \`min\`.** It is never proposed on a length rule; the`);
  w('  survivors are row counts and numeric ranges, where a minimum is a real constraint.');
  w(`- **${summary.selfContradicting} caps reject the component's own preview value.** Not judgement calls — the`);
  w('  contract and the data disagree and the data is what renders.');
  w(`- **${summary.markupCounted} caps sit on richtext**, where the character count includes markup rather than copy.`);
  w();
  w('## Role floors');
  w();
  w('Derived from `ROLE_LIMITS` in `content-length-plan.ts` — edit there and re-run to revise.');
  w();
  w('| cap | roles | inside a repeater row |');
  w('|---:|---|---:|');
  const byLimit = new Map<number, string[]>();
  for (const [role, limit] of Object.entries(ROLE_LIMITS)) {
    byLimit.set(limit, [...(byLimit.get(limit) ?? []), role]);
  }
  for (const limit of [...byLimit.keys()].sort((a, b) => a - b)) {
    const roles = (byLimit.get(limit) ?? []).sort();
    const inRow = [...new Set(roles.map((r) => IN_ROW_OVERRIDE[r] ?? limit))];
    w(`| ${limit} | ${roles.map((r) => `\`${r}\``).join(' · ')} | ${inRow.sort((a, b) => a - b).join(' / ')} |`);
  }
  w();
  w('A proposal is never below `observed × 1.2` where the component already ships longer content, so applying it');
  w('cannot reject copy that renders today.');
  w();

  const contradicting = entries
    .filter((e) => e.observed !== null && e.current.max !== undefined && e.observed > e.current.max)
    .sort((a, b) => b.observed! - b.current.max! - (a.observed! - a.current.max!));
  w("## Caps the component's own content already exceeds");
  w();
  if (contradicting.length === 0) {
    w('None — every cap clears the longest value its component ships. (Expected after a successful pass; this section');
    w('is computed from the contracts as they stand, so it empties once the plan is applied.)');
  } else {
    w('| field | cap | its own value |');
    w('|---|---:|---:|');
    for (const e of contradicting) {
      w(`| \`${e.componentId}.${e.path}\` | ${e.current.max} | **${e.observed}** |`);
    }
  }
  w();
  w('## Every field, by component');
  w();
  w('`—` in **proposed** means the rule is removed entirely. `min` is never proposed on a length rule.');
  w();
  const byComponent = new Map<string, PlanEntry[]>();
  for (const e of entries) byComponent.set(e.componentId, [...(byComponent.get(e.componentId) ?? []), e]);
  for (const id of [...byComponent.keys()].sort()) {
    const rows = byComponent.get(id) ?? [];
    w(`### \`${id}\` — ${rows.length} ruled fields`);
    w();
    w('| field | type | now | proposed | action | why |');
    w('|---|---|---|---|---|---|');
    for (const e of rows) {
      const now =
        [
          e.current.min !== undefined ? `min ${e.current.min}` : null,
          e.current.max !== undefined ? `max ${e.current.max}` : null,
        ]
          .filter(Boolean)
          .join(', ') || '—';
      const proposed = e.proposed.max !== undefined ? `max ${e.proposed.max}` : '—';
      w(`| \`${e.path}\` | ${e.type} | ${now} | ${proposed} | \`${e.action}\` | ${e.reason} |`);
    }
    w();
  }
  return out.join('\n');
}

function syntaxErrors(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  // `parseDiagnostics` is internal but is the only way to see that a re-parse failed — `createSourceFile` never throws.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.workspace) {
    console.error('Usage: tsx scripts/apply-content-length-plan.ts --workspace <handoff dir> [--write] [--component id]');
    process.exit(1);
  }
  const workspace = path.resolve(args.workspace.replace(/^~/, process.env.HOME ?? '~'));
  if (!fs.existsSync(workspace)) {
    console.error(`Workspace not found: ${workspace}`);
    process.exit(1);
  }

  const contracts = discoverContracts(workspace).filter(
    (c) => !args.components.length || args.components.includes(c.id)
  );
  if (!contracts.length) {
    console.error('No component contracts found. Expected <dir>/<folder>/<folder>.js under entries.components.');
    process.exit(1);
  }

  const stats = {
    components: 0,
    filesEdited: 0,
    fieldsEdited: 0,
    contentRemoved: 0,
    minDropped: 0,
    maxChanged: 0,
    notALengthUntouched: 0,
  };
  const problems: string[] = [];
  const wholePlan: PlanEntry[] = [];
  let totalFields = 0;

  for (const { id, file } of contracts) {
    const mod = require_(file) as { properties?: unknown; previews?: unknown };
    const entries = contentLengthPlan({ componentId: id, properties: mod.properties, previews: mod.previews });
    totalFields += countProperties(mod.properties);
    wholePlan.push(...entries);
    if (!entries.length) continue;
    stats.components += 1;

    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const root = exportedObject(source);
    if (!root) {
      problems.push(`${id}: no \`module.exports = { … }\` found — this script only edits that shape`);
      continue;
    }

    /** [start, end, replacement], applied right-to-left so earlier offsets stay valid. */
    const edits: [number, number, string][] = [];

    for (const entry of entries) {
      // A row count or a numeric range: not this exercise's business, so not a byte of it is touched.
      if (entry.action === 'not-a-length') {
        stats.notALengthUntouched += 1;
        continue;
      }

      const objectPath = [...planPathToObjectPath(entry.path), 'rules'];
      const node = nodeAt(root, objectPath);
      if (!node) {
        problems.push(`${id}.${entry.path}: no node at ${objectPath.join('.')}`);
        continue;
      }

      const start = node.getStart(source);
      const end = node.getEnd();
      let current: Record<string, unknown>;
      try {
        current = JSON.parse(text.slice(start, end)) as Record<string, unknown>;
      } catch {
        problems.push(`${id}.${entry.path}: rules block is not plain JSON — left for a human`);
        continue;
      }

      const content = (current.content ?? {}) as Record<string, unknown>;
      const currentMax = norm(content.max ?? current.maxLength);
      const currentMin = norm(content.min);
      if ((entry.current.max ?? undefined) !== currentMax || (entry.current.min ?? undefined) !== currentMin) {
        problems.push(
          `${id}.${entry.path}: file has {min:${currentMin}, max:${currentMax}}, plan assumed {min:${entry.current.min}, max:${entry.current.max}}`
        );
        continue;
      }

      const next = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
      // `content` is canonical; the legacy flat alias goes with it.
      delete next.maxLength;

      const max = entry.action === 'remove-rule' ? undefined : entry.proposed.max;
      if (max === undefined) {
        delete next.content;
        stats.contentRemoved += 1;
      } else {
        if (currentMin !== undefined) stats.minDropped += 1;
        if (max !== currentMax) stats.maxChanged += 1;
        // The minimum never survives, so the cap is the only content rule left.
        next.content = { max };
      }

      if (JSON.stringify(next) === JSON.stringify(current)) continue;

      const lineStart = text.lastIndexOf('\n', start) + 1;
      edits.push([start, end, reindent(JSON.stringify(next, null, 2), start - lineStart - '"rules": '.length)]);
      stats.fieldsEdited += 1;
    }

    if (!edits.length) continue;
    edits.sort((a, b) => b[0] - a[0]);
    let out = text;
    for (const [from, to, replacement] of edits) out = out.slice(0, from) + replacement + out.slice(to);

    const errors = syntaxErrors(file, out);
    if (errors.length) {
      problems.push(`${id}: rewritten file does not parse — ${errors[0]}`);
      continue;
    }

    stats.filesEdited += 1;
    if (args.write) fs.writeFileSync(file, out);
  }

  console.log(`${args.write ? 'WROTE' : 'DRY RUN'} — workspace ${workspace}`);
  console.log(`contracts scanned: ${contracts.length}`);
  console.log(JSON.stringify(stats, null, 1));
  console.log('\nplan across all contracts:');
  console.log(JSON.stringify(summarizePlan(wholePlan), null, 1));
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
    if (problems.length > 40) console.log(`  … ${problems.length - 40} more`);
  } else {
    console.log('\nno problems');
  }
  /**
   * The report describes the change, so it is rendered from the plan computed **before** any edit — which is also
   * why it is emitted last: by now `--write` has either applied that exact plan or not, and the document says which.
   */
  if (args.report) {
    const md = renderReport(wholePlan, {
      title: args.title || 'Content-length survey and proposed rationalization',
      workspace,
      contracts: contracts.length,
      totalFields,
      applied: args.write,
      note: args.note,
    });
    fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
    fs.writeFileSync(path.resolve(args.report), `${md}\n`);
    console.log(`\nreport written: ${path.resolve(args.report)} (${wholePlan.length} rows)`);
  }

  if (!args.write) console.log('\nNothing written. Re-run with --write to apply.');
}

main();
