# TestSprite log

A running record of how Lectern's end-to-end suite was set up in TestSprite and what each run found. The README's testing section is written from this. Times are China time (UTC+8).

## Setup

**2026-10-21**

- **~18:10** Vercel Authentication was turned off for the project, so TestSprite's cloud browsers can open pull request previews without a Vercel login.
- **~21:30** [PR #7](https://github.com/freddy-tama/lectern/pull/7) (the intro page and first-run path) was merged as `b523cb2`. Production was deployed by hand from Vercel, because the merge did not start a deployment on its own.
- **~21:35** The TestSprite project "Lectern" was created in the TestSprite 3.0 portal:
  - type: Frontend UI;
  - URL: https://lectern-sooty.vercel.app;
  - access: no sign-in;
  - context: [`testsprite-prd.md`](testsprite-prd.md), the flows and pass criteria written for this suite. Every claim in it was checked against production first.
  - The extra instructions say every test starts in a fresh browser, asserts the exact text and URLs from the PRD, and skips WebRTC sharing, the microphone, model downloads, AI and picture search.
  - The free plan doesn't accept test files, so [`testsprite-sample-notes.md`](testsprite-sample-notes.md) wasn't uploaded.
- **~21:36** TestSprite sent 10 agents to explore the live site, one per area of the PRD:
  - landing and first visit;
  - presentation playback;
  - the phone quiz;
  - the notes editor and deck creation;
  - key notes destinations;
  - the sample course and built-in content;
  - theme and appearance;
  - getting started;
  - the deck library and studio editing;
  - making a deck without AI.
- **~21:40** The PR trigger was added under GitHub Action:
  - The TestSprite GitHub App is installed on `freddy-tama` for the whole workspace.
  - *Detect events* on PR #7 found the Vercel commit status, the "Vercel Preview Comments" check and the vercel[bot] comment.
  - **Event:** the Vercel commit status, so tests start when the preview deployment is ready.
  - **Target URL pattern:** `https://lectern-git-{branch-slug}-freddy-tamas-projects.vercel.app`, which is Vercel's branch preview URL.
  - **Draft PRs:** not run.
  - **Merge gate:** on. Results are reported as a status check, and a failure blocks the merge.
  - Vercel shortens a preview hostname longer than 63 characters, so branch names should stay at or under 29 characters after slugging.

- **~21:43** The exploration finished: 10 agents, 87 steps, 88 pages captured, in 6 min 30 s. Exploring and planning cost 6.5 of the free plan's 150 monthly credits. The free plan also caps exploration at 10 features for the lifetime of the account, and this used all 10.

## Test plan

TestSprite proposed **83 tests in 11 use cases**. Many repeated each other:
- "list the six sample decks" appeared 4 times;
- presenter view, the teleprompter, study mode and title autosave appeared 2–3 times each.

Every PR run re-runs the whole suite, and credits are limited, so the plan was cut to **one test per behaviour, 27 tests**. Each one maps to a flow in the PRD:

| PRD flow | Tests kept |
|---|---|
| 1. First visit | Open the intro page from a fresh visit |
| 2. Sample talk on the intro page | Advance the sample talk with next slide · Reveal the answer · Switch between presenter and audience views |
| 3. Present | Navigate sample talk slides with keyboard · **Open a shared /try link and leave the show** (added by hand: `/try/talk/present` → Esc → studio, `/try/nope` → "Nothing here") |
| 4. Phone quiz | Complete the phone quiz |
| 5. From notes | Build a deck from notes with the talk audience · Switch to the AI draft tab and see the setup notice |
| 6. Key notes | Show the key notes tabs · Open presenter view from key notes · Open teleprompter from key notes · Read through the deck in review mode |
| 7. Uses and course | Open the sample report presentation · Open the sample lesson presentation · Open a lesson deck from the course schedule |
| 8. Theme | Cycle through system, light, and dark themes |
| 9. Getting started | Open Lectern start page · Open notes deck from the getting started page · Open file import flow · Open the record and review flow · Continue using the home page after starting from the sample talk |
| 10. Decks and studio | List all sample decks · Search for a sample deck · Edit a slide title and keep the change after reload · Add a slide to an existing deck |
| 11. Make without AI | **Make a deck from a topic alone with no AI** (rewritten by hand, see below) |

- **Rewritten:** TestSprite's "Show AI setup guidance when drafting a deck" was rewritten to aim at a bug found while checking the live site.
  - On `/make`, the brief box says "No files? Describe the topic here and Lectern drafts from that."
  - With no AI key on the server, a topic alone builds an empty one-slide "New deck" and announces "Your deck is ready".
  - The test now asserts that this doesn't happen, and that the page offers notes or a file instead.
  - It is expected to **fail** on the current production build. The fix will go through a TestSprite-gated PR.
- **Left out:** the file-upload tests, because the free plan has no test files.
- Every test starts on `lectern-sooty.vercel.app`, the default environment. PR runs point the same tests at that PR's Vercel preview.

## Runs

### Run 1: production, 2026-10-21 21:56 — 21 passed, 4 failed, 2 blocked (78%)

- 27 tests in about 4 minutes, for 13.5 credits (about 0.5 credits a test).
- Each failure was checked against the live site and the code before deciding what to change.

| Test | Result | Cause | What changed |
|---|---|---|---|
| Make a deck from a topic alone with no AI | Failed | **Real bug.** TestSprite saw "Your deck is ready" and a one-slide "New deck", with no notice that AI is off. Code: `MakePage.tsx` calls `offlineDraft` when there are no files, and the brief is ignored. | The fix goes through a TestSprite-gated PR |
| Open the sample report presentation | Failed | Test mistake. It clicked the hero's "Present the sample talk" link, so it landed on `/present/deck_meetings_talk`. The Uses link is correct (`/try/report/present`). | Steps now name the Uses section and the exact link text and href |
| Open the sample lesson presentation | Failed | Same mistake as the report test. | Same fix, for `/try/lesson/present` |
| Open teleprompter from key notes | Failed | Test mistake. It clicked "Presenter view" twice and then "Present", and never opened the Teleprompter tab. | Steps name the Teleprompter tab and the "Open the teleprompter" link (`/try/talk/prompter`) |
| Edit a slide title and keep the change after reload | Blocked | Test mistake. It looked for a deck called "Why small teams ship faster", which only existed in an exploring agent's browser. A fresh browser has only the six samples. | Now edits a title on `/studio/deck_meetings_talk` |
| Reveal the answer in the sample talk | Blocked | Test mistake. It opened present mode, but "Show answer" lives on the intro page's hero. It also stopped on slide 7, which reveals its three lines one click at a time. A check in a fresh headless Chrome showed the 4th Next does reach slide 8. | Steps stay on `/welcome` and use the hero's "Likely question" box |

**Takeaway:** the planner wrote tests from what the agents saw while exploring. Some steps were too loose ("click the link to present…") and some relied on state from an exploring session. Naming the exact accessible text, href or section fixed both.

### Run 1b: the five fixed tests re-run on production, 2026-10-21 ~22:15–22:25 — 5 of 5 passed

- **Passed:**
  - Open the sample report presentation;
  - Open the sample lesson presentation;
  - Edit a slide title and keep the change after reload;
  - Reveal the answer in the sample talk;
  - Open teleprompter from key notes.
- **Suite on production now: 26 passed, 1 failed.** The one failure is the real `/make` bug, which is the correct result until the fix lands.
- **Credits:** 127.5 of 150 left. Five single re-runs cost 2.5 credits; a full 27-test run costs about 13.5.

## The `/make` fix

**2026-10-21**

- **~22:20** The exact steps of DRF-001 were read from the portal, so the fix answers what the test checks:
  - go to `/make`;
  - type "Why small teams ship faster" into the "Anything Lectern should know?" box, with no files;
  - click "Make the deck" and wait up to 10 seconds;
  - the page must not say "Your deck is ready" or offer a one-slide "New deck";
  - it must say AI isn't set up here, and offer to start from notes or from a file.
- **~22:35** The fix was opened as a pull request on the branch `claude/make-no-ai-f4ac9d` (24 characters after slugging, so the preview URL keeps its full name).
  - With AI off and no file text or pictures, "Make the deck" no longer builds a deck. It says "AI isn't set up here, so Lectern can't draft from a topic alone. Start from your notes, or add a file."
  - The notice under the brief box says the same before anything is clicked, with "Start from notes" (`/decks?new=notes`) and "Choose a file".
  - The brief box no longer promises "Lectern drafts from that" when AI is off.
  - A Markdown file with headings still builds a deck. With AI on, a topic alone still goes to the AI.
  - New vitest coverage in `tests/make-page.test.tsx` renders `/make` with AI off and on. Its two bug tests fail on the old code and pass with the fix.
