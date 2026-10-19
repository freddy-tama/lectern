# Lectern

Make presentations for anything (talks, pitches, reports and lessons) and run your classes week by week. Lectern turns notes into well-designed slides and gives every slide **key notes**: what you'll say, what the audience should take away, and the question you expect. The same notes feed the presenter view, the teleprompter, review mode, the printed handout and the PowerPoint speaker notes.

It runs in the browser and saves to the browser (IndexedDB). There's no account and no server-side storage. Recorded lectures are transcribed in the browser too. The only server features are optional: AI drafting and AI class notes.

## What you can do

| Area | What it does |
|---|---|
| **Home** | Shows the next lesson, what's on today and this week (lessons and dated notes), open to-dos from your notes, recent decks and how far each course has got. |
| **Courses** | Weeks of lessons with dates, times and planned minutes. Each lesson links to its deck. Set a weekly timetable and Lectern fills in lesson dates. |
| **Schedule** | Week, month and agenda views of lessons and dated notes. Drag to reschedule, click an empty slot to add a lesson or note, and export everything to your calendar app (.ics). |
| **Notes** | Plans, reflections after class ("How did it go?"), reminders and ideas, with checklists, tags and pins. Link a note to a course, lesson, deck or a single slide; it then shows up there, in the presenter view and on the schedule. Press N anywhere to jot one down. |
| **Recordings** | Record a class with the microphone, or drop in a recording (mp3, m4a, wav, webm, ogg, or a video). It's transcribed on your device, so the audio never leaves the browser. The transcript follows the audio as it plays: click any line to jump there, search it, edit it, and export it as text or subtitles (SRT, VTT). Link a recording to its lesson, save the transcript or a passage as a note, and, with AI set up, turn it into class notes (summary, key points, a to-do list, quiz questions) and a quiz deck. |
| **Studio** | 22 slide types laid out for you on a 16:9 canvas. **Open:** title, section, agenda. **Explain:** points, compare, quote, key term, steps, timeline, statement, code. **Data:** big numbers, charts (column, bar, line, pie, doughnut), tables. **Pictures and diagrams:** image, gallery, people, diagram (cycle, funnel, 2×2). **Engage:** question or poll, quick recall. **Close:** takeaways, closing. Click any text on the slide to edit it. Undo, redo and autosave work everywhere. |
| **Purpose** | Each deck is a Lesson, Talk, Pitch or Report. The purpose sets the wording of the key notes and review mode, the presenter's cue ideas and how AI drafts the deck. Classroom wording only appears on lessons. |
| **Looks** | Six built-in looks, plus your own: colours, heading and body fonts, corner style, a logo and footer text, with a live preview. Three audience sizes (young learners, teens, adults) set type size and how many words a slide can hold. |
| **Key notes** | On every slide: a script, takeaways, a likely question with its answer, cues ("Pause", "Show the number") and the minutes the slide should take. |
| **Present** | An audience view with click-to-reveal steps, plus a presenter view (timer, pace, next slide, notes) and a teleprompter (auto-scroll at your speaking pace, mirroring). Every window stays in sync. |
| **Share to phones** | Two QR codes. **Your phone** becomes a teleprompter and remote: script, next slide, timer and big buttons that move the slides on the computer. **Everyone else** follows the slides live, answers question slides as a poll (results show on your screen and phone), and can keep the deck or save it as PowerPoint. Your script never leaves your devices. Phones keep the deck, so it still opens with no connection. |
| **Live quiz** | Question slides with a right answer become a scored quiz: each question opens when its slide shows, with an optional timer, and the next click reveals the answer. Faster right answers score more. Phones show the result and their place; the big screen shows a countdown, how many have answered, the leaderboard and a final podium. Save the results as a note or a spreadsheet (.csv). **Present ▸ Make a quiz** builds questions from your key notes and key-term slides. |
| **Hand out a copy** | For rooms where live sharing won't connect. A QR code carries the quiz, or a text-only copy of the slides, inside the link itself, and each phone runs it alone and marks its own answers. Phones can save it as a file for later. **Export ▸ Web page** makes the whole deck one view-only .html file (your reveals, no notes) that opens offline in any browser. |
| **Study / Review** | Read each slide with its takeaways and explanation, answer the question, flip flashcards, or read a one-page summary. Progress is saved. |
| **Start a deck** | From an outline (pasted, or a Markdown, Word or PowerPoint file), with AI, blank, or from a mod's starter. |
| **Export** | PowerPoint with on-click animations or one slide per step (for Google Slides and Keynote). Charts and tables export as real PowerPoint charts and tables you can edit. Also a view-only web page (one .html file that works offline), a key-notes handout to print or save as PDF, and a deck file you can open again. |

