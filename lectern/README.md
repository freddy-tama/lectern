# Lectern

Make presentations for anything (talks, pitches, reports and lessons) and run your classes week by week. Lectern turns notes into well-designed slides and gives every slide **key notes**: what you'll say, what the audience should take away, and the question you expect. The same notes feed the presenter view, the teleprompter, review mode, the printed handout and the PowerPoint speaker notes.

It runs in the browser and saves to the browser (IndexedDB). You don't need an account, and decks aren't stored on a server. Recorded lectures are transcribed in the browser too. The only server features are optional: picture search, AI drafting, AI pictures and AI class notes, and accounts that meter AI use.

**Live:** https://lectern-sooty.vercel.app · **Tests:** every pull request is tested end to end by [TestSprite](#testing).

## What you can do

| Area | What it does |
|---|---|
| **Home** | Shows the next lesson, what's on today and this week (lessons and dated notes), open to-dos from your notes, recent decks and how far each course has got. |
| **Courses** | Weeks of lessons with dates, times and planned minutes. Each lesson links to its deck. Set a weekly timetable and Lectern fills in lesson dates. |
| **Schedule** | Week, month and agenda views of lessons and dated notes. Drag to reschedule, click an empty slot to add a lesson or note, and export everything to your calendar app (.ics). |
| **Notes** | Plans, reflections after class ("How did it go?"), reminders and ideas, with checklists, tags and pins. Link a note to a course, lesson, deck or a single slide; it then shows up there, in the presenter view and on the schedule. Press N anywhere to jot one down. |
| **Recordings** | Record a class with the microphone, or drop in a recording (mp3, m4a, wav, webm, ogg, or a video). It's transcribed on your device, so the audio never leaves the browser. The transcript follows the audio as it plays: click any line to jump there, search it, edit it, and export it as text or subtitles (SRT, VTT). Link a recording to its lesson, save the transcript or a passage as a note, and, with AI set up, turn it into class notes (summary, key points, a to-do list, quiz questions) and a quiz deck. |
| **Studio** | 30 slide types laid out for you on a 16:9 canvas. **Open:** title, section, agenda. **Explain:** points, compare, quote, key term, steps, timeline, statement, code, cards. **Data:** big numbers, charts (column, bar, line, pie, doughnut), tables. **Pictures and diagrams:** image, gallery, people, diagram (cycle, funnel, 2×2). **Media:** video, web page. **Engage:** question or poll, quick recall, QR code, activity, timer, random picker. **Close:** takeaways, closing, credits. Click any text on the slide to type straight onto it: Enter adds the next point, Backspace in an empty one removes it, Tab moves to the next text. Drop or paste a picture, a video, a video link or SVG code onto the slide to place it. The side panel shows the main fields first, with switches and rarely used settings folded under **More options**; the key notes and the whole panel fold away for a larger slide. Undo, redo and autosave work everywhere. |
| **Pictures** | **Find a picture** on any image field searches Openverse and Wikimedia Commons (and Pexels, with a key) for pictures you may reuse, starting from the slide's heading. Results are ranked by size, shape and licence, and logos and icons are left out. You can also paste a link, upload, or make one with AI when the server has an image model. Every picture is kept in the browser with its source, author and licence. **Export ▸ Picture credits** lists them all, copies them, and adds or updates a credits slide; credits also go in the PowerPoint speaker notes and the handout. ★ a picture to have it offered first for similar searches, and a search result you hide or remove isn't suggested again for that search. |
| **Purpose** | Each deck is a Lesson, Talk, Pitch or Report. The purpose sets the wording of the key notes and review mode, the presenter's cue ideas and how AI drafts the deck. Classroom wording only appears on lessons. |
| **Video and the web** | A YouTube or Vimeo link, a video file or a stored upload plays on the slide, from a start time you choose, with autoplay, mute and loop. A web page slide shows a live site: Google Slides, Docs, Sheets and Forms, Figma, GeoGebra, CodePen, Loom, Canva and Miro links are converted to their embed address, and an Open button and an optional QR code cover sites that refuse to be framed. |
| **Activities** | Describe a game, quiz, sorting task, flashcards or simulation and AI writes it as a small web page that runs on the slide, in the deck's colours and fonts. Build it again, ask for a change ("make the timer longer"), or paste your own HTML. Timer and Random picker slides are ready-made activities that need no AI. A QR code slide turns any link or short text into a big code to scan. **Draw** on any image field asks AI for an SVG drawing (a diagram, an icon, a labelled sketch), or takes SVG you paste. |
| **Looks** | **Auto style** picks the look from what the deck is for and who it's for, takes its accent from the main colour of your pictures, and chooses each slide's layout from its content and its neighbours: a picture with no text goes full screen, picture slides alternate sides, four cards make a grid, shares of a whole become a doughnut chart. Picking a layout by hand pins it. Or choose from six built-in looks, plus your own: colours, heading and body fonts, corner style, a logo and footer text, with a live preview. Three audience sizes (young learners, teens, adults) set type size and how many words a slide can hold. |
| **Key notes** | On every slide: a script, takeaways, a likely question with its answer, cues ("Pause", "Show the number") and the minutes the slide should take. |
| **Present** | An audience view with click-to-reveal steps, plus a presenter view (timer, pace, next slide, notes) and a teleprompter (auto-scroll at your speaking pace, mirroring). Every window stays in sync. |
| **Share to phones** | Two QR codes. **Your phone** becomes a teleprompter and remote: script, next slide, timer and big buttons that move the slides on the computer. **Everyone else** follows the slides live, answers question slides as a poll (results show on your screen and phone), and can keep the deck or save it as PowerPoint. Your script never leaves your devices. Phones keep the deck, so it still opens with no connection. |
| **Live quiz** | Question slides with a right answer become a scored quiz: each question opens when its slide shows, with an optional timer, and the next click reveals the answer. Faster right answers score more. Phones show the result and their place; the big screen shows a countdown, how many have answered, the leaderboard and a final podium. Save the results as a note or a spreadsheet (.csv). **Present ▸ Make a quiz** builds questions from your key notes and key-term slides. |
| **Hand out a copy** | For rooms where live sharing won't connect. A QR code carries the quiz, or a text-only copy of the slides, inside the link itself, and each phone runs it alone and marks its own answers. Phones can save it as a file for later. **Export ▸ Web page** makes the whole deck one view-only .html file (your reveals, no notes) that opens offline in any browser. |
| **Study / Review** | Read each slide with its takeaways and explanation, answer the question, flip flashcards, or read a one-page summary. Progress is saved. |
| **Start a deck** | From an outline (pasted, or a Markdown, Word or PowerPoint file), with AI, blank, or from a mod's starter. |
| **Export** | PowerPoint with on-click animations or one slide per step (for Google Slides and Keynote). Charts and tables export as real PowerPoint charts and tables you can edit. YouTube videos go in as online videos that play in PowerPoint, and stored videos as video files. Web pages and activities become a card with a link and a QR code; timers show their time. Also a view-only web page (one .html file that works offline), a key-notes handout to print or save as PDF, and a deck file you can open again. |

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

