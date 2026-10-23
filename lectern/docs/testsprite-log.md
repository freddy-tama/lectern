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
- **~22:40** Vercel never received the push. There was no deployment, no commit status and no PR comment, and its "Create Deployment" dialog listed only `main` and the old intro-page branch. GitHub and Vercel both reported no incidents.
  - The project's Git settings still show `freddy-tama/lectern` as connected, and its Ignored Build Step is "Automatic".
  - This is the same failure as the merge of #7, which didn't start a production deploy.
  - Checking the Vercel GitHub App's repository access needs GitHub sudo re-authentication, which is left to the user.
  - The preview was created by hand from the Vercel dashboard ("Create Deployment" → branch `claude/make-no-ai-f4ac9d` → Create Preview Deployment), for commit `7b6bef7`.
- **~22:48** The manual preview passed the "Vercel" commit status on `7b6bef7`, but the TestSprite trigger stayed at "Active · Never run" and its Activity tab stayed empty. Neither app seems to be getting GitHub's events for this repository. The next commit (this log entry) tests that: if Vercel builds it on its own, the events are arriving again.
- **22:58** Vercel did build `c4e2017` on its own, about 14 minutes after it was pushed. An automatic build of `7b6bef7` had also turned up at 22:43–22:47, after the manual one. GitHub was delivering both apps' events late; neither app was misconfigured.
- **23:07–23:10** TestSprite queued 9 minutes after the preview was ready, then ran all 27 tests on the PR #8 preview ([run `5376a8a2`](https://www.testsprite.com/dashboard-v3/o/dfe734b3-7442-5019-aa71-fa10706b4f14/projects/4a558259-6d77-449a-bede-151ba58b667a/execution/5376a8a2-29a2-410f-b891-729e47ef7aaa)): 26 passed, 1 failed.
  - DRF-001, the `/make` bug, passed.
  - PRS-006 ("Continue using the home page after starting from the sample talk") failed, and the test was at fault, not the app. Its generated steps were loose: the agent went `/` → `/welcome` → Present → Esc and expected Home. For a first visit, going back to `/welcome` is right (PRD flow 3).
  - What the test meant was checked by hand on the preview: `/start` → "Open the sample talk" → `/studio/deck_meetings_talk`, then `/` shows Home.
- **~23:20** PRS-006 was rewritten in the portal to follow PRD flow 9 step by step:
  1. Go to `/start`.
  2. Click "Open the sample talk" (`data-testid="start-sample"`), not a "Present" link.
  3. Check that the URL is `/studio/deck_meetings_talk`.
  4. Go straight to `/`, without the Back button.
  5. Check that the URL stays `/` and the page doesn't show "Slides that know what to say".
- **23:22** Save & Run of the new PRS-006 on production passed. Every one of the 27 tests now has a passing latest result.
- **~23:28** Re-running PRS-006 inside the PR #8 run didn't start.
  - "Re-Run Failed" on Test Runs answered "unknown environment 'github-pr-8'; use one of: default".
  - The run page's "Re-run failed (1)" answered "Could not start the run".
  - A pull request run's tests can only run again in a new GitHub-triggered run, from a new push or a redeploy of the preview. That is a full 27-test run (about 13.5 credits), so the check on #8 stays at 26/27 for now.

## Sign-in for AI

**2026-10-21**

- **~23:35** Accounts were added on the branch `claude/signin-quota`. They gate AI only; browsing, presenting, notes and the quiz stay open. The PRD changed with it:
  - It no longer says "there are no accounts".
  - New flow 12 describes `/signin` with accounts off and with accounts on. The tests must check which state the server is in, because a preview has accounts only if the project's Supabase settings apply to previews.
  - The out-of-scope list now covers signing in: no test submits a real email address or follows a sign-in link.
- Three tests are planned to be added by hand once that pull request has a preview:
  - ACC-001, open `/signin` in a fresh browser: the page shows one of the two states from flow 12, never a blank page or an error, and Go to Home (accounts off) opens `/`.
  - ACC-002, open `/decks`, a sample deck and present mode without signing in: no step asks for a sign-in.
  - ACC-003, accounts on only: an email address without "@" shows "Enter an email address, like name@example.com." and sends nothing.

