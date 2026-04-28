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

export function handoffJsHandlebars(id: string, title: string, description: string, group: string, type: string): string {
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
    default: { title: 'Default', args: {} },
  },
};
`;
}

export function handoffJsReact(id: string, title: string, description: string, group: string, type: string): string {
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
    default: { title: 'Default', args: {} },
  },
};
`;
}

export function handoffJsCsf(id: string, title: string, description: string, group: string, type: string): string {
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
    default: { title: 'Default', args: {} },
  },
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
}): string {
  const { id, title, description, group, type } = data;
  const renderer = data.renderer ?? 'handlebars';
  if (renderer === 'react') return handoffJsReact(id, title, description, group, type);
  if (renderer === 'csf') return handoffJsCsf(id, title, description, group, type);
  return handoffJsHandlebars(id, title, description, group, type);
}
