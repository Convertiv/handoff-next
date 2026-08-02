module.exports=[337009,235583,e=>{"use strict";function t(e){return JSON.stringify(e)}e.i(406414);let s=`<head>
  {{{style}}}
  {{{script}}}
</head>
<body class="theme preview-body">
  <p>Hello from {{title}}</p>
</body>
`,r=`import React from 'react';

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
`,n=`import React from 'react';

const Demo = () => <div className="theme preview-body p-4">Story preview</div>;

export default {
  title: 'Demo',
  component: Demo,
};

export const Default = {
  render: () => <Demo />,
};
`,o=`/* component styles */
.preview-body { }
`,i=`// component client script
`;function a(e){return Object.fromEntries(Object.entries(e&&Object.keys(e).length>0?e:{default:{title:"Default",values:{}}}).map(([e,t])=>{let s=t.values&&"object"==typeof t.values?t.values:{};return[e,{title:t.title||e,args:s}]}))}function c(e,t){let s=JSON.stringify(t,null,2);if("react"===e){let e=String(t.id??"component");return`import { defineReactComponent } from 'handoff-app';
import Component from './${e}.tsx';

export default defineReactComponent(Component, ${s});
`}return"csf"===e?`import { defineCsfComponent } from 'handoff-app';

export default defineCsfComponent(${s});
`:`import { defineHandlebarsComponent } from 'handoff-app';

export default defineHandlebarsComponent(${s});
`}function l(e,s,r,n,o,i){let c=Object.entries(a(i)).map(([e,s])=>`    ${JSON.stringify(e)}: { title: ${t(s.title)}, args: ${JSON.stringify(s.args)} },`);return`module.exports = {
  id: ${t(e)},
  name: ${t(s)},
  description: ${t(r)},
  group: ${t(n)},
  type: ${t(o)},
  renderer: 'handlebars',
  entries: {
    template: ${t(`./${e}.hbs`)},
    scss: ${t(`./${e}.scss`)},
    js: ${t(`./${e}.client.js`)},
  },
  previews: {
${c.join("\n")}
  },
};
`}function p(e,s,r,n,o,i){let c=Object.entries(a(i)).map(([e,s])=>`    ${JSON.stringify(e)}: { title: ${t(s.title)}, args: ${JSON.stringify(s.args)} },`);return`module.exports = {
  id: ${t(e)},
  name: ${t(s)},
  description: ${t(r)},
  group: ${t(n)},
  type: ${t(o)},
  renderer: 'react',
  entries: {
    component: ${t(`./${e}.tsx`)},
    scss: ${t(`./${e}.scss`)},
    js: ${t(`./${e}.client.js`)},
  },
  previews: {
${c.join("\n")}
  },
};
`}function d(e,s,r,n,o,i){let c=Object.entries(a(i)).map(([e,s])=>`    ${JSON.stringify(e)}: { title: ${t(s.title)}, args: ${JSON.stringify(s.args)} },`);return`module.exports = {
  id: ${t(e)},
  name: ${t(s)},
  description: ${t(r)},
  group: ${t(n)},
  type: ${t(o)},
  renderer: 'csf',
  entries: {
    story: ${t(`./${e}.stories.tsx`)},
    scss: ${t(`./${e}.scss`)},
    js: ${t(`./${e}.client.js`)},
  },
  previews: {
${c.join("\n")}
  },
};
`}function f(e){let{id:t,title:a,group:c,renderer:l,description:p=""}=e,d="react"===l?{[`${t}.tsx`]:r,[`${t}.scss`]:o,[`${t}.client.js`]:i}:"csf"===l?{[`${t}.stories.tsx`]:n,[`${t}.scss`]:o,[`${t}.client.js`]:i}:{[`${t}.hbs`]:s,[`${t}.scss`]:o,[`${t}.client.js`]:i},f={};return d[`${t}.tsx`]&&(f.component=d[`${t}.tsx`]),d[`${t}.stories.tsx`]&&(f.story=d[`${t}.stories.tsx`]),d[`${t}.hbs`]&&(f.template=d[`${t}.hbs`]),d[`${t}.scss`]&&(f.scss=d[`${t}.scss`]),d[`${t}.client.js`]&&(f.js=d[`${t}.client.js`]),{id:t,path:`/system/component/${t}`,title:a,description:p,group:c,image:"",type:"element",renderer:l,categories:[],tags:[],should_do:[],should_not_do:[],previews:{default:{title:"Default",values:{},url:""}},properties:{},entrySources:f}}e.s(["buildHandoffDeclarationCjs",0,function(e){let{id:t,title:s,description:r,group:n,type:o,previews:i}=e,a=e.renderer??"handlebars";return"react"===a?p(t,s,r,n,o,i):"csf"===a?d(t,s,r,n,o,i):l(t,s,r,n,o,i)},"buildHandoffDeclarationObject",0,function(e){let{id:t,title:s,description:r="",group:n="",type:o="element",previews:i}=e,c=e.renderer??"handlebars",l=a(i),p={id:t,name:s,description:r,group:n,type:o,...e.image?{image:e.image}:{},...e.tags?.length?{tags:e.tags}:{},...e.categories?.length?{categories:e.categories}:{},...e.properties&&Object.keys(e.properties).length?{properties:e.properties}:{},...e.shouldDo?.length?{shouldDo:e.shouldDo}:{},...e.shouldNotDo?.length?{shouldNotDo:e.shouldNotDo}:{},previews:l};return"react"===c?{...p,renderer:"react",entries:e.entries??{component:`./${t}.tsx`,scss:`./${t}.scss`,js:`./${t}.client.js`}}:"csf"===c?{...p,renderer:"csf",entries:e.entries??{story:`./${t}.stories.tsx`,scss:`./${t}.scss`,js:`./${t}.client.js`}}:{...p,renderer:"handlebars",entries:e.entries??{template:`./${t}.hbs`,scss:`./${t}.scss`,js:`./${t}.client.js`}}},"buildHandoffDeclarationTsForRenderer",0,c,"buildHandoffDeclarationTsHandlebars",0,function(e){return c(e.renderer??"handlebars",e)},"handoffJsCsf",0,d,"handoffJsHandlebars",0,l,"handoffJsReact",0,p,"scaffoldNewComponentPayload",0,f],235583);let m=`import React from 'react';

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
`,$=`import React from 'react';

const Demo = () => <div className="theme preview-body p-4">Story preview</div>;

export default {
  title: 'Demo',
  component: Demo,
};

export const Default = {
  render: () => <Demo />,
};
`,u=`<head>
  {{{style}}}
  {{{script}}}
</head>
<body class="theme preview-body">
  <p>Hello from {{title}}</p>
</body>
`,h=`/* component styles */
.preview-body { }
`,b=`// component client script
`;e.s(["scaffoldNewComponentPayload",0,function(e){let t=f(e),s=t.entrySources;return s="react"===e.renderer?{component:m,scss:h,js:b}:"csf"===e.renderer?{story:$.replace(/motion\./g,""),scss:h,js:b}:{template:u,scss:h,js:b},{...t,entrySources:s}}],337009)},89570,e=>{"use strict";e.i(337009);var t=e.i(235583);e.s(["buildHandoffDeclarationTsHandlebars",()=>t.buildHandoffDeclarationTsHandlebars])}];

//# sourceMappingURL=src_app_lib_server_component-scaffold_ts_0-2glgt._.js.map