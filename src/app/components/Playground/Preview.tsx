'use client';

import React, { useRef } from 'react';
import { cn } from '../../lib/utils';

import Handlebars from 'handlebars';
import { registerFieldMarkHelper } from '@/lib/field-marks';
import { INLINE_EDIT_CSS, inlineEditScript } from './inline-edit-script';
import { PlaygroundComponent, SelectedPlaygroundComponent } from './types';

/**
 * Register all Handlebars helpers needed by component templates.
 * Mirrors the build-pipeline's registerHandlebarsHelpers (from
 * src/transformers/utils/handlebars.ts) but without Node-only deps.
 * Called before every Handlebars compile to guarantee parity.
 */
function registerPlaygroundHelpers() {
  // `{{#field 'name'}}` marks where a field renders, for inline editing (roadmap F.1). The mark format lives in
  // `lib/field-marks.ts` because the editor has to read back exactly what this writes.
  registerFieldMarkHelper(Handlebars);

  Handlebars.registerHelper('eq', function (a: any, b: any) {
    return a === b;
  });

  Handlebars.registerHelper('ne', function (a: any, b: any) {
    return a !== b;
  });

  Handlebars.registerHelper('and', function (this: any, ...args: any[]) {
    const options = args.pop();
    return args.every(Boolean) ? options.fn(this) : options.inverse(this);
  });

  Handlebars.registerHelper('or', function (this: any, ...args: any[]) {
    const options = args.pop();
    return args.some(Boolean) ? options.fn(this) : options.inverse(this);
  });

  Handlebars.registerHelper('not', function (value: any) {
    return !value;
  });

  Handlebars.registerHelper('gt', function (a: any, b: any) { return a > b; });
  Handlebars.registerHelper('gte', function (a: any, b: any) { return a >= b; });
  Handlebars.registerHelper('lt', function (a: any, b: any) { return a < b; });
  Handlebars.registerHelper('lte', function (a: any, b: any) { return a <= b; });

  Handlebars.registerHelper('concat', function (...args: any[]) {
    args.pop(); // remove Handlebars options
    return args.join('');
  });

  Handlebars.registerHelper('json', function (context: any) {
    return JSON.stringify(context);
  });

  Handlebars.registerHelper('default', function (value: any, fallback: any) {
    return value != null && value !== '' ? value : fallback;
  });

  Handlebars.registerHelper('capitalize', function (str: any) {
    if (typeof str !== 'string') return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  });

  Handlebars.registerHelper('lowercase', function (str: any) {
    return typeof str === 'string' ? str.toLowerCase() : str;
  });

  Handlebars.registerHelper('uppercase', function (str: any) {
    return typeof str === 'string' ? str.toUpperCase() : str;
  });
}

/**
 * Build the context object that Handlebars templates expect.
 * Mirrors `createHandlebarsContext` from the build-time pipeline but
 * without Node-only dependencies.
 */
function createPlaygroundHandlebarsContext(
  component: PlaygroundComponent,
  data: any,
  basePath: string
) {
  const previewCssLink = component.options?.preview?.css
    ? `\n<link rel="stylesheet" href="${component.options.preview.css}">`
    : '';
  return {
    style:
      `<link rel="stylesheet" href="${basePath}/api/component/main.css">` +
      `<link rel="stylesheet" href="${basePath}/api/component/${component.id}.css">\n` +
      `<link rel="stylesheet" href="${basePath}/assets/css/preview.css">` +
      previewCssLink,
    script:
      `<script src="${basePath}/api/component/${component.id}.js"></script>\n` +
      `<script src="${basePath}/assets/js/preview.js"></script>` +
      `<script>var fields = ${JSON.stringify(component.properties || {})};</script>`,
    properties: data || component.data || {},
    fields: component.properties || {},
    title: component.title,
  };
}

/**
 * Render a Handlebars component with the build-time-equivalent context.
 */
