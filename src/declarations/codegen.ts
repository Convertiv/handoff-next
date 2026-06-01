import { nestFigmaLinkDataForDeclarationFile } from '@handoff/figma/component-linking';
import type { RendererKind } from './types.js';

export type { RendererKind } from './types.js';

function esc(s: string): string {
  return JSON.stringify(s);
}

export type DeclarationPreviewEntry = { title: string; values?: Record<string, unknown> };

export const HB_TEMPLATE_STUB = `<head>
  {{{style}}}
  {{{script}}}
</head>
<body class="theme preview-body">
  <p>Hello from {{title}}</p>
</body>
`;

export const REACT_TSX_STUB = `import React from 'react';

export interface Props {
  title?: string;
  children?: React.ReactNode;
}

const Component: React.FC<Props> = ({ title = 'Component', children }) => (
  <div className="theme preview-body p-4">
    <p>{title}</p>
    {children}
  </div>
);

export default Component;
`;

export const CSF_STORY_STUB = `import React from 'react';

const Demo = () => <div className="theme preview-body p-4">Story preview</div>;

export default {
  title: 'Demo',
  component: Demo,
};

export const Default = {
  render: () => <Demo />,
};
`;

export const EMPTY_SCSS_STUB = `/* component styles */\n.preview-body { }\n`;
export const EMPTY_JS_STUB = `// component client script\n`;

function previewsToDeclarationArgsRecord(
  previews: Record<string, DeclarationPreviewEntry> | undefined
): Record<string, { title: string; args: Record<string, unknown> }> {
  const map =
    previews && Object.keys(previews).length > 0
      ? previews
      : { default: { title: 'Default', values: {} as Record<string, unknown> } };
  return Object.fromEntries(
    Object.entries(map).map(([key, p]) => {
      const vals = p.values && typeof p.values === 'object' ? p.values : {};
      return [key, { title: p.title || key, args: vals as Record<string, unknown> }];
    })
  );
}

export function buildHandoffDeclarationObject(data: {
  id: string;
  title: string;
  description?: string;
  group?: string;
  type?: string;
  renderer?: string;
  previews?: Record<string, DeclarationPreviewEntry>;
  properties?: Record<string, unknown>;
  image?: string;
  tags?: string[];
  categories?: string[];
  shouldDo?: string[];
  shouldNotDo?: string[];
  entries?: Record<string, string>;
}): Record<string, unknown> {
  const { id, title, description = '', group = '', type = 'element', previews } = data;
  const renderer = (data.renderer ?? 'handlebars') as RendererKind;
  const previewRecord = previewsToDeclarationArgsRecord(previews);
  const base = {
    id,
    name: title,
    description,
    group,
    type,
    ...(data.image ? { image: data.image } : {}),
    ...(data.tags?.length ? { tags: data.tags } : {}),
    ...(data.categories?.length ? { categories: data.categories } : {}),
    ...(data.properties && Object.keys(data.properties).length ? { properties: data.properties } : {}),
    ...(data.shouldDo?.length ? { shouldDo: data.shouldDo } : {}),
    ...(data.shouldNotDo?.length ? { shouldNotDo: data.shouldNotDo } : {}),
    previews: previewRecord,
  };

  if (renderer === 'react') {
    return {
      ...base,
      renderer: 'react',
      entries: data.entries ?? { component: `./${id}.tsx`, scss: `./${id}.scss`, js: `./${id}.client.js` },
    };
  }
  if (renderer === 'csf') {
    return {
      ...base,
      renderer: 'csf',
      entries: data.entries ?? { story: `./${id}.stories.tsx`, scss: `./${id}.scss`, js: `./${id}.client.js` },
    };
  }
  return {
    ...base,
    renderer: 'handlebars',
    entries: data.entries ?? { template: `./${id}.hbs`, scss: `./${id}.scss`, js: `./${id}.client.js` },
  };
}

export function buildHandoffDeclarationTsForRenderer(renderer: RendererKind, nestedConfig: Record<string, unknown>): string {
  const body = JSON.stringify(nestedConfig, null, 2);
  if (renderer === 'react') {
    const id = String(nestedConfig.id ?? 'component');
    return `import { defineReactComponent } from 'handoff-app';
import Component from './${id}.tsx';

export default defineReactComponent(Component, ${body});
`;
  }
  if (renderer === 'csf') {
    return `import { defineCsfComponent } from 'handoff-app';

export default defineCsfComponent(${body});
`;
  }
  return `import { defineHandlebarsComponent } from 'handoff-app';

export default defineHandlebarsComponent(${body});
`;
}

/** @deprecated Use {@link buildHandoffDeclarationTsForRenderer} with explicit renderer. */
export function buildHandoffDeclarationTsHandlebars(nestedConfig: Record<string, unknown>): string {
  const renderer = (nestedConfig.renderer as RendererKind | undefined) ?? 'handlebars';
  return buildHandoffDeclarationTsForRenderer(renderer, nestedConfig);
}

export function buildHandoffPatternDeclarationTs(config: Record<string, unknown>): string {
  const body = JSON.stringify(config, null, 2);
  return `import { definePattern } from 'handoff-app';

export default definePattern(${body});
`;
}

export function nestConfigForDeclarationFile(flat: Record<string, unknown>): Record<string, unknown> {
  return nestFigmaLinkDataForDeclarationFile(flat) as Record<string, unknown>;
}

