import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  coerceDefinitionToSubSections,
  collectRenderedPaths,
  dedupeDbNavBySlug,
  mergeDbNavIntoSkeleton,
  normalizeNavPath,
  shapeComponentCatalogSubSections,
  type DbNavNode,
} from '../src/app/lib/data/menu-merge';
import type { SectionLink } from '../src/app/components/util';

/**
 * These tests pin the contracts that prevent the two production regressions we
 * just shipped fixes for:
 *
 *   (a) Duplicate top-level nav items appearing in MainNav (foundations,
 *       guidelines, system each twice) — caused by `pages/foo.md` AND `pages/foo/`
 *       both emitting nodes at the same slug.
 *
 *   (b) Registry-wide TypeError "Cannot read properties of undefined (reading
 *       'split')" — caused by `injectMergedComponentMenus` flattening a
 *       3-level rebuilt tree to 2 levels, leaving `path: undefined` on every
 *       rendered link.
 *
 * Both regressions only surface at page render time, so a happy-path unit
 * suite missed them. The check `collectRenderedPaths(menu).every(p => typeof
 * p === 'string')` is the smallest assertion that catches (b) cold, and the
 * dedupe tests catch (a).
 */

describe('normalizeNavPath', () => {
  it('returns "/" for empty / null / undefined', () => {
    assert.strictEqual(normalizeNavPath(''), '/');
    assert.strictEqual(normalizeNavPath(null), '/');
    assert.strictEqual(normalizeNavPath(undefined), '/');
    assert.strictEqual(normalizeNavPath('   '), '/');
  });

  it('canonicalizes leading slash, trailing slash, casing', () => {
    assert.strictEqual(normalizeNavPath('foundations'), '/foundations');
    assert.strictEqual(normalizeNavPath('/foundations'), '/foundations');
    assert.strictEqual(normalizeNavPath('/foundations/'), '/foundations');
    assert.strictEqual(normalizeNavPath('Foundations'), '/foundations');
    assert.strictEqual(normalizeNavPath('  /Foundations///  '), '/foundations');
  });
});

describe('dedupeDbNavBySlug', () => {
  it('collapses category + markdown with same slug (category wins, children kept)', () => {
    const tree: DbNavNode[] = [
      {
        slug: 'foundations',
        type: 'category',
        title: 'Foundations',
        children: [{ slug: 'foundations/colors', type: 'markdown', title: 'Colors' }],
      },
      { slug: 'foundations', type: 'markdown', title: 'Foundations' },
    ];
    const out = dedupeDbNavBySlug(tree);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].slug, '/foundations');
    assert.strictEqual(out[0].type, 'category');
    assert.strictEqual(out[0].children?.length, 1);
  });

  it('unions children when both duplicates carry children', () => {
    const tree: DbNavNode[] = [
      {
        slug: 'guidelines',
        type: 'category',
        title: 'Guidelines',
        children: [{ slug: 'guidelines/a11y', type: 'markdown', title: 'A11y' }],
      },
      {
        slug: 'guidelines',
        type: 'category',
        title: 'Guidelines',
        children: [{ slug: 'guidelines/perf', type: 'markdown', title: 'Perf' }],
      },
    ];
    const out = dedupeDbNavBySlug(tree);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].children?.length, 2);
  });

  it('dedupes recursively at every depth', () => {
    const tree: DbNavNode[] = [
      {
        slug: 'foundations',
        type: 'category',
        title: 'Foundations',
        children: [
          { slug: 'foundations/images', type: 'category', title: 'Images', children: [] },
          { slug: 'foundations/images', type: 'markdown', title: 'Images' },
        ],
      },
    ];
    const out = dedupeDbNavBySlug(tree);
    assert.strictEqual(out[0].children?.length, 1);
  });
});