export function renderHandlebarsPreview(
  component: PlaygroundComponent,
  data: any = null,
  basePath: string = ''
): string {
  registerPlaygroundHelpers();
  const context = createPlaygroundHandlebarsContext(component, data, basePath);
  const template = Handlebars.compile(component.code);
  return template(context);
}

// Vendor-isolated bundles (roadmap 6.6): the tiny per-component `-client.mjs`
// entries import react / react-dom / the component library by BARE specifier,
// resolved via an importmap served at /api/component/hvendor-importmap.json.
// We fetch + inject it ONCE per iframe document, exposing a readiness promise
// (`window.__handoffImportmapReady`) that every dynamic `import()` awaits. This
// must run from a CLASSIC script (an inline `type="module"` would trigger the
// import-map lockout) and BEFORE any `import()`. Older self-contained bundles
// simply ignore the (possibly absent) importmap, so this degrades cleanly.
const IMPORTMAP_FILE = 'hvendor-importmap.json';
function importmapReadyScript(basePath: string): string {
  return `<script>
window.__handoffImportmapReady = fetch(${JSON.stringify(basePath)} + '/api/component/${IMPORTMAP_FILE}')
  .then(function(r){ return r.ok ? r.json() : null; })
  .then(function(map){ try { if (map) { var s=document.createElement('script'); s.type='importmap'; s.textContent=JSON.stringify(map); document.head.appendChild(s); } } catch(e){} })
  .catch(function(){});
</script>`;
}

/**
 * Construct an iframe HTML document that loads a React/CSF component module
 * and renders it with the given props. The module is served from
 * `/api/component/{id}-client.mjs` and exposes `render(container, props)`
 * and `update(props)` functions. The iframe listens for `postMessage`
 * events to re-render with new props without reloading the module.
 */
export function renderReactPreview(
  component: PlaygroundComponent,
  data: any = null,
  basePath: string = '',
  /** When set (composite canvas), only apply postMessage updates targeting this block id. */
  blockId?: string | null
): string {
  const props = JSON.stringify(data || component.data || {});
  // Escape the static HTML so it's safe inside a JSON script tag.
  const fallbackHtml = JSON.stringify(component.html || '');
  const previewCssLink = component.options?.preview?.css
    ? `\n    <link rel="stylesheet" href="${component.options.preview.css}" />`
    : '';
  const blockFilter = blockId
    ? `if (event.data.blockId && event.data.blockId !== ${JSON.stringify(blockId)}) return;`
    : '';
  return `<!DOCTYPE html>
<html>
  <head>
    ${importmapReadyScript(basePath)}
    <link rel="stylesheet" href="${basePath}/api/registry/theme.css" />
    <link rel="stylesheet" href="${basePath}/api/component/main.css" />
    <link rel="stylesheet" href="${basePath}/api/component/${component.id}.css" />
    <link rel="stylesheet" href="${basePath}/assets/css/preview.css" />${previewCssLink}
  </head>
  <body>
    <div id="root"></div>
    <script id="__PROPS__" type="application/json">${props}</script>
    <script id="__FALLBACK__" type="application/json">${fallbackHtml}</script>
    <script>
      var container = document.getElementById('root');
      var initialProps = JSON.parse(document.getElementById('__PROPS__').textContent || '{}');
      var fallbackHtml = JSON.parse(document.getElementById('__FALLBACK__').textContent || '""');

      // Await importmap injection, then load the (bare-specifier) client module.
      (window.__handoffImportmapReady || Promise.resolve())
        .then(function () { return import('${basePath}/api/component/${component.id}-client.mjs'); })
        .then(function (m) {
          m.render(container, initialProps);
          window.addEventListener('message', function (event) {
            if (event.data && event.data.type === 'update-props') {
              ${blockFilter}
              m.update(event.data.props);
            }
          });
        })
        .catch(function () {
          // module not available — render static HTML snapshot instead
          if (fallbackHtml) container.innerHTML = fallbackHtml;
        });
    </script>
  </body>
</html>`;
}

/**
 * Format-aware render dispatcher. Returns rendered HTML for the component.
 */
