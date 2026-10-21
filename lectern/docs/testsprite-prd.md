# Lectern: product requirements for end-to-end tests

Lectern is a presentation tool for talks, pitches, reports and lessons. Every slide carries **key notes**: a script, takeaways, a likely question, cues and planned minutes. The same notes feed present mode, the presenter view, the teleprompter, study mode, the printed handout and PowerPoint speaker notes. Everything is saved in the browser (IndexedDB), and a fresh browser starts with six sample decks. Accounts are optional and only needed for AI: browsing, presenting, notes and the quiz work without signing in.

- Live site: https://lectern-sooty.vercel.app (pull requests get a Vercel preview with the same behaviour)
- Tests never sign in. Every test starts in a fresh browser profile, so the sample data is always the same.
- The public site has no AI key, so AI features answer "isn't set up". That is the expected result, not a failure.

## Stable hooks

Prefer roles and accessible names. These `data-testid`s exist where names repeat: `nav-open-lectern`, `hero-present`, `finale-present`, `finale-open-lectern`, `quiz-open-here`, `notes-open-deck`, `start-sample`, `start-notes`, `start-file`, `start-course`, `start-record`, `start-look-around`, `nav-sign-in`, `ai-sign-in`.

## Flows and what counts as a pass

### 1. First visit
- Opening `/` in a fresh browser lands on `/welcome`.
- There is one `h1`: "Slides that know what to say."
- The "At a glance" list shows "30 slide types" and "6 built-in looks".
- The page has no horizontal scroll at 1440 px or at 390 px wide.
- Beside the `h1`, a short animation follows one slide's key notes through five scenes: Notes, On stage, Phones, Study and Share. It plays by itself, and its **Pause the animation** button stops it. Choosing a scene shows that scene and stops there. With reduced motion it doesn't play by itself.
- Under the "At a glance" list, **Watch it run** (`#tour`) has a muted, looping screen recording of the app with controls and chapter buttons. With reduced motion it doesn't start by itself.

### 2. The sample talk on the intro page
- The sample talk is in the **Try it here** section (`#try`), under the video.
- The region "Sample talk: Designing Meetings People Want to Attend" shows a real slide, "Usefulness rating by meeting size".
- Its status reads "Slide 4 of 17 · click 0 of 1".
- **Next slide:** the status becomes "click 1 of 1". A second Next makes it "Slide 5 of 17". **Previous slide** goes back.
- **Show answer:** reveals the answer to the likely question, and `aria-expanded` becomes true.
- **Audience view:** the notes area says "This is what the room sees".
- **Presenter view:** brings the script back.

### 3. Present the sample talk
- **Present the sample talk** (`hero-present`) opens `/present/deck_meetings_talk`.
- The right arrow key moves through the show.
- Escape returns to `/welcome`.
- Opening `/try/talk/present` directly in a fresh tab also starts the show. There, Escape goes to `/studio/deck_meetings_talk`.
- `/try/nope` shows "Nothing here".

### 4. The phone quiz
- **Take the quiz in this browser** (`quiz-open-here`) opens `/pack` with a long `#…` fragment.
- The quiz says it has 3 questions. **Start** shows "Question 1 of 3".
- Answering all three ends on a score of the form "N/3".

### 5. From notes, with no AI
- The "Your notes" text box is prefilled with sample notes.
- The status reads "8 slides · about 9 min".
- Adding a new `## Why now` heading with two `- ` lines makes it "9 slides".
- **Clear:** empties the box and shows a hint to start with a heading.
- **Reset example:** brings the sample back.
- **Made for:** choosing Pitch updates the look chip to say it was picked for a pitch.
- **Open as a deck** (`notes-open-deck`): opens `/studio/<id>` with those slides.
- **Opening twice:** coming back and using Open as a deck again, with no edits, doesn't create a second copy in `/decks`.

### 6. Key notes in five places
- The tabs "Presenter view", "Teleprompter", "Study mode", "Handout" and "PowerPoint" each show their own panel.
- **Open presenter view:** goes to `/presenter/deck_meetings_talk`.
- **Open the teleprompter:** goes to `/prompter/deck_meetings_talk`.
- **Open study mode:** goes to `/study/deck_meetings_talk`.
- **Download .pptx:** finishes without the "Couldn't make the file" alert.

### 7. Uses and the sample course
- **Present the sample report:** opens `/present/deck_q3_update`.
- **Present the sample lesson:** opens `/present/deck_water_cycle`.
- **See the sample course:** opens `/courses/course_earth`, which lists the weeks of "Earth & Climate".

### 8. Theme
- The theme button cycles match-system, light and dark.
- The page stays readable in each, with no element left invisible.

### 9. Getting started
- **Open Lectern** (`nav-open-lectern`): goes to `/start?next=%2F`, whose `h1` is "Where do you want to start?".
- **Open the sample talk** (`start-sample`): opens `/studio/deck_meetings_talk`. Opening `/` afterwards shows Home, not the intro page again.
- **Start from my notes** (`start-notes`): opens `/decks` with the new-deck dialog on its notes step.
- **Turn a file into a deck** (`start-file`): opens `/make`.
- **Record and review** (`start-record`): opens `/recordings`.
- **Just look around** (`start-look-around`): opens `/`.

### 10. Decks and the studio
- `/decks` lists the six sample decks, each tagged "Sample".
- In the studio, editing a slide's title and reloading the page keeps the edit (autosave).

### 11. Make a deck without AI
- On `/make`, with no AI on the server, typing only a topic must **not** produce an empty one-slide deck announced as "Your deck is ready".
- The page must say plainly that AI isn't set up here. It should offer to start from notes or a file instead.
- Adding a text or Markdown file with headings still builds a deck from that file.

### 12. Sign-in for AI
A server turns accounts on with its Supabase settings. Check which state the server is in, then hold it to that state:

- **Accounts off:** `/signin` has the `h1` "Sign in" and says "Accounts aren’t set up on this copy of Lectern. Everything here works without signing in." Its **Go to Home** link opens `/`. The sidebar has no "Sign in" link.
- **Accounts on:** the sidebar has a **Sign in** link (`nav-sign-in`) to `/signin`. That page's `h1` is "Sign in to use AI", and it says every account starts with 4,000 free AI credits. It offers **Email me a sign-in link**, and **Continue with GitHub** when GitHub sign-in is turned on.
  - Typing `ada` as the email and clicking **Email me a sign-in link** shows "Enter an email address, like name@example.com." and sends nothing.
  - Where AI is offered on a server that has AI, a signed-out visitor sees a notice starting "Sign in to" (`ai-sign-in`) with a **Sign in** button to `/signin?next=…`. Without AI on the server, the "isn't set up" notices from flows 5 and 11 show instead.
- **Either way:** nothing outside AI asks for a sign-in. Decks, the studio, present mode, notes and the quiz all work signed out.

## Out of scope for these tests

These need hardware, a second device, large downloads or paid keys:

- **Share to phones and the live quiz** need a second device over WebRTC.
- **Recording** needs a microphone.
- **Transcription** downloads a speech model of 40 MB or more.
- **AI drafting, the deck assistant and AI pictures** need a server key and a signed-in account. Only check that they say "isn't set up", or ask to sign in (flow 12).
- **Signing in** needs a real email inbox or GitHub account. Never submit a real address or follow a sign-in link.
- **Picture search** depends on Openverse and Wikimedia, which can be slow.
- **Installing the app and offline use** are also out of scope.
