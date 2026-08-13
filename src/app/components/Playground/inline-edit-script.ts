/**
 * The in-frame half of inline editing — roadmap F.2.
 *
 * Runs **inside the preview iframe**, which is where it has to run: the frame is opaque-origin
 * (`sandbox="allow-scripts"`, no `allow-same-origin`), so the parent cannot read its DOM or measure anything in
 * it. The frame already receives injected script and CSS for block controls, so this is the same channel — and
 * hosting the overlay here rather than in the parent removes the rect protocol, scroll/resize/font-load
 * invalidation, and all the drift that comes with keeping two documents' geometry in sync.
 *
 * **It edits an overlay, never the component's own node.** No `contenteditable` on *rendered output*: React
 * reconciliation eats it (see the caret-loss note in `RichTextField.tsx`), and for Handlebars a re-render would
 * discard the caret anyway. The overlay is its own `contenteditable` node positioned over the field's box; the
 * component tree is untouched until the parent applies the committed value through the normal args path.
 *
 * **Marks come from `{{#field}}` comment pairs** (F.1, `lib/field-marks.ts`). A `TreeWalker` over comment nodes
 * finds them, so nesting is a non-issue — the nodes are flat siblings in document order, which is also what makes
 * "order the rail by document position" fall out for free.
 *
 * Emitted as a string because it is injected into `srcdoc`, matching `getBlockControlsScript`. Kept in its own
 * module because it is long enough that burying it in `Preview.tsx` would hide it.
 */

/** Format constants, duplicated deliberately — see the note in `inlineEditScript`. */
const MARK_PREFIX = 'hf:';
const MARK_CLOSE_PREFIX = '/hf:';

export const INLINE_EDIT_CSS = `
.hf-field-hit { outline: 1px dashed rgba(99,102,241,.55); outline-offset: 2px; cursor: text; }
.hf-field-hit-active { outline: 2px solid rgb(99,102,241); outline-offset: 2px; }
.hf-overlay-meta {
  position: absolute; z-index: 2147483001; padding: 1px 6px; border-radius: 3px;
  background: rgb(99,102,241); color: #fff; font: 500 11px/1.5 system-ui, sans-serif; white-space: nowrap;
}
.hf-overlay-meta[data-over="1"] { background: rgb(180,83,9); }
.hf-overlay-meta { display: flex; align-items: center; gap: 6px; }
.hf-overlay-btn {
  all: unset; cursor: pointer; padding: 0 4px; border-radius: 2px; line-height: 1.4;
  font: 600 11px/1.4 system-ui, sans-serif; color: #fff;
}
.hf-overlay-btn:hover { background: rgba(255,255,255,.25); }
/* The overlay keeps the document's own typography — it is editing copy in place, not filling a form box. It has
   no fixed height on purpose: a fixed box is what hid long copy while it was being typed. */
.hf-overlay-rich {
  position: absolute; z-index: 2147483000; margin: 0; padding: 2px 4px; min-width: 120px;
  border: 2px solid rgb(99,102,241); border-radius: 3px; background: #fff; color: #111;
  box-shadow: 0 4px 14px rgba(0,0,0,.18); overflow: auto;
}
.hf-overlay-rich:focus { outline: none; }

/**
 * The section a finding is about, on arrival.
 *
 * An outline that fades rather than one that stays: the point is to answer "which part of the page is this?" at the
 * moment you land, and a highlight that persists competes with the field-level outline that is still showing you
 * *where in the section* to look. An outline rather than a border, because a border would change the block's box and
 * reflow the page you were just scrolled into.
 */
@keyframes hf-block-reveal {
  0%   { outline-color: rgba(99,102,241,.9); background-color: rgba(99,102,241,.10); }
  70%  { outline-color: rgba(99,102,241,.9); background-color: rgba(99,102,241,.06); }
  100% { outline-color: rgba(99,102,241,0); background-color: rgba(99,102,241,0); }
}
.hf-block-reveal {
  outline: 3px solid rgba(99,102,241,0); outline-offset: -3px;
  animation: hf-block-reveal 1.9s ease-out 1 forwards;
}
/* A reader who asked for less motion still gets told which section — it just holds and drops instead of pulsing. */
@media (prefers-reduced-motion: reduce) {
  .hf-block-reveal { animation-duration: 1.2s; animation-timing-function: step-end; }
}
`;

