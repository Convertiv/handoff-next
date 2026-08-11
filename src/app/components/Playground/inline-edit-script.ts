/**
 * The in-frame half of inline editing — roadmap F.2.
 *
 * Runs **inside the preview iframe**, which is where it has to run: the frame is opaque-origin
 * (`sandbox="allow-scripts"`, no `allow-same-origin`), so the parent cannot read its DOM or measure anything in
 * it. The frame already receives injected script and CSS for block controls, so this is the same channel — and
 * hosting the overlay here rather than in the parent removes the rect protocol, scroll/resize/font-load
 * invalidation, and all the drift that comes with keeping two documents' geometry in sync.
 *
 * **It edits an overlay, never the component's own node.** No `contenteditable` on rendered output: React
 * reconciliation eats it (see the caret-loss note in `RichTextField.tsx`), and for Handlebars a re-render would
 * discard the caret anyway. The overlay is a plain `<textarea>` positioned over the field's box; the component
 * tree is untouched until the parent applies the committed value through the normal args path.
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
.hf-overlay {
  position: absolute; z-index: 2147483000; margin: 0; padding: 2px 4px;
  border: 2px solid rgb(99,102,241); border-radius: 3px; background: #fff; color: #111;
  box-shadow: 0 4px 14px rgba(0,0,0,.18); resize: none; overflow: hidden;
  font: inherit; line-height: inherit; letter-spacing: inherit;
}
.hf-overlay-meta {
  position: absolute; z-index: 2147483001; padding: 1px 6px; border-radius: 3px;
  background: rgb(99,102,241); color: #fff; font: 500 11px/1.5 system-ui, sans-serif; white-space: nowrap;
}
.hf-overlay-meta[data-over="1"] { background: rgb(180,83,9); }
`;

/**
 * @param fieldLimits `{ [fieldPath]: maxLength }` — the guardrail limits in force, so the overlay can show the
 *   same counter the rail does. Keyed by field path *without* a row index: one rule covers every row.
 */
export function inlineEditScript(
  fieldLimits: Record<string, number> = {},
  editableFields: string[] = []
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
  var open = null;

  function editable(id){ return EDITABLE.indexOf(id.replace(/:\\d+$/,''))!==-1; }

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
    var value=o.input.value;
    o.input.remove(); o.meta.remove();
    if(o.hit) o.hit.classList.remove('hf-field-hit-active');
    if(commit&&value!==o.original){
      post('playground-field-commit',{blockId:o.mark.blockId,fieldId:o.mark.id,value:value});
    }
  }

  function limitFor(id){
    // One rule per field, so the row index is stripped before lookup.
    var field=id.replace(/:\\d+$/,'');
    return LIMITS[field];
  }

  function openEditor(m){
    close(false);
    var box=boxOf(m);
    if(!box)return;
    var input=document.createElement('textarea');
    input.className='hf-overlay';
    input.value=textOf(m);
    input.style.left=(box.left+window.scrollX)+'px';
    input.style.top=(box.top+window.scrollY)+'px';
    input.style.width=Math.max(box.width,120)+'px';
    input.style.height=Math.max(box.height,24)+'px';
    // Match the text it is covering, so editing does not reflow the reader's sense of the page.
    var cs=window.getComputedStyle(m.start.parentElement||document.body);
    input.style.font=cs.font; input.style.textAlign=cs.textAlign;

    var meta=document.createElement('div');
    meta.className='hf-overlay-meta';
    meta.style.left=(box.left+window.scrollX)+'px';
    meta.style.top=Math.max(0,box.top+window.scrollY-18)+'px';

    var max=limitFor(m.id);
    function paint(){
      var n=input.value.length;
      meta.textContent=m.id+(max?'  '+n+'/'+max:'');
      meta.setAttribute('data-over',max&&n>max?'1':'0');
    }
    paint();
    input.addEventListener('input',paint);

    input.addEventListener('keydown',function(e){
      if(e.key==='Escape'){e.preventDefault();close(false);}
      // Enter commits on a single-line field; Shift+Enter always inserts a newline.
      else if(e.key==='Enter'&&!e.shiftKey&&input.value.indexOf('\\n')===-1){e.preventDefault();close(true);}
    });
    input.addEventListener('blur',function(){close(true);});

    document.body.appendChild(input);
    document.body.appendChild(meta);
    input.focus();
    input.setSelectionRange(input.value.length,input.value.length);

    var hit=m.start.parentElement;
    if(hit) hit.classList.add('hf-field-hit-active');
    open={mark:m,input:input,meta:meta,original:input.value,hit:hit};
    post('playground-field-focus',{blockId:m.blockId,fieldId:m.id});
  }

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
      marks.forEach(function(m){
        var host=m.start.parentElement;
        if(host) host.classList.toggle('hf-field-hit-active',d.fieldId===m.id);
      });
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
