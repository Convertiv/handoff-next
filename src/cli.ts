#! /usr/bin/env node

import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';
import { commands } from './commands/index.js';

// Generated at build time by scripts/write-build-meta.mjs.
// Falls back gracefully if someone runs ts-node directly before a build.
let BUILD_VERSION = '2.0.0-alpha';
try {
  const meta = await import('./generated/build-meta.js');
  BUILD_VERSION = meta.BUILD_VERSION;
} catch {
  // pre-build or direct ts-node invocation — use the base version
}

class HandoffCliError extends Error {
  exitCode: number;
  messageOnly: boolean;
  constructor(message?: string) {
    // 'Error' breaks prototype chain here
    super(message);
    this.exitCode = 1;
    this.messageOnly = false;
  }
}

/**
 * Show the version string stamped at build time.
 */
const showVersion = () => {
  return `handoff-app ${BUILD_VERSION}`;
};

/**
 * Define a CLI error
 * @param msg
 * @param exitCode
 */
const cliError = function (msg: string, exitCode = 1) {
  const err = new HandoffCliError(msg);
  err.messageOnly = true;
  err.exitCode = exitCode;
  throw err;
};

const run = () => {
  try {
    const yargsInstance = yargs(hideBin(process.argv));

    commands.forEach((command) => {
      yargsInstance.command(command);
    });

    yargsInstance.help().version(showVersion()).strict().parse();
  } catch (e: any) {
    if (e.message.indexOf('Unknown or unexpected option') === -1) throw e;
    return cliError(e.message, 2);
  }
};

run();
