// Speaks narration.mjs with ElevenLabs text-to-speech: one MP3 per line in REC_ROOT/voice, plus lines.json with
// each line's length, which record.mjs uses to hold a shot until its line is said. A line is only sent again when
// its text or the voice changes, so re-running costs nothing.
// The key comes from ELEVENLABS_API_KEY, or from the dotenv file named by ELEVENLABS_ENV. It is never printed.
// Usage, from lectern/: ELEVENLABS_ENV=path/to/.env node scripts/tour/voice.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LINES, VOICE } from './narration.mjs';

const ROOT = process.env.REC_ROOT ?? join(tmpdir(), 'lectern-tour');
const OUT = join(ROOT, 'voice');
mkdirSync(OUT, { recursive: true });

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const file = process.env.ELEVENLABS_ENV;
  const found = file && readFileSync(file, 'utf8').match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*["']?([^"'\r\n]+)/m);
  if (!found) throw new Error('Set ELEVENLABS_API_KEY, or ELEVENLABS_ENV to a dotenv file that has it.');
  return found[1].trim();
}

const seconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

const listPath = join(OUT, 'lines.json');
const before = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : {};
const after = {};
let key;
let spent = 0;
for (const [i, line] of LINES.entries()) {
  const hash = createHash('sha1').update(JSON.stringify([line.text, VOICE])).digest('hex').slice(0, 12);
  const file = join(OUT, `${line.id}.mp3`);
  if (before[line.id]?.hash !== hash || !existsSync(file)) {
    key ??= apiKey();
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE.voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
      body: JSON.stringify({
        text: line.text,
        model_id: VOICE.model,
        voice_settings: VOICE.settings,
        // The lines either side, so each one is said as part of the same read.
        previous_text: LINES[i - 1]?.text,
        next_text: LINES[i + 1]?.text,
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs said ${res.status} for "${line.id}": ${(await res.text()).slice(0, 300)}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    spent += line.text.length;
    console.log(`spoke ${line.id}`);
  }
  after[line.id] = { text: line.text, hash, seconds: +seconds(file).toFixed(3) };
}
writeFileSync(listPath, JSON.stringify(after, null, 1));
const total = Object.values(after).reduce((a, l) => a + l.seconds, 0);
console.log(`${LINES.length} lines, ${total.toFixed(1)} s of speech; ${spent} characters sent this run`);
for (const [id, l] of Object.entries(after)) console.log(`${id.padEnd(10)} ${l.seconds.toFixed(2)} s`);