You need Node 22.12 or newer. The first visit loads three sample courses and six sample decks. You can restore them later from the **Mods** page.

### First visit and sample links

A first visit to `/` opens the front page at `/welcome`. Until the setup is done, its **Open Lectern** buttons go through `/start`, one screen that asks where to start (the sample talk, your notes, a file, a course, or a recording) and opens that page in one click. **Fine-tune first** on that screen holds the full set of preferences, and `/start?tune=1` opens it. Two keys in localStorage remember this:

| Key | What it holds |
|---|---|
| `lectern.welcomed` | Set once the front page has been seen, so `/` opens the app next time. |
| `lectern.profile` | The answers from `/start` and Preferences: what you came to do, the sidebar's parts, and the defaults for new decks. |

`/try/:sample/:view` opens a sample deck in one view, for links from the front page, a demo or a test. `:sample` is `talk`, `report`, `lesson` or `writing`; `:view` is `studio` (the default), `present`, `presenter`, `prompter`, `study` or `print`. If the sample was deleted it's put back first; a sample you edited is left as it is. Present mode takes `?from=` with a 0-based slide index, for example `/try/talk/present?from=3`. `/try/course` opens the sample course. Leaving present mode goes back to the page you came from, or to the deck in the studio when the show was opened straight from a link.

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
2. Vercel reads [`vercel.json`](vercel.json): a Vite build to `dist/`, single-page routing, the functions in `api/`, and cache headers. Hashed files in `assets/` are cached for good; `sw.js` and the manifest are checked on every visit, so a deploy reaches people straight away.
3. Optional environment variables:

| Variable | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on "With AI" drafting, AI class notes from recordings, AI activities and AI drawings. Without it, each explains that it isn't set up, and everything else works, transcription included. |
| `LECTERN_MODEL` | The model that drafts decks and writes class notes. Default `claude-opus-5-5`. |
| `LECTERN_ACCESS_CODE` | People must enter this code before AI drafting, AI pictures or class notes run, so a public site doesn't spend your credit for strangers. Picture search works without it. For a public site, [accounts](#accounts-and-ai-credits) are the better guard. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | Turn on [accounts](#accounts-and-ai-credits): AI then needs a signed-in person with credits left. The legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` work too. The secret key stays on the server. |
| `LECTERN_DAILY_CREDITS` | With accounts on, the most credits everyone together may spend in a UTC day. Default `4000` ($20); `0` turns the cap off. |
| `OPENAI_API_KEY` | Turns on **Make with AI** in the picture finder, with OpenAI's `gpt-image-2.5-sunburst`. Claude doesn't make pictures, so this is a second provider. Without an image key the tab is hidden. |
| `GEMINI_API_KEY` | The same with Google's Gemini image model (`gemini-3.1-flash-image`), used when there's no OpenAI key. |
| `LECTERN_IMAGE_PROVIDER` | `openai`, `gemini` or `off`. Picks one when both keys are set, or turns AI pictures off. |
| `LECTERN_IMAGE_MODEL` | The image model for that provider, for example `gpt-image-1` or `gemini-3-pro-image`. |
| `PEXELS_API_KEY` | Adds [Pexels](https://www.pexels.com/api/) photos to picture search. Openverse and Wikimedia Commons need no key. |
| `OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET` | Optional [Openverse API credentials](https://api.openverse.org/v1/). Anonymous use has low rate limits shared by everyone using your server; search results are cached for an hour to help. |
| `LECTERN_PLUGINS` | Build with mods, for example `chinese,lesson-plan`. Leave it empty for the general edition. |
| `VITE_PEER_HOST`, `VITE_PEER_PORT`, `VITE_PEER_PATH`, `VITE_PEER_KEY` | Your own [PeerJS server](https://github.com/peers/peerjs-server) for Share to phones. By default PeerJS's free public server introduces devices; slides, state and votes then go straight between them. |
| `VITE_ICE_SERVERS` | JSON list of your own STUN/TURN servers, for networks that block direct connections. |
| `VITE_PUBLIC_ORIGIN` | The public address of the site, such as `https://lectern.example.com`. The front page builds its quiz QR code from it, so a code shown on `localhost` or a preview deployment still opens on a phone. Without it, the code uses the address the page was opened at. |
| `VITE_TESTSPRITE_URL` | A link to the site's TestSprite test results. When it's set, the front page's footer links to it; otherwise the line is left out. |

For local AI drafting, put the same variables in `.env.local`. The dev server serves `api/` itself.

### Accounts and AI credits

Without Supabase settings, Lectern has no accounts and AI works for anyone (behind `LECTERN_ACCESS_CODE`, if set). With them, browsing, presenting, notes and the quiz still need no account, but every AI feature asks people to sign in, with GitHub or an emailed link. Each account starts with 4,000 credits, worth $20 of AI use (one credit is half a US cent). Each request takes what it really cost: the tokens each model used, at its list price ([`src/core/ai/prices.ts`](src/core/ai/prices.ts)). When the credits run out, AI stops for that person and everything else keeps working. Signed-in people's study progress is saved to their account too.

1. Create a [Supabase](https://supabase.com) project. In its SQL editor, run [`supabase/schema.sql`](supabase/schema.sql). It's safe to run again after an update.
2. Under **Authentication ▸ URL Configuration**, set the Site URL to your site, and add `https://<your-site>/signin` to the redirect URLs. For Vercel previews, also add a pattern such as `https://<project>-git-*-<team>.vercel.app/**`, and for local work `http://localhost:5173/**`.
3. Email sign-in is on by default. Supabase's built-in email only reaches your project's team members, a few times an hour, so for the public set up your own SMTP under **Authentication ▸ Emails**.
4. For GitHub sign-in, create a GitHub OAuth app whose callback URL is `https://<project-ref>.supabase.co/auth/v1/callback`. Paste its client ID and secret into **Authentication ▸ Sign In / Providers ▸ GitHub**. The sign-in page shows the GitHub button only when this provider is on.
5. Copy the project URL and the publishable and secret keys (**Project Settings ▸ API Keys**) into the environment variables above, then redeploy.

[`api/_lib/account.ts`](api/_lib/account.ts) checks the sign-in and the balance before any AI call and charges afterwards. Only the server, with the secret key, can open accounts or spend credits. The database functions are closed to signed-in people, and they can read only their own balance and study marks.

### Where your data lives

Vercel stores nothing, and with [accounts](#accounts-and-ai-credits) on, Supabase keeps only each person's credits and study progress. Decks, pictures and recordings live in the visitor's browser (IndexedDB) and preferences in localStorage, so data belongs to one browser at one address: a preview deployment's URL starts empty. Two things can clear it:

- **Safari** deletes a site's data after 7 days of Safari use without a visit. Apps added to the Dock or the Home Screen are exempt, but they have their own storage, separate from Safari's, so data moves across with a backup.
- **Other browsers** can clear data that isn't persistent when the disk runs low. Lectern asks for persistent storage after the first save; Chrome and Edge give it to installed apps.

So Lectern can be installed, and **Preferences ▸ Your data** shows whether the data is protected, with an Install button where the browser has one and the Share ▸ Add to Dock / Home Screen steps on Safari. When you have decks of your own (edited samples count, untouched ones don't) and no backup from the last 14 days, a quiet reminder offers **Download a backup**, at most once a week. On Safari it also suggests installing.

The service worker ([`src/pwa/sw.js`](src/pwa/sw.js)) keeps the app shell, so Lectern opens offline after one visit. The build writes `dist/sw.js` with the list of files to keep and a version made from their contents. It never handles `/api/*`, other sites or anything but GET. After a deploy the new version installs in the background and Lectern offers **Reload**, but not while you're presenting. The dev server's `sw.js` removes any worker a production preview left on the same address. The app icons are drawn from the logo by `npm run icons`.

### How AI drafting works

[`api/draft-deck.ts`](api/draft-deck.ts) sends the topic, the audience and any material you paste to Claude. It asks for a structured-output JSON schema built from the slide types installed in that build, mods included. The reply is streamed, so long decks don't time out. Server-side refusal fallback (`fallbacks: "default"`) is on: if the model declines a request, the API retries it on Anthropic's recommended fallback model. The returned deck goes through the same path as an outline, so key notes are filled in and timed the same way.

Before you see an AI deck, the browser checks it against Lectern's own layout rules with the real fonts ([`src/core/deck/check.ts`](src/core/deck/check.ts)). Up to eight slides that don't fit go back to Claude, three at a time, through the `fit` mode of [`api/revise-slide.ts`](api/revise-slide.ts). That request carries the layout's exact warnings and the audience's word budget, and asks Claude to change only what's needed. Code then re-checks each answer and keeps it only if the slide now fits. Otherwise the slide is split into slides of the same type. Minutes are rescaled to the session length in code. One line says what changed, with Undo. AI suggestions for a single slide get the same check, with one automatic fit before they're shown. The word budgets come from `DENSITY` in [`src/core/kinds/kit.ts`](src/core/kinds/kit.ts) and are sent with each request, so the prompts never keep their own copy.

### How activities run

[`api/make-code.ts`](api/make-code.ts) asks Claude for one self-contained HTML page (or, for drawings, one SVG), with the deck's colours, fonts and audience in the request. The page is stored on the slide and runs in a sandboxed frame with no access to the app, its storage or the network: the frame's sandbox allows only scripts and pointer lock, and a Content-Security-Policy added at the top of the page blocks every request, so an activity can't load anything or send anything anywhere. Pasted HTML runs under the same rules. SVG drawings are cleaned before they're stored: scripts, event handlers, embedded HTML and outside references are removed.

### How pictures are found and kept

[`api/picture-search.ts`](api/picture-search.ts) asks each library separately, so fast answers show while slow ones are still coming, and the browser ranks the results. [`api/picture-fetch.ts`](api/picture-fetch.ts) downloads the picture you pick, or a link you paste, so nothing is hotlinked and other sites' CORS rules don't matter. It accepts only http and https on ports 80 and 443, refuses local and private addresses, and checks every address again when it connects, so a name that changes its answer can't reach a private network. Redirects are checked the same way. Files over 12 MB are refused, and the type comes from the file's first bytes (JPEG, PNG, WebP or GIF), never from its name. The browser then scales very large photos to 2400 px and stores the picture as an asset with its credit. [`api/picture-generate.ts`](api/picture-generate.ts) sends your description, with a style taken from the deck's look and audience, to the image provider.

### How transcription works

Transcription needs no server and no key. A Web Worker runs Whisper with [transformers.js](https://github.com/huggingface/transformers.js) on the device: on the graphics chip through WebGPU when the browser has it, otherwise on the processor through WebAssembly. Pick **Faster** (`whisper-tiny`), **Balanced** (`whisper-base`, the default) or **More accurate** (`whisper-small`); the model downloads from Hugging Face once and is cached. Pick the spoken language or let it be detected.

The browser decodes the audio straight to 16 kHz mono. Long recordings are cut into sections of about four minutes at quiet moments, and each section is read in 30-second windows that overlap by 5 seconds. Each section saves as soon as it's done, so the transcript appears as it goes, a stopped transcription carries on where it left off, and you can move around the app while it runs. Videos keep only their sound.

[`api/lecture-notes.ts`](api/lecture-notes.ts) is the optional AI step: it sends the transcript text (never the audio) to Claude and gets back a title, summary, key points, action items and multiple-choice questions as structured JSON. Transcripts over about five hours are refused rather than cut.

| Key on a recording | Action |
|---|---|
| Space | Play or pause |
| ← / → | Back or forward 10 seconds |
| Enter in search | Next match (Shift+Enter for the previous one) |

## Testing

### End to end, on every pull request (TestSprite)

The [TestSprite](https://www.testsprite.com) GitHub App tests every pull request against the real app, in TestSprite's cloud browsers:

1. A push to a pull request makes Vercel build a preview at `https://lectern-git-<branch>-freddy-tamas-projects.vercel.app`.
2. When the preview is ready, TestSprite runs the whole suite against it.
3. The result shows on the pull request as the `TestSprite V3` check, for example "All 27 tests passed" on [#9](https://github.com/freddy-tama/lectern/pull/9).

The suite was built in the TestSprite 3.0 portal from [`docs/testsprite-prd.md`](docs/testsprite-prd.md). That file lists Lectern's flows with the exact text, URLs and `data-testid`s that count as a pass. It has 27 tests in 11 areas:

| Area | Tests | What they check |
|---|---|---|
| Welcome and discovery | 6 | A fresh visit lands on the intro page; the start page; the sample talk by keyboard; the notes, file and recording paths from getting started. |
| Presentation playback | 7 | Advancing and revealing in the sample talk; presenter and audience views; the sample report and lesson; a shared `/try` link and leaving the show; Home after starting from the sample talk. |
| Key notes views | 3 | The key-notes tabs, and opening the presenter view and the teleprompter from them. |
| Phone quiz | 1 | The three-question quiz carried in the link, answered to a score. |
| Notes to deck | 2 | A deck built from notes for a talk audience; the AI tab's setup notice. |
| New deck creation | 1 | `/make` with no AI doesn't make an empty deck from a topic alone. |
| Deck library | 2 | Listing and searching the six sample decks. |
| Studio editor | 2 | Editing a slide title, which is kept after a reload; adding a slide. |
| Course workspace | 1 | Opening a lesson's deck from the course schedule. |
| Review mode | 1 | Reading a deck through in review mode. |
| Theme | 1 | Cycling through system, light and dark. |

The suite leaves out what needs a second device, a microphone, a large model download, a paid AI key or a real sign-in. Every run, failure and fix is recorded in [`docs/testsprite-log.md`](docs/testsprite-log.md). For example, #8 fixed a bug the suite found on production, its run caught a badly written test, and the rewritten test passed on #9.

### Unit and integration tests (vitest)

`npm test` runs 619 tests in 45 files, in Node and jsdom. They need no keys and no network: the Claude API, Supabase and the picture services are stood in for. They cover, among other things:

- outlines, drafting and the slide types;
- layout, fitting and PowerPoint export;
- import from Word, PowerPoint and Markdown;
- the service worker, sharing and the quiz;
- each AI endpoint's request and its refusals;
- AI credits;
- [`supabase/schema.sql`](supabase/schema.sql), run in a real Postgres (PGlite) to check its row-level security.

## How it's built

```text
src/
  core/            no React; shared by the app, exports and mods
    deck/          deck and key-notes types, outline parser, drafting, word counts
    transcribe/    transcript segments, search, SRT/VTT/text export, audio sectioning
    engine/        box layout on a 1920×1080 canvas, text measuring, themes
    media/         video links, page embeds, QR codes, SVG cleaning, built-in activities
    kinds/         the slide-type contract, layout kit and the core types
    pictures/      picture credits, licences and search ranking
    export/        PowerPoint export (pptxgenjs)
    import/        Word / PowerPoint / Markdown → outline
    plugins/       the mod contract and registry
  data/            IndexedDB (Dexie): courses, lessons, decks, notes, recordings, assets, study progress
  features/        home, courses, studio, present, study, notes, schedule, share, recordings
  ui/              dialogs, menus, toasts, formatting
api/               Vercel functions for AI drafting, class notes, picture search, download, AI pictures and accounts
  _lib/            not a route: sign-in checks and AI credits, shared by the functions
plugins/           mods, each a folder with an index.ts
supabase/          the database for accounts: credits and study progress (schema.sql)
tests/             vitest: core, features, API functions, the database schema, mods
```

A slide is a list of positioned boxes (text, shapes, images, charts, tables, videos and embedded pages). The same layout draws the slide in the browser and writes it to PowerPoint, so what you see is what you export. Text is measured and fitted to its box, and the studio warns when a slide holds more than its audience should read.

## Next

- Linking a lecture's transcript to the slides it covers.
- Sharing a deck's study mode with learners.