describe('mergeDbNavIntoSkeleton', () => {
  const baseSkeleton = (): SectionLink[] => [
    {
      title: 'Foundations',
      weight: 0,
      path: '/foundations',
      subSections: [
        { title: 'Colors', path: '/foundations/colors', image: '' },
      ],
    },
    { title: 'System', weight: 0, path: '/system', subSections: [] },
  ];

  it('preserves skeleton sections that have no DB counterpart', () => {
    const merged = mergeDbNavIntoSkeleton(baseSkeleton(), []);
    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].path, '/foundations');
    assert.strictEqual(merged[1].path, '/system');
  });

  it('does NOT duplicate sections that exist on both sides (regression: 8 → 5)', () => {
    const liveDb: DbNavNode[] = [
      { slug: 'foundations', type: 'category', title: 'Foundations', children: [
        { slug: 'foundations/typography', type: 'markdown', title: 'Typography' },
      ]},
      { slug: 'foundations', type: 'markdown', title: 'Foundations' }, // duplicate from old push
      { slug: 'system', type: 'category', title: 'System', children: [] },
      { slug: 'system', type: 'markdown', title: 'System' },
    ];
    const merged = mergeDbNavIntoSkeleton(baseSkeleton(), liveDb);
    const foundations = merged.filter((s) => s.path === '/foundations');
    const system = merged.filter((s) => s.path === '/system');
    assert.strictEqual(foundations.length, 1, 'foundations must appear exactly once');
    assert.strictEqual(system.length, 1, 'system must appear exactly once');
  });

  it('merges DB children into skeleton subSections by path (no clobber)', () => {
    const db: DbNavNode[] = [
      { slug: 'foundations', type: 'category', title: 'Foundations', children: [
        { slug: 'foundations/typography', type: 'markdown', title: 'Typography' },
        // Same path as skeleton — must NOT add a duplicate, just preserve.
        { slug: 'foundations/colors', type: 'markdown', title: 'Colors (DB)' },
      ]},
    ];
    const merged = mergeDbNavIntoSkeleton(baseSkeleton(), db);
    const foundations = merged.find((s) => s.path === '/foundations')!;
    const paths = foundations.subSections.map((s) => s.path);
    assert.deepStrictEqual(paths.sort(), ['/foundations/colors', '/foundations/typography']);
  });

  it('empty DB children leaves skeleton subSections fully intact (regression: /system sidebar)', () => {
    const db: DbNavNode[] = [
      { slug: 'system', type: 'category', title: 'System', children: [] },
    ];
    const baseWithCatalog: SectionLink[] = [
      {
        title: 'System',
        weight: 0,
        path: '/system',
        subSections: [
          { title: 'Elements', path: '', image: '', menu: [{ title: 'Button', path: '/system/component/button', image: '' }] } as never,
        ],
      },
    ];
    const merged = mergeDbNavIntoSkeleton(baseWithCatalog, db);
    assert.strictEqual(merged[0].subSections.length, 1);
    assert.strictEqual(merged[0].subSections[0].title, 'Elements');
  });

  it('appends DB sections that have no skeleton match', () => {
    const db: DbNavNode[] = [
      { slug: 'assets', type: 'category', title: 'Assets', children: [
        { slug: 'assets/icons', type: 'markdown', title: 'Icons' },
      ]},
    ];
    const merged = mergeDbNavIntoSkeleton(baseSkeleton(), db);
    const assets = merged.find((s) => s.path === '/assets');
    assert.ok(assets, 'assets must be appended');
    assert.strictEqual(assets!.subSections.length, 1);
  });
});

