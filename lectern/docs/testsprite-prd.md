# Lectern: product requirements for end-to-end tests

Lectern is a presentation tool for talks, pitches, reports and lessons. Every slide carries **key notes**: a script, takeaways, a likely question, cues and planned minutes. The same notes feed present mode, the presenter view, the teleprompter, study mode, the printed handout and PowerPoint speaker notes. Everything is saved in the browser (IndexedDB), and a fresh browser starts with six sample decks. Accounts are optional and only needed for AI: browsing, presenting, notes and the quiz work without signing in.

- Live site: https://lectern-sooty.vercel.app (pull requests get a Vercel preview with the same behaviour)
- Tests never sign in. Every test starts in a fresh browser profile, so the sample data is always the same.
- The public site has no AI key, so AI features answer "isn't set up". That is the expected result, not a failure.

## Stable hooks

Prefer roles and accessible names. These `data-testid`s exist where names repeat: `nav-open-lectern`, `hero-present`, `finale-present`, `finale-open-lectern`, `quiz-open-here`, `notes-open-deck`, `start-sample`, `start-notes`, `start-file`, `start-course`, `start-record`, `start-look-around`, `nav-sign-in`, `ai-sign-in`, `studio-fields`.

## Flows and what counts as a pass

### 1. First visit
- Opening `/` in a fresh browser lands on `/welcome`.
- There is one `h1`: "Slides that know what to say."
- The "At a glance" list shows "37 slide types" and "6 built-in looks".
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
- The slide is the editor: clicking text on it types straight into it. The panel with every field starts folded away. **Show all fields** (`studio-fields`, in the studio's top bar) opens it, and so does a slide toolbar button such as **All fields** or **Change picture**.

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

### 13. Slide types for reports, pitches and the room
- On `/welcome`, the **Slide types** section (`#slide-types`) has cards named "Scorecard", "Pricing", "Word cloud", "Contact", "Text", "Roadmap" and "Screenshot".
- In the studio, **Add slide → Scorecard** adds a slide titled "This quarter" with four measures, each with a bar and a status: "On track", "At risk", "On track", "Done".
- **Add slide → Pricing** adds three plans, Starter, Team and Business. Team is marked "Most popular".
- **Add slide → Contact** adds "Thank you" with "Maya Chen" and "maya@example.com". Filling in **QR code link** (open **Show all fields** first) with an address adds a QR code to the slide.
- **Add slide → Word cloud** adds the question "In one word: what makes a great meeting?". With no answers yet, the slide says "Answer on your phone. Words appear here as they come in."
  - Under **More options** in the fields panel, adding a word to **Words on the slide** (for example "Agenda" with count 3) draws that word on the slide.
- Answering a word cloud from a phone needs a second device and is out of scope.
- **Add slide → Text** adds "What we learned" with two paragraphs.
- **Add slide → Roadmap** adds "Roadmap" with the periods Q1 to Q4 and the workstreams Product, Design, Engineering and Marketing, each with bars.
- **Add slide → Screenshot** adds "Meet the new editor" with three numbered callouts. With no picture yet, the studio's frame says "Add a screenshot".

### 14. Layouts and editing on the slide
- In the studio, clicking a point on a **Points** slide puts the cursor in it on the slide, with a small toolbar beside it: **Layout**, **Add point**, **All fields** and **Delete point**.
  - **Add point** adds an empty point under it, ready to type.
  - **Delete point** removes it, and the toast's **Undo** brings it back. The slide itself stays.
- Under the slide, the slide type button (for example "Points") changes the type, and the layout button lists that type's layouts. Points offers **Picture right**, **Picture left** and **Two columns**; choosing **Two columns** sets the points in two columns.
- These types gained layouts: Quote (**Testimonial**), Big numbers (**One big number**), Steps (**Top to bottom**) and Agenda (**You are here**).
- Dragging a box on the slide moves it, and **Reset layout** appears under the slide. Clicking it puts everything back. Dragging needs a steady pointer, so a test may skip it.

## Out of scope for these tests

These need hardware, a second device, large downloads or paid keys:

- **Share to phones, the live quiz and live word cloud answers** need a second device over WebRTC.
- **Recording** needs a microphone.
- **Transcription** downloads a speech model of 40 MB or more.
- **AI drafting, the deck assistant and AI pictures** need a server key and a signed-in account. Only check that they say "isn't set up", or ask to sign in (flow 12).
- **Signing in** needs a real email inbox or GitHub account. Never submit a real address or follow a sign-in link.
- **Picture search** depends on Openverse and Wikimedia, which can be slow.
- **Installing the app and offline use** are also out of scope.
