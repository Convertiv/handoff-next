import { Argv, CommandModule } from 'yargs';
import Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import { SharedArgs } from '@handoff/commands/types';
import { getSharedOptions } from '@handoff/commands/utils';

export interface PrepareRuntimeArgs extends SharedArgs {
  skipComponents?: boolean;
}

const DEPRECATION_MESSAGE = `
[DEPRECATED] prepare-runtime materializes the Next.js app into .handoff/runtime/
for the legacy per-project Vercel deploy model. Under ADR-001 (registry as
service), client projects no longer deploy themselves — the registry runs as
its own deployment of convertiv/handoff-app, and workspaces push content via
\`handoff-app push:all\`. See docs/ADR-001-registry-as-service.md and
docs/REGISTRY-SETUP.md.
This command still works for legacy deployments. It will be removed in a
future major release.
`;

const command: CommandModule<{}, PrepareRuntimeArgs> = {
  command: 'prepare-runtime',
  describe:
    '[DEPRECATED] Materialize the Next.js Handoff app to .handoff/runtime (legacy per-project deploy model)',
  builder: (yargs): Argv<PrepareRuntimeArgs> =>
    getSharedOptions(yargs).option('skip-components', {
      describe: 'Skip building components before preparing the runtime',
      type: 'boolean',
      default: false,
    }) as Argv<PrepareRuntimeArgs>,
  handler: async (args: PrepareRuntimeArgs) => {
    Logger.warn(DEPRECATION_MESSAGE);
    const handoff = new Handoff(args.debug, args.force);
    await handoff.build(args.skipComponents ?? false, 'vercel');
  },
};

export default command;