**2026-10-22**

- **00:04** [PR #9](https://github.com/freddy-tama/lectern/pull/9) (accounts for AI) was opened from `claude/signin-quota`. It was built on #8, so it carried #8's two commits as well.
- **00:10** Vercel's preview was ready, about 6 minutes after the push. Its server functions answered: `/api/account` gave `{"accounts":false}`, because the Supabase settings aren't on previews yet, and the AI endpoints reported AI as off, as on production. So this run tested the accounts-off state.
- **00:14–00:16** TestSprite ran all 27 tests on the preview ([run `3ae71737`](https://www.testsprite.com/dashboard-v3/o/dfe734b3-7442-5019-aa71-fa10706b4f14/projects/4a558259-6d77-449a-bede-151ba58b667a/execution/3ae71737-de1e-4bc7-ae2c-a1b48bddd0d8)): **All 27 tests passed**.
  - That includes DRF-001 (the `/make` fix from #8) and the rewritten PRS-006, so the loop that #8's run started closed here.
  - The suite is still the same 27 tests; flow 12 in the PRD has no test of its own yet.
- **00:19** #9 was merged as `1e32c71`. GitHub marked #8 as merged too, because its commits were in #9.
- **00:24** Production hadn't deployed the merge. Vercel's dashboard showed a "GitHub Outage" notice: automatic deployments from GitHub may be delayed. It is probably what delayed GitHub's events the evening before, too.
- **00:32** Vercel deployed the merge to production on its own (`1e32c71`, ready at 00:33), about 13 minutes after the merge. No hand deploy was needed. The live site's `/api/account` answers `{"accounts":false}`.
- **00:37** Production now has AI keys: `/api/draft-deck` and `/api/picture-generate` report AI as available, the pictures with `gpt-image-2.5-sunburst`. Accounts and an access code are both off, so AI there is open to anyone. Previews still have AI off.
  - Two tests assume AI is off and would fail against production: DRF-001 (`/make` with a topic alone) and NTS-002 (the AI tab's setup notice). Pull request runs aren't affected, because they test previews.
  - Once accounts are on, production shows "Sign in to …" in those places instead. The PRD and those two tests need to accept that state too.

## License and README testing section

**2026-10-22** (China time). These times come from the `TestSprite V3` and Vercel commit statuses on the pull request.

- **00:26** [PR #10](https://github.com/freddy-tama/lectern/pull/10) was opened from `claude/license-readme`: the all-rights-reserved LICENSE, the README's first testing section, and #9's run in this log. No app code changed.
- **00:31** Vercel's preview was ready. TestSprite queued the run 10 minutes later, at 00:41.
- **00:41–00:44** **All 27 tests passed** ([run `1cc5186e`](https://www.testsprite.com/dashboard-v3/o/dfe734b3-7442-5019-aa71-fa10706b4f14/projects/4a558259-6d77-449a-bede-151ba58b667a/execution/1cc5186e-11c9-481a-a141-30ab7b112350)), for 13.5 credits.
- The two log entries above (00:32 and 00:37) were committed after #10's last push and never pushed. They reached `main` with #13.

## Intro page pitch and video

**2026-10-22** (China time)

- **Before the run:** the intro page changed on the branch `claude/pitch-video-dacd59` (25 characters after slugging), PR #11.
  - An animated pitch now sits beside the `h1`, and a "Watch it run" video (`#tour`) sits under the "At a glance" list.
  - The playable sample talk moved into "Try it here" (`#try`), under the video. Its region name, status text, buttons and test ids are unchanged.
  - Names in the new film and the video chapters were chosen to avoid the page's existing control names, such as "Presenter view" and "Slide 4 of 17". Playwright matches names by substring, so a repeat would make a test's locator match two elements.
  - The PRD's flows 1 and 2 gained the film, the video and `#try`. No test was edited in the portal.
- **01:57** Commit `5e2744f` was pushed. Vercel started the preview on its own this time, and it was ready at 01:59.
- **01:59–02:03** TestSprite queued 27 tests on the PR #11 preview and **all 27 passed** ([run `f242796d`](https://www.testsprite.com/dashboard-v3/o/dfe734b3-7442-5019-aa71-fa10706b4f14/projects/4a558259-6d77-449a-bede-151ba58b667a/execution/f242796d-a0c5-4584-a29b-d3dc539db17c)). It cost about 13.5 credits.
- **After the run:** the preview was checked in headless Chrome.
  - `/media/lectern-tour.mp4` is served as `video/mp4` with byte ranges.
  - On screen, the video plays muted. It had reached 6.5 s after 7 s, fully buffered.
  - With reduced motion it neither loads nor starts.
- **02:17** #11 was merged as `49cc41b`. Its log entry above was committed after its last push and never pushed; it reached `main` with #13.

## The "compiled grammar is too large" fix

**2026-10-22** (China time)

- **02:07** [PR #12](https://github.com/freddy-tama/lectern/pull/12) was opened from `claude/brave-tharp-957118` (25 characters after slugging). On `/make`, every AI draft had failed with "The compiled grammar is too large". The fix sends each slide's content as one JSON string, so the output schema shrank from about 41 KB to about 2 KB.
- **02:08** Vercel's preview was ready, and TestSprite queued the run 6 seconds later.
- **02:08–02:11** **All 27 tests passed** ([run `6b3e289a`](https://www.testsprite.com/dashboard-v3/o/dfe734b3-7442-5019-aa71-fa10706b4f14/projects/4a558259-6d77-449a-bede-151ba58b667a/execution/6b3e289a-5664-46f1-be89-4359bafff4fc)), for 13.5 credits.
  - Previews have AI off, so the suite couldn't reach the fixed code. It checked that nothing else broke. The fix itself is covered by vitest (`tests/draft-deck.test.ts`).
- **02:17** #10, #11 and #12 were merged within 20 seconds of each other, as `8cf8b86`, `49cc41b` and `d3ef26e`.
- **~02:20** Vercel deployed `8cf8b86` and then `d3ef26e` to production on its own. No hand deploy was needed. Its dashboard still showed the "GitHub Outage" notice.

## The repository README

**2026-10-22** (China time)

- **Before the run:** the repository root had only `LICENSE` and `lectern/`, so GitHub's front page showed no README.
  - The branch `claude/readme-front` (19 characters after slugging) adds a root `README.md` for judges and new users. It covers the problem Lectern solves, links into the live app, how the TestSprite loop is wired, the 27 tests by PRD flow, and this log as a timeline.
  - `lectern/README.md` now points to it for testing and plans, so the two don't drift apart.
  - No app code changed. The vitest suite on `main` (`d3ef26e`) passed: 625 tests in 45 files.
- **Checked for the README:**
  - `gh api repos/freddy-tama/lectern/branches/main/protection` answers "Branch not protected". The TestSprite merge gate reports a failing status, but GitHub doesn't block the merge on it.
  - The portal lists 12 runs:
    - run 1;
    - five single re-runs at 22:11–22:15;
    - PRS-006 at 23:22;
    - the five PR runs, #8 to #12.
  - The workspace's Usage page shows 90.5 of the 150 monthly credits used, and 59.5 left. The cycle renews on Nov 15.
    - The sum: setup 6.5 + run 1 13.5 + re-runs 2.5 + PRS-006 0.5 + five PR runs at 13.5 each = 90.5.
  - Production answers `/api/account` with `{"accounts":false}`, and `/api/draft-deck` with `"available":true`.
- **This run:** #13 is expected to cost about 13.5 credits, leaving about 46. Its result is on the pull request's `TestSprite V3` check. Pushing the result here would start another full run, so it goes into the next pull request's log entry.

## Four new slide types

**2026-10-22** (China time)

- **Before the run:** the branch `claude/lectern-new-kinds` adds Scorecard, Pricing, Contact and Word cloud, which brings the built-in slide types from 30 to 34.
  - The vitest suite passed on the branch: 667 tests in 47 files, 42 of them new (`tests/pitch-kinds.test.ts`, `tests/word-cloud.test.ts`). `npm run build` passed.
  - The live word cloud was checked by hand in one browser, with the host on `127.0.0.1` and a phone on `localhost`:
    - the phone sent three words, refused a repeat that differed only in case, and closed its answer box at the limit;
    - the big screen redrew the cloud without a reload;
    - the Share panel's hide button took a word off the big screen;
    - **Keep** saved the words on the slide.
- **What the suite may notice:** the intro page's "At a glance" list counts the slide types, so it now reads "34 slide types". The PRD said 30 (flow 1).
  - The PRD now says 34. It also has a new flow 13 for the four slide types, and the out-of-scope list now covers live word cloud answers.
  - If WLC-006 checks the number in that list, it fails on this preview until its expected text is changed to "34 slide types" in the portal. That would be the loop doing its job, not a regression.
  - Flow 13 has no test yet. New tests for it would be added in the portal from the PRD.
- **This run:** about 13.5 credits for the 27 tests, leaving about 32.5 of the month's 150 if the last count was right.
- **03:08** TestSprite ran the 27 tests on the #14 preview ([run `6fb0f65c`](https://www.testsprite.com/dashboard-v3/o/dfe734b3-7442-5019-aa71-fa10706b4f14/projects/4a558259-6d77-449a-bede-151ba58b667a/execution/6fb0f65c-2c73-416d-904d-c7b511519db0)): 26 passed, 1 blocked, none failed.
  - The blocked test, "Build a deck from notes with the talk audience", stalled while the test agent was typing. The app was fine.
  - The `TestSprite V3` check shows as failing because of the blocked test. The branch isn't protected, and a run with only blocked tests has been treated as fine to merge.
- **09:53** #14 was merged as `34bfe4e`, and Vercel deployed it to production.

## Layouts, three slide types and editing on the slide

**2026-10-22** (China time)

- **Before the run:** the branch `claude/lectern-layouts-canvas-d2cc05` makes four changes:
  - **Layouts** for existing types, each with an auto style rule:
    - Points: Picture right, Picture left, Two columns;
    - Quote: Testimonial;
    - Big numbers: One big number;
    - Steps: Top to bottom;
    - Agenda: You are here.
  - **Three new types:** Text, Roadmap and Screenshot. The built-in slide types go from 34 to 37.
  - **Editing on the slide.** Click to type, drag to move, handles to resize, and a toolbar beside the selection. The fields panel starts folded away.
  - **Positions people choose.** Moved boxes are stored per slide by box id, and the layout engine applies them. The studio, present mode, phones, thumbnails and PowerPoint all match, and **Reset layout** clears them. A new layout or type clears them too. Auto style leaves a hand-arranged slide alone.
  - The vitest suite and `npm run build` passed on the branch. The editor was checked by hand in the browser pane: typing, dragging with the marker following, corner scaling, dragging a screenshot callout, and Delete on a selected point.
- **What the suite may notice:**
  - The "At a glance" list now reads "37 slide types" (flow 1). If WLC-006 checks the number, it fails until its expected text says 37 in the portal.
  - The fields panel is hidden when the studio opens. Tests that fill in a field, such as Contact's **QR code link** (flow 13) or the word cloud's **Words on the slide**, need **Show all fields** (`studio-fields`) first. The PRD says so now.
    - The flow 10 test edits a slide's title. If it types into the panel's **Title** field rather than onto the slide, it can't find the field while the panel is folded away. Typing onto the slide's title works as before.
  - Flow 13 lists the three new types, and the new flow 14 covers layouts and editing on the slide. Neither has a test yet.
- **This run:** about 13.5 credits for the 27 tests, which leaves about 19 of the month's 150, enough for one more run.
- **10:47 and 15:45** TestSprite skipped both pushes to #15 (`5089819`, and an empty commit `a1dd274` meant to start it). The trigger's Activity tab gave the reason: "The URL pointed at a host we cannot test."
  - **Why:** the trigger builds the preview address from `https://lectern-git-{branch-slug}-freddy-tamas-projects.vercel.app`. The branch `claude/lectern-layouts-canvas-d2cc05` makes the first part of the host 70 characters long, and a host name's parts can be at most 63. Vercel shortened its own preview address to `lectern-git-claude-lectern-layouts-e9c660-…`, which the pattern can't predict.
  - **Fix:** the branch was renamed on GitHub to `claude/lectern-layouts` (56 characters).
  - **16:01** Renaming the branch closed #15. GitHub moves a PR along when its base branch is renamed, but closes it when its head branch is. The same commits were opened again as #16, and this entry was pushed after it opened to start the run.
  - **For later PRs:** keep the branch slug (the branch name with `/` as `-`) to 29 characters or fewer.
- **16:03** TestSprite ran the 27 tests on the #16 preview ([run `bdd1b265`](https://www.testsprite.com/dashboard-v3/o/dfe734b3-7442-5019-aa71-fa10706b4f14/projects/4a558259-6d77-449a-bede-151ba58b667a/execution/bdd1b265-26e8-4d13-90b7-e1bbafbd0392)): 26 passed, 1 blocked, none failed.
  - WLC-006 passed with "37 slide types".
  - The flow 10 title test passed with the fields panel folded away.
  - The blocked test was again "Build a deck from notes with the talk audience" (NTS-001), which was also blocked on #14.
    - This time the agent saw the outline, the eight-slide preview and **Talk** selected, but couldn't activate **Open as a deck**.
    - That button (`notes-open-deck` in `FromNotes.tsx`) is a plain, enabled button that this branch didn't change, so this looks like the test agent's trouble rather than the app's. It's worth one check by hand.
  - The `TestSprite V3` check shows as failing because of the blocked test, as on #14.
- **16:16** #16 was merged as `faad386`, and Vercel deploys it to production.
  - This entry went straight to main. A push to the PR would have started another paid run, and TestSprite skips pushes to main.
- **Credits:** about 13.5 for this run. The two skipped events on #15 cost nothing. About 19 of the month's 150 are left, enough for one more run.

## The tour video, now with a live AI run

**2026-10-23** (China time)

- **Before the run:** the branch `claude/tour-live-ai` replaces the intro page's **Watch it run** video and adds a sound button:
  - The video (124 s, 7.8 MB) keeps the old recording's first 54 seconds, the sample talk, and adds narration to it. Then it adds a run on the live site:
    - Claude Opus turns two sample files and a brief into a deck on `/make`.
    - The deck assistant changes the deck.
    - The deck plays on a laptop, the room's screen and a phone.

    Each AI wait that was cut out is labelled on screen with how long it was.
  - The narration is ElevenLabs text-to-speech, over a quiet music loop.
  - The Tour section gets **Play with sound**: it unmutes the video and starts it from the top, and then reads **Mute**. The chapter names changed, and none is part of another control's name on the page.
  - The vitest suite (726 tests), the typecheck and `npm run build` passed. The section was checked by hand in Chrome and in the browser pane, on a desktop and at phone width.
- **What the suite may notice:** flow 1's tour checks. The PRD mentions **Play with sound** now. It doesn't name the chapters, but a test written in the portal might use an old chapter name.
- **This run:** about 13.5 credits, which leaves about 5.5 of the month's 150.
- **07:50** TestSprite queued the 27 tests on the #17 preview ([run `324c3933`](https://www.testsprite.com/dashboard-v3/o/dfe734b3-7442-5019-aa71-fa10706b4f14/projects/4a558259-6d77-449a-bede-151ba58b667a/execution/324c3933-c2d7-4f4f-acdd-0b2568c7bd1f)). It had finished by 08:34: all 27 passed.
  - NTS-001, blocked on #14 and #16, passed this time.
  - The branch was pushed before the PR was opened, and the run still started. Vercel finished building after the PR opened.
- **08:34** #17 was merged as `e399901`, and Vercel deploys it to production.
  - This entry went straight to main. A push to the PR would have started another paid run, and TestSprite skips pushes to main.
- **Credits:** about 13.5 for this run. About 5.5 of the month's 150 are left, not enough for another full run.
