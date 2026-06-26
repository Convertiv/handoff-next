import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  createFigmaAuditReport,
  fetchNodeImages,
  fetchNodePropertySeeds,
  flattenNestedFigmaInRawDeclaration,
  getMissingFigmaMetadata,
  loadFigmaComponentCatalog,
  matchHandoffComponentToFigma,
  nestFigmaLinkDataForDeclarationFile,
  type FigmaComponentCatalog,
} from '../src/figma/component-linking.js';

function catalog(): FigmaComponentCatalog {
  const buttonChild = {
    slug: 'button-default',
    parentSlug: 'button',
    figma: 'https://www.figma.com/file/file123/?node-id=10-21',
    figmaComponentName: 'Button / State=Default',
    figmaComponentKey: 'component-key-button',
    figmaPublishedComponentKeys: ['component-key-button'],
    figmaFileKey: 'file123',
    figmaNodeId: '10:21',
    figmaComponentSetId: '10:20',
    figmaComponentSetName: 'button',
    figmaVariantLabel: 'state=default',
    figmaVariantValues: { state: 'default' },
    figmaUpdatedAt: '2026-05-12T00:00:00.000Z',
    figmaVariantSchema: [{ name: 'state', values: ['default', 'hover'], defaultValue: 'default' }],
    figmaInstanceCount: 1,
    figmaImages: [{ name: 'Background', part: 'background', width: 320, height: 200 }],
    previews: [{ id: 'default', title: 'default', values: { state: 'default' } }],
  };
  const button = {
    slug: 'button',
    figma: 'https://www.figma.com/file/file123/?node-id=10-20',
    figmaComponentName: 'button',
    figmaComponentSetName: 'button',
    figmaPublishedComponentKeys: ['component-key-button'],
    figmaFileKey: 'file123',
    figmaNodeId: '10:20',
    figmaComponentSetId: '10:20',
    figmaUpdatedAt: '2026-05-12T00:00:00.000Z',
    figmaVariantSchema: [{ name: 'state', values: ['default', 'hover'], defaultValue: 'default' }],
    figmaInstanceCount: 2,
    figmaImages: [{ name: 'Background', part: 'background', width: 320, height: 200 }],
    previews: [
      { id: 'default', title: 'default', values: { state: 'default' } },
      { id: 'hover', title: 'hover', values: { state: 'hover' } },
    ],
    children: [buttonChild],
  };

  return {
    entries: [button],
    childEntries: [buttonChild],
    byName: new Map([[button.slug, button]]),
    byComponentKey: new Map([[buttonChild.figmaComponentKey, buttonChild]]),
    byChildName: new Map([[buttonChild.slug, [buttonChild]]]),
  };
}