describe('shapeComponentCatalogSubSections', () => {
  /**
   * The function consumes the output of `buildComponentSubmenusFromSummaries(..., true)`,
   * which is a 3-level structure: Type → Group → Leaf. The previous (broken)
   * implementation mapped `block.menu.map(item => ({ path: item.path }))` —
   * but `item` is a Group with no `path`, so every rendered link got
   * `path: undefined`. Next/Link then crashed in URL parsing.
   *
   * These tests pin the invariant that crashed prod.
   */
  const rebuiltSample = [
    {
      title: 'Elements',
      menu: [
        {
          title: 'Inputs',
          menu: [
            { path: '/system/component/button', title: 'Button' },
            { path: '/system/component/input', title: 'Input' },
          ],
        },
      ],
    },
    {
      title: 'Blocks',
      menu: [
        {
          title: 'Content',
          menu: [{ path: '/system/component/card', title: 'Card' }],
        },
      ],
    },
  ];

  it('preserves the 3-level Type → Group → Leaf nesting', () => {
    const out = shapeComponentCatalogSubSections(rebuiltSample);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].title, 'Elements');
    const groups = (out[0].menu ?? []) as Array<{ title: string; menu?: Array<{ path: string }> }>;
    assert.strictEqual(groups[0].title, 'Inputs');
    assert.strictEqual(groups[0].menu?.length, 2);
    assert.strictEqual(groups[0].menu?.[0].path, '/system/component/button');
  });

  it('no rendered path is ever undefined or non-string (regression: Next/Link split crash)', () => {
    const sub = shapeComponentCatalogSubSections(rebuiltSample);
    const synthetic: SectionLink[] = [{
      title: 'System',
      weight: 0,
      path: '/system',
      subSections: sub,
    }];
    const paths = collectRenderedPaths(synthetic);
    for (const p of paths) {
      assert.strictEqual(
        typeof p,
        'string',
        `nav item rendered with non-string path: ${JSON.stringify(p)}`
      );
    }
    // Sanity: at least the component leaves are present.
    assert.ok(paths.includes('/system/component/button'));
  });

  it('filters out malformed groups and leaves without throwing', () => {
    const messy = [
      { title: 'Elements', menu: [
        null, // bad group
        { title: 'Inputs', menu: [
          { path: '/system/component/button', title: 'Button' },
          { title: 'Missing path' }, // bad leaf — must be dropped
          { path: '', title: 'Empty path' }, // also dropped
          null,
        ]},
      ]},
      null, // bad block
    ];
    const out = shapeComponentCatalogSubSections(messy);
    const synthetic: SectionLink[] = [{
      title: 'System', weight: 0, path: '/system', subSections: out,
    }];
    const paths = collectRenderedPaths(synthetic);
    for (const p of paths) {
      assert.strictEqual(typeof p, 'string', `bad item leaked through: ${JSON.stringify(p)}`);
    }
    assert.ok(paths.includes('/system/component/button'));
  });
});

