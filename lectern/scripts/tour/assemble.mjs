// Turns record.mjs's frames into the videos, keeping the recording's timing: a 1080p master for
// uploading, and the 720p cut and poster that go in public/media. Needs ffmpeg on the PATH.
import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.env.REC_ROOT ?? join(tmpdir(), 'lectern-tour');
const { frames, marks, end } = JSON.parse(readFileSync(join(ROOT, 'frames.json'), 'utf8'));
const t0 = frames[0][1];
// An exact 30 fps sequence: each output frame is the newest recorded frame at that moment.
// Hard links keep it cheap; the concat demuxer would round short frames up and stretch time.
const SEQ = join(ROOT, 'seq');
rmSync(SEQ, { recursive: true, force: true });
mkdirSync(SEQ);
const count = Math.round(end * 30);
let j = 0;
for (let k = 0; k < count; k++) {
  while (j + 1 < frames.length && frames[j + 1][1] - t0 <= k / 30) j++;
  linkSync(join(ROOT, 'frames', frames[j][0]), join(SEQ, `${String(k).padStart(6, '0')}.jpg`));
}

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });

ff(['-framerate', '30', '-i', join(SEQ, '%06d.jpg'), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', '-an', join(ROOT, 'lectern-tour-1080p.mp4')]);
ff(['-i', join(ROOT, 'lectern-tour-1080p.mp4'), '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF ?? '27', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '60', '-movflags', '+faststart', '-an', join(ROOT, 'lectern-tour.mp4')]);
ff(['-ss', process.env.POSTER_AT ?? '24', '-i', join(ROOT, 'lectern-tour-1080p.mp4'), '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '4', join(ROOT, 'lectern-tour.jpg')]);

console.log(`length ${end.toFixed(1)} s`);
console.log(marks.map((m) => `${m.label} @ ${m.at}`).join('\n'));
