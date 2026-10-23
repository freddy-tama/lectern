// Turns record.mjs's parts into the videos, keeping the recording's timing: a 1080p master for uploading, and
// the 720p cut and poster that go in public/media. The narration (voice.mjs) is laid under each shot where
// record.mjs started its line, over a quiet music bed (music.mjs) that ducks under the voice. Needs ffmpeg.
// PARTS picks and orders the parts (intro,make,assist, or talk from reuse.mjs in place of intro); MUSIC=0 leaves
// the music out; POSTER_AT is the poster's time in seconds.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.env.REC_ROOT ?? join(tmpdir(), 'lectern-tour');
const PARTS = (process.env.PARTS ?? 'intro,make,assist').split(',');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

// One timeline over every part, in order.
let offset = 0;
const frames = [];
const marks = [];
const cues = [];
const skips = [];
for (const [p, part] of PARTS.entries()) {
  const rec = JSON.parse(readFileSync(join(ROOT, part, 'frames.json'), 'utf8'));
  // A frame may be named by its full path, as reuse.mjs does for the frames it keeps.
  for (const [name, at] of rec.frames) frames.push([resolve(ROOT, part, 'frames', name), offset + at, p]);
  marks.push(...rec.marks.filter((m) => m.label !== 'End').map((m) => ({ ...m, at: +(offset + m.at).toFixed(2) })));
  cues.push(...rec.cues.map((c) => ({ ...c, at: offset + c.at })));
  skips.push(...rec.skips.map((x) => ({ ...x, t: +(offset + x.t).toFixed(2) })));
  offset += rec.end;
}
const end = offset;

// An exact 30 fps sequence: each output frame is the newest recorded frame at that moment.
// Hard links keep it cheap; the concat demuxer would round short frames up and stretch time.
const SEQ = join(ROOT, 'seq');
rmSync(SEQ, { recursive: true, force: true });
mkdirSync(SEQ);
const count = Math.round(end * 30);
const seqFile = (k) => join(SEQ, `${String(k).padStart(6, '0')}.jpg`);
const picked = [];
let j = 0;
for (let k = 0; k < count; k++) {
  while (j + 1 < frames.length && frames[j + 1][1] <= k / 30 + 1e-6) j++;
  picked.push(frames[j]);
  // NTFS allows 1023 links to a file, so a still screen of over 34 s gets copies.
  try { linkSync(frames[j][0], seqFile(k)); } catch (e) { if (['EMLINK', 'EPERM', 'EXDEV'].includes(e.code)) copyFileSync(frames[j][0], seqFile(k)); else throw e; }
}

// A part that ends on a still screen dissolves into the next, so a difference between takes (a panel left open,
// say) doesn't jump. A part that already fades out, as reuse.mjs's does, is left alone.
const JOIN = 15;
for (let p = 1; p < PARTS.length; p++) {
  const at = picked.findIndex((f) => f[2] === p);
  const still = picked[at - 1]?.[0];
  if (at < JOIN || picked.slice(at - JOIN, at).some((f) => f[0] !== still)) continue;
  const tmp = join(ROOT, 'join');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  ff(['-loop', '1', '-framerate', '30', '-t', '2', '-i', still, '-loop', '1', '-framerate', '30', '-t', '2', '-i', picked[at][0],
    '-filter_complex', `[0:v][1:v]xfade=transition=fade:duration=${JOIN / 30}:offset=0`, '-frames:v', String(JOIN), '-q:v', '2', join(tmp, '%02d.jpg')]);
  for (let i = 0; i < JOIN; i++) {
    // These are links to the recorded frames: replace them, never write through them.
    rmSync(seqFile(at - JOIN + i));
    copyFileSync(join(tmp, `${String(i + 1).padStart(2, '0')}.jpg`), seqFile(at - JOIN + i));
  }
  console.log(`dissolve into ${PARTS[p]} @ ${(at / 30).toFixed(2)}`);
}
const picture = join(ROOT, 'picture-1080p.mp4');
ff(['-framerate', '30', '-i', join(SEQ, '%06d.jpg'), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', '-an', picture]);

// The soundtrack: every line at its cue, the music under it.
function soundtrack(out, withMusic) {
  const lines = cues.filter((c) => existsSync(join(ROOT, 'voice', `${c.id}.mp3`)));
  const args = [];
  for (const c of lines) args.push('-i', join(ROOT, 'voice', `${c.id}.mp3`));
  const music = withMusic && existsSync(join(ROOT, 'music.mp3'));
  if (music) args.push('-stream_loop', '-1', '-i', join(ROOT, 'music.mp3'));
  const parts = lines.map((c, i) => {
    const ms = Math.max(0, Math.round(c.at * 1000));
    return `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`;
  });
  parts.push(lines.length
    ? `${lines.map((_, i) => `[v${i}]`).join('')}amix=inputs=${lines.length}:normalize=0,apad,atrim=0:${end.toFixed(3)}[voice]`
    : `anullsrc=r=48000:cl=stereo,atrim=0:${end.toFixed(3)}[voice]`);
  if (music) {
    const m = lines.length;
    parts.push(`[voice]asplit=2[say][key]`);
    parts.push(`[${m}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:${end.toFixed(3)},asetpts=N/SR/TB,volume=0.22,afade=t=in:d=1.5,afade=t=out:st=${(end - 3).toFixed(3)}:d=3[bed]`);
    parts.push(`[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=30:release=600[ducked]`);
    parts.push(`[say][ducked]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[mix]`);
  } else {
    parts.push(`[voice]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[mix]`);
  }
  ff([...args, '-filter_complex', parts.join(';'), '-map', '[mix]', '-t', end.toFixed(3), '-c:a', 'aac', '-b:a', '192k', out]);
}
const withMusic = process.env.MUSIC !== '0';
const mix = join(ROOT, 'soundtrack.m4a');
const voiceOnly = join(ROOT, 'soundtrack-voice.m4a');
soundtrack(mix, withMusic);
soundtrack(voiceOnly, false);

ff(['-i', picture, '-i', mix, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', join(ROOT, 'lectern-tour-1080p.mp4')]);
ff(['-i', picture, '-i', voiceOnly, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', join(ROOT, 'lectern-tour-1080p-voice-only.mp4')]);
ff(['-i', picture, '-i', mix, '-map', '0:v', '-map', '1:a', '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF ?? '27', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '60', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', join(ROOT, 'lectern-tour.mp4')]);
ff(['-ss', process.env.POSTER_AT ?? '24', '-i', picture, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '4', join(ROOT, 'lectern-tour.jpg')]);

console.log(`length ${end.toFixed(1)} s`);
console.log(marks.map((m) => `${m.label} @ ${m.at}`).join('\n'));
console.log(skips.map((x) => `cut ${x.secs} s of ${x.what} @ ${x.t}`).join('\n'));
