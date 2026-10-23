// Keeps the opening of an earlier recording, so a retake only has to record what comes after it:
//   node scripts/tour/reuse.mjs <old recording> <seconds>
// <old recording> holds that take's frames/ and frames.json, from before record.mjs recorded parts. Everything
// before <seconds> becomes the `talk` part, with the intro's narration laid over its shots, and it fades into the
// first frame of the next part (NEXT, default make). Then assemble.mjs joins it with PARTS=talk,make,assist.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [from, cutArg] = process.argv.slice(2);
if (!from || !cutArg) throw new Error('usage: node scripts/tour/reuse.mjs <old recording> <seconds>');
const ROOT = process.env.REC_ROOT ?? join(tmpdir(), 'lectern-tour');
const NEXT = process.env.NEXT ?? 'make';
const OUT = join(ROOT, 'talk');
const cut = Number(cutArg);
const FADE = 0.6; // as long as the director's card fade

// The intro's lines, each this many seconds into the shot it describes. "Present" starts just before its shot, so
// "a click reveals the takeaway" is said as the takeaway appears.
const LINES = {
  'Key notes': [['title', 0.2], ['keynotes', 4.3]],
  Present: [['present', -0.5]],
  'Presenter view': [['presenter', 0.2]],
  Teleprompter: [['prompter', 0.2]],
  'Phone quiz': [['quiz', 0.2]],
};

const old = JSON.parse(readFileSync(join(from, 'frames.json'), 'utf8'));
const t0 = old.frames[0][1]; // the old frames carry clock times
const frames = old.frames.map(([name, t]) => [resolve(from, 'frames', name), +(t - t0).toFixed(4)]).filter(([, at]) => at < cut);
const marks = old.marks.filter((m) => m.at < cut);
const cues = marks.flatMap((m) => (LINES[m.label] ?? []).map(([id, after]) => ({ id, at: +(Math.max(0, m.at) + after).toFixed(2) })));

// The fade: the last kept frame dissolving into the next part's first.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'frames'), { recursive: true });
const next = JSON.parse(readFileSync(join(ROOT, NEXT, 'frames.json'), 'utf8'));
const n = Math.round(FADE * 30);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-loop', '1', '-framerate', '30', '-t', '2', '-i', frames.at(-1)[0],
  '-loop', '1', '-framerate', '30', '-t', '2', '-i', join(ROOT, NEXT, 'frames', next.frames[0][0]),
  '-filter_complex', `[0:v][1:v]xfade=transition=fade:duration=${FADE}:offset=0`, '-frames:v', String(n), '-q:v', '2',
  join(OUT, 'frames', 'fade-%02d.jpg')], { stdio: 'inherit' });
// On the 30 fps grid exactly: a rounded time can land a hair after its slot, and assemble.mjs would skip the frame.
const first = Math.round(cut * 30);
for (let k = 1; k <= n; k++) frames.push([`fade-${String(k).padStart(2, '0')}.jpg`, (first + k - 1) / 30]);
const end = (first + n) / 30;

writeFileSync(join(OUT, 'frames.json'), JSON.stringify({ frames, marks, cues, skips: [], end }, null, 1));
console.log(`talk: ${frames.length} frames, ${end.toFixed(2)} s`);
console.log(marks.map((m) => `${m.label} @ ${m.at}`).join('\n'));
console.log(cues.map((c) => `${c.id} @ ${c.at}`).join('\n'));
