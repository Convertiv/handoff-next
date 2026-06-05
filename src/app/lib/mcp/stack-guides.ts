import 'server-only';

import fs from 'fs';
import path from 'path';
import type { StackProfile } from '@/lib/mcp/project-profile';

/**
 * Locate the directory containing built-in stack guide .md files.
 * Resolution order (first match wins):
 *   1. lib/mcp/stack-guides/        — materialized app root (production)
 *   2. src/app/lib/mcp/stack-guides/ — legacy path (pre-consolidation)
 *   3. src/stacks/                   — canonical source (development / monorepo)
 */
function resolveGuidesDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'lib/mcp/stack-guides'),
    path.join(process.cwd(), 'src/app/lib/mcp/stack-guides'),
    path.join(process.cwd(), 'src/stacks'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'bootstrap-handlebars.md'))) return dir;
  }
  return null;
}

/**
 * Load the stack guide markdown for the given profile.
 *
 * Resolution order:
 *   1. HANDOFF_STACK_GUIDE_PATH env var — absolute or relative-to-workingPath custom guide
 *   2. {HANDOFF_WORKING_PATH}/docs/stack-guide.md — per-project custom guide
 *   3. Built-in profile file from stack-guides directory
 */
export function loadStackGuideMarkdown(profile: StackProfile): string {
  // 1. Explicit env var override (absolute path or relative to working path)
  const customEnvPath = process.env.HANDOFF_STACK_GUIDE_PATH?.trim();
  if (customEnvPath) {
    const abs = path.isAbsolute(customEnvPath)
      ? customEnvPath
      : path.join(process.env.HANDOFF_WORKING_PATH?.trim() || process.cwd(), customEnvPath);
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch {
      // fall through
    }
  }

  // 2. Per-project docs/stack-guide.md in working path
  const workingPath = process.env.HANDOFF_WORKING_PATH?.trim();
  if (workingPath) {
    const projectGuide = path.join(workingPath, 'docs', 'stack-guide.md');
    try {
      return fs.readFileSync(projectGuide, 'utf8');
    } catch {
      // fall through
    }
  }

  // 3. Built-in profile
  const dir = resolveGuidesDir();
  if (!dir) return `# Stack guide: ${profile}\n\n(No guide file found. Create docs/stack-guide.md in your project or set HANDOFF_STACK_GUIDE_PATH.)`;
  const file = path.join(dir, `${profile}.md`);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return `# Stack guide: ${profile}\n\n(Guide file not found for profile "${profile}". Available profiles: bootstrap-handlebars, react-tailwind, react-scss, tailwind-handlebars.)`;
  }
}
