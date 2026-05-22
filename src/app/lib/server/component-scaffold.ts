import type { ComponentListObject } from '@handoff/transformers/preview/types';
import {
  buildHandoffDeclarationCjs,
  buildHandoffDeclarationObject,
  buildHandoffDeclarationTsForRenderer,
  buildHandoffDeclarationTsHandlebars,
  handoffJsCsf,
  handoffJsHandlebars,
  handoffJsReact,
  scaffoldNewComponentPayload as scaffoldNewComponentPayloadFromCodegen,
  type DeclarationPreviewEntry,
  type RendererKind,
} from '@handoff/declarations/codegen.js';

export type { DeclarationPreviewEntry, RendererKind };

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

const HB_TEMPLATE = `<head>
  {{{style}}}
  {{{script}}}
</head>
<body class="theme preview-body">
  <p>Hello from {{title}}</p>
</body>
`;

const EMPTY_SCSS = `/* component styles */\n.preview-body { }\n`;
const EMPTY_JS = `// component client script\n`;

/** DB payload for a new component row (`handoff_component.data`). */
export function scaffoldNewComponentPayload(opts: {
  id: string;
  title: string;
  group: string;
  renderer: RendererKind;
  description?: string;
}): ComponentListObject {
  const base = scaffoldNewComponentPayloadFromCodegen(opts);
  let entrySources = (base as unknown as { entrySources: Record<string, string> }).entrySources;
  if (opts.renderer === 'react') {
    entrySources = { component: REACT_TSX, scss: EMPTY_SCSS, js: EMPTY_JS };
  } else if (opts.renderer === 'csf') {
    entrySources = { story: CSF_STORY.replace(/motion\./g, ''), scss: EMPTY_SCSS, js: EMPTY_JS };
  } else {
    entrySources = { template: HB_TEMPLATE, scss: EMPTY_SCSS, js: EMPTY_JS };
  }
  return { ...base, entrySources } as unknown as ComponentListObject;
}

export {
  buildHandoffDeclarationObject,
  buildHandoffDeclarationTsForRenderer,
  buildHandoffDeclarationTsHandlebars,
  buildHandoffDeclarationCjs,
  handoffJsHandlebars,
  handoffJsReact,
  handoffJsCsf,
};
