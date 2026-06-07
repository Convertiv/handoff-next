import type { Argv, CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import type { Validator, ValidatorResult } from '@handoff/types/validation';
import type { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface ValidateArgs extends SharedArgs {
  component?: string;
  validators?: string;
  json?: boolean;
  ci?: boolean;
  update?: boolean;
}

const command: CommandModule<{}, ValidateArgs> = {
  command: 'validate [component]',
  describe:
    'Run the configured component validators (axe, schema, contrast, custom). Without [component], validates all components.',
  builder: (yargs): Argv<ValidateArgs> =>
    getSharedOptions(yargs)
      .positional('component', {
        type: 'string',
        describe: 'Validate a single component by id (default: all components in config)',
      })
      .option('validators', {
        type: 'string',
        describe: 'Comma-separated list of validator IDs to run (default: all configured)',
      })
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Print results as JSON to stdout (suppresses human-readable output)',
      })
      .option('ci', {
        type: 'boolean',
        default: false,
        describe: 'Exit non-zero per config.validation.failOn (error | warning | never)',
      })
      .option('update', {
        type: 'boolean',
        default: false,
        describe: 'Write results to components/<id>/dist/<id>.json (silently update stored results)',
      }) as Argv<ValidateArgs>,
  handler: async (args: ValidateArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();

    const validationCfg = (handoff.config as { validation?: { validators?: unknown[]; failOn?: string } })?.validation;
    const configuredValidators = (Array.isArray(validationCfg?.validators) ? validationCfg.validators : []) as Validator[];

    if (configuredValidators.length === 0) {
      Logger.warn('No validators configured in handoff.config.js. See docs/ADR-002-validation-framework.md.');
      return;
    }

    // Filter by --validators if provided
    const onlyIds = args.validators?.split(',').map((s) => s.trim()).filter(Boolean);
    const activeValidators = onlyIds?.length
      ? configuredValidators.filter((v) => onlyIds.includes(v.id))
      : configuredValidators;

    if (activeValidators.length === 0) {
      Logger.warn(`No validators matched --validators=${args.validators}`);
      return;
    }

    // Determine which components to validate
    const runtimeComponents = handoff.runtimeConfig?.entries?.components ?? {};
    const allIds = Object.keys(runtimeComponents);
    const targetIds = args.component ? [args.component] : allIds;
    if (args.component && !runtimeComponents[args.component]) {
      Logger.error(`Component "${args.component}" not found in config.entries.components.`);
      process.exitCode = 1;
      return;
    }

    const { runValidators } = await import('@handoff/transformers/validation/runner');
    const { readComponentApi, writeComponentApi } = await import('@handoff/transformers/preview/component/api');

    type PerComponent = { id: string; results: ValidatorResult[] };
    const allResults: PerComponent[] = [];

    for (const id of targetIds) {
      const data = await readComponentApi(handoff, id);
      if (!data) {
        Logger.warn(`Skipping "${id}": no built component data (run \`handoff-app build:components ${id}\` first).`);
        continue;
      }
      const results = await runValidators(handoff, data, activeValidators);
      allResults.push({ id, results });

      if (args.update) {
        data.validationResults = results;
        await writeComponentApi(id, data, handoff, []);
      }
    }

    if (args.json) {
      process.stdout.write(JSON.stringify(allResults, null, 2) + '\n');
    } else {
      printHumanReadable(allResults);
    }

    if (args.ci) {
      const failOn = (validationCfg?.failOn ?? 'error') as 'error' | 'warning' | 'never';
      const exitCode = computeCiExitCode(allResults, failOn);
      if (exitCode !== 0) {
        Logger.error(`Validation failed CI gate (failOn=${failOn}).`);
      }
      process.exitCode = exitCode;
    }
  },
};

function printHumanReadable(perComponent: { id: string; results: ValidatorResult[] }[]): void {
  if (perComponent.length === 0) {
    Logger.info('No components to validate.');
    return;
  }
  let totalError = 0;
  let totalWarning = 0;
  let totalInfo = 0;
  for (const { id, results } of perComponent) {
    const summary = results
      .map((r) => {
        const icon =
          r.status === 'skipped' ? '○' : r.severity === 'pass' ? '✓' : r.severity === 'error' ? '✗' : r.severity === 'warning' ? '!' : '·';
        return `${icon} ${r.validatorId}`;
      })
      .join('  ');
    Logger.info(`${id.padEnd(40)} ${summary}`);
    for (const r of results) {
      for (const f of r.findings) {
        if (f.severity === 'error') totalError++;
        else if (f.severity === 'warning') totalWarning++;
        else totalInfo++;
        const tgt = f.target ? ` [${f.target}]` : '';
        Logger.log(`  ${f.severity.toUpperCase().padEnd(7)} ${f.ruleId}: ${f.message}${tgt}`);
      }
    }
  }
  Logger.log('');
  Logger.info(`Totals: ${totalError} error, ${totalWarning} warning, ${totalInfo} info`);
}

function computeCiExitCode(
  perComponent: { id: string; results: ValidatorResult[] }[],
  failOn: 'error' | 'warning' | 'never'
): number {
  if (failOn === 'never') return 0;
  for (const { results } of perComponent) {
    for (const r of results) {
      if (r.severity === 'error') return 1;
      if (failOn === 'warning' && r.severity === 'warning') return 1;
    }
  }
  return 0;
}

export default command;
