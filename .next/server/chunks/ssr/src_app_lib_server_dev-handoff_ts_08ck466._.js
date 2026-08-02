module.exports=[507439,587783,a=>{"use strict";var b=a.i(200301),c=a.i(925783),d=a.i(348160);async function e(a,b="high"){let c=a.trim();if(!c)return null;if(c.startsWith("data:image/"))return{type:"image_url",image_url:{url:c,detail:b}};let f=(0,d.blobPathnameFromProxyUrl)(c);if(f){let a=await (0,d.readPrivateBlob)(f);if(!a)return null;let c=a.contentType.startsWith("image/")?a.contentType:"image/png";return{type:"image_url",image_url:{url:`data:${c};base64,${a.buffer.toString("base64")}`,detail:b}}}if(c.startsWith("http://")||c.startsWith("https://"))try{let a=await fetch(c,{signal:AbortSignal.timeout(6e4)});if(!a.ok)return null;let d=await a.arrayBuffer(),e=Buffer.from(d).toString("base64"),f=(a.headers.get("content-type")||"image/png").split(";")[0].trim().toLowerCase(),g=f.startsWith("image/")?f:"image/png";return{type:"image_url",image_url:{url:`data:${g};base64,${e}`,detail:b}}}catch{}return null}let f=()=>process.env.HANDOFF_ASSET_VISION_MODEL?.trim()||"gpt-4o-mini";async function g(b){let c=b.trim(),{blobPathnameFromProxyUrl:d,resolveStoredImage:e}=await a.A(114178);d(c)&&(c=(await e(c)).trim());let f=/^data:(image\/(?:png|jpeg|webp|jpg));base64,(.+)$/i.exec(c);if(f){let a=f[1].toLowerCase();if("image/jpg"===a&&(a="image/jpeg"),"image/png"!==a&&"image/jpeg"!==a&&"image/webp"!==a)return null;let b=Buffer.from(f[2],"base64");if(0===b.length)return null;let c="image/jpeg"===a?"jpg":"image/webp"===a?"webp":"png";return{filename:`composite.${c}`,contentType:a,data:b}}if(c.startsWith("http://")||c.startsWith("https://")){let a=await fetch(c);if(!a.ok)return null;let b=(a.headers.get("content-type")||"").split(";")[0].trim().toLowerCase(),d=null;if("image/png"===b?d="image/png":"image/jpeg"===b||"image/jpg"===b?d="image/jpeg":"image/webp"===b&&(d="image/webp"),!d)return null;let e=Buffer.from(await a.arrayBuffer());return 0===e.length?null:{filename:"composite.png",contentType:d,data:e}}return null}async function h(a,b){let d=await e(a,"low");if(!d)return{componentType:"other",suggestedName:"Component",visibleStates:["default"],subComponents:[],hasIcons:!1,hasMedia:!1,complexity:"medium"};let g=`You are analyzing a UI design screenshot. Classify it and return JSON only:
{
  "componentType": "button|card|form|input|navigation|modal|table|list|badge|tooltip|hero|banner|media|other",
  "suggestedName": "short PascalCase component name e.g. PrimaryButton",
  "visibleStates": ["default", and any of: "hover","focus","active","disabled","error","loading","selected","expanded"],
  "subComponents": [{"name":"short name","role":"what it does"}, ...],
  "hasIcons": true|false,
  "hasMedia": true|false,
  "complexity": "simple|medium|complex"
}
Rules:
- visibleStates: only include states actually visible as separate variations in the screenshot
- subComponents: reusable child pieces e.g. label, icon slot, avatar, badge
- complexity: simple=1-2 elements, medium=3-6, complex=7+`;try{var h=await (0,c.openAiChatJson)([{role:"system",content:g},{role:"user",content:[{type:"text",text:"Classify this UI design:"},d]}],{actorUserId:b,route:"design-asset-extract",eventType:"ai.design_classify",model:f(),maxTokens:400});let a={componentType:"other",suggestedName:"Component",visibleStates:["default"],subComponents:[],hasIcons:!1,hasMedia:!1,complexity:"medium"};try{let b=JSON.parse(h);return{componentType:b.componentType||a.componentType,suggestedName:"string"==typeof b.suggestedName&&b.suggestedName.trim()?b.suggestedName.trim():a.suggestedName,visibleStates:Array.isArray(b.visibleStates)&&b.visibleStates.length>0?b.visibleStates:a.visibleStates,subComponents:Array.isArray(b.subComponents)?b.subComponents:[],hasIcons:!!b.hasIcons,hasMedia:!!b.hasMedia,complexity:b.complexity||a.complexity}}catch{return a}}catch(a){return console.warn("[design-asset-extractor] classify failed, using fallback:",a),{componentType:"other",suggestedName:"Component",visibleStates:["default"],subComponents:[],hasIcons:!1,hasMedia:!1,complexity:"medium"}}}async function i(a,b,d,g){try{let[h,i]=await Promise.all([e(a,"low"),e(b,"low")]);if(!h||!i)return!0;let j=await (0,c.openAiChatJson)([{role:"system",content:`Compare two images. Image A is the original design. Image B is an extracted asset.
Reply JSON only: {"ok":true|false,"explanation":"one sentence"}.
Set ok=true only if B is grounded in A (no invented content) AND matches the intended role "${d.role}" / label "${d.label}".`},{role:"user",content:[{type:"text",text:"Image A — original:"},h,{type:"text",text:"Image B — extracted:"},i]}],{actorUserId:g,route:"design-asset-extract",eventType:"ai.design_asset_validate",model:f(),maxTokens:160}),k=JSON.parse(j);return!1!==k.ok}catch{return!0}}async function j(a){let{imageUrl:b,actorUserId:d}=a;if(!process.env.HANDOFF_AI_API_KEY?.trim())return{assets:[],classification:null,assetsStatus:"failed",extractionError:"HANDOFF_AI_API_KEY is not configured."};try{let a=await g(b);if(!a)return{assets:[],classification:null,assetsStatus:"failed",extractionError:"Could not read composite image."};let e=await h(b,d),f=function(a){var b,c,d,e;let f=[];for(let d of a.visibleStates){"default"!==d&&f.push({key:`state_${d}`,role:"state",stateName:d,label:`${d.charAt(0).toUpperCase()+d.slice(1)} state`,semanticName:`${a.suggestedName} — ${d}`,prompt:(b=a.componentType,c=d,`Extract the ${c} state variant of this ${b} UI component.
Show only the ${c} state as it appears in the design, isolated from other states.
Preserve the component's full bounding box and styling.
Remove surrounding page content that is not part of this component state.`)})}for(let b of a.subComponents.slice(0,3)){let a=`sub_${b.name.toLowerCase().replace(/[^a-z0-9]/g,"_").slice(0,30)}`;f.push({key:a,role:"subcomponent",label:b.name,semanticName:`${b.name} — ${b.role}`,prompt:(d=b.name,e=b.role,`Extract the "${d}" sub-component (${e}) from this UI design.
Isolate this element with a transparent or neutral background.
Preserve its exact visual treatment including colors, typography, and decorative elements.
Remove surrounding layout, other components, and unrelated UI chrome.`)})}return a.hasIcons&&f.push({key:"icons",role:"icon",label:"Icons",prompt:"Extract all icons from this UI design as individual icon glyphs on a transparent background. Include only the icon shapes, not surrounding buttons or containers. Preserve original proportions."}),a.hasMedia&&f.push({key:"media",role:"media",label:"Media",prompt:"Extract the main media element (photo, video thumbnail, or illustration) from this design. Preserve the crop and framing as it appears. Remove surrounding UI chrome, text, and buttons."}),["hero","banner","card","media"].includes(a.componentType)&&f.push({key:"background",role:"background",label:"Background",prompt:"Extract the background layer (fill, gradient, texture, or backdrop) from this design. Remove all foreground content: text, buttons, icons, photos. Output a CSS-ready background-image asset."}),f}(e),j={model:"gpt-image-2",size:"1024x1024",actorUserId:d,route:"worker:design-asset"},k=[],l=[];for(let b=0;b<f.length;b+=4){let d=f.slice(b,b+4);for(let b of(await Promise.allSettled(d.map(async b=>{let d=await (0,c.openAiImageEdit)({...j,prompt:b.prompt,images:[a],eventType:`ai.design_asset_extract.${b.role}`});return{task:b,assetUrl:d}}))))if("rejected"===b.status){let a=b.reason instanceof Error?b.reason.message:String(b.reason);l.push(a)}else k.push({key:b.value.task.key,label:b.value.task.label,imageUrl:b.value.assetUrl,role:b.value.task.role,stateName:b.value.task.stateName,semanticName:b.value.task.semanticName,description:b.value.task.prompt.split("\n")[0],prompt:b.value.task.prompt})}if(0===k.length)return{assets:[],classification:e,assetsStatus:"failed",extractionError:l.join(" | ").slice(0,2e3)||"No assets extracted."};let m=[];for(let a of k){if(!await i(b,a.imageUrl,{...a,prompt:a.prompt??"",semanticName:a.semanticName},d)){console.warn("[design-asset-extractor] discarded asset (validation):",a.key);continue}m.push(a)}let n=[{key:"annotated_overview",label:"Design overview",imageUrl:b,role:"annotated_overview",description:"Original composite design image — primary reference for spec generation."},...m];return n.length,{assets:n,classification:e,assetsStatus:"done",extractionError:null}}catch(a){return{assets:[],classification:null,assetsStatus:"failed",extractionError:(a instanceof Error?a.message:String(a)).slice(0,2e3)}}}async function k(a,c={}){let d,e;if(!await (0,b.claimDesignArtifactForExtraction)(a))return void console.log("[design-asset-extractor] skip (not pending or already claimed)",a);let f=await (0,b.getDesignArtifactById)(a);if(!f?.imageUrl?.trim())return void await (0,b.finalizeDesignArtifactExtraction)(a,{assets:[],assetsStatus:"failed",extractionError:"No composite image on artifact."});let g=Math.max(15e3,c.timeoutMs??12e4),h=new Promise(a=>{d=setTimeout(()=>a({assets:[],classification:null,assetsStatus:"failed",extractionError:`Extraction exceeded ${Math.round(g/1e3)}s and was abandoned.`}),g)});try{e=await Promise.race([j({imageUrl:f.imageUrl,actorUserId:f.userId}),h])}catch(a){e={assets:[],classification:null,assetsStatus:"failed",extractionError:(a instanceof Error?a.message:String(a)).slice(0,2e3)}}finally{d&&clearTimeout(d)}await (0,b.finalizeDesignArtifactExtraction)(a,{assets:e.assets,assetsStatus:e.assetsStatus,extractionError:e.extractionError})}var l=a.i(604929),m=a.i(702003),n=a.i(18002);let o=a=>"string"==typeof a?a:null==a?"":String(a);async function p(a){try{let b=await (0,l.getDataProvider)().getDtcgTokenStrings(a);if(!b?.dtcg)return[];let c=[];return!function a(b,c,d){if(b&&"object"==typeof b&&!(d.length>=60)){if("$value"in b)return void d.push({name:c.join("."),value:o(b.$value),reference:`var(--${c.join("-")})`});for(let[e,f]of Object.entries(b))e.startsWith("$")||a(f,[...c,e],d)}}(JSON.parse(b.dtcg),[],c),c}catch{return[]}}async function q(){var a,b;let c={};try{c=(await (0,l.getDataProvider)().getTokens()??{}).localStyles??{}}catch{c={}}let[d,e]=await Promise.all([p("spacing"),p("border-radius")]);return{colors:(Array.isArray((a=c).color)?a.color:[]).slice(0,60).map(a=>({name:o(a.name),value:o(a.value),reference:o(a.reference)||o(a.sass)||o(a.machineName)})),typography:(Array.isArray((b=c).typography)?b.typography:[]).slice(0,60).map(a=>{let b=a.values??{},c=o(b.fontSize),d=o(b.lineHeightPx),e=[o(b.fontFamily),o(b.fontWeight),c&&d?`${c}/${d}`:c].filter(Boolean);return{name:o(a.name),value:e.join(" "),reference:o(a.reference)||o(a.machine_name)||o(a.machineName)}}),spacing:d,radii:e}}async function r(a){if(!Array.isArray(a)||0===a.length)return[];try{let b=(0,l.getDataProvider)(),c=[];for(let d of a){if(!d||"object"!=typeof d)continue;let a="string"==typeof d.id?d.id.trim():"";if(!a)continue;let e=await b.getComponent(a);e&&c.push({id:a,title:e.title||a,propsJson:JSON.stringify(e.properties??{},null,2).slice(0,4e3)})}return c}catch{return[]}}async function s(){let a=(0,l.getDataProvider)(),b=await a.getComponentSummaries().then(a=>(a??[]).slice(0,120).map(a=>{let b="string"==typeof a.id?a.id:"",c="string"==typeof a.title?a.title:b,d="string"==typeof a.group&&a.group?` [${a.group}]`:"";return`${b} — ${c}${d}`})).catch(()=>[]),c=await a.getPatterns().then(a=>(a??[]).slice(0,120).map(a=>{let b="string"==typeof a.id?a.id:"",c="string"==typeof a.title?a.title:b;return`${b} — ${c}`})).catch(()=>[]);return{components:b.filter(Boolean),patterns:c.filter(Boolean)}}function t(a){try{return JSON.parse(a.replace(/^```(?:json)?\s*/m,"").replace(/```\s*$/m,"").trim())}catch{return null}}async function u(a,c){let d=await (0,b.getDesignArtifactById)(a),e=d?.metadata&&"object"==typeof d.metadata&&!Array.isArray(d.metadata)?{...d.metadata}:{};e.specError=c,await (0,b.updateDesignArtifactById)(a,{specStatus:"failed",metadata:e}).catch(()=>void 0)}async function v(a){if(!process.env.HANDOFF_AI_API_KEY?.trim())return void await u(a,"HANDOFF_AI_API_KEY is not configured on the server.");await (0,b.updateDesignArtifactById)(a,{specStatus:"generating"});try{var d;let f,g,h,i,j,k=await (0,b.getDesignArtifactById)(a);if(!k?.imageUrl?.trim())return void await u(a,"No composite image on artifact.");let l=Array.isArray(k.assets)?k.assets:[],o=l.find(a=>"annotated_overview"===a.key)??l[0],p=o?.imageUrl??k.imageUrl,v=l.filter(a=>"annotated_overview"!==a.key).map(a=>a.key),w=function(a){if(!Array.isArray(a))return[];let b=[],c=/"([^"]{2,120})"/g,d=/(?:label|text|copy|says?|reads?|titled?|named?|called?|button|heading|placeholder)[:\s]+["']?([A-Z][^"'\n]{2,80})/gi;for(let e of a){let a;if(!e||"object"!=typeof e||"user"!==e.role||"string"!=typeof e.prompt)continue;let f=e.prompt;for(c.lastIndex=0;null!==(a=c.exec(f));){let c=a[1].trim();c.length>=3&&!b.includes(c)&&b.push(c)}for(d.lastIndex=0;null!==(a=d.exec(f));){let c=a[1].trim().replace(/["']$/,"");c.length>=3&&!b.includes(c)&&b.push(c)}}return b.slice(0,20)}(k.conversationHistory),x=await r(k.componentGuides),y=await e(p,"high"),z={componentType:"other",suggestedName:k.title||"Component",visibleStates:v.filter(a=>a.startsWith("state_")).map(a=>a.replace("state_","")),subComponents:[],hasIcons:v.includes("icons"),hasMedia:v.includes("media"),complexity:"medium"};z.visibleStates.length||(z.visibleStates=["default"]);let A=JSON.stringify(z,null,2),[B,C,D]=await Promise.all([(0,m.getDesignWorkspace)().catch(()=>null),q().catch(()=>null),s().catch(()=>({components:[],patterns:[]}))]),E=C&&!(!C.colors.length&&!C.typography.length&&!C.spacing.length&&!C.radii.length)?(f=(a,b)=>{if(!b.length)return"";let c=b.map(a=>`- ${a.name} = ${a.value}${a.reference?`  → ${a.reference}`:""}`);return`
### ${a}
${c.join("\n")}`})("Colors",C.colors)+f("Typography",C.typography)+f("Spacing",C.spacing)+f("Border radius",C.radii):"",F=B?(0,n.formatBrandVoiceForPrompt)(B.brandVoice).trim():"",G=D.components.length>0||D.patterns.length>0,H=(a,b,d,e,f)=>{let g=[{role:"system",content:a}];return d&&y?g.push({role:"user",content:[{type:"text",text:b},y]}):g.push({role:"user",content:b}),(0,c.openAiChatJson)(g,{actorUserId:k.userId,route:"design-spec-generate",eventType:e,model:process.env.HANDOFF_SPEC_MODEL?.trim()||process.env.HANDOFF_AI_MODEL?.trim()||"gpt-4.1",maxTokens:f})},[I,J]=await Promise.all([H(function(a){let{classificationJson:b,extractedAssetKeys:c,copyFromPrompt:d,existingComponents:e,designMd:f}=a,g="";e.length>0&&(g=`

## Existing component schemas to match against
`+e.map(a=>`### ${a.title} (id: ${a.id})
${a.propsJson}`).join("\n\n"));let h=d.length>0?`

## UI copy strings extracted from the design prompt
${d.map(a=>`- "${a}"`).join("\n")}`:"",i=f?`

## Team design guidelines
${f.slice(0,2e3)}`:"";return`You are generating a detailed component specification from a UI design screenshot and extracted assets.

## Classification
${b}

## Extracted asset keys (use these as variant keys where applicable)
${c.join(", ")}
${h}${g}${i}

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
    "copyFromPrompt": ${JSON.stringify(d)},
    "rules": [{ "field": "<field name>", "maxLength": <number or omit>, "notes": "<guideline>" }]
  },
  "implementation": {
    "existingComponentMatches": ${e.length>0?`[
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
- Return ONLY valid JSON — no markdown, no commentary.`}({classificationJson:A,extractedAssetKeys:["default",...v],copyFromPrompt:w,existingComponents:x,designMd:B?.designMd??""}),"Generate the ComponentSpec JSON for this design:",!0,"ai.design_spec_generate",4e3),E?H((d={tokenSummary:E},`You map the visual values in a UI design onto a design system's REAL tokens.

## The design system's tokens — match against THESE ONLY
${d.tokenSummary}

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
- Return ONLY valid JSON — no markdown, no commentary.`),"Map this design onto the design system tokens:",!0,"ai.design_spec_tokens",2500).then(a=>t(a)).catch(b=>(console.warn("[design-spec-generator] tokens section failed",a,b),null)):Promise.resolve(null)]),K=function(a,b){try{let c=a.replace(/^```(?:json)?\s*/m,"").replace(/```\s*$/m,"").trim(),d=JSON.parse(c);if(!d.overview||!d.props)return null;return d.overview.name||(d.overview.name=b),d.version=1,d.generatedAt||(d.generatedAt=new Date().toISOString()),d}catch{return null}}(I,k.title||"Component");if(!K)return void await u(a,"The model returned a specification that could not be parsed. Re-run the dev handoff.");J&&(K.tokens=J);let[L,M]=await Promise.all([G?H(function(a){let{specSummary:b,reuseCatalog:c}=a;return`You decide whether a new UI design should be COMPOSED from a design system's existing parts, or genuinely built new.

## The design
${b}

## What the team ALREADY has
${c.components.length?`### Existing components
${c.components.map(a=>`- ${a}`).join("\n")}`:""}
${c.patterns.length?`
### Existing patterns (already-composed layouts)
${c.patterns.map(a=>`- ${a}`).join("\n")}`:""}

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
- Return ONLY valid JSON — no markdown, no commentary.`}({specSummary:(g=K.overview??{},h=[`Name: ${g.name??"Component"}`,`Type: ${g.type??"other"}${g.designSystemGroup?` (group: ${g.designSystemGroup})`:""}`,g.summary?`Summary: ${g.summary}`:"",g.description?`Description: ${g.description}`:""].filter(Boolean),(i=(K.content?.textInventory??[]).slice(0,24).map(a=>`  - [${a.role}] "${a.text}"${a.location?` (${a.location})`:""}`)).length&&h.push("","Visible content:",...i),(j=(K.props??[]).slice(0,20).map(a=>`  - ${a.name}: ${a.type}`)).length&&h.push("","Props identified:",...j),h.join("\n")),reuseCatalog:D}),"Decide what this design should be composed from:",!1,"ai.design_spec_reuse",2e3).then(a=>t(a)).catch(b=>(console.warn("[design-spec-generator] reuse section failed",a,b),null)):Promise.resolve(null),(()=>{let b;if(!F)return Promise.resolve(null);let c=(b=(K.content?.textInventory??[]).filter(a=>"string"==typeof a.text&&a.text.trim().length>1).map(a=>({text:a.text.trim(),role:a.role||"body"}))).length?b.slice(0,40):w.slice(0,40).map(a=>({text:a,role:"body"}));return c.length?H(function(a){let{copyStrings:b,brandVoice:c}=a;return`You check UI copy against a brand's voice guidelines.

## Brand voice guidelines
${c.slice(0,6e3)}

## The copy in this design
${b.map(a=>`- [${a.role}] "${a.text}"`).join("\n")}

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
- Return ONLY valid JSON — no markdown, no commentary.`}({copyStrings:c,brandVoice:F}),"Check this copy against the brand voice:",!1,"ai.design_spec_voice",2e3).then(a=>t(a)).catch(b=>(console.warn("[design-spec-generator] voice section failed",a,b),null)):Promise.resolve(null)})()]);L&&(K.reuse=L),M&&(K.voice=M),K.generatedAt=new Date().toISOString(),await (0,b.updateDesignArtifactById)(a,{componentSpec:K,componentSpecMd:function(a){let b=[];if(b.push(`# ${a.overview.name}`),b.push(""),b.push(`**Type:** ${a.overview.type} \xb7 **Group:** ${a.overview.designSystemGroup}`),b.push(""),b.push(a.overview.summary||a.overview.description),a.variants.length>0)for(let c of(b.push("","## Variants"),a.variants))b.push(`- **${c.name}**${c.isDefault?" *(default)*":""}: ${c.description}`);if(a.props.length>0)for(let c of(b.push("","## Props"),b.push("| Prop | Type | Required | Default | Description |"),b.push("|------|------|----------|---------|-------------|"),a.props)){let a=c.options&&c.options.length?`\`${c.options.join(" | ")}\``:`\`${c.type}\``;b.push(`| \`${c.name}\` | ${a} | ${c.required?"✓":"—"} | ${c.defaultValue?`\`${c.defaultValue}\``:"—"} | ${c.description} |`)}if(a.behavior.interactions.length>0||a.behavior.edgeCases.length>0){if(b.push("","## Behavior"),a.behavior.interactions.length>0)for(let c of(b.push("","**Interactions**"),a.behavior.interactions))b.push(`- **${c.trigger}** → ${c.action}`);if(a.behavior.transitions.length>0)for(let c of(b.push("","**Transitions**"),a.behavior.transitions))b.push(`- ${c}`);if(a.behavior.edgeCases.length>0)for(let c of(b.push("","**Edge cases**"),a.behavior.edgeCases))b.push(`- ${c}`)}if(b.push("","## Accessibility"),b.push(`- **ARIA role:** \`${a.accessibility.ariaRole}\``),a.accessibility.requiredAriaAttributes.length>0&&b.push(`- **Required attributes:** ${a.accessibility.requiredAriaAttributes.map(a=>`\`${a}\``).join(", ")}`),a.accessibility.keyboardNav.length>0)for(let c of(b.push("","**Keyboard navigation**"),a.accessibility.keyboardNav))b.push(`- \`${c.key}\` → ${c.action}`);if(a.accessibility.screenReaderNotes&&b.push("",`**Screen reader:** ${a.accessibility.screenReaderNotes}`),b.push(`- **WCAG target:** ${a.accessibility.wcagTarget}`),a.content.textInventory.length>0){for(let c of(b.push("","## Content"),b.push("","**Text inventory**"),a.content.textInventory))b.push(`- \`${c.role}\` \xb7 *${c.location}*: "${c.text}"${c.editable?" *(prop)*":""}`);if(a.content.copyFromPrompt.length>0)for(let c of(b.push("","**Copy from design prompt**"),a.content.copyFromPrompt))b.push(`- "${c}"`);if(a.content.rules.length>0)for(let c of(b.push("","**Rules**"),a.content.rules))b.push(`- **${c.field}**${c.maxLength?` (max ${c.maxLength} chars)`:""}: ${c.notes}`)}if(a.implementation.existingComponentMatches.length>0){let c=a.implementation.existingComponentMatches.sort((a,b)=>b.confidence-a.confidence)[0];c.confidence>=.5&&(b.push("","## Existing component match"),b.push(`**${c.componentTitle}** (confidence: ${Math.round(100*c.confidence)}%, match: ${c.matchLevel})`),b.push("",c.recommendation),Object.keys(c.sampleConfig).length>0&&b.push("","```json",JSON.stringify(c.sampleConfig,null,2),"```"))}if(a.implementation.cssNotes||a.implementation.developerHints.length>0){for(let c of(b.push("","## Implementation notes"),a.implementation.cssNotes&&b.push(a.implementation.cssNotes),a.implementation.developerHints))b.push(`- ${c}`);a.tokens&&b.push("","> Concrete colour, type, spacing and radius values are resolved in **Design tokens** below — use those, not any values named here.")}if(a.reuse&&(a.reuse.candidates?.length||a.reuse.patterns?.length||a.reuse.recommendation)){let c=a.reuse;if(b.push("","## Build from what exists","",`Composition score: **${Math.round((c.compositionScore??0)*100)}%**`),c.recommendation&&b.push("",`**${c.recommendation}**`),c.patterns?.length)for(let a of(b.push("","### Existing patterns that already fit",""),c.patterns))b.push(`- **${a.title}** (\`${a.patternId}\`) — ${a.note}`);if(c.candidates?.length)for(let a of(b.push("","### Existing components to compose from","","| Component | Covers | Confidence | Notes |","|---|---|---|---|"),c.candidates))b.push(`| **${a.title}** \`${a.componentId}\` | ${a.role} | ${Math.round((a.confidence??0)*100)}% | ${a.note} |`)}if(a.tokens){let c=a.tokens,d=[["Color",c.colors??[]],["Typography",c.typography??[]],["Spacing",c.spacing??[]],["Radius",c.radii??[]]];if(d.some(([,a])=>a.length>0)){for(let[a,e]of(b.push("","## Design tokens","",`Token coverage: **${Math.round((c.coverage??0)*100)}%**`),c.notes&&b.push("",c.notes),d))if(e.length)for(let c of(b.push("",`### ${a}`,"","| Observed | Used for | Token | Reference | Match |","|---|---|---|---|---|"),e)){let a="exact"===c.matchLevel?"✅ exact":"close"===c.matchLevel?"⚠️ close":"❌ off-system";b.push(`| \`${c.observed}\` | ${c.usage} | ${c.token??"—"} | ${c.reference?`\`${c.reference}\``:"—"} | ${a} |`),c.note&&"exact"!==c.matchLevel&&b.push(`| | | | | ${c.note} |`)}}}if(a.voice){let c=a.voice;if(b.push("","## Brand voice","",`Voice compliance: **${Math.round((c.score??0)*100)}%**`),c.summary&&b.push("",c.summary),c.bannedPhrasesFound?.length&&b.push("",`> ⚠️ Contains phrases on the avoid list: ${c.bannedPhrasesFound.map(a=>`"${a}"`).join(", ")}`),c.findings?.length)for(let a of(b.push("","| Copy | Role | Verdict | Notes |","|---|---|---|---|"),c.findings)){let c="pass"===a.verdict?"✅":"warn"===a.verdict?"⚠️":"❌",d=a.suggestion?`${a.detail} — *suggested:* "${a.suggestion}"`:a.detail;b.push(`| "${a.text}" | ${a.role} | ${c} ${a.verdict} | ${d} |`)}}return b.join("\n")}(K),specStatus:"done"}),console.log("[design-spec-generator] spec generated for",a,K.overview.name,`(tokens:${K.tokens?"y":"n"} reuse:${K.reuse?"y":"n"} voice:${K.voice?"y":"n"})`)}catch(b){console.error("[design-spec-generator] failed",a,b),await u(a,b instanceof Error?b.message.slice(0,2e3):"Specification generation failed.")}}a.s(["generateSpecForArtifact",0,v],587783);let w=new Set(["pending","extracting"]),x=new Set(["pending","generating"]);function y(a,b){if(!a||"object"!=typeof a||Array.isArray(a))return null;let c=a[b];return"string"==typeof c&&c.trim()?c:null}function z(a){var b;let c,d,e,f,g;return c=((b={assetsStatus:a.assetsStatus,specStatus:a.specStatus,metadata:a.metadata}).assetsStatus??"none").trim()||"none",d=(b.specStatus??"none").trim()||"none",e=y(b.metadata,"assetsExtractionError"),f=y(b.metadata,"specError"),g={assetsStatus:c,specStatus:d},"none"===c&&"none"===d?{...g,stage:"not_started",running:!1,progress:0,label:"Not started",error:null,warning:null}:w.has(c)?{...g,stage:"extracting_assets",running:!0,progress:"pending"===c?.1:.35,label:"Extracting assets",error:null,warning:null}:x.has(d)?{...g,stage:"generating_spec",running:!0,progress:"pending"===d?.55:.75,label:"Generating specification",error:null,warning:"failed"===c?e??"Asset extraction failed; specifying from the original image.":null}:"done"===d?{...g,stage:"ready",running:!1,progress:1,label:"Ready for dev",error:null,warning:"failed"===c?e??"Asset extraction failed — the spec was generated from the original image.":null}:"failed"===d||"failed"===c?{...g,stage:"failed",running:!1,progress:0,label:"Failed",error:f??e??"The dev handoff failed without recording a reason.",warning:null}:{...g,stage:"not_started",running:!1,progress:.4*("done"===c),label:"done"===c?"Assets extracted — no specification yet":"Not started",error:null,warning:null}}let A=["spec"];async function B(a,c){let d=c.stages??A,e=d.includes("assets"),f=d.includes("spec"),g={};e?(g.assetsStatus="pending",c.clearAssets&&(g.assets=[])):g.assetsStatus="none",f&&(g.specStatus="pending");let h=await (0,b.getDesignArtifactById)(a);if(!h)return!1;if(h.metadata&&"object"==typeof h.metadata&&!Array.isArray(h.metadata)){let a={...h.metadata};delete a.assetsExtractionError,f&&delete a.specError,g.metadata=a}return(0,b.updateDesignArtifactById)(a,g)}async function C(a,b={}){let c=a.trim(),d=b.stages??A;if(d.includes("assets"))try{await k(c,{timeoutMs:b.budgetMs??12e4})}catch(a){console.error("[dev-handoff] asset extraction threw",c,a)}d.includes("spec")&&console.log("[dev-handoff] specification queued for cron pickup",c)}async function D(a){let c=await (0,b.getDesignArtifactById)(a.trim());return c?z(c):null}a.s(["devHandoffStatusForRow",0,z,"getDevHandoffStatus",0,D,"markDevHandoffQueued",0,B,"runDevHandoff",0,C],507439)}];

//# sourceMappingURL=src_app_lib_server_dev-handoff_ts_08ck466._.js.map