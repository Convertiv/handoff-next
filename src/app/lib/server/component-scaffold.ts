import type { ComponentListObject } from '@handoff/transformers/preview/types';

export type RendererKind = 'react' | 'handlebars' | 'csf';

const HB_TEMPLATE = `<head>
  {{{style}}}
  {{{script}}}
</head>
<body class="theme preview-body">
  <p>Hello from {{title}}</p>
</body>
`;

const REACT_TSX = `import React from 'react';

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

const CSF_STORY = `import React from 'react';

const Demo = () => <div className="theme preview-body p-4">Story preview</div>;

export default {
  title: 'Demo',
  component: Demo,
};

export const Default = {
  render: () => <Demo />,
};
`;

function esc(s: string): string {
  return JSON.stringify(s);
}

export type DeclarationPreviewEntry = { title: string; values?: Record<string, unknown> };

function previewsToCjsBlock(previews: Record<string, DeclarationPreviewEntry> | undefined): string {
  const map =
    previews && Object.keys(previews).length > 0
      ? previews
      : { default: { title: 'Default', values: {} as Record<string, unknown> } };
  const lines: string[] = [];
  for (const [key, p] of Object.entries(map)) {
    const vals = p.values && typeof p.values === 'object' ? p.values : {};
    lines.push(`    ${JSON.stringify(key)}: { title: ${esc(p.title || key)}, args: ${JSON.stringify(vals)} },`);
  }
  return `{\n${lines.join('\n')}\n  }`;
}

export function handoffJsHandlebars(
  id: string,
  title: string,
  description: string,
  group: string,
  type: string,
  previews?: Record<string, DeclarationPreviewEntry>
): string {
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
  previews: ${previewsToCjsBlock(previews)},
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
  previews: ${previewsToCjsBlock(previews)},
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
  previews: ${previewsToCjsBlock(previews)},
};
`;
}

const EMPTY_SCSS = `/* ${'component'} styles */\n.preview-body { }\n`;
const EMPTY_JS = `// ${'component'} client script\n`;

/** DB payload for a new component row (`handoff_component.data`). */
export function scaffoldNewComponentPayload(opts: {
  id: string;
  title: string;
  group: string;
  renderer: RendererKind;
  description?: string;
}): ComponentListObject {
  const { id, title, group, renderer, description = '' } = opts;
  const type = 'element';
  const path = `/system/component/${id}`;

  let entrySources: { template?: string; scss?: string; js?: string; component?: string; story?: string };

  if (renderer === 'react') {
    entrySources = { component: REACT_TSX, scss: EMPTY_SCSS, js: EMPTY_JS };
  } else if (renderer === 'csf') {
    entrySources = { story: CSF_STORY, scss: EMPTY_SCSS, js: EMPTY_JS };
  } else {
    entrySources = { template: HB_TEMPLATE, scss: EMPTY_SCSS, js: EMPTY_JS };
  }

  return {
    id,
    path,
    title,
    description,
    group,
    image: '',
    type,
    renderer,
    categories: [],
    tags: [],
    should_do: [],
    should_not_do: [],
    previews: {
      default: {
        title: 'Default',
        values: {},
        url: '',
      },
    },
    properties: {},
    entrySources,
  } as unknown as ComponentListObject;
}

export function buildHandoffDeclarationCjs(data: {
  id: string;
  title: string;
  description: string;
  group: string;
  type: string;
  renderer?: string;
  /** Preview keys → { title, values } (emitted as `args` in CJS for Handoff normalizer). */
  previews?: Record<string, DeclarationPreviewEntry>;
}): string {
  const { id, title, description, group, type, previews } = data;
  const renderer = data.renderer ?? 'handlebars';
  if (renderer === 'react') return handoffJsReact(id, title, description, group, type, previews);
  if (renderer === 'csf') return handoffJsCsf(id, title, description, group, type, previews);
  return handoffJsHandlebars(id, title, description, group, type, previews);
}
