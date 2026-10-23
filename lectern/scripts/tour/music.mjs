// A quiet music bed for the tour, saved as REC_ROOT/music.mp3; assemble.mjs loops it under the voice when the file
// is there. ElevenLabs Music needs a paid plan, so this asks the sound-effects model for a short seamless loop.
// Same key as voice.mjs.
// Usage, from lectern/: ELEVENLABS_ENV=path/to/.env node scripts/tour/music.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.env.REC_ROOT ?? join(tmpdir(), 'lectern-tour');
mkdirSync(ROOT, { recursive: true });
const env = process.env.ELEVENLABS_API_KEY ? '' : readFileSync(process.env.ELEVENLABS_ENV ?? '', 'utf8');
const key = (process.env.ELEVENLABS_API_KEY ?? env.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*["']?([^"'\r\n]+)/m)?.[1] ?? '').trim();

const text = 'Calm optimistic instrumental background music loop for a software demo: soft electric piano chords, '
  + 'light plucked synth arpeggio, warm pad, gentle brushed beat, 100 BPM, steady, no vocals.';
const res = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
  method: 'POST',
  headers: { 'xi-api-key': key, 'content-type': 'application/json' },
  body: JSON.stringify({ text, duration_seconds: 22, prompt_influence: 0.6, loop: true }),
});
if (res.ok) {
  writeFileSync(join(ROOT, 'music.mp3'), Buffer.from(await res.arrayBuffer()));
  console.log('music.mp3, a 22 s loop');
} else {
  console.log(`ElevenLabs said ${res.status}: ${(await res.text()).slice(0, 400)}`);
  process.exitCode = 1;
}
