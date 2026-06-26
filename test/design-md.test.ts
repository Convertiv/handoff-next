import assert from 'node:assert';
import { describe, it } from 'node:test';
import { buildDesignMd } from '@handoff/utils/design-md';

describe('buildDesignMd', () => {
  const md = buildDesignMd({
    project: { name: 'SS&C', stackProfile: 'bootstrap-handlebars', figmaFileKey: '0gKWw8', origin: 'https://ssc.example' },
    colors: [
      { name: 'SS&C Blue', value: '#0077c8', group: 'primary', sass: '$color-primary-ssc-blue', reference: 'color-primary-ssc-blue' },
      { name: 'Accent Yellow', value: '#f5ab0a', group: 'accent', sass: '$color-accent-yellow', reference: 'color-accent-yellow' },
    ],
    typography: [{ name: 'Heading 1', reference: 'typography--heading-1', values: { fontFamily: 'Barlow', fontSize: 76, fontWeight: 400 } }],
    spacing: [{ cssVariable: '--spacing-2', value: '1.25rem', description: '20px — base spacer' }],
    borderRadius: [{ cssVariable: '--border-radius-md', value: '4px' }],
    components: [
      { id: 'hero_centered', title: 'Hero Centered', group: 'Heroes' },
      { id: 'button', title: 'Button', group: 'Atomic Elements' },
    ],
    brandVoiceMarkdown: '**Tone:** authoritative, precise, enterprise-ready.',
    designGuidelines: '## Layout\nUse a consistent grid.',
  });

  it('includes the project name and identity', () => {
    assert.ok(md.startsWith('# SS&C — Design System'));
    assert.ok(md.includes('**Stack:** bootstrap-handlebars'));
    assert.ok(md.includes('`0gKWw8`'));
  });

  it('lists colors grouped, with usable token names + values', () => {
    assert.ok(md.includes('### primary'));
    assert.ok(md.includes('`$color-primary-ssc-blue` — #0077c8'));
    assert.ok(md.includes('### accent'));
  });

  it('includes type scale, spacing, radius', () => {
    assert.ok(md.includes('**Heading 1** — Barlow · 76px · 400'));
    assert.ok(md.includes('`--spacing-2` — 1.25rem (20px — base spacer)'));
    assert.ok(md.includes('`--border-radius-md` — 4px'));
  });

  it('lists components by group with their ids', () => {
    assert.ok(md.includes('## Component vocabulary'));
    assert.ok(md.includes('`hero_centered` — Hero Centered'));
    assert.ok(md.includes('`button`'));
  });

  it('includes brand voice and design guidelines', () => {
    assert.ok(md.includes('## Brand voice'));
    assert.ok(md.includes('authoritative, precise'));
    assert.ok(md.includes('## Design guidelines'));
  });

  it('omits empty sections and tolerates missing data', () => {
    const minimal = buildDesignMd({ project: { name: 'X' } });
    assert.ok(minimal.includes('# X — Design System'));
    assert.ok(!minimal.includes('## Colors'));
    assert.ok(!minimal.includes('## Component vocabulary'));
  });
});