describe('component-linking', () => {
  it('prefers explicit figmaComponentId matches', () => {
    const match = matchHandoffComponentToFigma(
      { id: 'cta-button', figmaComponentId: 'button' },
      catalog()
    );
    assert.strictEqual(match.status, 'matched');
    assert.strictEqual(match.matchedBy, 'figma_component_id');
    assert.strictEqual(match.entry?.slug, 'button');
  });

  it('marks runtime-id fallback matches as unlinked', () => {
    const match = matchHandoffComponentToFigma(
      { id: 'button' },
      catalog()
    );
    assert.strictEqual(match.status, 'unlinked');
    assert.strictEqual(match.matchedBy, 'runtime_id');
  });

  it('reports missing structured metadata for matched components', () => {
    const match = matchHandoffComponentToFigma({ id: 'cta-button', figmaComponentId: 'button' }, catalog());
    const missing = getMissingFigmaMetadata({ figmaComponentId: 'button' }, match);
    assert.deepStrictEqual(
      missing,
      [
        'figma',
        'figmaComponentKey',
        'figmaComponentName',
        'figmaFileKey',
        'figmaNodeId',
        'figmaComponentSetId',
        'figmaComponentSetName',
        'figmaPublishedComponentKeys',
        'figmaUpdatedAt',
        'figmaVariantSchema',
        'figmaVariantLabel',
        'figmaVariantValues',
        'figmaInstanceCount',
        'figmaImages',
      ]
    );
  });

  it('builds an audit report with figma-only and unlinked components', () => {
    const report = createFigmaAuditReport([{ id: 'button', title: 'Button' }], catalog());
    assert.strictEqual(report.summary.unlinked, 1);
    assert.strictEqual(report.summary.missingInHandoff, 0);

    const second = createFigmaAuditReport([{ id: 'card', title: 'Card' }], catalog());
    assert.strictEqual(second.summary.missingInHandoff, 1);
    assert.strictEqual(second.figmaOnly[0]?.slug, 'button');
    assert.strictEqual(second.figmaOnly[0]?.figmaImages?.[0]?.width, 320);
  });

  it('ingests standalone published file components from the Figma components endpoint', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/files/file123/components')) {
        return new Response(
          JSON.stringify({
            meta: {
              components: [
                {
                  key: 'pagination-key',
                  file_key: 'file123',
                  node_id: '134:562',
                  thumbnail_url: 'https://example.com/pagination.png',
                  name: 'Pagination',
                  description: '',
                  updated_at: '2026-05-12T00:00:00.000Z',
                },
                {
                  key: 'input-default-key',
                  file_key: 'file123',
                  node_id: '1959:1199',
                  thumbnail_url: 'https://example.com/input-default.png',
                  name: 'State=Default',
                  description: '',
                  updated_at: '2026-05-12T00:00:00.000Z',
                  containing_frame: {
                    name: 'Input',
                    containingComponentSet: {
                      name: 'Input',
                      nodeId: '1956:1143',
                    },
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ meta: { components: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const loaded = await loadFigmaComponentCatalog({
        config: { figma_project_id: 'file123', dev_access_token: 'Bearer token' },
        async getDocumentationObject() {
          return { components: {} };
        },
      } as never);

      const standalone = loaded.childEntries.find((entry) => entry.figmaComponentKey === 'pagination-key');
      const variant = loaded.childEntries.find((entry) => entry.figmaComponentKey === 'input-default-key');

      assert.strictEqual(loaded.childEntries.length, 2);
      assert.strictEqual(standalone?.figmaComponentName, 'Pagination');
      assert.strictEqual(standalone?.figmaComponentSetId, undefined);
      assert.strictEqual(variant?.figmaComponentName, 'Input');
      assert.strictEqual(variant?.figmaVariantLabel, 'State=Default');
      assert.strictEqual(variant?.figmaComponentSetName, 'Input');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetches image layers from the Figma nodes endpoint', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/v1/files/file123/nodes?ids=10%3A20')) {
        return new Response(
          JSON.stringify({
            nodes: {
              '10:20': {
                document: {
                  id: '10:20',
                  name: 'Card',
                  children: [
                    {
                      id: '10:21',
                      name: 'Hero Image',
                      absoluteBoundingBox: { width: 640, height: 360 },
                      fills: [{ type: 'IMAGE', imageRef: 'hero-image-ref' }],
                    },
                    {
                      id: '10:22',
                      name: 'Overlay',
                      absoluteBoundingBox: { width: 640, height: 360 },
                      fills: [{ type: 'SOLID' }],
                    },
                  ],
                },
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    try {
      const images = await fetchNodeImages('file123', '10:20', 'Bearer token');
      assert.strictEqual(images.length, 1);
      assert.deepStrictEqual(images[0], {
        name: 'Hero Image',
        role: 'image',
        imageRef: 'hero-image-ref',
        width: 640,
        height: 360,
        nodeId: '10:21',
        part: 'Card/Hero Image',
        // Image sizing guide capture fields (commit 4fb4e0be) — defaults when the
        // fixture node declares no scaleMode / layout sizing / min dimensions.
        scaleMode: undefined,
        isResponsive: false,
        minWidth: undefined,
        minHeight: undefined,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetches scaffold property seeds from the Figma nodes endpoint', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          nodes: {
            '10:20': {
              document: {
                id: '10:20',
                name: 'Hero Split',
                children: [
                  {
                    id: '10:21',
                    name: 'Headline',
                    type: 'TEXT',
                    characters: 'Build faster',
                    absoluteBoundingBox: { width: 320, height: 40 },
                  },
                  {
                    id: '10:22',
                    name: 'Hero Image',
                    type: 'RECTANGLE',
                    absoluteBoundingBox: { width: 640, height: 360 },
                    fills: [{ type: 'IMAGE', imageRef: 'abc123', visible: true }],
                  },
                ],
              },
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const seeds = await fetchNodePropertySeeds('file123', '10:20', 'Bearer token');
      assert.deepStrictEqual(
        seeds.map((seed) => ({ key: seed.key, type: seed.suggestedType, name: seed.name, defaultValue: seed.defaultValue })),
        [
          { key: 'headline', type: 'text', name: 'Headline', defaultValue: 'Build faster' },
          { key: 'hero-image', type: 'image', name: 'Hero Image', defaultValue: undefined },
        ]
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('round-trips nested declaration figma metadata', () => {
    const flat = {
      id: 'btn',
      title: 'Button',
      figma: 'https://www.figma.com/file/abc/?node-id=1-2',
      figmaFileKey: 'abc',
      figmaNodeId: '1:2',
      figmaComponentName: 'Button',
    } as Record<string, unknown>;
    const nested = nestFigmaLinkDataForDeclarationFile(flat);
    assert.strictEqual(typeof nested.figma, 'object');
    const again = flattenNestedFigmaInRawDeclaration(nested);
    assert.strictEqual(again.figma, flat.figma);
    assert.strictEqual(again.figmaFileKey, 'abc');
    assert.strictEqual(again.figmaNodeId, '1:2');
  });
});