### Presenting keys

| Key | Action |
|---|---|
| → or Space | Next step or slide |
| ← | Back |
| Home / End | First or last slide |
| a number, then Enter | Go to that slide |
| B | Blank the screen |
| N | Show the key notes |
| F | Full screen |
| Esc | Leave |

Mods can add keys. The Chinese mod uses P to show or hide pinyin.

## Quick start

```bash
npm install
npm run dev        # http://127.0.0.1:5180
npm test
npm run build      # type-checks, then builds to dist/
```

You need Node 22.12 or newer. The first visit loads three sample courses and four sample decks. You can restore them later from the **Mods** page.

## Writing an outline

"From notes" turns plain text into slides without AI. Short lines go on the slide and longer prose goes into the key notes.

```text
# Why the Moon Has Phases          → title slide (the next line is the subtitle)
Week 2 · Space science

## Today                            → a new slide; the heading picks its type
- What we see from Earth            → points
- Why the shape changes

## Key terms                        → "Term: meaning" lines under this heading become key-term slides
Orbit: the path the Moon takes around Earth

## How the cycle goes
1. New moon: the lit side faces away  → an ordered "Label: detail" list becomes steps
2. Full moon: the lit side faces us

## Quick check
Q: Why does the Moon look different each night?   → a question with choices
A) It changes shape  B) We see a different part of its lit half *
Answer: We see different amounts of the lit half.
Notes: Give them thirty seconds to vote first.     → goes to the key-notes script

| Phase    | Visible     |                          → a Markdown table becomes a table slide
|----------|-------------|
| New      | none        |
| Full     | all of it   |

> The Moon is a friend for the lonesome to talk to.  → quote
— Carl Sandburg
![Moon phases](https://example.com/phases.png)        → image
---                                                   → slide break
```

Headings named Agenda, Summary, Takeaways or Exit ticket get matching slide types.

## Mods

A mod adds things to Lectern for one subject or school: slide types, looks, ways to start a deck, exports, presenter keys, and extra fields in the key notes or on the deck. Mods are picked **when the app is built**, so the public build contains no mod code.

```bash
npm run dev:mods                                  # both included mods
LECTERN_PLUGINS=chinese npm run dev               # just one (macOS/Linux shells)
npx cross-env LECTERN_PLUGINS=chinese npm run dev # any shell
```

Two mods ship in [`plugins/`](plugins):

- **`chinese`**: Characters (a 生字 grid), Word card and Sentences slides with pinyin; a Word list starter that turns `学 xue2 to study` lines into a deck; tone numbers become tone marks; P hides or shows pinyin while you present, without moving anything on the slide.
- **`lesson-plan`** (教案): adds 教学环节, 教学方法, 教师活动, 学生活动, 板书 and 设计意图 to each slide's key notes, and the 说明部分 (试讲人, 教学目标, 重点, 难点…) under **Details** in the studio. **Export → 教案 (Word)** writes an A4 lesson plan in the thirteen-item course format, with 教学过程 grouped into its six stages and each step tied to its slide.

A deck made with a mod still opens without it. Its slides show a short note, and their content and key notes are kept.

See [docs/mods.md](docs/mods.md) to write your own.

## Deploy to Vercel

