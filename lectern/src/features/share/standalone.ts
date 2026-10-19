// Single-file web pages that work with no connection at all: a self-scoring
// quiz, a text-only copy of the slides, and a view-only copy of the full deck.
// Each is one .html file to AirDrop, email, or put on the class page.

import type { Deck } from '../../core/deck/types';
import type { Box } from '../../core/engine/boxes';
import { CANVAS_H, CANVAS_W } from '../../core/engine/boxes';
import { layoutSlide } from '../../core/engine/layout';
import { getTheme } from '../../core/engine/themes';
import type { QuizPack, SlidesPack } from '../../core/share/pack';
import { db } from '../../data/db';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function page(title: string, css: string, body: string, script = '', dark = false): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="Lectern">
<meta name="color-scheme" content="${dark ? 'dark' : 'light dark'}">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
${body}
${script ? `<script>${script}</script>` : ''}
</body>
</html>
`;
}

const BASE_CSS = `
:root{--bg:#f6f4ef;--panel:#fff;--ink:#1d1c1a;--ink2:#5c5850;--line:#e3dfd6;--brand:#d9542b;--good:#2f7d4f;--goodsoft:#e3f1e8;--bad:#c2412d;--badsoft:#fbe5df;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--panel:#1c1c1a;--ink:#f1efea;--ink2:#b5b1a8;--line:#2f2e2a;--brand:#f07a55;--good:#6cc48d;--goodsoft:#17301f;--bad:#f07a63;--badsoft:#3a1d17}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:max(20px,env(safe-area-inset-top)) 16px 40px}
h1{font:600 28px/1.15 Georgia,"Times New Roman",serif;margin:6px 0 8px}
h2{font-size:21px;line-height:1.3;margin:0 0 16px}
.eyebrow{margin:0;color:var(--ink2);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.muted{color:var(--ink2)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px;margin:14px 0}
button{font:inherit;cursor:pointer}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 22px;border:0;border-radius:14px;background:var(--brand);color:#fff;font-weight:700;font-size:16px}
.btn.ghost{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 1.5px var(--line)}
.foot{margin-top:28px;text-align:center;color:var(--ink2);font-size:12.5px}
`;

// --- Quiz ---------------------------------------------------------------------

const QUIZ_CSS = `${BASE_CSS}
.progress{height:6px;border-radius:9px;background:var(--line);overflow:hidden;margin:10px 0 18px}
.progress span{display:block;height:100%;background:var(--brand);border-radius:inherit;transition:width .3s}
.choices{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:360px){.choices{grid-template-columns:1fr}}
.choice{display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:10px;min-height:96px;padding:14px;border:0;border-radius:16px;color:#fff;font-size:16px;font-weight:650;line-height:1.25;text-align:left;box-shadow:inset 0 -4px 0 rgba(0,0,0,.18);overflow-wrap:anywhere;transition:opacity .2s,transform .1s}
.choice:active{transform:scale(.97)}
.choice b{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.25)}
.c0{background:#d9542b}.c1{background:#2a7bbd}.c2{background:#a8700a}.c3{background:#4f7a24}.c4{background:#87479f}.c5{background:#1b7f79}
.done .choice{opacity:.35;cursor:default}
.done .choice.right{opacity:1;box-shadow:0 0 0 3px var(--good)}
.done .choice.picked{opacity:1}
.feedback{margin-top:16px;padding:16px;border-radius:16px;background:var(--badsoft)}
.feedback.ok{background:var(--goodsoft)}
.feedback strong{display:block;font-size:19px;margin-bottom:4px}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.row .btn{flex:1}
.score{font:600 64px/1 Georgia,serif;margin:10px 0 4px}
.review{list-style:none;margin:0;padding:0}
.review li{display:grid;grid-template-columns:28px 1fr;gap:10px;padding:12px 0;border-top:1px solid var(--line)}
.review .mark{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;color:#fff;font-weight:800;background:var(--bad)}
.review .mark.ok{background:var(--good)}
.review small{display:block;color:var(--ink2)}
`;

const QUIZ_JS = `(function(){
var P=JSON.parse(document.getElementById('pack').textContent);
var app=document.getElementById('app');
var i=0,picked=[],shown=false;
function L(n){return String.fromCharCode(65+n)}
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function intro(){
  app.innerHTML='<p class="eyebrow">Quiz</p><h1>'+esc(P.title)+'</h1><p class="muted">'+P.items.length+(P.items.length===1?' question':' questions')+'. Tap an answer to see if you got it right.</p><div class="row"><button class="btn" id="go">Start</button></div>';
  document.getElementById('go').onclick=function(){i=0;picked=[];ask()};
}
function ask(){
  var q=P.items[i];shown=picked[i]!==undefined;
  var h='<p class="eyebrow">Question '+(i+1)+' of '+P.items.length+'</p><div class="progress"><span style="width:'+(i/P.items.length*100)+'%"></span></div><h2>'+esc(q.q)+'</h2><div class="choices'+(shown?' done':'')+'">';
  q.c.forEach(function(c,n){var cls='choice c'+(n%6)+(shown&&n===q.a?' right':'')+(shown&&n===picked[i]?' picked':'');h+='<button class="'+cls+'" data-n="'+n+'"'+(shown?' disabled':'')+'><b>'+L(n)+'</b><span>'+esc(c)+'</span></button>'});
  h+='</div>';
  if(shown){var ok=picked[i]===q.a;h+='<div class="feedback'+(ok?' ok':'')+'" role="status"><strong>'+(ok?'Correct!':'Not quite')+'</strong>'+(ok?'':'The answer is '+L(q.a)+': '+esc(q.c[q.a])+'. ')+(q.e?esc(q.e):'')+'</div><div class="row"><button class="btn" id="next">'+(i<P.items.length-1?'Next question':'See your score')+'</button></div>'}
  app.innerHTML=h;
  app.querySelectorAll('.choice').forEach(function(b){b.onclick=function(){if(picked[i]!==undefined)return;picked[i]=Number(b.getAttribute('data-n'));ask()}});
  var nx=document.getElementById('next');if(nx){nx.onclick=function(){i++;if(i<P.items.length)ask();else end()};nx.focus()}
  window.scrollTo(0,0);
}
function end(){
  var right=0;P.items.forEach(function(q,n){if(picked[n]===q.a)right++});
  var pct=P.items.length?Math.round(right/P.items.length*100):0;
  var msg=pct>=80?'Great work.':pct>=50?'Good effort. Have another look at the ones you missed.':'Keep going. Review the answers below, then try again.';
  var h='<p class="eyebrow">'+esc(P.title)+'</p><div class="score">'+right+'/'+P.items.length+'</div><p class="muted">'+pct+'% right. '+msg+'</p><div class="card"><ol class="review">';
  P.items.forEach(function(q,n){var ok=picked[n]===q.a;h+='<li><span class="mark'+(ok?' ok':'')+'">'+(ok?'&#10003;':'&#10007;')+'</span><span>'+esc(q.q)+'<small>'+L(q.a)+': '+esc(q.c[q.a])+'</small></span></li>'});
  h+='</ol></div><div class="row"><button class="btn" id="again">Try again</button></div>';
  app.innerHTML=h;
  document.getElementById('again').onclick=function(){i=0;picked=[];ask()};
  window.scrollTo(0,0);
}
intro();
})();`;

export function quizHtml(pack: QuizPack): string {
  const body = `<main><div id="app"></div><p class="foot">Made with Lectern · works offline</p></main>
<script type="application/json" id="pack">${scriptJson(pack)}</script>`;
  return page(pack.title || 'Quiz', QUIZ_CSS, body, QUIZ_JS);
}

// --- Text-only slides -----------------------------------------------------------

const LITE_CSS = `${BASE_CSS}
.slide{position:relative;padding-top:18px}
.num{position:absolute;top:14px;right:16px;color:var(--ink2);font-size:12.5px;font-weight:700}
.slide h2{margin:0 0 8px;padding-right:32px}
.slide ul{margin:0;padding-left:20px}
.slide li{margin:4px 0}
`;

export function slidesLiteHtml(pack: SlidesPack): string {
  const cards = pack.slides.map((s, i) => `<article class="card slide"><span class="num">${i + 1}</span>${s.h ? `<h2>${escapeHtml(s.h)}</h2>` : ''}${s.b.length ? `<ul>${s.b.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}</article>`).join('\n');
  const body = `<main><p class="eyebrow">${pack.slides.length} slides</p><h1>${escapeHtml(pack.title)}</h1>
${cards}
<p class="foot">Made with Lectern · text-only copy</p></main>`;
  return page(pack.title || 'Slides', LITE_CSS, body);
}

// --- View-only deck -------------------------------------------------------------

const DECK_CSS = `
:root{--ease-out:cubic-bezier(.2,.8,.2,1);--s:1}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:#0e0e0d;color:#f1efea;font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.stage{position:fixed;inset:0 0 56px 0;display:grid;place-items:center;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.page-slide{position:relative;width:calc(${CANVAS_W}px * var(--s));height:calc(${CANVAS_H}px * var(--s));overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.45)}
.page-slide[hidden]{display:none}
.page-slide .slide-canvas{transform:scale(var(--s))}
.bar{position:fixed;left:0;right:0;bottom:0;height:56px;display:flex;align-items:center;gap:6px;padding:0 max(10px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(10px,env(safe-area-inset-left))}
.bar .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#b5b1a8;padding:0 8px}
.bar button{display:grid;place-items:center;min-width:44px;height:40px;padding:0 12px;border:0;border-radius:10px;background:#242422;color:#f1efea;font:inherit;font-weight:650;cursor:pointer}
.bar button:hover{background:#30302d}
.count{min-width:64px;text-align:center;font-variant-numeric:tabular-nums;color:#f1efea}
.progress{position:fixed;left:0;right:0;bottom:56px;height:3px;background:#242422}
.progress span{display:block;height:100%;background:#f07a55;transition:width .25s}
:fullscreen .bar,:fullscreen .progress{opacity:0;transition:opacity .3s}
:fullscreen .bar:hover{opacity:1}
:fullscreen .stage{inset:0}
@media (prefers-reduced-motion:reduce){.box{transition:none!important}}
`;

const DECK_JS = `(function(){
var slides=[].slice.call(document.querySelectorAll('.page-slide'));
var i=0,step=0,root=document.documentElement;
var count=document.getElementById('count'),prog=document.getElementById('prog');
function steps(s){return Number(s.getAttribute('data-steps')||0)}
function show(){
  slides.forEach(function(s,n){s.hidden=n!==i});
  [].forEach.call(slides[i].querySelectorAll('[data-step]'),function(b){b.classList.toggle('is-hidden',Number(b.getAttribute('data-step'))>step)});
  count.textContent=(i+1)+' / '+slides.length;
  prog.style.width=((i+1)/slides.length*100)+'%';
  try{history.replaceState(null,'','#'+(i+1))}catch(e){}
}
function next(){if(step<steps(slides[i]))step++;else if(i<slides.length-1){i++;step=0}show()}
function prev(){if(step>0)step--;else if(i>0){i--;step=steps(slides[i])}show()}
function go(n,all){i=Math.max(0,Math.min(slides.length-1,n));step=all?steps(slides[i]):0;show()}
function fit(){var full=!!document.fullscreenElement;var w=innerWidth,h=innerHeight-(full?0:59);root.style.setProperty('--s',String(Math.min(w/${CANVAS_W},h/${CANVAS_H})))}
function full(){if(document.fullscreenElement)document.exitFullscreen();else if(root.requestFullscreen)root.requestFullscreen().catch(function(){})}
addEventListener('resize',fit);document.addEventListener('fullscreenchange',fit);
addEventListener('keydown',function(e){
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  var k=e.key;
  if(k==='ArrowRight'||k==='ArrowDown'||k==='PageDown'||k===' '||k==='Enter'){e.preventDefault();next()}
  else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'||k==='Backspace'){e.preventDefault();prev()}
  else if(k==='Home')go(0);else if(k==='End')go(slides.length-1,true);
  else if(k==='f'||k==='F')full();
});
var stage=document.getElementById('stage'),x0=null,y0=0;
stage.addEventListener('click',function(e){if(e.clientX<innerWidth/3)prev();else next()});
stage.addEventListener('touchstart',function(e){x0=e.touches[0].clientX;y0=e.touches[0].clientY},{passive:true});
stage.addEventListener('touchend',function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0,dy=e.changedTouches[0].clientY-y0;x0=null;if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){e.preventDefault();if(dx<0)next();else prev()}});
document.getElementById('prev').onclick=prev;document.getElementById('next').onclick=next;document.getElementById('full').onclick=full;
var start=parseInt(location.hash.slice(1),10);if(start>0)i=Math.min(slides.length,start)-1;
fit();show();
})();`;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Turns every image into a data: URL so the page needs nothing else. */
async function inlineImage(src: string): Promise<string> {
  try {
    if (src.startsWith('data:')) return src;
    if (src.startsWith('asset:')) {
      const asset = await db.assets.get(src.slice(6));
      return asset ? await blobToDataUrl(asset.blob) : '';
    }
    const res = await fetch(src);
    return res.ok ? await blobToDataUrl(await res.blob()) : src;
  } catch {
    return src;
  }
}

function familyNames(stack: string): string[] {
  return stack.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** The Latin @font-face rules this page has loaded for these families, with the font files inlined. */
async function embeddedFonts(families: Set<string>): Promise<string> {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      if (!families.has(family)) continue;
      const range = rule.style.getPropertyValue('unicode-range');
      if (range && !/U\+0+-0*FF(?![0-9A-F])/i.test(range)) continue;
      const src = rule.style.getPropertyValue('src');
      const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(src);
      if (!m?.[1]) continue;
      try {
        const url = new URL(m[1], sheet.href ?? window.location.href).href;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await blobToDataUrl(await res.blob());
        out.push(`@font-face{font-family:"${family}";font-style:${rule.style.getPropertyValue('font-style') || 'normal'};font-weight:${rule.style.getPropertyValue('font-weight') || '400'};font-display:swap;src:url(${data}) format("woff2")${range ? `;unicode-range:${range}` : ''}}`);
      } catch { /* leave this face to the system fallback */ }
    }
  }
  return out.join('\n');
}

/**
 * A view-only copy of the whole deck as one web page: the slides exactly as
 * designed, with click-by-click reveals, and no notes or script.
 */
export async function deckHtml(deck: Deck): Promise<string> {
  const [{ renderToStaticMarkup }, { createElement, Fragment }, { BoxView }, slidesCss] = await Promise.all([
    import('react-dom/server'),
    import('react'),
    import('../slides/SlideView'),
    import('../../styles/slides.css?raw').then((m) => m.default as string),
  ]);
  const theme = getTheme(deck.themeId);
  const visible = deck.slides.filter((s) => !s.hidden);
  const sections: string[] = [];
  for (let n = 0; n < visible.length; n++) {
    const layout = layoutSlide(visible[n]!, {
      theme, audience: deck.audience, mode: 'show', slideNumber: n + 1, slideCount: visible.length, deckTitle: deck.title,
    });
    const boxes: Box[] = await Promise.all(layout.boxes.map(async (b) => (b.type === 'image' ? { ...b, src: await inlineImage(b.src) } : b)));
    const markup = renderToStaticMarkup(createElement(Fragment, null, ...boxes.map((box) => createElement(BoxView, {
      key: box.id, box, theme, state: 'shown', editable: false, active: false,
    }))));
    sections.push(`<section class="page-slide" data-steps="${layout.steps}" aria-label="Slide ${n + 1}"${n ? ' hidden' : ''} style="background:${escapeHtml(layout.background)}"><div class="slide-canvas" style="width:${CANVAS_W}px;height:${CANVAS_H}px">${markup}</div></section>`);
  }
  const fonts = await embeddedFonts(new Set([theme.display.web, theme.body.web, theme.mono.web].flatMap(familyNames)));
  const body = `<div class="stage" id="stage">
${sections.join('\n')}
</div>
<div class="progress"><span id="prog"></span></div>
<nav class="bar" aria-label="Slides">
<span class="title">${escapeHtml(deck.title)}</span>
<button type="button" id="prev" aria-label="Previous">&#8592;</button>
<span class="count" id="count" aria-live="polite"></span>
<button type="button" id="next" aria-label="Next">&#8594;</button>
<button type="button" id="full" aria-label="Full screen" title="Full screen (F)">&#x26F6;</button>
</nav>`;
  return page(deck.title || 'Slides', `${fonts}\n${slidesCss}\n${DECK_CSS}`, body, DECK_JS, true);
}
