/**
 * Auto-height for opaque-origin preview frames (design-system roadmap §14).
 *
 * Every surface that renders authored/component HTML does so in a sandboxed iframe with
 * `sandbox="allow-scripts"` and **no** `allow-same-origin`, so a `<script>` in the framed document
 * cannot read the viewer's cookies or make authenticated same-origin requests. The cost of that is
 * the parent can no longer read `contentWindow.document.body.scrollHeight` to size the frame — the
 * frame has to volunteer its height instead.
 *
 * This is the one copy of that protocol. It used to be pasted into each surface, which is a live
 * hazard: the message type here and the `event.data.type` the parent listens for are a contract, and
 * three copies of it drift silently — a frame that reports under a renamed type just stops resizing,
 * with no error anywhere.
 *
 * Emitted as a string because it is injected into `srcdoc` / into HTML written by the static build,
 * never bundled.
 */

/** Message type posted from the frame to its parent. Parent listeners must match this exactly. */
export const PREVIEW_HEIGHT_MESSAGE = 'handoff-preview-height';

/**
 * ResizeObserver is the steady-state signal; `load`/`resize` and the two timeouts cover the cases it
 * misses — a document whose height settles after late images/fonts, and browsers where the observer
 * is unavailable.
 */
export const HEIGHT_REPORTER_SCRIPT =
  `<script>(function(){function h(){var b=document.body,e=document.documentElement;` +
  `var v=Math.max(b?b.scrollHeight:0,b?b.offsetHeight:0,e?e.scrollHeight:0,e?e.offsetHeight:0);` +
  `try{parent.postMessage({type:'${PREVIEW_HEIGHT_MESSAGE}',height:v},'*');}catch(_){}}` +
  `try{if(window.ResizeObserver&&document.body){new ResizeObserver(h).observe(document.body);}}catch(_){}` +
  `window.addEventListener('load',h);window.addEventListener('resize',h);` +
  `setTimeout(h,100);setTimeout(h,500);})();</script>`;

/** Appends the reporter to a document, before `</body>` when there is one. */
export const injectHeightReporter = (html: string): string =>
  html.includes('</body>') ? html.replace('</body>', `${HEIGHT_REPORTER_SCRIPT}</body>`) : html + HEIGHT_REPORTER_SCRIPT;