/**
 * @param fieldLimits `{ [blockId]: { [fieldPath]: maxLength } }` — the limits in force, so the overlay shows the
 *   same counter the rail does. Keyed by field path *without* a row index (one rule covers every row) and nested
 *   under the block, because two components can declare different limits for the same field name.
 */
export function inlineEditScript(
  fieldLimits: Record<string, Record<string, number>> = {},
  editableFields: string[] = [],
  /** Marks whose value is richtext, so the overlay commits markup rather than words — roadmap F.2b. */
  richtextFields: string[] = []
): string {
  return `
(function(){
  var LIMITS = ${JSON.stringify(fieldLimits)};
  /**
   * Only these field paths get an editing affordance.
   *
   * The overlay seeds from the marked range's *text*, which is only faithful for a plain string. A field wrapping
   * a repeater reads back as its rows concatenated (\`footer.menu\` → "PrivacyTerms") and committing that would
   * write a string over an array; richtext reads back with its markup stripped. Both were caught by driving the
   * real template output. Anything not listed gets no hit area — see \`textEditableFieldPaths\`.
   */
  var EDITABLE = ${JSON.stringify(editableFields)};
  /**
   * Marks whose value is **richtext** (roadmap F.2b). These get a \`contenteditable\` overlay seeded from the
   * mark's innerHTML, so committing preserves \`<strong>\`, lists and links instead of flattening them — which is
   * exactly what a plain-text commit does, and why richtext was excluded from F.2 in the first place.
   */
  var RICHTEXT = ${JSON.stringify(richtextFields)};
  var open = null;

  function bare(id){ return id.replace(/:\\d+$/,''); }
  function editable(id){ return EDITABLE.indexOf(bare(id))!==-1 || RICHTEXT.indexOf(bare(id))!==-1; }
  function isRichtext(id){ return RICHTEXT.indexOf(bare(id))!==-1; }

  /**
   * Copy length for the counter, markup excluded.
   *
   * Re-implemented rather than imported for the same reason the mark format is: this string is injected into a
   * sandboxed document with no module loader. It must stay in step with \`richTextToCopy\` in
   * \`authoring-guardrails.ts\`, which is what the server measures against — an inline counter that disagrees with
   * the gate is the E.9 bug all over again. Same two rules: block boundaries become spaces, inline ones do not.
   */
  var INLINE_TAGS = ' a abbr b bdi bdo cite code data dfn em i kbd mark q rp rt ruby s samp small span strong sub sup time u var wbr ';
  function copyLength(html){
    var text = html
      .replace(/<(script|style)\\b[^>]*>[\\s\\S]*?<\\/\\1>/gi,'')
      .replace(/<!--[\\s\\S]*?-->/g,'')
      .replace(/<\\/?([a-z][a-z0-9-]*)\\b[^>]*>/gi,function(m,name){
        return INLINE_TAGS.indexOf(' '+name.toLowerCase()+' ')!==-1 ? '' : ' ';
      })
      .replace(/<[^>]*>/g,'')
      .replace(/&nbsp;/gi,' ')
      .replace(/&amp;/gi,'&')
      .replace(/\\s+/g,' ')
      .trim();
    return text.length;
  }

  /** The mark's rendered HTML, which is what a richtext overlay must start from. */
  function htmlOf(m){
    var holder=document.createElement('div');
    holder.appendChild(rangeOf(m).cloneContents());
    return holder.innerHTML;
  }

  /**
   * Every marked field, as { id, blockId, start, end }.
   *
   * The mark format is re-implemented here rather than imported: this string is injected into a sandboxed
   * document with no module loader, so it cannot share \`lib/field-marks.ts\`. The two must stay in step — the
   * format lives there, and \`test/field-marks.test.ts\` pins it.
   */
  function collect(){
    var out=[];
    var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT,null);
    var stack=[];
    var node;
    while((node=walker.nextNode())){
      var v=(node.nodeValue||'').trim();
      if(v.indexOf('${MARK_CLOSE_PREFIX}')===0){
        var closeId=v.slice(${MARK_CLOSE_PREFIX.length});
        for(var i=stack.length-1;i>=0;i--){
          if(stack[i].id===closeId){
            var openNode=stack.splice(i,1)[0];
            var block=openNode.node.parentElement&&openNode.node.parentElement.closest('.playground-block');
            out.push({id:closeId,blockId:block?block.getAttribute('data-block-id'):null,start:openNode.node,end:node});
            break;
          }
        }
      } else if(v.indexOf('${MARK_PREFIX}')===0){
        stack.push({id:v.slice(${MARK_PREFIX.length}),node:node});
      }
    }
    return out;
  }

  /** A DOM range spanning a mark's content — what gives geometry for an empty slot too. */
  function rangeOf(m){
    var r=document.createRange();
    r.setStartAfter(m.start);
    r.setEndBefore(m.end);
    return r;
  }

  /**
   * The box to cover. A range's own rect is empty when the field rendered nothing, so an empty slot falls back to
   * its parent element — otherwise there would be nothing to click on exactly where a value is most needed.
   */
  function boxOf(m){
    var r=rangeOf(m).getBoundingClientRect();
    if(r.width>1&&r.height>1)return r;
    var host=m.start.parentElement;
    return host?host.getBoundingClientRect():null;
  }

  function textOf(m){ return rangeOf(m).toString(); }

  function post(type,extra){
    var msg={type:type};
    for(var k in extra) msg[k]=extra[k];
    window.parent.postMessage(msg,'*');
  }

  function close(commit){
    if(!open)return;
    var o=open; open=null;
    // Richtext keeps its markup; a text field commits the words only, never the browser's stray <div>/<br>.
    var value=o.rich ? o.input.innerHTML : (o.input.textContent||'');
    o.input.remove(); o.meta.remove();
    if(o.hit) o.hit.classList.remove('hf-field-hit-active');
    if(commit&&value!==o.original){
      post('playground-field-commit',{blockId:o.mark.blockId,fieldId:o.mark.id,value:value});
    }
  }

  function limitFor(m){
    // One rule per field, so the row index is stripped before lookup; nested per block so two components
    // declaring the same field name cannot show each other's number.
    var forBlock=LIMITS[m.blockId]||{};
    return forBlock[m.id.replace(/:\\d+$/,'')];
  }

  function openEditor(m){
    close(false);
    var box=boxOf(m);
    if(!box)return;
    var rich=isRichtext(m.id);
    /**
     * **Both kinds get a \`contenteditable\` overlay** — richtext since F.2b, plain text as of the QA pass.
     *
     * The text overlay used to be a \`<textarea>\`, and a textarea is a fixed box that scrolls its own content: a
     * headline longer than the box wrapped out of sight while you were typing it. A contenteditable grows with the
     * text and inherits the page's own typography, so editing a heading looks like editing that heading. The only
     * difference left between the two kinds is what gets committed — innerHTML for richtext, textContent for text
     * (and \`plaintext-only\`, so a paste cannot smuggle markup into a plain string field).
     *
     * Still an overlay, never the component's own node: React reconciliation eats a \`contenteditable\` on rendered
     * output and a Handlebars re-render discards the caret — the same bug \`RichTextField\` documents. So the
     * overlay owns its own node and the component tree is untouched until the parent applies the value.
     */
    var input=document.createElement('div');
    input.className='hf-overlay-rich';
    input.setAttribute('contenteditable', rich ? 'true' : 'plaintext-only');
    if(rich){ input.innerHTML=htmlOf(m); } else { input.textContent=textOf(m); }
    input.style.left=(box.left+window.scrollX)+'px';
    input.style.top=(box.top+window.scrollY)+'px';
    input.style.width=Math.max(box.width,120)+'px';
    // Height is left to the content: a fixed height is what hid the text being typed.
    input.style.minHeight=Math.max(box.height,24)+'px';
    // Match the text it is covering, so editing does not reflow the reader's sense of the page.
    var cs=window.getComputedStyle(m.start.parentElement||document.body);
    input.style.font=cs.font; input.style.textAlign=cs.textAlign;


    var meta=document.createElement('div');
    meta.className='hf-overlay-meta';
    meta.style.left=(box.left+window.scrollX)+'px';
    meta.style.top=Math.max(0,box.top+window.scrollY-18)+'px';

    /**
     * Label and buttons are separate nodes so \`paint()\` can rewrite the counter without wiping the controls —
     * setting \`meta.textContent\` would remove them on the first keystroke.
     */
    var label=document.createElement('span');
    meta.appendChild(label);

    /**
     * A visible save/discard pair. Escape and Enter already worked but said so nowhere, which is fine for a
     * text input and not fine as the only way to know the overlay is committal.
     *
     * \`mousedown\` is where the default is prevented, and that is the whole trick: a click would blur the
     * overlay first, and blur commits — so "discard" would have committed before its own handler ran.
     */
    function action(text,title,commit){
      var b=document.createElement('button');
      b.type='button'; b.className='hf-overlay-btn'; b.textContent=text; b.title=title;
      b.addEventListener('mousedown',function(e){e.preventDefault();});
      b.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();close(commit);});
      return b;
    }
    meta.appendChild(action('\u2713','Save (Enter)',true));
    meta.appendChild(action('\u2715','Discard (Esc)',false));

    var max=limitFor(m);
    function paint(){
      // Copy, not markup: a bolded 'Hi' is 2 characters, matching what the server enforces (E.9 addendum).
      var n=rich ? copyLength(input.innerHTML) : (input.textContent||'').length;
      label.textContent=m.id+(max?'  '+n+'/'+max:'');
      meta.setAttribute('data-over',max&&n>max?'1':'0');
    }
    paint();
    input.addEventListener('input',paint);

    input.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();close(false);return;}
      if(rich){
        /**
         * **Enter does not commit in richtext** — it makes a new paragraph, which is the whole point of the
         * control. The visible ✓ and blur are how a richtext edit is committed.
         *
         * Bold/italic/underline are wired to the usual shortcuts because a formatting control without them reads
         * as broken. \`execCommand\` is deprecated but is what \`RichTextField\` already uses, and is the only thing
         * available inside an injected script with no editor library.
         */
        var meta=e.metaKey||e.ctrlKey;
        if(meta&&(e.key==='b'||e.key==='i'||e.key==='u')){
          e.preventDefault();
          document.execCommand(e.key==='b'?'bold':e.key==='i'?'italic':'underline');
          paint();
        }
        return;
      }
      // Enter commits on a single-line field; Shift+Enter always inserts a newline.
      if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();close(true);}
    });
    input.addEventListener('blur',function(){close(true);});

    document.body.appendChild(input);
    document.body.appendChild(meta);
    input.focus();
    /**
     * Caret to the end, via Selection rather than \`setSelectionRange\`.
     *
     * ⚠️ \`setSelectionRange\` is a textarea method. F.2b gave richtext a \`<div>\` and left this call in place, so
     * opening a richtext field threw a TypeError **right here** — after the overlay was in the DOM but before
     * \`open\` was assigned, which is why a richtext edit appeared to work and then committed nothing. Now that both
     * kinds are contenteditable there is one path, and it is the one that works for a div.
     */
    var range=document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    var sel=window.getSelection();
    if(sel){ sel.removeAllRanges(); sel.addRange(range); }

    var hit=m.start.parentElement;
    if(hit) hit.classList.add('hf-field-hit-active');
    open={mark:m,input:input,meta:meta,original:rich?input.innerHTML:(input.textContent||''),rich:rich,hit:hit};
    post('playground-field-focus',{blockId:m.blockId,fieldId:m.id});
  }

  /**
   * Block-level navigation, registered **before** the marks are checked.
   *
   * Everything below this returns early on a page with no \`{{#field}}\` marks — which is every page built from React
   * blocks. Taking "show me this section" down with it was wrong: a section is addressable by its wrapper alone, and
   * a React page is exactly where a reviewer has no other way to find what a finding is about.
   */
  window.addEventListener('message',function(event){
    var d=event.data;
    if(!d||d.type!=='playground-scroll-to-block')return;
    /**
     * Also handled here, not only in the block-controls script.
     *
     * A review canvas has no controls — no toolbars, nothing to click — so that script is not injected, and "jump to
     * the block this finding is about" silently did nothing there. This script is injected on any canvas that wants
     * navigation, editable or not.
     */
    var block=document.querySelector('.playground-block[data-block-id="'+String(d.blockId).replace(/"/g,'')+'"]');
    if(!block)return;
    block.scrollIntoView({behavior:'smooth',block:'start'});
    /**
     * \`flash\` outlines the whole section for a moment (Brad, QA: *"even better highlighted the section"*).
     *
     * Only on a deliberate arrival. The rail posts this message on every block selection too, and a section that
     * flashes each time you click down a list is noise — so the parent opts in from the "show me this finding" path
     * and nowhere else. A field-level finding gets both: the section flashes, and the field itself stays outlined
     * after the flash fades, which is what tells you *where in the section* to look.
     *
     * Removed and re-added across a frame so clicking the same finding twice replays the animation instead of doing
     * nothing — a keyframe on an element that already has the class never restarts.
     */
    if(!d.flash)return;
    var lit=document.querySelectorAll('.hf-block-reveal');
    for(var i=0;i<lit.length;i++) lit[i].classList.remove('hf-block-reveal');
    requestAnimationFrame(function(){ block.classList.add('hf-block-reveal'); });
    block.addEventListener('animationend',function once(){
      block.classList.remove('hf-block-reveal');
      block.removeEventListener('animationend',once);
    });
  });

  var marks=collect();
  if(!marks.length)return;

  /**
   * Report the marks in document order.
   *
   * This is what lets the rail order fields the way the page reads them instead of the way the schema happens to
   * list them — the "fields come in the order they come in" complaint, answered without any inference.
   */
  post('playground-fields',{fields:marks.map(function(m){return{id:m.id,blockId:m.blockId};})});

  // A hit area per *editable* mark, so a field is discoverable before it is clicked — and a field the overlay
  // cannot edit faithfully offers nothing at all.
  marks.forEach(function(m){
    if(!editable(m.id))return;
    var host=m.start.parentElement;
    if(!host)return;
    host.classList.add('hf-field-hit');
    host.addEventListener('mouseenter',function(){post('playground-field-hover',{blockId:m.blockId,fieldId:m.id});});
    host.addEventListener('mouseleave',function(){post('playground-field-hover',{blockId:m.blockId,fieldId:null});});
    host.addEventListener('click',function(e){
      // Stops the block-level click handler from swallowing it into "select this block".
      e.stopPropagation();e.preventDefault();
      openEditor(m);
    });
  });

  window.addEventListener('message',function(event){
    var d=event.data;
    if(!d)return;
    // The rail asking the canvas to highlight or open a field — the other half of hover linking.
    if(d.type==='playground-highlight-field'){
      // Compared row-less, because the rail sends \`items.paragraph\` while a mark is \`items.paragraph:1\` —
      // hovering the one editor the rail shows for a repeater should light up every row it covers.
      var want=d.fieldId?String(d.fieldId).replace(/:\d+$/,''):null;
      var first=null;
      marks.forEach(function(m){
        var host=m.start.parentElement;
        if(!host)return;
        var on=want!==null&&m.id.replace(/:\d+$/,'')===want;
        host.classList.toggle('hf-field-hit-active',on);
        if(on&&!first) first=host;
      });
      /**
       * \`reveal\` scrolls; a bare highlight does not.
       *
       * Hovering a row in the rail highlights, and yanking the page on hover would make the rail unusable. Clicking
       * a finding is a deliberate "take me there", and it sets this — the difference between the two is the whole
       * reason it is a flag rather than always-on behaviour.
       */
      if(d.reveal&&first) first.scrollIntoView({behavior:'smooth',block:'center'});
    } else if(d.type==='playground-edit-field'){
      var hit=marks.filter(function(m){return m.id===d.fieldId&&editable(m.id)&&(!d.blockId||m.blockId===d.blockId);})[0];
      if(hit) openEditor(hit);
    }
  });

  // A re-render replaces the body, taking the marks and any open overlay with it; the parent re-injects.
  window.addEventListener('beforeunload',function(){close(false);});
})();
`;
}