export async function renderPreview(
  component: PlaygroundComponent,
  data: any = null,
  basePath: string = ''
): Promise<string> {
  if (component.format === 'react') {
    return renderReactPreview(component, data, basePath);
  }
  return renderHandlebarsPreview(component, data, basePath);
}

export function previewRenderedHtml(html: string, basePath: string = ''): string {
  return `<html>
  <head>
    <link rel="stylesheet" href="${basePath}/api/component/main.css" />
  </head>
  <body>
    ${html}
  </body>
  <script src="${basePath}/api/component/main.js"></script>
</html>`;
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const BLOCK_CONTROLS_CSS = `
.playground-block{position:relative}
.playground-block::after{content:'';position:absolute;inset:0;pointer-events:none;border:2px solid transparent;transition:border-color .15s;z-index:9998}
.playground-block:hover::after{border-color:rgba(59,130,246,.45)}
.playground-block-toolbar{position:absolute;top:8px;left:8px;display:flex;align-items:center;gap:4px;opacity:0;transition:opacity .15s;z-index:9999}
.playground-block:hover .playground-block-toolbar{opacity:1}
.playground-block-title{background:rgba(59,130,246,.9);color:#fff;font-size:11px;font-weight:500;padding:3px 8px;border-radius:4px;line-height:1.3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:nowrap}
.playground-block-btn{background:#fff;border:1px solid rgba(0,0,0,.12);border-radius:4px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:background .1s,border-color .1s;color:#374151}
.playground-block-btn:hover{background:#f3f4f6}
.playground-block-btn.delete:hover{background:#fef2f2;border-color:#fca5a5;color:#ef4444}
`;

/**
 * `allowDelete: false` renders the hover toolbar with **edit only**.
 *
 * Used by the read-only-structure surfaces (roadmap E.5): a guest filling in a template, and a frozen
 * template being viewed. They still need to click a block to edit its content — they must not be able to
 * remove it, and offering a control that will be refused is worse than not offering it.
 *
 * @param restoreScrollY Where the canvas was scrolled to before this document replaced the last one. Every
 *   committed edit rebuilds the whole `srcdoc` — there is no partial update, because a Handlebars block is a
 *   rendered HTML string — so without this the page jumps to the top on each change. Tolerable while edits came
 *   from the rail; unusable once you are editing text in the canvas itself (roadmap F.2). The parent cannot read
 *   the frame's scroll position (opaque origin), so the frame reports it and the parent hands it back on rebuild.
 */
function getBlockControlsScript(allowDelete = true, restoreScrollY = 0): string {
  const editSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
  const trashSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';

  return `
(function(){
  document.querySelectorAll('.playground-block').forEach(function(block){
    var id=block.getAttribute('data-block-id');
    var title=block.getAttribute('data-block-title');
    var tb=document.createElement('div');
    tb.className='playground-block-toolbar';
    tb.innerHTML='<span class="playground-block-title">'+title+'</span>'
      +'<button class="playground-block-btn edit" title="Edit">${editSvg}</button>'
      +${allowDelete ? `'<button class="playground-block-btn delete" title="Remove">${trashSvg}</button>'` : "''"};
    block.insertBefore(tb,block.firstChild);
    tb.addEventListener('click',function(e){
      var btn=e.target.closest('.playground-block-btn');
      if(!btn)return;
      e.stopPropagation();e.preventDefault();
      var action=btn.classList.contains('edit')?'edit':'delete';
      window.parent.postMessage({type:'playground-block-action',action:action,blockId:id},'*');
    });
  });

  // Selecting a block in the rail should bring it into view. The reverse direction already worked —
  // clicking a block in the canvas selected it — so the canvas could scroll you to a block but the
  // list could not, which reads as the click doing nothing. Matters more since the rail now swaps to
  // the editor on select: without this you lose your place in the page entirely.
  window.addEventListener('message',function(event){
    if(!event.data||event.data.type!=='playground-scroll-to-block')return;
    var target=document.querySelector('.playground-block[data-block-id="'+event.data.blockId+'"]');
    if(!target)return;
    target.scrollIntoView({behavior:'smooth',block:'start'});
  });

  // Where we are in the page, reported so the next rebuild can put us back. Coalesced to one message per frame:
  // scroll fires far faster than the parent needs, and the parent only ever keeps the latest.
  var pending=false;
  window.addEventListener('scroll',function(){
    if(pending)return;
    pending=true;
    requestAnimationFrame(function(){
      pending=false;
      window.parent.postMessage({type:'playground-scroll',y:window.scrollY},'*');
    });
  },{passive:true});

  ${
    restoreScrollY > 0
      ? `
  // Restored twice on purpose: once now, when stylesheets have applied and the layout is broadly right, and again
  // after \`load\`, because images finishing changes the document height — a scroll set past the height the document
  // had a moment ago is silently clamped, landing you short of where you were.
  //
  // The retry is abandoned if you moved yourself, detected from *input* events rather than by comparing scroll
  // positions: a clamped restore also leaves \`scrollY\` far from the target, so position alone cannot tell
  // "the user scrolled away" from "the restore did not reach".
  var restoreY=${Math.round(restoreScrollY)};
  var userMoved=false;
  ['wheel','touchstart','keydown','mousedown'].forEach(function(t){
    window.addEventListener(t,function(){userMoved=true;},{passive:true,once:true});
  });
  window.scrollTo(0,restoreY);
  window.addEventListener('load',function(){
    if(!userMoved) window.scrollTo(0,restoreY);
  });`
      : ''
  }
})();
`;
}

export async function constructComponentPreview(
  components: SelectedPlaygroundComponent[],
  basePath: string = '',
  options?: {
    injectBlockControls?: boolean;
    allowDelete?: boolean;
    /**
     * Inline editing on `{{#field}}` marks (roadmap F.2). Off unless asked for: a read-only surface must not
     * offer an editor, and a React block carries no marks so the script no-ops there anyway.
     */
    inlineEdit?: boolean;
    /**
     * Guardrail limits so the overlay shows the same counter the rail does, as
     * `{ [blockId]: { [fieldPath]: maxLength } }`.
     *
     * Nested per block because two components can declare different limits for the same field name — `title` at
     * 60 on one and 80 on another — and a flat map showed one block the other's number.
     */
    fieldLimits?: Record<string, Record<string, number>>;
    /**
     * Field paths a text overlay may edit. Anything absent gets no affordance — see `textEditableFieldPaths`
     * for the two shapes that made a whitelist necessary rather than optional.
     */
    editableFields?: string[];
    /**
     * Scroll offset to land at, from the frame's own last report. Passed on a rebuild so a committed edit does
     * not send the reader back to the top of the page — see `getBlockControlsScript`.
     */
    restoreScrollY?: number;
  }
): Promise<string> {
  let bodyInner = '';
  const reactScripts: string[] = [];
  const cssOverrides = new Set<string>();
  const componentCssIds = new Set<string>();
  const injectControls = options?.injectBlockControls ?? false;
  let reactIdx = 0;

  for (const component of components) {
    if (component.options?.preview?.css) {
      cssOverrides.add(component.options.preview.css);
    }

    let blockHtml: string;
    if (component.format === 'react') {
      const suffix = `_pg_${reactIdx++}`;
      const rootId = `root${suffix}`;
      const propsId = `__PROPS__${suffix}`;
      const fallbackId = `__FALLBACK__${suffix}`;
      const propsJson = JSON.stringify(component.data ?? {});
      const fallbackHtml = JSON.stringify(component.html || '');
      componentCssIds.add(component.id);
      const bid = component.uniqueId || '';
      blockHtml =
        `<script id="${propsId}" type="application/json">${propsJson}</script>` +
        `<script id="${fallbackId}" type="application/json">${fallbackHtml}</script>` +
        `<div id="${rootId}"></div>`;
      // Classic script (NOT type="module") so the shared importmap can be
      // injected first; each block awaits `__handoffImportmapReady` before its
      // dynamic import so bare-specifier vendors resolve. See importmapReadyScript.
      reactScripts.push(`    <script>
      (function(){
        var blockId = ${JSON.stringify(bid)};
        var container = document.getElementById(${JSON.stringify(rootId)});
        var el = document.getElementById(${JSON.stringify(propsId)});
        var initialProps = el ? JSON.parse(el.textContent || '{}') : {};
        var fb = document.getElementById(${JSON.stringify(fallbackId)});
        var fallbackHtml = fb ? JSON.parse(fb.textContent || '""') : '';
        (window.__handoffImportmapReady || Promise.resolve())
          .then(function(){ return import('${basePath}/api/component/${component.id}-client.mjs'); })
          .then(function(m) {
            m.render(container, initialProps);
            window.addEventListener('message', function (event) {
              if (!event.data || event.data.type !== 'update-props') return;
              if (event.data.blockId && event.data.blockId !== blockId) return;
              m.update(event.data.props);
            });
          })
          .catch(function() {
            // module not available — render static HTML snapshot instead
            if (fallbackHtml) container.innerHTML = fallbackHtml;
          });
      })();
    </script>`);
    } else if (component.rendered) {
      blockHtml = component.rendered;
    } else {
      blockHtml = component.html || '';
    }

    if (injectControls && component.uniqueId) {
      bodyInner += `<div class="playground-block" data-block-id="${escapeAttr(component.uniqueId)}" data-block-title="${escapeAttr(component.title)}">${blockHtml}</div>`;
    } else {
      bodyInner += blockHtml;
    }
  }

  const perComponentCss = Array.from(componentCssIds)
    .map((id) => `\n      <link rel="stylesheet" href="${basePath}/api/component/${id}.css" />`)
    .join('');

  const cssOverrideLinks = Array.from(cssOverrides)
    .map((href) => `\n      <link rel="stylesheet" href="${href}" />`)
    .join('');

  const controlsStyle = injectControls ? `<style>${BLOCK_CONTROLS_CSS}</style>` : '';
  const controlsScript = injectControls
    ? `<script>${getBlockControlsScript(options?.allowDelete ?? true, options?.restoreScrollY ?? 0)}</script>`
    : '';
  const inlineEditStyle = options?.inlineEdit ? `<style>${INLINE_EDIT_CSS}</style>` : '';
  // After the controls script, so its click handler is registered first and the field handler can stop the
  // event before "select this block" swallows it.
  const inlineEditJs = options?.inlineEdit
    ? `<script>${inlineEditScript(options.fieldLimits ?? {}, options.editableFields ?? [])}</script>`
    : '';

  return `<html>
    <head>
      ${importmapReadyScript(basePath)}
      <link rel="stylesheet" href="${basePath}/api/registry/theme.css" />
      <link rel="stylesheet" href="${basePath}/api/component/main.css" />
      <link rel="stylesheet" href="${basePath}/assets/css/preview.css" />${perComponentCss}${cssOverrideLinks}
      ${controlsStyle}${inlineEditStyle}
    </head>
    <body>
      ${bodyInner}
    </body>
    <script src="${basePath}/api/component/main.js"></script>
${reactScripts.join('\n')}
    ${controlsScript}
    ${inlineEditJs}
  </html>`;
}

interface PreviewProps {
  html: string;
  className?: string;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}

export default function Preview({ html, className, iframeRef: externalRef }: PreviewProps) {
  const internalRef = useRef<HTMLIFrameElement>(null);
  const ref = externalRef || internalRef;

  // Opaque-origin sandbox (no allow-same-origin) so the frame can't reach the
  // registry's cookies/auth (§14). We feed the document via `srcdoc` rather than
  // writing to contentDocument (which requires same-origin). The frame still
  // receives prop updates via postMessage and loads its module cross-origin
  // (the /api/component route serves modules with CORS).
  return (
    <iframe
      ref={ref}
      className={cn('h-full w-full', className)}
      title="Component Preview"
      sandbox="allow-scripts"
      srcDoc={html}
    />
  );
}
