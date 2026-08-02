module.exports=[855786,48110,e=>{"use strict";var t=e.i(63728),n=e.i(292746),a=e.i(774296),o=e.i(961613),s=e.i(225536),i=e.i(851898),r=e.i(566716);let l=e=>"string"==typeof e?e:null==e?"":String(e);async function c(e){try{let t=await (0,s.getDataProvider)().getDtcgTokenStrings(e);if(!t?.dtcg)return[];let n=[];return!function e(t,n,a){if(t&&"object"==typeof t&&!(a.length>=60)){if("$value"in t)return void a.push({name:n.join("."),value:l(t.$value),reference:`var(--${n.join("-")})`});for(let[o,s]of Object.entries(t))o.startsWith("$")||e(s,[...n,o],a)}}(JSON.parse(t.dtcg),[],n),n}catch{return[]}}async function d(){var e,t;let n={};try{n=(await (0,s.getDataProvider)().getTokens()??{}).localStyles??{}}catch{n={}}let[a,o]=await Promise.all([c("spacing"),c("border-radius")]);return{colors:(Array.isArray((e=n).color)?e.color:[]).slice(0,60).map(e=>({name:l(e.name),value:l(e.value),reference:l(e.reference)||l(e.sass)||l(e.machineName)})),typography:(Array.isArray((t=n).typography)?t.typography:[]).slice(0,60).map(e=>{let t=e.values??{},n=l(t.fontSize),a=l(t.lineHeightPx),o=[l(t.fontFamily),l(t.fontWeight),n&&a?`${n}/${a}`:n].filter(Boolean);return{name:l(e.name),value:o.join(" "),reference:l(e.reference)||l(e.machine_name)||l(e.machineName)}}),spacing:a,radii:o}}async function p(e){if(!Array.isArray(e)||0===e.length)return[];try{let t=(0,s.getDataProvider)(),n=[];for(let a of e){if(!a||"object"!=typeof a)continue;let e="string"==typeof a.id?a.id.trim():"";if(!e)continue;let o=await t.getComponent(e);o&&n.push({id:e,title:o.title||e,propsJson:JSON.stringify(o.properties??{},null,2).slice(0,4e3)})}return n}catch{return[]}}async function u(){let e=(0,s.getDataProvider)(),t=await e.getComponentSummaries().then(e=>(e??[]).slice(0,120).map(e=>{let t="string"==typeof e.id?e.id:"",n="string"==typeof e.title?e.title:t,a="string"==typeof e.group&&e.group?` [${e.group}]`:"";return`${t} — ${n}${a}`})).catch(()=>[]),n=await e.getPatterns().then(e=>(e??[]).slice(0,120).map(e=>{let t="string"==typeof e.id?e.id:"",n="string"==typeof e.title?e.title:t;return`${t} — ${n}`})).catch(()=>[]);return{components:t.filter(Boolean),patterns:n.filter(Boolean)}}function h(e){try{return JSON.parse(e.replace(/^```(?:json)?\s*/m,"").replace(/```\s*$/m,"").trim())}catch{return null}}async function g(e,n){let a=await (0,t.getDesignArtifactById)(e),o=a?.metadata&&"object"==typeof a.metadata&&!Array.isArray(a.metadata)?{...a.metadata}:{};o.specError=n,await (0,t.updateDesignArtifactById)(e,{specStatus:"failed",metadata:o}).catch(()=>void 0)}async function m(e){if(!process.env.HANDOFF_AI_API_KEY?.trim())return void await g(e,"HANDOFF_AI_API_KEY is not configured on the server.");await (0,t.updateDesignArtifactById)(e,{specStatus:"generating"});try{var n;let s,l,c,m,f,y=await (0,t.getDesignArtifactById)(e);if(!y?.imageUrl?.trim())return void await g(e,"No composite image on artifact.");let v=Array.isArray(y.assets)?y.assets:[],$=v.find(e=>"annotated_overview"===e.key)??v[0],w=$?.imageUrl??y.imageUrl,b=v.filter(e=>"annotated_overview"!==e.key).map(e=>e.key),x=function(e){if(!Array.isArray(e))return[];let t=[],n=/"([^"]{2,120})"/g,a=/(?:label|text|copy|says?|reads?|titled?|named?|called?|button|heading|placeholder)[:\s]+["']?([A-Z][^"'\n]{2,80})/gi;for(let o of e){let e;if(!o||"object"!=typeof o||"user"!==o.role||"string"!=typeof o.prompt)continue;let s=o.prompt;for(n.lastIndex=0;null!==(e=n.exec(s));){let n=e[1].trim();n.length>=3&&!t.includes(n)&&t.push(n)}for(a.lastIndex=0;null!==(e=a.exec(s));){let n=e[1].trim().replace(/["']$/,"");n.length>=3&&!t.includes(n)&&t.push(n)}}return t.slice(0,20)}(y.conversationHistory),A=await p(y.componentGuides),S=await (0,o.imageUrlToVisionPart)(w,"high"),k={componentType:"other",suggestedName:y.title||"Component",visibleStates:b.filter(e=>e.startsWith("state_")).map(e=>e.replace("state_","")),subComponents:[],hasIcons:b.includes("icons"),hasMedia:b.includes("media"),complexity:"medium"};k.visibleStates.length||(k.visibleStates=["default"]);let N=JSON.stringify(k,null,2),[I,C,D]=await Promise.all([(0,i.getDesignWorkspace)().catch(()=>null),d().catch(()=>null),u().catch(()=>({components:[],patterns:[]}))]),E=C&&!(!C.colors.length&&!C.typography.length&&!C.spacing.length&&!C.radii.length)?(s=(e,t)=>{if(!t.length)return"";let n=t.map(e=>`- ${e.name} = ${e.value}${e.reference?`  → ${e.reference}`:""}`);return`
### ${e}
${n.join("\n")}`})("Colors",C.colors)+s("Typography",C.typography)+s("Spacing",C.spacing)+s("Border radius",C.radii):"",O=I?(0,r.formatBrandVoiceForPrompt)(I.brandVoice).trim():"",T=D.components.length>0||D.patterns.length>0,P=(e,t,n,o,s)=>{let i=[{role:"system",content:e}];return n&&S?i.push({role:"user",content:[{type:"text",text:t},S]}):i.push({role:"user",content:t}),(0,a.openAiChatJson)(i,{actorUserId:y.userId,route:"design-spec-generate",eventType:o,model:process.env.HANDOFF_SPEC_MODEL?.trim()||process.env.HANDOFF_AI_MODEL?.trim()||"gpt-4.1",maxTokens:s})},[L,R]=await Promise.all([P(function(e){let{classificationJson:t,extractedAssetKeys:n,copyFromPrompt:a,existingComponents:o,designMd:s}=e,i="";o.length>0&&(i=`

## Existing component schemas to match against
`+o.map(e=>`### ${e.title} (id: ${e.id})
${e.propsJson}`).join("\n\n"));let r=a.length>0?`

## UI copy strings extracted from the design prompt
${a.map(e=>`- "${e}"`).join("\n")}`:"",l=s?`

## Team design guidelines
${s.slice(0,2e3)}`:"";return`You are generating a detailed component specification from a UI design screenshot and extracted assets.

## Classification
${t}

## Extracted asset keys (use these as variant keys where applicable)
${n.join(", ")}
${r}${i}${l}

## Instructions
Generate a complete ComponentSpec JSON object. Follow this EXACT schema — every field is required:

{
  "version": 1,
  "generatedAt": "<ISO timestamp>",
  "overview": {
    "name": "<PascalCase component name>",
    "description": "<1-2 sentence description>",
    "type": "<atom|molecule|organism|template|pattern|other>",
    "designSystemGroup": "<group name e.g. Inputs, Navigation, Feedback>",
    "summary": "<2-3 sentence design and purpose summary>"
  },
  "variants": [
    { "key": "<asset key or 'default'>", "name": "<display name>", "description": "<what differs>", "isDefault": true|false }
  ],
  "props": [
    { "name": "<propName>", "type": "<string|boolean|enum|number|ReactNode|function>", "required": true|false, "defaultValue": "<if any>", "options": ["<for enum>"], "description": "<purpose>" }
  ],
  "behavior": {
    "interactions": [{ "trigger": "<click|hover|focus|keydown|change>", "action": "<what happens>" }],
    "transitions": ["<animation note>"],
    "edgeCases": ["<empty state, overflow, loading, etc.>"]
  },
  "accessibility": {
    "ariaRole": "<role>",
    "requiredAriaAttributes": ["<aria-label>", "<aria-expanded>", ...],
    "keyboardNav": [{ "key": "<Tab|Enter|Space|Arrow>", "action": "<what happens>" }],
    "screenReaderNotes": "<what a screen reader user experiences>",
    "wcagTarget": "AA"
  },
  "content": {
    "textInventory": [
      { "text": "<visible text>", "role": "<heading|label|button|body|placeholder|error|badge|helper|link>", "location": "<where in component>", "editable": true|false }
    ],
    "copyFromPrompt": ${JSON.stringify(a)},
    "rules": [{ "field": "<field name>", "maxLength": <number or omit>, "notes": "<guideline>" }]
  },
  "implementation": {
    "existingComponentMatches": ${o.length>0?`[
      {
        "componentId": "<matched component id or empty string>",
        "componentTitle": "<matched component title>",
        "matchLevel": "<exact|variation|similar>",
        "confidence": <0.0-1.0>,
        "propMapping": [{ "specProp": "<spec prop name>", "existingProp": "<existing prop name>", "suggestedValue": "<value if deterministic>" }],
        "missingProps": ["<props in spec not found in existing component>"],
        "sampleConfig": { "<existingProp>": "<value>" },
        "recommendation": "<one sentence — e.g. Use Button with variant=primary"
      }
    ]`:"[]"},
    "dependencies": ["<other component ids this depends on>"],
    "cssNotes": "<LAYOUT and STRUCTURE notes only — grid/columns, stacking, alignment, overflow, responsive behaviour. No concrete colour, size, spacing or radius values.>",
    "developerHints": ["<hint>"]
  }
}

Rules:
- Include at least 1 variant (default). Add more for each extracted state key.
- textInventory: transcribe ALL visible text in the design image.
- copyFromPrompt: use the provided array verbatim.
- If existing components were provided, evaluate each for matchLevel and fill existingComponentMatches accordingly.
- cssNotes and developerHints: describe LAYOUT and STRUCTURE only. Do NOT state specific hex colours,
  font sizes, spacing values or border radii. Those are resolved separately against the design
  system's real tokens, and a guess here contradicts that mapping — on a live run this section
  claimed "Teal (#00A3BF)" and "8px border-radius" for a design whose actual tokens were #04888a and
  12px. Describe the intent ("primary action colour", "card corner radius") and let the token
  mapping supply the value.
- Return ONLY valid JSON — no markdown, no commentary.`}({classificationJson:N,extractedAssetKeys:["default",...b],copyFromPrompt:x,existingComponents:A,designMd:I?.designMd??""}),"Generate the ComponentSpec JSON for this design:",!0,"ai.design_spec_generate",4e3),E?P((n={tokenSummary:E},`You map the visual values in a UI design onto a design system's REAL tokens.

## The design system's tokens — match against THESE ONLY
${n.tokenSummary}

## Instructions
Read the colours, type, spacing and corner radii off the design image and return ONLY this JSON:
{
  "colors": [
    { "observed": "<value read off the design, e.g. #EBEAE1>", "usage": "<where, e.g. section background>", "token": "<exact token name from above, or null>", "reference": "<the → reference for that token, or null>", "matchLevel": "<exact|close|none>", "note": "<required unless exact: why, and what to do>" }
  ],
  "typography": [ { "observed": "<family weight size/lineheight>", "usage": "<e.g. headline>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
  "spacing": [ { "observed": "<e.g. 32px>", "usage": "<e.g. gap between CTAs>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
  "radii": [ { "observed": "<e.g. 8px>", "usage": "<e.g. button corners>", "token": "<name|null>", "reference": "<ref|null>", "matchLevel": "<exact|close|none>", "note": "<...>" } ],
  "coverage": <0.0-1.0 — share of observed values with matchLevel "exact">,
  "notes": "<one or two sentences on overall design-system adherence>"
}

Rules:
- NEVER invent a token name. Use only names from the list above; when an observed value has no counterpart there, set token and reference to null with matchLevel "none" and say so in note. An honest "off-system" is far more useful than a false match.
- Use "close" when the value is within a couple of units/shades of a real token — that is the actionable case ("snap this to X"), so always name the token you would snap to.
- Estimate spacing and radii in pixels; approximate is fine, say so in note.
- Return ONLY valid JSON — no markdown, no commentary.`),"Map this design onto the design system tokens:",!0,"ai.design_spec_tokens",2500).then(e=>h(e)).catch(t=>(console.warn("[design-spec-generator] tokens section failed",e,t),null)):Promise.resolve(null)]),j=function(e,t){try{let n=e.replace(/^```(?:json)?\s*/m,"").replace(/```\s*$/m,"").trim(),a=JSON.parse(n);if(!a.overview||!a.props)return null;return a.overview.name||(a.overview.name=t),a.version=1,a.generatedAt||(a.generatedAt=new Date().toISOString()),a}catch{return null}}(L,y.title||"Component");if(!j)return void await g(e,"The model returned a specification that could not be parsed. Re-run the dev handoff.");R&&(j.tokens=R);let[_,F]=await Promise.all([T?P(function(e){let{specSummary:t,reuseCatalog:n}=e;return`You decide whether a new UI design should be COMPOSED from a design system's existing parts, or genuinely built new.

## The design
${t}

## What the team ALREADY has
${n.components.length?`### Existing components
${n.components.map(e=>`- ${e}`).join("\n")}`:""}
${n.patterns.length?`
### Existing patterns (already-composed layouts)
${n.patterns.map(e=>`- ${e}`).join("\n")}`:""}

## Instructions
Return ONLY this JSON:
{
  "candidates": [
    { "componentId": "<id from the list above>", "title": "<its title>", "role": "<which part of THIS design it would cover>", "confidence": <0.0-1.0>, "note": "<how it would be used, or what would need to change>" }
  ],
  "patterns": [ { "patternId": "<id from the list above>", "title": "<its title>", "note": "<why it fits>" } ],
  "compositionScore": <0.0-1.0 — share of this design buildable from the lists above>,
  "recommendation": "<one or two sentences: compose from what exists, or genuinely build new — and why>"
}

Rules:
- Default to composition. Assume the design SHOULD be built from existing parts, and conclude otherwise only when nothing fits.
- Break the design into its parts and name a candidate for each part you can.
- Use ONLY ids that appear above. NEVER invent one.
- List near-misses too, saying in note what would need to change — an adaptable near-miss beats silence.
- If an existing pattern already covers the whole layout, say so plainly in recommendation.
- Return ONLY valid JSON — no markdown, no commentary.`}({specSummary:(l=j.overview??{},c=[`Name: ${l.name??"Component"}`,`Type: ${l.type??"other"}${l.designSystemGroup?` (group: ${l.designSystemGroup})`:""}`,l.summary?`Summary: ${l.summary}`:"",l.description?`Description: ${l.description}`:""].filter(Boolean),(m=(j.content?.textInventory??[]).slice(0,24).map(e=>`  - [${e.role}] "${e.text}"${e.location?` (${e.location})`:""}`)).length&&c.push("","Visible content:",...m),(f=(j.props??[]).slice(0,20).map(e=>`  - ${e.name}: ${e.type}`)).length&&c.push("","Props identified:",...f),c.join("\n")),reuseCatalog:D}),"Decide what this design should be composed from:",!1,"ai.design_spec_reuse",2e3).then(e=>h(e)).catch(t=>(console.warn("[design-spec-generator] reuse section failed",e,t),null)):Promise.resolve(null),(()=>{let t;if(!O)return Promise.resolve(null);let n=(t=(j.content?.textInventory??[]).filter(e=>"string"==typeof e.text&&e.text.trim().length>1).map(e=>({text:e.text.trim(),role:e.role||"body"}))).length?t.slice(0,40):x.slice(0,40).map(e=>({text:e,role:"body"}));return n.length?P(function(e){let{copyStrings:t,brandVoice:n}=e;return`You check UI copy against a brand's voice guidelines.

## Brand voice guidelines
${n.slice(0,6e3)}

## The copy in this design
${t.map(e=>`- [${e.role}] "${e.text}"`).join("\n")}

## Instructions
Return ONLY this JSON:
{
  "findings": [
    { "text": "<the copy string>", "role": "<heading|subhead|cta|body|label>", "verdict": "<pass|warn|fail>", "rule": "<banned-phrase|length|tone|preferred-phrase>", "detail": "<what the guideline says and how this copy measures up>", "suggestion": "<concrete rewrite — required when verdict is warn or fail>" }
  ],
  "bannedPhrasesFound": ["<only phrases from the guidelines' avoid list that literally appear>"],
  "score": <0.0-1.0 — share of findings with verdict "pass">,
  "summary": "<one sentence>"
}

Rules:
- Check every heading, subhead and CTA. Apply length rules literally — count the words.
- Any phrase on the avoid list is verdict "fail".
- bannedPhrasesFound must contain only phrases that LITERALLY appear in the copy. Do not list a phrase because the copy is similar in spirit.
- If the guidelines contradict each other on a phrase, say so in that finding's detail rather than guessing.
- Return ONLY valid JSON — no markdown, no commentary.`}({copyStrings:n,brandVoice:O}),"Check this copy against the brand voice:",!1,"ai.design_spec_voice",2e3).then(e=>h(e)).catch(t=>(console.warn("[design-spec-generator] voice section failed",e,t),null)):Promise.resolve(null)})()]);_&&(j.reuse=_),F&&(j.voice=F),j.generatedAt=new Date().toISOString(),await (0,t.updateDesignArtifactById)(e,{componentSpec:j,componentSpecMd:function(e){let t=[];if(t.push(`# ${e.overview.name}`),t.push(""),t.push(`**Type:** ${e.overview.type} \xb7 **Group:** ${e.overview.designSystemGroup}`),t.push(""),t.push(e.overview.summary||e.overview.description),e.variants.length>0)for(let n of(t.push("","## Variants"),e.variants))t.push(`- **${n.name}**${n.isDefault?" *(default)*":""}: ${n.description}`);if(e.props.length>0)for(let n of(t.push("","## Props"),t.push("| Prop | Type | Required | Default | Description |"),t.push("|------|------|----------|---------|-------------|"),e.props)){let e=n.options&&n.options.length?`\`${n.options.join(" | ")}\``:`\`${n.type}\``;t.push(`| \`${n.name}\` | ${e} | ${n.required?"✓":"—"} | ${n.defaultValue?`\`${n.defaultValue}\``:"—"} | ${n.description} |`)}if(e.behavior.interactions.length>0||e.behavior.edgeCases.length>0){if(t.push("","## Behavior"),e.behavior.interactions.length>0)for(let n of(t.push("","**Interactions**"),e.behavior.interactions))t.push(`- **${n.trigger}** → ${n.action}`);if(e.behavior.transitions.length>0)for(let n of(t.push("","**Transitions**"),e.behavior.transitions))t.push(`- ${n}`);if(e.behavior.edgeCases.length>0)for(let n of(t.push("","**Edge cases**"),e.behavior.edgeCases))t.push(`- ${n}`)}if(t.push("","## Accessibility"),t.push(`- **ARIA role:** \`${e.accessibility.ariaRole}\``),e.accessibility.requiredAriaAttributes.length>0&&t.push(`- **Required attributes:** ${e.accessibility.requiredAriaAttributes.map(e=>`\`${e}\``).join(", ")}`),e.accessibility.keyboardNav.length>0)for(let n of(t.push("","**Keyboard navigation**"),e.accessibility.keyboardNav))t.push(`- \`${n.key}\` → ${n.action}`);if(e.accessibility.screenReaderNotes&&t.push("",`**Screen reader:** ${e.accessibility.screenReaderNotes}`),t.push(`- **WCAG target:** ${e.accessibility.wcagTarget}`),e.content.textInventory.length>0){for(let n of(t.push("","## Content"),t.push("","**Text inventory**"),e.content.textInventory))t.push(`- \`${n.role}\` \xb7 *${n.location}*: "${n.text}"${n.editable?" *(prop)*":""}`);if(e.content.copyFromPrompt.length>0)for(let n of(t.push("","**Copy from design prompt**"),e.content.copyFromPrompt))t.push(`- "${n}"`);if(e.content.rules.length>0)for(let n of(t.push("","**Rules**"),e.content.rules))t.push(`- **${n.field}**${n.maxLength?` (max ${n.maxLength} chars)`:""}: ${n.notes}`)}if(e.implementation.existingComponentMatches.length>0){let n=e.implementation.existingComponentMatches.sort((e,t)=>t.confidence-e.confidence)[0];n.confidence>=.5&&(t.push("","## Existing component match"),t.push(`**${n.componentTitle}** (confidence: ${Math.round(100*n.confidence)}%, match: ${n.matchLevel})`),t.push("",n.recommendation),Object.keys(n.sampleConfig).length>0&&t.push("","```json",JSON.stringify(n.sampleConfig,null,2),"```"))}if(e.implementation.cssNotes||e.implementation.developerHints.length>0){for(let n of(t.push("","## Implementation notes"),e.implementation.cssNotes&&t.push(e.implementation.cssNotes),e.implementation.developerHints))t.push(`- ${n}`);e.tokens&&t.push("","> Concrete colour, type, spacing and radius values are resolved in **Design tokens** below — use those, not any values named here.")}if(e.reuse&&(e.reuse.candidates?.length||e.reuse.patterns?.length||e.reuse.recommendation)){let n=e.reuse;if(t.push("","## Build from what exists","",`Composition score: **${Math.round((n.compositionScore??0)*100)}%**`),n.recommendation&&t.push("",`**${n.recommendation}**`),n.patterns?.length)for(let e of(t.push("","### Existing patterns that already fit",""),n.patterns))t.push(`- **${e.title}** (\`${e.patternId}\`) — ${e.note}`);if(n.candidates?.length)for(let e of(t.push("","### Existing components to compose from","","| Component | Covers | Confidence | Notes |","|---|---|---|---|"),n.candidates))t.push(`| **${e.title}** \`${e.componentId}\` | ${e.role} | ${Math.round((e.confidence??0)*100)}% | ${e.note} |`)}if(e.tokens){let n=e.tokens,a=[["Color",n.colors??[]],["Typography",n.typography??[]],["Spacing",n.spacing??[]],["Radius",n.radii??[]]];if(a.some(([,e])=>e.length>0)){for(let[e,o]of(t.push("","## Design tokens","",`Token coverage: **${Math.round((n.coverage??0)*100)}%**`),n.notes&&t.push("",n.notes),a))if(o.length)for(let n of(t.push("",`### ${e}`,"","| Observed | Used for | Token | Reference | Match |","|---|---|---|---|---|"),o)){let e="exact"===n.matchLevel?"✅ exact":"close"===n.matchLevel?"⚠️ close":"❌ off-system";t.push(`| \`${n.observed}\` | ${n.usage} | ${n.token??"—"} | ${n.reference?`\`${n.reference}\``:"—"} | ${e} |`),n.note&&"exact"!==n.matchLevel&&t.push(`| | | | | ${n.note} |`)}}}if(e.voice){let n=e.voice;if(t.push("","## Brand voice","",`Voice compliance: **${Math.round((n.score??0)*100)}%**`),n.summary&&t.push("",n.summary),n.bannedPhrasesFound?.length&&t.push("",`> ⚠️ Contains phrases on the avoid list: ${n.bannedPhrasesFound.map(e=>`"${e}"`).join(", ")}`),n.findings?.length)for(let e of(t.push("","| Copy | Role | Verdict | Notes |","|---|---|---|---|"),n.findings)){let n="pass"===e.verdict?"✅":"warn"===e.verdict?"⚠️":"❌",a=e.suggestion?`${e.detail} — *suggested:* "${e.suggestion}"`:e.detail;t.push(`| "${e.text}" | ${e.role} | ${n} ${e.verdict} | ${a} |`)}}return t.join("\n")}(j),specStatus:"done"}),console.log("[design-spec-generator] spec generated for",e,j.overview.name,`(tokens:${j.tokens?"y":"n"} reuse:${j.reuse?"y":"n"} voice:${j.voice?"y":"n"})`)}catch(t){console.error("[design-spec-generator] failed",e,t),await g(e,t instanceof Error?t.message.slice(0,2e3):"Specification generation failed.")}}e.s(["generateSpecForArtifact",0,m],48110);let f=new Set(["pending","extracting"]),y=new Set(["pending","generating"]);function v(e,t){if(!e||"object"!=typeof e||Array.isArray(e))return null;let n=e[t];return"string"==typeof n&&n.trim()?n:null}function $(e){var t;let n,a,o,s,i;return n=((t={assetsStatus:e.assetsStatus,specStatus:e.specStatus,metadata:e.metadata}).assetsStatus??"none").trim()||"none",a=(t.specStatus??"none").trim()||"none",o=v(t.metadata,"assetsExtractionError"),s=v(t.metadata,"specError"),i={assetsStatus:n,specStatus:a},"none"===n&&"none"===a?{...i,stage:"not_started",running:!1,progress:0,label:"Not started",error:null,warning:null}:f.has(n)?{...i,stage:"extracting_assets",running:!0,progress:"pending"===n?.1:.35,label:"Extracting assets",error:null,warning:null}:y.has(a)?{...i,stage:"generating_spec",running:!0,progress:"pending"===a?.55:.75,label:"Generating specification",error:null,warning:"failed"===n?o??"Asset extraction failed; specifying from the original image.":null}:"done"===a?{...i,stage:"ready",running:!1,progress:1,label:"Ready for dev",error:null,warning:"failed"===n?o??"Asset extraction failed — the spec was generated from the original image.":null}:"failed"===a||"failed"===n?{...i,stage:"failed",running:!1,progress:0,label:"Failed",error:s??o??"The dev handoff failed without recording a reason.",warning:null}:{...i,stage:"not_started",running:!1,progress:.4*("done"===n),label:"done"===n?"Assets extracted — no specification yet":"Not started",error:null,warning:null}}let w=["spec"];async function b(e,n){let a=n.stages??w,o=a.includes("assets"),s=a.includes("spec"),i={};o?(i.assetsStatus="pending",n.clearAssets&&(i.assets=[])):i.assetsStatus="none",s&&(i.specStatus="pending");let r=await (0,t.getDesignArtifactById)(e);if(!r)return!1;if(r.metadata&&"object"==typeof r.metadata&&!Array.isArray(r.metadata)){let e={...r.metadata};delete e.assetsExtractionError,s&&delete e.specError,i.metadata=e}return(0,t.updateDesignArtifactById)(e,i)}async function x(e,t={}){let a=e.trim(),o=t.stages??w;if(o.includes("assets"))try{await (0,n.runDesignAssetExtractionForArtifact)(a,{timeoutMs:t.budgetMs??12e4})}catch(e){console.error("[dev-handoff] asset extraction threw",a,e)}o.includes("spec")&&console.log("[dev-handoff] specification queued for cron pickup",a)}async function A(t,n={}){let a,{claimDesignArtifactForSpec:o}=await e.A(711196);if(!await o(t))return!1;let s=n.budgetMs??24e4;try{await Promise.race([m(t).then(()=>!1),new Promise(e=>{a=setTimeout(()=>e(!0),s)})])&&await S(t,`Specification generation exceeded ${Math.round(s/1e3)}s and was abandoned. Re-run the dev handoff.`)}catch(e){console.error("[dev-handoff] queued spec generation threw",t,e),await S(t,e instanceof Error?e.message.slice(0,2e3):"Specification generation failed.")}finally{a&&clearTimeout(a)}return!0}async function S(e,n){try{let a=await (0,t.getDesignArtifactById)(e),o=a?.metadata&&"object"==typeof a.metadata&&!Array.isArray(a.metadata)?{...a.metadata}:{};o.specError=n,await (0,t.updateDesignArtifactById)(e,{specStatus:"failed",metadata:o})}catch(t){console.error("[dev-handoff] could not mark spec failed",e,t)}}async function k(e){let n=await (0,t.getDesignArtifactById)(e.trim());return n?$(n):null}e.s(["devHandoffStatusForRow",0,$,"getDevHandoffStatus",0,k,"markDevHandoffQueued",0,b,"runDevHandoff",0,x,"runQueuedSpecGeneration",0,A],855786)}];

//# sourceMappingURL=src_app_lib_server_dev-handoff_ts_0cvzu~5._.js.map