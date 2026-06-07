import auditFigmaComponentsCommand from './audit/figma-components.js';
import buildAppCommand from './build/app.js';
import buildComponentsCommand from './build/components.js';
import devCommand from './dev/index.js';
import ejectConfigCommand from './eject/config.js';
import ejectPagesCommand from './eject/pages.js';
import ejectThemeCommand from './eject/theme.js';
import fetchCommand from './fetch/index.js';
import initCommand from './init/index.js';
import initVercelCommand from './init/vercel.js';
import makeComponentCommand from './make/component.js';
import makePageCommand from './make/page.js';
import makeTemplateCommand from './make/template.js';
import prepareRuntimeCommand from './prepare-runtime.js';
import vercelBuildCommand from './vercel-build.js';
import loginCommand from './login.js';
import logoutCommand from './logout.js';
import pullCommand from './pull.js';
import pushCommand from './push.js';
import pushAllCommand from './push-all.js';
import scaffoldCommand from './scaffold/index.js';
import startCommand from './start/index.js';
import syncStatusCommand from './sync-status.js';
import validateComponentsCommand from './validate/components.js';
import validateCommand from './validate.js';

export const commands = [
  auditFigmaComponentsCommand,
  buildAppCommand,
  buildComponentsCommand,
  prepareRuntimeCommand,
  vercelBuildCommand,
  devCommand,
  ejectConfigCommand,
  ejectPagesCommand,
  ejectThemeCommand,
  fetchCommand,
  initCommand,
  initVercelCommand,
  makePageCommand,
  makeComponentCommand,
  makeTemplateCommand,
  loginCommand,
  logoutCommand,
  pullCommand,
  pushCommand,
  pushAllCommand,
  scaffoldCommand,
  startCommand,
  syncStatusCommand,
  validateComponentsCommand,
  validateCommand,
];