export function entryStubFilesForRenderer(
  id: string,
  renderer: RendererKind
): Record<string, string> {
  if (renderer === 'react') {
    return {
      [`${id}.tsx`]: REACT_TSX_STUB,
      [`${id}.scss`]: EMPTY_SCSS_STUB,
      [`${id}.client.js`]: EMPTY_JS_STUB,
    };
  }
  if (renderer === 'csf') {
    return {
      [`${id}.stories.tsx`]: CSF_STORY_STUB,
      [`${id}.scss`]: EMPTY_SCSS_STUB,
      [`${id}.client.js`]: EMPTY_JS_STUB,
    };
  }
  return {
    [`${id}.hbs`]: HB_TEMPLATE_STUB,
    [`${id}.scss`]: EMPTY_SCSS_STUB,
    [`${id}.client.js`]: EMPTY_JS_STUB,
  };
}

export function inferProjectRenderer(
  components: Record<string, { renderer?: string } | undefined>,
  remoteRenderer?: string
): RendererKind {
  const counts: Record<string, number> = {};
  for (const c of Object.values(components)) {
    const r = c?.renderer;
    if (r === 'react' || r === 'handlebars' || r === 'csf') {
      counts[r] = (counts[r] ?? 0) + 1;
    }
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    return sorted[0][0] as RendererKind;
  }
  if (remoteRenderer === 'react' || remoteRenderer === 'handlebars' || remoteRenderer === 'csf') {
    return remoteRenderer;
  }
  return 'handlebars';
}

export function handoffJsHandlebars(
  id: string,
  title: string,
  description: string,
  group: string,
  type: string,
  previews?: Record<string, DeclarationPreviewEntry>
): string {
  const previewRecord = previewsToDeclarationArgsRecord(previews);
  const lines = Object.entries(previewRecord).map(
    ([key, p]) => `    ${JSON.stringify(key)}: { title: ${esc(p.title)}, args: ${JSON.stringify(p.args)} },`
  );
  return `module.exports = {
  id: ${esc(id)},
  name: ${esc(title)},
  description: ${esc(description)},
  group: ${esc(group)},
  type: ${esc(type)},
  renderer: 'handlebars',
  entries: {
    template: ${esc(`./${id}.hbs`)},
    scss: ${esc(`./${id}.scss`)},
    js: ${esc(`./${id}.client.js`)},
  },
  previews: {
${lines.join('\n')}
  },
};
`;
}

export function handoffJsReact(
  id: string,
  title: string,
  description: string,
  group: string,
  type: string,
  previews?: Record<string, DeclarationPreviewEntry>
): string {
  const previewRecord = previewsToDeclarationArgsRecord(previews);
  const lines = Object.entries(previewRecord).map(
    ([key, p]) => `    ${JSON.stringify(key)}: { title: ${esc(p.title)}, args: ${JSON.stringify(p.args)} },`
  );
  return `module.exports = {
  id: ${esc(id)},
  name: ${esc(title)},
  description: ${esc(description)},
  group: ${esc(group)},
  type: ${esc(type)},
  renderer: 'react',
  entries: {
    component: ${esc(`./${id}.tsx`)},
    scss: ${esc(`./${id}.scss`)},
    js: ${esc(`./${id}.client.js`)},
  },
  previews: {
${lines.join('\n')}
  },
};
`;
}

export function handoffJsCsf(
  id: string,
  title: string,
  description: string,
  group: string,
  type: string,
  previews?: Record<string, DeclarationPreviewEntry>
): string {
  const previewRecord = previewsToDeclarationArgsRecord(previews);
  const lines = Object.entries(previewRecord).map(
    ([key, p]) => `    ${JSON.stringify(key)}: { title: ${esc(p.title)}, args: ${JSON.stringify(p.args)} },`
  );
  return `module.exports = {
  id: ${esc(id)},
  name: ${esc(title)},
  description: ${esc(description)},
  group: ${esc(group)},
  type: ${esc(type)},
  renderer: 'csf',
  entries: {
    story: ${esc(`./${id}.stories.tsx`)},
    scss: ${esc(`./${id}.scss`)},
    js: ${esc(`./${id}.client.js`)},
  },
  previews: {
${lines.join('\n')}
  },
};
`;
}

export function buildHandoffDeclarationCjs(data: {
  id: string;
  title: string;
  description: string;
  group: string;
  type: string;
  renderer?: string;
  previews?: Record<string, DeclarationPreviewEntry>;
}): string {
  const { id, title, description, group, type, previews } = data;
  const renderer = data.renderer ?? 'handlebars';
  if (renderer === 'react') return handoffJsReact(id, title, description, group, type, previews);
  if (renderer === 'csf') return handoffJsCsf(id, title, description, group, type, previews);
  return handoffJsHandlebars(id, title, description, group, type, previews);
}

export function scaffoldNewComponentPayload(opts: {
  id: string;
  title: string;
  group: string;
  renderer: RendererKind;
  description?: string;
}): Record<string, unknown> {
  const { id, title, group, renderer, description = '' } = opts;
  const stubs = entryStubFilesForRenderer(id, renderer);
  const entrySources: Record<string, string> = {};
  if (stubs[`${id}.tsx`]) entrySources.component = stubs[`${id}.tsx`];
  if (stubs[`${id}.stories.tsx`]) entrySources.story = stubs[`${id}.stories.tsx`];
  if (stubs[`${id}.hbs`]) entrySources.template = stubs[`${id}.hbs`];
  if (stubs[`${id}.scss`]) entrySources.scss = stubs[`${id}.scss`];
  if (stubs[`${id}.client.js`]) entrySources.js = stubs[`${id}.client.js`];

  return {
    id,
    path: `/system/component/${id}`,
    title,
    description,
    group,
    image: '',
    type: 'element',
    renderer,
    categories: [],
    tags: [],
    should_do: [],
    should_not_do: [],
    previews: { default: { title: 'Default', values: {}, url: '' } },
    properties: {},
    entrySources,
  };
}
