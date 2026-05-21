import 'server-only';

import fs from 'fs';
import path from 'path';
import type { StackProfile } from '@/lib/mcp/project-profile';

function resolveGuidesDir(): string | null {
  const candidates = [
    path.join(process.cwd(), 'lib/mcp/stack-guides'),
    path.join(process.cwd(), 'src/app/lib/mcp/stack-guides'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'bootstrap-handlebars.md'))) return dir;
  }
  return null;
}

export function loadStackGuideMarkdown(profile: StackProfile): string {
  const dir = resolveGuidesDir();
  if (!dir) return `# Stack guide: ${profile}\n\n(No guide file found.)`;
  const file = path.join(dir, `${profile}.md`);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return `# Stack guide: ${profile}\n\n(No guide file found.)`;
  }
}
