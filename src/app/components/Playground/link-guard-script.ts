/**
 * Links do nothing in an editing canvas.
 *
 * A preview is full of real anchors — nav items, buttons, footer menus — and clicking one navigated the frame to
 * the live site, replacing the page being edited with somebody's homepage and losing the scroll position, the open
 * editor and any uncommitted overlay with it. The sandbox already blocks *top-level* navigation, which is why this
 * never looked like a security problem and always looked like the editor breaking.
 *
 * Capture phase, on the document: a component's own handler cannot get in front of it, and the click never reaches
 * the block's "select this" handler either — clicking a link in the canvas should mean nothing at all, not
 * accidentally mean "select this block".
 *
 * Forms too. A search box inside a preview would otherwise submit and navigate for exactly the same reason.
 */
export function getLinkGuardScript(): string {
  return `
(function(){
  var toast=null,timer=null;
  function say(text){
    if(!toast){
      toast=document.createElement('div');
      toast.setAttribute('style','position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483002;'
        +'padding:6px 12px;border-radius:6px;background:rgba(17,24,39,.92);color:#fff;'
        +'font:500 12px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);pointer-events:none;'
        +'opacity:0;transition:opacity .15s');
      document.body.appendChild(toast);
    }
    toast.textContent=text;
    toast.style.opacity='1';
    if(timer)clearTimeout(timer);
    timer=setTimeout(function(){ if(toast) toast.style.opacity='0'; },1800);
  }
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
    if(!a)return;
    var href=a.getAttribute('href')||'';
    // An in-page anchor is navigation *within* the preview — that is the page working, so let it work.
    if(href.charAt(0)==='#')return;
    e.preventDefault();
    e.stopPropagation();
    say('Links are inactive here \\u2014 you are editing the page.');
  },true);
  document.addEventListener('submit',function(e){
    e.preventDefault();
    e.stopPropagation();
    say('Forms are inactive here \\u2014 you are editing the page.');
  },true);
})();
`;
}
