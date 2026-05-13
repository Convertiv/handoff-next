import { CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { runFigmaComponentAudit } from '@handoff/cli/figma-audit';
import { SharedArgs } from '../types.js';
import { getSharedOptions } from '../utils.js';

export interface AuditFigmaComponentsArgs extends SharedArgs {
  json?: boolean;
  failOnDrift?: boolean;
}

const command: CommandModule<{}, AuditFigmaComponentsArgs> = {
  command: 'audit:figma-components',
  describe: 'Compare fetched Figma components against local Handoff components and report drift',
  builder: (yargs) =>
    getSharedOptions(yargs)
      .option('json', {
        type: 'boolean',
        default: false,
        describe: 'Print the full audit report as JSON.',
      })
      .option('fail-on-drift', {
        type: 'boolean',
        default: false,
        describe: 'Exit with an error when unlinked or missing components are detected.',
      }),
  handler: async (args: AuditFigmaComponentsArgs) => {
    const handoff = new Handoff(args.debug, args.force);
    handoff.preRunner();
    await runFigmaComponentAudit(handoff, {
      json: Boolean(args.json),
      failOnDrift: Boolean(args.failOnDrift),
    });
  },
};

export default command;
