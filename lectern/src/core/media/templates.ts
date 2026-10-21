// Built-in activities: small, self-contained pages that run in the activity sandbox,
// coloured from the deck's look. They work offline and on phones.

import type { Theme } from '../engine/themes';
import { fontFamily } from '../engine/themes';

/** JSON that is safe inside a <script> element. */
function data(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function css(theme: Theme) {
  const c = theme.colors;
  return `:root{--bg:${c.bg};--surface:${c.surface};--ink:${c.ink};--muted:${c.muted};--accent:${c.accent};--on:${c.onAccent};--accent2:${c.accent2};--line:${c.line}}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}
body{background:var(--bg);color:var(--ink);font-family:${fontFamily(theme, 'body', 'web')};-webkit-user-select:none;user-select:none}
button{font:inherit;font-weight:700;border:0;border-radius:999px;cursor:pointer;padding:.55em 1.4em;background:var(--accent);color:var(--on);transition:transform .12s}
button:active{transform:scale(.96)}button.quiet{background:transparent;color:var(--ink);box-shadow:inset 0 0 0 .14em var(--line)}
button:focus-visible{outline:.18em solid var(--ink);outline-offset:.18em}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
}

/** Seconds from "5", "2:30" or "90s". Defaults to five minutes. */
export function timerSeconds(value: unknown): number {
  const v = String(value ?? '').trim().toLowerCase();
  let s = 0;
  if (/^\d+(\.\d+)?$/.test(v)) s = Number(v) * 60;
  else if (/^\d+:\d{1,2}$/.test(v)) { const [m, sec] = v.split(':').map(Number); s = m * 60 + sec; }
  else if (/^\d+\s*s(ec(onds?)?)?$/.test(v)) s = parseInt(v, 10);
  else if (/^\d+\s*m(in(utes?)?)?$/.test(v)) s = parseInt(v, 10) * 60;
  if (!Number.isFinite(s) || s <= 0) s = 300;
  return Math.min(Math.round(s), 3 * 3600);
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** A countdown ring with start, pause and reset. Space starts and pauses, R resets. */
export function timerHtml(theme: Theme, o: { seconds: number; autostart: boolean; sound: boolean }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(theme)}
body{display:grid;place-items:center}
.wrap{display:flex;flex-direction:column;align-items:center;gap:5vh;width:100%}
.ring{position:relative;height:72vh;aspect-ratio:1;max-width:80vw}
svg{width:100%;height:100%;transform:rotate(-90deg)}
circle{fill:none;stroke-width:7}.track{stroke:var(--line)}.bar{stroke:var(--accent);stroke-linecap:round;transition:stroke-dashoffset .25s linear}
.time{position:absolute;inset:0;display:grid;place-items:center;font-size:min(19vh,16vw);font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.btns{display:flex;gap:2.4vw;font-size:max(16px,4.2vh)}
.done .time{color:var(--accent);animation:pulse .9s ease-in-out 4}
@keyframes pulse{50%{transform:scale(1.08)}}
</style></head><body><div class="wrap" id="w"><div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="45"/><circle class="bar" id="bar" cx="50" cy="50" r="45" stroke-dasharray="282.74" stroke-dashoffset="0"/></svg><div class="time" id="t" role="timer" aria-live="off"></div></div>
<div class="btns"><button id="go">Start</button><button id="reset" class="quiet">Reset</button></div></div>
<script>
const TOTAL=${data(o.seconds)},AUTO=${data(o.autostart)},SOUND=${data(o.sound)};
let left=TOTAL*1000,running=false,last=0,timer=0;
const t=document.getElementById('t'),bar=document.getElementById('bar'),go=document.getElementById('go'),w=document.getElementById('w');
function fmt(ms){const s=Math.ceil(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?h+':'+String(m).padStart(2,'0')+':'+x:m+':'+x}
function draw(){t.textContent=fmt(left);bar.style.strokeDashoffset=String(282.74*(1-left/(TOTAL*1000)));go.textContent=running?'Pause':left<TOTAL*1000&&left>0?'Resume':left<=0?'Again':'Start'}
function chime(){if(!SOUND)return;try{const a=new AudioContext();[0,.28,.56].forEach((d,i)=>{const o=a.createOscillator(),g=a.createGain();o.frequency.value=[660,880,1320][i];g.gain.setValueAtTime(.0001,a.currentTime+d);g.gain.exponentialRampToValueAtTime(.35,a.currentTime+d+.02);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+d+.6);o.connect(g).connect(a.destination);o.start(a.currentTime+d);o.stop(a.currentTime+d+.7)})}catch(e){}}
function tick(){const now=performance.now();left-=now-last;last=now;if(left<=0){left=0;running=false;clearInterval(timer);w.classList.add('done');chime()}draw()}
function start(){if(left<=0){left=TOTAL*1000;w.classList.remove('done')}running=true;last=performance.now();clearInterval(timer);timer=setInterval(tick,200);draw()}
function pause(){running=false;clearInterval(timer);draw()}
function reset(){pause();left=TOTAL*1000;w.classList.remove('done');draw()}
go.onclick=()=>running?pause():start();document.getElementById('reset').onclick=reset;
addEventListener('keydown',e=>{if(e.key===' '){e.preventDefault();running?pause():start()}else if(e.key==='r'||e.key==='R')reset()});
draw();if(AUTO)start();
</script></body></html>`;
}

/** A wheel that spins to a random choice. Space or Enter spins. */
export function pickerHtml(theme: Theme, o: { items: string[]; removePicked: boolean }): string {
  const items = o.items.map((s) => s.trim()).filter(Boolean).slice(0, 40);
  const c = theme.colors;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css(theme)}
body{display:flex;align-items:center;justify-content:center;gap:5vw;padding:2vh 3vw}
.wheel{position:relative;height:92vh;aspect-ratio:1;max-width:58vw;flex:none}
canvas{width:100%;height:100%;display:block}
.pin{position:absolute;right:-1.2vh;top:50%;width:0;height:0;border-top:2.6vh solid transparent;border-bottom:2.6vh solid transparent;border-right:5vh solid var(--ink);transform:translateY(-50%);filter:drop-shadow(0 .3vh .4vh rgba(0,0,0,.25))}
.side{display:flex;flex-direction:column;align-items:flex-start;gap:4vh;min-width:0;flex:1}
.label{font-size:max(14px,3.2vh);color:var(--muted);font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.result{font-size:min(11vh,7vw);font-weight:800;line-height:1.05;min-height:1.1em;overflow-wrap:anywhere}
.btns{display:flex;gap:1.6vw;font-size:max(16px,4.2vh);flex-wrap:wrap}
.empty{font-size:4vh;color:var(--muted)}
</style></head><body><div class="wheel"><canvas id="c" width="1000" height="1000" aria-hidden="true"></canvas><div class="pin"></div></div>
<div class="side"><div class="label" id="lab">Spin the wheel</div><div class="result" id="r" aria-live="polite"></div><div class="btns"><button id="spin">Spin</button><button id="reset" class="quiet" hidden>Put all back</button></div></div>
<script>
const ALL=${data(items)},REMOVE=${data(o.removePicked)};
const COLORS=${data([c.accent, c.accent2, c.surface, c.line])},INKS=${data([c.onAccent, c.ink, c.ink, c.ink])};
let items=ALL.slice(),angle=0,spinning=false;
const cv=document.getElementById('c'),x=cv.getContext('2d'),r=document.getElementById('r'),spin=document.getElementById('spin'),reset=document.getElementById('reset'),lab=document.getElementById('lab');
const font=getComputedStyle(document.body).fontFamily;
function draw(){x.clearRect(0,0,1000,1000);const n=items.length;if(!n){x.fillStyle=COLORS[3];x.beginPath();x.arc(500,500,490,0,7);x.fill();return}
const seg=Math.PI*2/n;for(let i=0;i<n;i++){const a=angle+i*seg,k=n%2&&i===n-1&&n>1?1:i%(n>3?3:2);x.beginPath();x.moveTo(500,500);x.arc(500,500,490,a,a+seg);x.closePath();x.fillStyle=COLORS[k];x.fill();x.strokeStyle='rgba(0,0,0,.08)';x.lineWidth=3;x.stroke();
x.save();x.translate(500,500);x.rotate(a+seg/2);x.textAlign='right';x.textBaseline='middle';x.fillStyle=INKS[k];const size=Math.max(18,Math.min(54,seg*300));x.font='700 '+size+'px '+font;let s=items[i];while(x.measureText(s).width>380&&s.length>2)s=s.slice(0,-2)+'…';x.fillText(s,460,0);x.restore()}
x.beginPath();x.arc(500,500,64,0,7);x.fillStyle=COLORS[0];x.fill();x.lineWidth=10;x.strokeStyle='#fff';x.stroke()}
function pickIndex(){const n=items.length,seg=Math.PI*2/n;let a=((-angle)%(Math.PI*2)+Math.PI*2)%(Math.PI*2);return Math.floor(a/seg)%n}
function go(){if(spinning||!items.length)return;spinning=true;spin.disabled=true;r.textContent='';const start=angle,turn=Math.PI*2*(5+Math.random()*3)+Math.random()*Math.PI*2,dur=matchMedia('(prefers-reduced-motion: reduce)').matches?10:4200,t0=performance.now();
function step(now){const p=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-p,4);angle=start+turn*e;draw();if(p<1)requestAnimationFrame(step);else done()}requestAnimationFrame(step)}
function done(){spinning=false;spin.disabled=false;const i=pickIndex(),v=items[i];r.textContent=v;lab.textContent='Picked';if(REMOVE){setTimeout(()=>{items.splice(i,1);draw();reset.hidden=items.length===ALL.length;if(!items.length){spin.disabled=true;lab.textContent='Everyone has had a turn'}},900)}}
spin.onclick=go;reset.onclick=()=>{items=ALL.slice();reset.hidden=true;spin.disabled=false;lab.textContent='Spin the wheel';r.textContent='';draw()};
addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();go()}});
if(!ALL.length){document.querySelector('.side').innerHTML='<div class="empty">Add some choices to the wheel.</div>'}
draw();
</script></body></html>`;
}
