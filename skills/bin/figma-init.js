#!/usr/bin/env node
/**
 * figma-init — scaffold a new project for the handoff-figma pipeline.
 *
 * Run from the root of a handoff project:
 *   npx figma-init
 *
 * Creates:
 *   figma-config.js               — fill in your Figma file keys + sections
 *   .claude/commands/figma-setup.md — Claude skill for auto-matching components
 */

const fs   = require('fs');
const path = require('path');

const PKG_TEMPLATES = path.join(__dirname, '..', 'templates');
const CWD = process.cwd();

let created = 0;
let skipped = 0;

function scaffold(src, dest, label) {
  if (fs.existsSync(dest)) {
    console.log(`  skip  ${label}  (already exists)`);
    skipped++;
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`  create  ${label}`);
  created++;
}

console.log('\nhandoff-figma init\n');

scaffold(
  path.join(PKG_TEMPLATES, 'figma-config.template.js'),
  path.join(CWD, 'figma-config.js'),
  'figma-config.js'
);

scaffold(
  path.join(PKG_TEMPLATES, 'figma-setup.md'),
  path.join(CWD, '.claude', 'commands', 'figma-setup.md'),
  '.claude/commands/figma-setup.md'
);

console.log(`\n${created} file(s) created, ${skipped} skipped.\n`);

if (created > 0) {
  console.log('Next steps:');
  console.log('  1. Open figma-config.js and fill in your Figma file key(s), section IDs,');
  console.log('     projectId, componentsDir, and projectName.');
  console.log('  2. Add HANDOFF_DEV_ACCESS_TOKEN to your .env file.');
  console.log('  3. Run /figma-setup in Claude Code to auto-match components and run the pipeline.');
  console.log('  Or run the scripts manually — see figma-config.js for the step-by-step order.\n');
}
