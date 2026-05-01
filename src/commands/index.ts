import buildAppCommand from './build/app.js';
import buildComponentsCommand from './build/components.js';
import devCommand from './dev/index.js';
import ejectConfigCommand from './eject/config.js';
import ejectPagesCommand from './eject/pages.js';
import ejectThemeCommand from './eject/theme.js';
import fetchCommand from './fetch/index.js';
import initCommand from './init/index.js';
import makeComponentCommand from './make/component.js';
import makePageCommand from './make/page.js';
import makeTemplateCommand from './make/template.js';
import prepareRuntimeCommand from './prepare-runtime.js';
import pullCommand from './pull.js';
import pushCommand from './push.js';
import scaffoldCommand from './scaffold/index.js';
import startCommand from './start/index.js';
import syncStatusCommand from './sync-status.js';
import validateComponentsCommand from './validate/components.js';

export const commands = [
  buildAppCommand,
  buildComponentsCommand,
  prepareRuntimeCommand,
  devCommand,
  ejectConfigCommand,
  ejectPagesCommand,
  ejectThemeCommand,
  fetchCommand,
  initCommand,
  makePageCommand,
  makeComponentCommand,
  makeTemplateCommand,
  pullCommand,
  pushCommand,
  scaffoldCommand,
  startCommand,
  syncStatusCommand,
  validateComponentsCommand,
];