describe('coerceDefinitionToSubSections (frontmatter menu honor)', () => {
  // The SSC foundations.md `menu:` frontmatter shape: an array of groups, each
  // with a title and a `menu` of leaves; leaves may have nested `menu`.
  // Registry-side sidebar must render exactly this — group labels + nested
  // children — instead of falling back to a flat auto-walked list.
  const sscFoundations = [
    {
      title: 'Getting Started',
      menu: [{ path: 'foundations', title: 'Foundations', icon: 'square-chart-gantt' }],
    },
    {
      title: 'Foundations',
      menu: [
        {
          path: 'foundations/logo',
          title: 'Logo',
          icon: 'hexagon',
          menu: [
            { path: 'foundations/logo', title: 'Overview' },
            { path: 'foundations/logo-resources', title: 'Resources' },
          ],
        },
        { path: 'foundations/grid', title: 'Grid', icon: 'grid' },
      ],
    },
  ];

  it('preserves group labels (no path) and nested children verbatim', () => {
    const out = coerceDefinitionToSubSections(sscFoundations);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].title, 'Getting Started');
    assert.strictEqual(out[0].path, ''); // groups have no path → render as label
    const groupMenu = out[0].menu!;
    assert.strictEqual(groupMenu.length, 1);
    assert.strictEqual(groupMenu[0].path, '/foundations'); // leading slash added
    const nestedLogo = out[1].menu!.find((m) => m.title === 'Logo')!;
    assert.ok(Array.isArray((nestedLogo as { menu?: unknown[] }).menu));
    assert.strictEqual(((nestedLogo as { menu: { path: string }[] }).menu)[1].path, '/foundations/logo-resources');
  });

  it('drops malformed entries instead of crashing the renderer', () => {
    const messy = [
      'not an object',
      null,
      { title: 'Group', menu: [
        { path: 'x', title: 'Leaf' },
        { path: 123, title: 'Bad path' },  // non-string path → coerced/dropped
        null,
      ]},
    ];
    const out = coerceDefinitionToSubSections(messy);
    const paths = collectRenderedPaths([{ title: 'X', weight: 0, path: '/x', subSections: out }] as never);
    for (const p of paths) assert.strictEqual(typeof p, 'string');
  });

  it('merge prefers frontmatter definition over auto-walked children', () => {
    const skeleton: SectionLink[] = [
      { title: 'Foundations', weight: 0, path: '/foundations', subSections: [] },
    ];
    const dbTree: DbNavNode[] = [{
      slug: 'foundations',
      type: 'category',
      title: 'Foundations',
      definition: sscFoundations,
      // Also has auto-walked children — should be IGNORED in favor of definition.
      children: [{ slug: 'foundations/should-not-appear', type: 'markdown', title: 'Should Not Appear' }],
    }];
    const merged = mergeDbNavIntoSkeleton(skeleton, dbTree);
    const f = merged.find((s) => s.path === '/foundations')!;
    const titles = f.subSections.map((s) => s.title);
    assert.deepStrictEqual(titles, ['Getting Started', 'Foundations']);
    // The auto-walked path should NOT show up anywhere.
    const renderedPaths = collectRenderedPaths(merged).filter((p): p is string => typeof p === 'string');
    assert.ok(!renderedPaths.includes('/foundations/should-not-appear'));
  });

  it('falls back to children when no frontmatter definition is pushed', () => {
    const skeleton: SectionLink[] = [
      { title: 'Foundations', weight: 0, path: '/foundations', subSections: [] },
    ];
    const dbTree: DbNavNode[] = [{
      slug: 'foundations',
      type: 'category',
      title: 'Foundations',
      children: [{ slug: 'foundations/colors', type: 'markdown', title: 'Colors' }],
    }];
    const merged = mergeDbNavIntoSkeleton(skeleton, dbTree);
    const f = merged.find((s) => s.path === '/foundations')!;
    assert.strictEqual(f.subSections.length, 1);
    assert.strictEqual(f.subSections[0].path, '/foundations/colors');
  });
});

