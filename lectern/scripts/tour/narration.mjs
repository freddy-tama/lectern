// The tour's voice-over, one line per shot. record.mjs starts each line at its shot and holds the shot until the
// line has been said; assemble.mjs lays the spoken lines under the video at those times. Everything said here
// must be true of the live app: the captions on screen carry the details.
export const VOICE = {
  // ElevenLabs "Matilda": knowledgeable, professional.
  voiceId: process.env.VOICE ?? 'XrExE9yKIg1WjnnlVkGX',
  model: 'eleven_multilingual_v2',
  settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true, speed: 1.05 },
};

export const LINES = [
  { id: 'title', text: 'This is Lectern: slides that know what to say.' },
  { id: 'keynotes', text: 'Every slide carries its own script, takeaways, a question for the room, cues and minutes.' },
  { id: 'present', text: 'Present, and the room sees only the slide. A click reveals the takeaway.' },
  { id: 'presenter', text: 'Your laptop shows the script, the cues, the next slide and the clock.' },
  { id: 'prompter', text: 'The teleprompter scrolls your script at speaking pace.' },
  { id: 'quiz', text: 'Phones join a quiz from a QR code. The questions travel inside the link, so there’s nothing to install.' },
  { id: 'ai', text: 'Now a harder job, live on the site, with Claude Opus.' },
  { id: 'files', text: 'Drop in a spreadsheet with three sheets of figures, and a Word brief.' },
  { id: 'brief', text: 'Then the hard part: make the case for twelve new stations, and be honest about the weak numbers.' },
  { id: 'questions', text: 'Lectern reads both files and asks a few questions first.' },
  { id: 'outline', text: 'Claude plans an outline, and you check it before anything is written.' },
  { id: 'draft', text: 'Then it writes every slide and its speaker notes. The badge shows the wait we cut.' },
  { id: 'assistant', text: 'In the editor, ask the assistant for changes in plain words.' },
  { id: 'accept', text: 'Nothing changes until you accept.' },
  { id: 'devices', text: 'Then present it anywhere: on the room’s screen, your laptop, and the audience’s phones.' },
  { id: 'end', text: 'Lectern. Free to try, with no sign-up.' },
];
