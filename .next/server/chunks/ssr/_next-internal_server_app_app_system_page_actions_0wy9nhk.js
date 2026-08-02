module.exports=[111459,a=>{"use strict";var b=a.i(137936),c=a.i(93321),d=a.i(580484),e=a.i(506768),f=a.i(795814);a.i(908300);var g=a.i(525662);let h=/^[a-z0-9][a-z0-9_-]{0,127}$/;async function i(a,b,d){var h;let i;if(!a?.user)throw Error("Unauthorized");let j=(0,e.getDb)(),[k]=await j.select().from(g.handoffComponents).where((0,c.eq)(g.handoffComponents.id,b));if(!k)throw Error("Not found");let l={...k.data&&"object"==typeof k.data&&!Array.isArray(k.data)?{...k.data}:{}};void 0!==d.categories&&(l.categories=d.categories),void 0!==d.tags&&(l.tags=d.tags),void 0!==d.should_do&&(l.should_do=d.should_do),void 0!==d.should_not_do&&(l.should_not_do=d.should_not_do);let m=void 0!==d.data?function(a,b){let c={...a};for(let[a,d]of Object.entries(b))if("entrySources"!==a)if("entries"===a&&d&&"object"==typeof d&&!Array.isArray(d)){let a=c.entries&&"object"==typeof c.entries&&!Array.isArray(c.entries)?c.entries:{};c.entries={...a,...d}}else c[a]=d;return c}(l,d.data):l,n={updatedAt:new Date,data:m};void 0!==d.title&&(n.title=d.title),void 0!==d.description&&(n.description=d.description),void 0!==d.group&&(n.group=d.group),void 0!==d.type&&(n.type=d.type),void 0!==d.image&&(n.image=d.image),void 0!==d.path&&(n.path=d.path),void 0===d.title&&"string"==typeof m.title&&(n.title=m.title),void 0===d.description&&"string"==typeof m.description&&(n.description=m.description),void 0===d.group&&"string"==typeof m.group&&(n.group=m.group),void 0===d.type&&"string"==typeof m.type&&(n.type=m.type),await j.update(g.handoffComponents).set(n).where((0,c.eq)(g.handoffComponents.id,b)),await j.insert(g.editHistory).values({entityType:"component",entityId:b,userId:a.user.id??a.user.email??null,diff:{action:"update",updates:d}});let[o]=await j.select().from(g.handoffComponents).where((0,c.eq)(g.handoffComponents.id,b));o&&await (0,f.insertSyncEvent)({entityType:"component",entityId:b,action:"update",payload:{id:o.id,path:o.path,title:o.title,description:o.description,group:o.group,image:o.image,type:o.type,properties:o.properties,previews:o.previews,data:o.data,source:o.source},userId:(h=a.user,"string"==typeof(i=h?.id)&&i.length>0?i:null)})}a.i(429577);let j=`<head>
  {{{style}}}
  {{{script}}}
</head>
<body class="theme preview-body">
  <p>Hello from {{title}}</p>
</body>
`,k=`import React from 'react';

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
`,l=`import React from 'react';

const Demo = () => <div className="theme preview-body p-4">Story preview</div>;

export default {
  title: 'Demo',
  component: Demo,
};

export const Default = {
  render: () => <Demo />,
};
`,m=`/* component styles */
.preview-body { }
`,n=`// component client script
`,o=`import React from 'react';

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
`,p=`import React from 'react';

const Demo = () => <div className="theme preview-body p-4">Story preview</div>;

export default {
  title: 'Demo',
  component: Demo,
};

export const Default = {
  render: () => <Demo />,
};
`,q=`<head>
  {{{style}}}
  {{{script}}}
</head>
<body class="theme preview-body">
  <p>Hello from {{title}}</p>
</body>
`,r=`/* component styles */
.preview-body { }
`,s=`// component client script
`;var t=a.i(843405),u=a.i(200301),v=a.i(604929),w=a.i(925783);async function x(){let a=(0,v.getDataProvider)(),b=await a.getComponents(),c=b.slice().sort((a,b)=>(a.group||"").localeCompare(b.group||"")||a.id.localeCompare(b.id)),d=new Map;for(let a of c){let b=a.group?.trim()||"Uncategorized";d.has(b)||d.set(b,[]),d.get(b).push(a)}let e=`# Component catalog (generated)

`;for(let a of(e+=`Total: **${b.length}** components.

| ID | Title | Type | Props | Previews | JS |
| --- | --- | --- | --- | --- | --- |
`,c)){var f,g;let b=(!(f=a.previews)||"object"!=typeof f?[]:Object.keys(f)).join(", ")||"—";e+=`| \`${a.id}\` | ${y(a.title||"")} | ${y(a.type||"")} | ${!(g=a.properties)||"object"!=typeof g?0:Object.keys(g).length} | ${y(b)} | ${!function(a){if(!a||"object"!=typeof a)return!1;let b=a.entrySources;if(b&&"object"==typeof b){let a=b.js;if("string"==typeof a&&a.trim().length>20)return!0}return!1}(a.data)?"No":"Yes"} |
`}for(let[a,b]of(e+=`
## By group

`,[...d.entries()].sort((a,b)=>a[0].localeCompare(b[0])))){for(let c of(e+=`### ${y(a)}

`,b))e+=`- **${c.id}** — ${y(c.title||c.id)}
`;e+=`
`}return{content:e,metadata:{componentCount:b.length,generatedKind:"catalog"}}}function y(a){return a.replace(/\|/g,"\\|").replace(/\n/g," ").slice(0,120)}async function z(){let a=(0,v.getDataProvider)(),b=await a.getTokens(),c=b.localStyles||{},d=`# Design tokens (generated)

`,e=["color","typography","effect","spacing"];for(let a of e){let b=c[a];if(d+=`## ${a}

`,!Array.isArray(b)||0===b.length){d+=`_No entries._

`;continue}for(let a of(d+=`| Name | Value / line |
| --- | --- |
`,b.slice(0,200))){if(!a||"object"!=typeof a)continue;let b=String(a.name??a.id??""),c=String(a.line??a.value??JSON.stringify(a).slice(0,120));d+=`| ${y(b)} | ${y(c)} |
`}d+=`
`}let f=[];for(let a of(!function a(b,c,d,e=0){if(!(e>12)&&null!=b){if("string"==typeof b||"number"==typeof b||"boolean"==typeof b)return void d.push({path:c||"root",value:String(b)});if(Array.isArray(b))return void b.slice(0,40).forEach((b,f)=>{a(b,`${c}[${f}]`,d,e+1)});if("object"==typeof b)for(let[f,g]of Object.entries(b))a(g,c?`${c}.${f}`:f,d,e+1)}}(b,"",f),d+=`## CSS custom properties (sample)

| Path | Sample value |
| --- | --- |
`,f.filter(a=>a.value.includes("var(--")||a.path.toLowerCase().includes("css")).slice(0,80)))d+=`| ${y(a.path)} | ${y(a.value.slice(0,100))} |
`;return{content:d,metadata:{generatedKind:"tokens",localStyleKeys:e.filter(a=>Array.isArray(c[a])&&c[a].length>0)}}}let A=/\bfa[a-z0-9-]*\s+fa-[a-z0-9-]+\b/gi,B=/<svg[\s\S]*?<\/svg>/gi;async function C(){let a=(0,v.getDataProvider)(),b=await a.getComponents(),c=new Map,d=0;for(let a of b)for(let b of function(a){if(!a||"object"!=typeof a)return[];let b=a.entrySources,c=[];if(b&&"object"==typeof b)for(let a of Object.values(b))"string"==typeof a&&c.push(a);return c}(a.data)){for(let a of b.matchAll(A)){let b=a[0].toLowerCase();c.set(b,(c.get(b)??0)+1)}let a=b.match(B);a&&(d+=a.length)}let e=[...c.entries()].sort((a,b)=>b[1]-a[1]).slice(0,200),f=`# Icons and icon-like markup (generated)

`;if(f+=`Scanned **${b.length}** component template sources.

## Font Awesome–style classes (frequency)

`,0===e.length)f+=`_None detected._

`;else for(let[a,b]of(f+=`| Class pattern | Uses |
| --- | --- |
`,e))f+=`| \`${y(a)}\` | ${b} |
`;return{content:f+=`
## Inline SVG

Total SVG fragments found: **${d}**.
`,metadata:{generatedKind:"icons",faDistinct:e.length,svgFragments:d}}}async function D(){let a=(0,v.getDataProvider)(),b=await a.getComponents(),c=new Map;for(let a of b){let b=a.properties;if(b&&"object"==typeof b)for(let[d,e]of Object.entries(b)){let b=function(a,b){try{return JSON.stringify({name:a,shape:function a(b,c=0){if(c>6)return"…";if(!b||"object"!=typeof b)return typeof b;let d={type:b.type};return Array.isArray(b.properties)&&(d.properties=b.properties.map(b=>b&&"object"==typeof b?a(b,c+1):b)),b.items&&"object"==typeof b.items&&(d.items=a(b.items,c+1)),d}(b)})}catch{return JSON.stringify({name:a,shape:"unknown"})}}(d,e),f=c.get(b);f?(f.count+=1,f.exampleIds.length<5&&!f.exampleIds.includes(a.id)&&f.exampleIds.push(a.id)):c.set(b,{json:b,count:1,exampleIds:[a.id]})}}let d=[...c.values()].filter(a=>a.count>=2).sort((a,b)=>b.count-a.count),e=`# Property pattern frequency (algorithmic)

`;for(let a of(e+=`Pairs of property name + structural shape appearing in **2+** components.

| Occurrences | Example component IDs | Shape (JSON) |
| --- | --- | --- |
`,d.slice(0,120)))e+=`| ${a.count} | ${a.exampleIds.map(a=>`\`${a}\``).join(", ")} | \`${y(a.json.slice(0,240))}\` |
`;return{content:e,metadata:{generatedKind:"property-patterns-raw",patternCount:d.length}}}async function E(a,b){if(!process.env.HANDOFF_AI_API_KEY?.trim())return`${a}

---

_(LLM refinement skipped: HANDOFF_AI_API_KEY not set.)_
`;let c=`You are a design-system documentation assistant. Given a frequency table of Handoff component property shapes, produce a concise markdown guide with:
- Sections per recurring pattern (heading, CTA, image, link, arrays, toggles, etc.) when inferrable from property names/types
- Copy-paste friendly **JSON snippets** for a single representative property definition (Handoff metadata shape: name, description, type, default, rules)
- Short usage notes for authors implementing new components
Keep under 8000 characters. Respond with JSON only: { "markdown": "<markdown body>" }. Escape newlines in markdown as \\n inside the JSON string.`,d=`Here is the raw frequency analysis:

${a.slice(0,12e3)}`,e=await (0,w.openAiChatJson)([{role:"system",content:c},{role:"user",content:d}],{actorUserId:b.actorUserId,route:"reference-material-generator",eventType:"ai.reference_property_patterns",model:process.env.HANDOFF_REFERENCE_MODEL?.trim()||"gpt-4.1-mini"});try{let a=JSON.parse(e);if("string"==typeof a.markdown&&a.markdown.trim())return a.markdown.replace(/\\n/g,"\n")}catch{}return"string"==typeof e&&e.trim()?e.trim():a}async function F(a){let b=await D(),c=b.content;return{content:c=a.skipLlm?`${b.content}

---

_(LLM refinement skipped.)_
`:await E(c,{actorUserId:a.actorUserId}),metadata:{...b.metadata,llmRefined:!a.skipLlm}}}async function G(a,b={}){switch(a){case"catalog":return x();case"tokens":return z();case"icons":return C();case"property-patterns":return F({actorUserId:b.actorUserId,skipLlm:b.skipLlm});default:throw Error(`Unknown reference material: ${a}`)}}async function H(a={}){let b={};for(let c of["catalog","tokens","icons","property-patterns"])"property-patterns"!==c&&(b[c]=await G(c,a));return b["property-patterns"]=await G("property-patterns",a),b}var I=a.i(255929);async function J(a={}){let b=await H(a);for(let a of I.REFERENCE_MATERIAL_IDS){let c=b[a];await (0,u.upsertReferenceMaterial)(a,c.content,c.metadata)}}function K(a){(0,t.after)(()=>{J(a??{}).catch(a=>{console.error("[reference-material-schedule] regenerate failed",a)})})}function L(a){let b=a?.id;return"string"==typeof b&&b.length>0?b:null}function M(a){if(!a?.user)throw Error("Unauthorized");if("admin"!==a.user.role)throw Error("Forbidden")}async function N(a){var b;let i,t,u,v=await (0,d.auth)();M(v);let w=(0,e.getDb)();if(!((i=a.id.trim()).length>0&&i.length<=128&&h.test(i)))throw Error("Invalid component ID: use 1–128 characters, start with a letter or number, and use only lowercase letters, numbers, and hyphens.");let x=a.payload??(u=(t=function(a){let{id:b,title:c,group:d,renderer:e,description:f=""}=a,g="react"===e?{[`${b}.tsx`]:k,[`${b}.scss`]:m,[`${b}.client.js`]:n}:"csf"===e?{[`${b}.stories.tsx`]:l,[`${b}.scss`]:m,[`${b}.client.js`]:n}:{[`${b}.hbs`]:j,[`${b}.scss`]:m,[`${b}.client.js`]:n},h={};return g[`${b}.tsx`]&&(h.component=g[`${b}.tsx`]),g[`${b}.stories.tsx`]&&(h.story=g[`${b}.stories.tsx`]),g[`${b}.hbs`]&&(h.template=g[`${b}.hbs`]),g[`${b}.scss`]&&(h.scss=g[`${b}.scss`]),g[`${b}.client.js`]&&(h.js=g[`${b}.client.js`]),{id:b,path:`/system/component/${b}`,title:c,description:f,group:d,image:"",type:"element",renderer:e,categories:[],tags:[],should_do:[],should_not_do:[],previews:{default:{title:"Default",values:{},url:""}},properties:{},entrySources:h}}(b={id:a.id,title:a.title,group:a.group??"",renderer:a.renderer??"handlebars",description:a.description})).entrySources,u="react"===b.renderer?{component:o,scss:r,js:s}:"csf"===b.renderer?{story:p.replace(/motion\./g,""),scss:r,js:s}:{template:q,scss:r,js:s},{...t,entrySources:u}),[y]=await w.select({id:g.handoffComponents.id}).from(g.handoffComponents).where((0,c.eq)(g.handoffComponents.id,a.id));if(y)throw Error(`Component "${a.id}" already exists`);return await w.insert(g.handoffComponents).values({id:a.id,title:a.title,description:a.description??"",group:a.group??"",type:a.type??"element",data:x,source:"db"}),await w.insert(g.editHistory).values({entityType:"component",entityId:a.id,userId:v.user.id??v.user.email??null,diff:{action:"create",data:a}}),await (0,f.insertSyncEvent)({entityType:"component",entityId:a.id,action:"create",payload:{id:a.id,title:a.title,description:a.description??"",group:a.group??"",type:a.type??"element",data:x},userId:L(v.user)}),K({actorUserId:v.user.id??void 0,skipLlm:!1}),{success:!0}}async function O(a,b){let c=await (0,d.auth)();return M(c),await i(c,a,b),K({actorUserId:c.user.id??void 0,skipLlm:!1}),{success:!0}}async function P(a){let b=await (0,d.auth)();M(b);let h=(0,e.getDb)();return await (0,f.insertSyncEvent)({entityType:"component",entityId:a,action:"delete",payload:{id:a},userId:L(b.user)}),await h.delete(g.handoffComponents).where((0,c.eq)(g.handoffComponents.id,a)),await h.insert(g.editHistory).values({entityType:"component",entityId:a,userId:b.user.id??b.user.email??null,diff:{action:"delete"}}),{success:!0}}(0,a.i(713095).ensureServerEntryExports)([N,O,P]),(0,b.registerServerReference)(N,"403679f4664c8fdfcb741602d373263eda36611157",null),(0,b.registerServerReference)(O,"600c52a2282519291499e708fa9b1550085b524f9e",null),(0,b.registerServerReference)(P,"4057bd59830d0c6b4f22a4e9208016ca6cd73bf0ac",null),a.s([],441779),a.i(441779),a.s(["403679f4664c8fdfcb741602d373263eda36611157",0,N],111459)}];

//# sourceMappingURL=_next-internal_server_app_app_system_page_actions_0wy9nhk.js.map