describe('coerceDefinitionToSubSections — dynamic markers', () => {
  // SSC's actual system.md frontmatter as pushed to production. None of these
  // entries have explicit children/menu — they all rely on the workspace
  // resolving `tokens: true` and `components: '<type>'` dynamically.
  const sscSystem = [
    { menu: [{ path: 'system', title: 'Overview' }], title: 'Design System' },
    { title: 'Tokens', tokens: true },
    { title: 'Atoms', components: 'element' },
    { title: 'Charts', components: 'data' },
    { title: 'Components', components: 'block' },
    { title: 'Templates', components: 'template' },
  ];

  const resolver = {
    components: (filter: boolean | string) => {
      const all = [
        { id: 'button', type: 'element', title: 'Button' },
        { id: 'chart', type: 'data', title: 'Chart' },
        { id: 'card', type: 'block', title: 'Card' },
      ];
      const filtered = typeof filter === 'string' ? all.filter((c) => c.type === filter) : all;
      if (filtered.length === 0) return [];
      return [{ title: 'Group', menu: filtered.map((c) => ({ title: c.title, path: `/system/component/${c.id}` })) }];
    },
    tokens: () => [{ title: 'Foundations', path: '/system/tokens/foundations' }],
  };

  it('drops the dynamic marker when no resolver is provided (regression: empty Atoms/Charts/Components)', () => {
    const out = coerceDefinitionToSubSections(sscSystem);
    const titles = out.map((s) => s.title);
    // The non-marker entry ("Design System") with explicit menu survives.
    assert.ok(titles.includes('Design System'));
    // Markers without a resolver are dropped entirely — better than emitting
    // empty groups (which is exactly what shipped to prod and rendered as
    // bare divs).
    assert.ok(!titles.includes('Tokens'));
    assert.ok(!titles.includes('Atoms'));
  });

  it('resolves component markers into populated subSections', () => {
    const out = coerceDefinitionToSubSections(sscSystem, { resolver });
    const atoms = out.find((s) => s.title === 'Atoms');
    assert.ok(atoms, 'Atoms section must be present');
    assert.ok(atoms!.menu!.length > 0, 'Atoms must contain component links');
    assert.strictEqual(atoms!.menu![0].path, '/system/component/button');
  });

  it('resolves tokens marker', () => {
    const out = coerceDefinitionToSubSections(sscSystem, { resolver });
    const tokens = out.find((s) => s.title === 'Tokens');
    assert.ok(tokens, 'Tokens section must be present');
    const inner = tokens!.menu as Array<{ title: string }>;
    assert.ok(inner.some((m) => m.title === 'Foundations'));
  });

  it('drops a section whose resolver returns no items (e.g. project has no `data` components)', () => {
    const limitedResolver = {
      components: (filter: boolean | string) => {
        if (filter === 'data') return []; // SSC has 0 chart components
        return [{ title: 'Group', menu: [{ title: 'Button', path: '/system/component/button' }] }];
      },
    };
    const out = coerceDefinitionToSubSections(sscSystem, { resolver: limitedResolver });
    assert.ok(!out.some((s) => s.title === 'Charts'), 'Charts (empty resolver) must be dropped');
    assert.ok(out.some((s) => s.title === 'Atoms'), 'Atoms (populated resolver) must remain');
  });

  it('every rendered path is a string after resolution', () => {
    const out = coerceDefinitionToSubSections(sscSystem, { resolver });
    const synthetic = [{ title: 'System', weight: 0, path: '/system', subSections: out }] as never;
    for (const p of collectRenderedPaths(synthetic)) {
      assert.strictEqual(typeof p, 'string', `non-string path: ${JSON.stringify(p)}`);
    }
  });
});

describe('end-to-end nav (the actual regression contract)', () => {
  it('full registry-mode pipeline produces zero undefined paths', () => {
    // Simulate: registry deploy with no bundled docs → skeleton is empty,
    // injectMergedComponentMenus materializes a synthetic /system, DB nav has
    // the SSC-shaped duplicates.
    const sub = shapeComponentCatalogSubSections([
      { title: 'Elements', menu: [
        { title: 'Inputs', menu: [{ path: '/system/component/button', title: 'Button' }] },
      ]},
    ]);
    const skeleton: SectionLink[] = [
      { title: 'System', weight: 0, path: '/system', subSections: sub },
    ];
    const dbTree: DbNavNode[] = [
      { slug: 'foundations', type: 'category', title: 'Foundations', children: [
        { slug: 'foundations/colors', type: 'markdown', title: 'Colors' },
      ]},
      { slug: 'foundations', type: 'markdown', title: 'Foundations' }, // duplicate
      { slug: 'system', type: 'category', title: 'System', children: [] }, // empty children
      { slug: 'system', type: 'markdown', title: 'System' }, // duplicate
      { slug: 'assets', type: 'category', title: 'Assets', children: [
        { slug: 'assets/icons', type: 'markdown', title: 'Icons' },
      ]},
    ];

    const merged = mergeDbNavIntoSkeleton(skeleton, dbTree);

    // Section-level dedupe: each top-level slug appears exactly once.
    const topPaths = merged.map((s) => s.path);
    const seen = new Set(topPaths);
    assert.strictEqual(seen.size, topPaths.length, `duplicate top-level paths: ${topPaths.join(', ')}`);

    // /system still has its component catalog (skeleton subSections preserved).
    const system = merged.find((s) => s.path === '/system')!;
    assert.ok(system.subSections.length > 0, '/system must keep its catalog');

    // Every rendered path is a string.
    const paths = collectRenderedPaths(merged);
    for (const p of paths) {
      assert.strictEqual(typeof p, 'string', `undefined/null path reached renderer: ${JSON.stringify(p)}`);
    }
  });
});