1. Import the repository in Vercel. If Lectern isn't at the repository root, set **Root Directory** to the `lectern` folder.
2. Vercel reads [`vercel.json`](vercel.json): a Vite build to `dist/`, single-page routing, and the AI function in `api/`.
3. Optional environment variables:

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on "With AI" drafting and AI class notes from recordings. Without it, both explain that they aren't set up, and everything else works, transcription included. |
| `LECTERN_MODEL` | The model that drafts decks and writes class notes. Default `claude-opus-5-5`. |
| `LECTERN_ACCESS_CODE` | People must enter this code before AI drafting or class notes run, so a public site doesn't spend your credit for strangers. |
| `LECTERN_PLUGINS` | Build with mods, for example `chinese,lesson-plan`. Leave it empty for the general edition. |
| `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_KEY` | Your own [PeerJS server](https://github.com/peers/peerjs-server) for Share to phones. By default PeerJS's free public server introduces devices; slides, state and votes then go straight between them. |
| `VITE_ICE_SERVERS` | JSON list of your own STUN/TURN servers, for networks that block direct connections. |

For local AI drafting, put the same variables in `.env.local`. The dev server serves `api/` itself.

### How AI drafting works

[`api/draft-deck.ts`](api/draft-deck.ts) sends the topic, the audience and any material you paste to Claude. It asks for a structured-output JSON schema built from the slide types installed in that build, mods included. The reply is streamed, so long decks don't time out. Server-side refusal fallback (`fallbacks: "default"`) is on: if the model declines a request, the API retries it on Anthropic's recommended fallback model. The returned deck goes through the same path as an outline, so key notes are filled in and timed the same way.

### How transcription works

Transcription needs no server and no key. A Web Worker runs Whisper with [transformers.js](https://github.com/huggingface/transformers.js) on the device: on the graphics chip through WebGPU when the browser has it, otherwise on the processor through WebAssembly. Pick **Faster** (`whisper-tiny`), **Balanced** (`whisper-base`, the default) or **More accurate** (`whisper-small`); the model downloads from Hugging Face once and is cached. Pick the spoken language or let it be detected.

The browser decodes the audio straight to 16 kHz mono. Long recordings are cut into sections of about four minutes at quiet moments, and each section is read in 30-second windows that overlap by 5 seconds. Each section saves as soon as it's done, so the transcript appears as it goes, a stopped transcription carries on where it left off, and you can move around the app while it runs. Videos keep only their sound.

[`api/lecture-notes.ts`](api/lecture-notes.ts) is the optional AI step: it sends the transcript text (never the audio) to Claude and gets back a title, summary, key points, action items and multiple-choice questions as structured JSON. Transcripts over about five hours are refused rather than cut.

| Key on a recording | Action |
|---|---|
| Space | Play or pause |
| ← / → | Back or forward 10 seconds |
| Enter in search | Next match (Shift+Enter for the previous one) |

## How it's built

```text
src/
  core/            no React; shared by the app, exports and mods
    deck/          deck and key-notes types, outline parser, drafting, word counts
    transcribe/    transcript segments, search, SRT/VTT/text export, audio sectioning
    engine/        box layout on a 1920×1080 canvas, text measuring, themes
    kinds/         the slide-type contract, layout kit and the 14 core types
    export/        PowerPoint export (pptxgenjs)
    import/        Word / PowerPoint / Markdown → outline
    plugins/       the mod contract and registry
  data/            IndexedDB (Dexie): courses, lessons, decks, notes, recordings, assets, study progress
  features/        home, courses, studio, present, study, notes, schedule, share, recordings
  ui/              dialogs, menus, toasts, formatting
api/               Vercel functions for AI drafting and class notes
plugins/           mods, each a folder with an index.ts
tests/             vitest: seed data, PowerPoint export, mods
```

A slide is a list of positioned boxes (text, shapes, images). The same layout draws the slide in the browser and writes it to PowerPoint, so what you see is what you export. Text is measured and fitted to its box, and the studio warns when a slide holds more than its audience should read.

## Next

- Classroom notes you can keep, tag and schedule against lessons.
- Linking a lecture's transcript to the slides it covers.
- Sharing a deck's study mode with learners.
