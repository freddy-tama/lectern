# Deck study, November 2026: what real decks do that Lectern doesn't

On 2026-11-04 we read 53 real decks and compared them with Lectern. The set was the user's own 16 课件 and report decks, plus 37 well-known decks from the web: 8 pitches, 8 talks, 8 reports (11 files), 7 English lessons and 5 Chinese 课件.

The aim was patterns, not copies. Nothing from these decks goes into Lectern, and no downloaded file is in the repo. The decks themselves stay outside the repo in `D:\deck-study\batch-2026-11-04`.

The ranked list of changes is at the end. No code has changed yet: the user picks from that list first.

## How the decks were read

- **Structure:** every .pptx went through python-pptx. For each slide we recorded:
  - the layout;
  - the words, counted the way Lectern counts them (Latin words plus 0.52 × CJK characters);
  - pictures, tables and charts;
  - click animations and triggers;
  - the speaker notes.
- **PDFs:** read with PyMuPDF, page by page. We also looked at contact sheets of every PDF deck (except a sample of the two 300-page reports).
- **No rendering of .pptx:** none was opened in PowerPoint, because the files are untrusted. So for the .pptx lessons and 课件, the visual judgements are inferred from their structure.
- **Importer test:** Lectern's own importers (`readPptx`, `findQuestion` and `fileToOutline`) ran over all 37 .pptx files in vitest.
- **Caveats:**
  - The British Council lesson could not be fetched: its site refuses scripted downloads.
  - The "Node.js" talk deck turned out to be a 2012 meetup intro, not Ryan Dahl's own.
  - Mirror sites added an advert page to several pitch decks, and 1ppt.com added one to each 课件. These pages were ignored.
  - Three pitch PDFs are image-only, so their word counts are estimates read from the pictures.

## The decks at a glance

Words are the median per slide, counted Lectern's way.

| Deck | Purpose, audience | Slides | Words | Reveals | Practice and checks | Order of parts |
|---|---|---|---|---|---|---|
| Own: 小马过河 课件 (定) | lesson, 二年级 (Indonesia), 37 min | 26 | 22 | 2.3 clicks/slide | cloze with word bank, sentence order, word scramble, cloze that grows over 4 slides, 听写 with a 5-min prep | picture-guess opener → title → word pairs with pictures → sentence patterns → whole text → per 段: text, question, one-line summary → practice → recap → moral applied to life → homework |
| Own: 孙中山 课文部分 (修订) | lesson, 六年级, 15 min | 21 | 37 | 1.9 | per-段 question with answer on click, cloze with bank, recall questions, story order, why + "and you?" | who-is-he Q&A → per 段: read + 1 question, then a word slide → cloze → recall → order → think and say → summary → homework |
| Own: 颐和园 生词部分 | lesson, 六年级 | 18 | 5 | 0.9 | word ↔ picture match, cloze | per word: pinyin + 2 pictures, then 2 example sentences → review → match → cloze → homework |
| Own: 颐和园 课文部分 | lesson | 13 | 0 | 0 | true/false with corrections in brackets | pictures of the text → T/F → homework |
| Own: 语法教学 (把字句) | lesson | 16 | 7 | 1.4 | pattern fill-in, act it out | story pictures → pattern → examples → fill-ins → perform → recap → homework |
| Own: WARNA | lesson, young | 26 | 1 | 0.9 | none | spell each colour letter by letter → word → review |
| Own: 3 Yellow Tower decks | report, founder/shareholders | 11–18 | 31–63 | none | n/a | data screenshots → issues → next steps; label titles, no sources, no summary up front |
| Oak KS1 science, plants | lesson, age 5–7, ~45 min | 34 | 32 | 1.8 | T/F with a reason to pick, MCQ, label the picture, two children's claims to judge, partner talk with sentence stems, 3 lettered tasks | title → outcome → keywords → 3 cycles (you-are-here → explain → checks → task → feedback) → summary |
| Oak Y6 English, colons | lesson, age 10–11 | 35 | 69 | 4.5 | MCQ, match, fix the commas, spot and correct the mistake, build from word banks; model answers after every task | same Oak frame, 2 cycles |
| Oak KS3 maths, like terms | lesson, age 11–14 | 43 | 25 | 1.6 | sort tiles into groups, match, two pupils' methods compared, a claim to disprove with a written reason | same frame, 3 cycles (concrete → symbol → exponent) |
| Oak KS3 French, -er verbs | lesson, age 11–14 | 36 | 36 | 2.2 | listen and repeat, tick tables, picture MCQ, match with answer slides, ending fill-in, sentence-builder table | same frame, 3 cycles (sound, vocab, grammar) |
| Oak KS4 history, Berlin Wall | lesson, age 14–16 | 31 | 45 | 0.4 | MCQ, open "why", challenge an interpretation, spot errors in a paragraph, 3 writing tasks with "you should…" scaffolds | same frame, 3 cycles |
| CS50 lecture 0 | lesson, university, ~1.5–2 h | 148 | 1 | builds as slides | none | logistics → one-word concept chain → binary → text and images → algorithms → Scratch |
| Python for Everybody 5 | lesson, university | 53 | 34 | none | traced values, frame by frame | loops → 3 bumper dividers → idioms → summary |
| 课件 守株待兔 | lesson, 三年级, 40 min | 29 | 11 | builds as slides | picture → idiom guessing, word-making | 导入 → text → 生字 → 写字 → the passage highlighted sentence by sentence (9 slides) → 作业 |
| 课件 陶罐和铁罐 | lesson, 三年级 | 31 | 32 | none | dialogue tone fill-in, tables filled in after a blank version | review → text → 精读 → reading dialogue by 称呼/标点/提示语 → 总结 → transfer to a 2nd fable → 作业 |
| 课件 小马过河 | lesson, 二年级 | 41 | 23 | none | 我的疑问, retell prompts, characters sorted by structure | 生字词 → 读通 → 整体感知 → per 段 → dialogue → 写字 |
| 课件 画杨桃 | lesson, 二年级 | 32 | 27 | builds as slides | 多音字 contrast, cloze with the gloss shown with the answer | 预学汇报 band → read → words → characters → 共学 |
| 课件 巨人的花园 | lesson, 四年级 | 23 | 23 | 1.7 | quote + question + answer on click (9 slides) | contents → 4 numbered sections with dividers → 作业 revealed item by item |
| Airbnb 2009 | pitch, angels | 14 | ~30 | none | n/a | purpose → problem → solution → validation → market (3 nested circles) → product → model (arrow chain of numbers) → adoption → competition (logos on a 2×2) → team → press → users → ask |
| LinkedIn 2004 | pitch, Series B | 37 | ~50 | none | n/a | thesis → problem → analogies → traction → share → competition 2×2 → model → market → pricing → financials → team → summary |
| YouTube 2005 | pitch | 10 | ~25 | none | n/a | purpose → problem → solution → market → competition → product → sales → team → metrics |
| UberCab 2008 | pitch | 25 | 31 | none | n/a | problem → concept → uses → fleet → tech → market → scenarios → progress and ask |
| Buffer 2011 | pitch, seed | 13 | 28 | none | n/a | why now → hook question → product → traction → model → competition (logos) → team → contact |
| Front 2016 | pitch, Series B | 24 | 24 | build pairs | n/a | problem → solution → customers → one chart per metric, the title states it → team → vision → raise |
| Moz 2011 | pitch, growth | 36 | 24 | none | n/a | history → why now → problem → market (Venn) → metrics (chips) → round → risks → use of funds → vision |
| Alan Series A | pitch | 42 | ~25 | none | n/a | purpose → why raising → product → market → metrics → distribution → team → roadmap → vision |
| YC seed template | pitch, template | 10 | 27 | none | n/a | purpose → problem → solution → traction → insight → model → market → team → ask |
| Karpathy, Intro to LLMs | talk, general, 60 min | 45 | 17 | few | none | diagram opener → 3 parts with picture dividers → close reprises the summary diagram |
| Karpathy, State of GPT | talk, developers, 42 min | 45 | (screenshots) | reveals | none | pipeline map, repeated with the current stage marked → prompting tips → joke close |
| Holman, GitHub | talk, developers | 112 | 9 | ~25 builds | none | morphing title → 6 colour dividers, each part ends on a stamped recap → thanks |
| Kapterev, Death by PowerPoint | talk, presenters | 61 | ~8 | 1 | none | statistics hook → agenda → 4 parts with a dot tracker → checklist → applause |
| Netflix culture | reading deck | 128 | 30 | ~15 | none | agenda of 7 repeated 8 times as you-are-here → recap → conclusion |
| HubSpot Culture Code | reading deck | 58 | 6 | none | none | why/how/who map → numbered coloured dividers, a running header names the part |
| Node.js meetup (Amsler) | talk, developers | 24 | 32 | none | none | title + bullets throughout, ends on links |
| VanderPlas PyCon keynote | talk, 45 min | 79 | 8 | ~13 | none | image opener → about me → story → a recurring question with 4 numbered reasons → recap → same image → thanks |
| Bank of England MPR charts | report, markets | 59 | 6–20 | none | n/a | 3 sections + annex. Numbered chart titles that state the finding (40 of 41); sources in the notes (38 of 41) |
| Evans, AI eats the world | report/talk | 90 | 46 | chart builds | n/a | framing → 2 dividers → what next → recap. Grey + one red series, source on most charts |
| BOND AI trends | reading report | 340 | 121 | none | n/a | outline repeated with the current part marked; finding in each title bar; source on ~95% of charts |
| State of AI 2025 | reading report | 313 | 158 | none | n/a | summary on slide 9 → last year's predictions scored → 5 sections with a nav band → predictions |
| Daqo Q3 results | report, analysts | 16 | 57 | none | n/a | remarks as summary → facilities → charts → statements → definitions |
| UNAIDS epidemiology | report, presenters | 13 | 90 | none | n/a | numbers → trends → regional maps; a source line on every slide |
| GitLab Q2 earnings | report, analysts | 28 | 104 | none | n/a | highlights first → KPI tile grids → charts with one highlighted bar → outlook → questions → appendix |
| World Bank GEP | report, press | 14 | 13 | none | n/a | contents → one-paragraph summary → 10 slides of two chart panels, each with its own source |

## What the user's own decks show

These matter most, because they show how the user actually teaches:

- **Fast pace.** 小马过河 has 26 slides for a 37-minute lesson, about 1.4 minutes a slide. The 15-minute 孙中山 lesson has 21 slides, about 0.7 minutes a slide.
- **Few words.** Medians are 5–37 words, and the young-learner decks are almost all picture.
- **Practice is varied and comes in a clear order:**
  - cloze with a word bank;
  - putting sentences or events in order (three times across two decks);
  - unscrambling words into a sentence;
  - a passage whose blanks grow over four slides;
  - dictation with a timer;
  - matching words to pictures;
  - true/false with the correction in brackets.
- **Openers are guessing games:** picture clues for the title, or picture → idiom.
- **The close turns the moral to the learner's own life,** then sets a short homework.
- **Two slides of 小马过河 (定) still carry the 六要素 labels,** which the user has since ruled out for slides. They are not a pattern to copy.

## Findings, by area

### 1. Pace: lessons are planned at half the real slide count

- **The rule:** LESSON_RULES says "one slide per 2–4 minutes".
- **What every lesson source does:** about 1–1.7 minutes a slide.

| Source | Slides | Length | Minutes a slide |
|---|---|---|---|
| Own: 小马过河 | 26 | 37 min | 1.4 |
| Own: 孙中山 | 21 | 15 min | 0.7 |
| Oak (five lessons) | 31–43 | ~50–60 min | about 1.3–1.7 |
| 1ppt 课件 (第一课时) | 23–41 | 40 min | about 1–1.7 |
| CS50 | 148 | about 1.5–2 hours | about 0.6–0.8 |

- **Talks are faster still.** Talks with a known length ran at 0.6–1.3 minutes a slide; the designed keynote (VanderPlas) ran at about 0.6.
- **Talks, pitches and reports have no pace rule at all.**
- **The effect:** a 40-minute lesson is outlined as 10–20 slides when real ones have 25–40, so each slide ends up carrying more.

### 2. Word budgets depend on the audience, not the purpose

`DENSITY` (`src/core/kinds/kit.ts`) gives an adult deck 70 words a slide, whatever it's for. Medians by purpose:

| Kind of deck | Median words a slide |
|---|---|
| Designed talks (Holman, Kapterev, VanderPlas, HubSpot) | 6–9 |
| Plain talks | 30–32 |
| Pitches | 24–31 |
| Presented report chart packs (BoE, World Bank) | 6–20 |
| Reading reports (BOND, State of AI, GitLab) | 104–158 |

- **Lessons by age:** young learners 5–32 (own decks, 1ppt grades 2–3, Oak KS1); KS3/4 25–45; Oak Y6 English is the outlier at 69.
- **What's right today:** the young (25) and teen (45) budgets fit.
- **What's wrong today:** adult 70 is far too loose for talks and pitches, and too tight for a deck meant to be read.

### 3. Purpose rules versus the flow real decks follow

**Pitch.** Lectern's order is problem → solution → proof → market and why now → plan → ask. The 9 pitch decks show:
- 8 have a team slide, 7 a business model and 6 a competition slide. Lectern's order has none of these three.
- The usual order is purpose → problem → solution → market → product → business model → traction → competition → team → ask.
- Every deck that states an ask gives an amount plus what it buys (YC, Airbnb, Moz).

**Lesson.** LESSON_RULES matches Oak and the 课件 on the main points:
- open on a question or picture;
- questions before a passage;
- facts, then meaning;
- a check after each idea;
- practice from easy to hard;
- nothing given away.

What real lessons add:
- a **you-are-here** slide between parts (all 5 Oak lessons);
- a **model answer slide after every task** (all Oak lessons, and the empty-then-filled tables of 陶罐和铁罐);
- **judging a named person's claim, with a reason** (4 of 5 Oak lessons);
- the rule asks for "putting things in order", but **Lectern has no slide that does it**.

**Talk.** The rule (hook, a few ideas, an ending; one idea a slide) fits. What it misses:
- **Signposting:** 6 of 8 talks repeat a you-are-here before each part (a repeated agenda, a dot tracker, a pipeline map with the stage marked, a recurring question with numbered reasons).
- **A recap at the end of each part** (Holman, VanderPlas).
- **A bookend:** the opening image or diagram comes back at the close (Karpathy, VanderPlas, HubSpot).

**Report.** "Lead with the summary" fits 5 of 8 published decks. Charts are where the rule falls short:
- **Titles:** about 73% of ~194 chart slides use the title to state the finding (BoE 40 of 41). Lectern's rule only says to label charts with what they show.
- **Sources:** about 47% of chart slides carry a source on the slide, and 66% counting BoE's notes. Lectern's chart slide has no source line at all, though its table has one.

### 4. Slides people use that Lectern can't make

These are ranked by how many decks use them:

| Missing slide | Used in |
|---|---|
| **Match** pairs and **sort** into groups | 4 Oak lessons, 课件 小马过河 (characters by structure), own 生词 (words ↔ pictures) |
| **Put in order** | own decks ×3, Oak and 课件 retell orders; LESSON_RULES asks for it |
| **Task + model answer** (lettered parts, "you should…" scaffold, answer slide after) | all 5 Oak lessons, 陶罐和铁罐, own 孙中山 |
| **Judge a claim** (a named person says something; agree or disagree, and why) and **true/false with a reason** | Oak 26, 27, 28, 30 |
| **Repeated you-are-here and numbered dividers.** Lectern has the agenda "You are here" layout, but drafting never repeats it, and section slides carry no part number | 6 of 8 talks, all Oak lessons, BOND, State of AI, 巨人的花园 |
| **Passage spotlight** (the same passage, one sentence lit per click) and the **growing cloze** | 守株待兔 (9 slides), own 小马过河 (4 slides), Netflix statement reveals |
| **Table with cells revealed on click** (blank first, then filled) | 陶罐和铁罐 ×2, Oak French tick tables and sentence builder, Oak KS1 log |
| **Picture choices** in a question, or a picture-guess opener | Oak French and KS1, own 小马过河 opener, 守株待兔 idiom guessing, own 生词 |
| **KPI tiles** (more than 4 big numbers, footnoted) | GitLab ×7, Moz, Airbnb, UNAIDS |
| **Logo wall** (customers, investors, competitors on a 2×2) and **market-size circles** | Airbnb, Buffer, Alan, LinkedIn |
| **Audio clip** to listen and repeat (none found in the media kinds) | Oak French ×2 |
| **Chinese specifics:** characters sorted by structure, a 多音字 contrast, one 写字 tip per character | 守株待兔, 小马过河, 画杨桃 |

### 5. Layout variants missing from kinds Lectern already has

- **Chart:**
  - no source/footnote line;
  - no highlight of one bar or series with the rest grey (Evans, GitLab, Front);
  - no two-panel layout (World Bank 10 of 10).
- **Big numbers:** at most 4, with no footnote line.
- **Question:** text choices only. It needs picture choices and a "who said it" claim layout.
- **True or false:** no "because…" choice.
- **Fill in the blanks:** one passage, one slide. It needs a "grow the blanks" sequence and choices inside a bracket.
- **Table:** no reveal by cell or row.
- **Section:** no part number or progress ("2 of 4", dots).

### 6. Auto style

- **Pitch decks are not dark.** `suggestLook` gives pitches `midnight` (dark), yet 0 of 8 pitch PDFs have a dark main look. Measured by page brightness: the only dark pages are a mirror's advert and a few hook slides.
- **Talks are mixed:** 2 of 7 are mostly dark.
- **Reports:** only GitLab's earnings deck is dark, so `minimal` for reports fits.
- **Section dividers:**
  - Designed decks number their dividers or show progress (HubSpot numerals, Kapterev dots, Holman colour fields).
  - Auto style already knows each slide's place in the deck, so it could number section slides and turn agendas into you-are-here slides.
- **Charts:** one highlight colour on the point and grey for the rest is the common habit (Evans, GitLab, Front). Today the auto look has no such default.

### 7. The .pptx importers

Measured on 37 real .pptx files. Each item below can be rebuilt as a small synthetic fixture.

- **F1. Headings from template furniture.**
  - **What fails:** many decks are built on blank layouts (all of the user's lesson decks, 巨人的花园) or keep the real heading in a plain text box. The finished-deck import then names the slide after the first text in file order. That text is often:
    - a label repeated on every slide (a subject line on 32 of 33 slides of 画杨桃);
    - a section label (巨人的花园);
    - Oak's learning-cycle band;
    - a site URL on the last slide.
  - **The file order is also not the reading order:** on 24–34 slides of each Oak deck, and on 25 of 33 in 画杨桃.
  - **Fixture:** a blank-layout slide with three boxes. The first in file order is a small label repeated on every slide at the same spot; the second a large heading lower down; the third a URL text. **Expected:** the large heading is picked; the repeated label and the URL are skipped.
- **F2. A dialogue taken for a question.**
  - **What fails:** `findQuestion` turned a moral plus a two-line A:/B: dialogue on the user's own 小马过河 slide into a multiple-choice question. This was the only "question" it found in all 37 decks.
  - **Fixture:** a statement line, then "A: …!" and "B: …!" lines with no question mark. **Expected:** no question.
- **F3. Practice formats that are never found.** None of these is recognised:
  - true/false marks √ / × with a correction in brackets (own 颐和园);
  - fill-ins with （ ） or ___ and a word bank (画杨桃, own decks);
  - ①② used as footnotes or paragraph numbers (守株待兔, 小马过河), which must stay *not* a question.

  **Fixtures:**
  - three statements ending （√） / （×，correction）. **Expected:** a true/false slide;
  - a sentence with （　） plus a bank line. **Expected:** a fill-in;
  - a passage with ①…④ notes. **Expected:** no question.
- **F4. Alt text and chart text dropped.**
  - **What fails:** Oak's maths lesson keeps its algebra in pictures with alt text, 52,000 characters that the importer reads none of. BoE's chart alt text is lost too. Text inside native charts is lost: UNAIDS 5,400 characters, Daqo 1,400.
  - **Fixture:** a slide with only a picture whose description is "3x + 5x", and a slide with a native chart titled "Cases by year". **Expected:** both texts are in the slide's words, marked as a picture description or a chart.
- **F5. Outline import (`fileToOutline` → `pptxToOutline`), several gaps:**
  - It keeps hidden slides (CS50's 21, Oak's 1–2), where the finished import marks them.
  - It drops tables. Roadmap Yellow Tower loses about a third of its words, and Daqo, Oak French and UNAIDS lose text too.
  - It sorts slides by file name, not the presentation's order (no real deck here was reordered, so this is low risk).
  - It refuses files over 40 MB. That includes the user's own 45 MB 小马过河 课件, which the finished import reads fine.

  **Fixtures:**
  - a slide with show="0". **Expected:** left out or marked;
  - a slide with a 2×3 table. **Expected:** a Markdown table in the outline;
  - slide2.xml listed first in the presentation's slide list. **Expected:** it comes first;
  - the size cap tested with a lowered limit.

## Ranked changes

- **Sizes:** S is up to half a day, M is one to two days, L is more.
- **"Plugin":** the change belongs in `lectern/plugins/chinese`, and core stays general.
- **Lesson-only wording:** any wording that is only about classrooms stays behind the `lesson` purpose.

| # | Change | Evidence | Expected value | Size |
|---|---|---|---|---|
| 1 | **Lesson pace and splitting.** About 1–1.5 min a slide (about 1 for young learners). A task and its answer go on separate slides; one passage chunk per slide. | Own 小马过河 (1.4), 孙中山 (0.7), Oak (1.3–1.7), 课件 (1–1.7) | Drafts get the right number of small slides, so slides stop being walls. Every lesson draft benefits. | S |
| 2 | **"Put in order" slide.** Items shown shuffled; the right order on click. Uses: events, sentences, process steps. | Own decks ×3; Oak and 课件 retells; LESSON_RULES already asks for it | Closes a gap the drafting rules already rely on. Useful in workshops too. | M |
| 3 | **Match and Sort slide** (one kind, two layouts: pairs, or groups). Answers on click; picture items allowed. | Oak 26–29 (≈16 slides), 课件 小马过河, own 生词 | The most common check in good lessons that Lectern can't make. General: sorting ideas, matching terms. | M |
| 4 | **Word budget by purpose × audience.** Proposal: talk ~25, pitch ~35, report 40 (or the audience budget when density is "detailed"), lesson as now (25/45/60). | Talks 6–9 designed vs 30 plain; pitches 24–31; chart packs 6–20; reading reports 104–158 | Warnings and drafts stop accepting 70-word slides in talks and pitches. | S–M |
| 5 | **Pitch order rule.** Add team, business model and competition. The ask states the amount and what it buys. | Team 8/9, model 7/9, competition 6/9; ask with use of funds in YC, Airbnb, Moz | Pitch drafts match what investors expect. | S |
| 6 | **Task + model answer.** A task slide with lettered parts and an optional "a good answer…" checklist, paired with an answer slide or answer on click. | All 5 Oak lessons (3 tasks each), 陶罐和铁罐, own 孙中山 | Lessons and workshops get the practice → feedback loop real decks use. | M |
| 7 | **Judge a claim, and true/false with a reason.** A question layout with a named speaker and claim (agree or disagree, and why); true/false gets optional "because…" choices. | Oak 26, 27, 28, 30 | Deeper checks, matching the "why" questions the user asks for. Small change to existing kinds. | S–M |
| 8 | **Signposting.** Drafting repeats the agenda as you-are-here before each part of longer decks. Auto style numbers section slides ("2 of 4") and can show progress dots. | 6/8 talks, 5/5 Oak, BOND, State of AI, 巨人的花园 | Every purpose gains structure at almost no cost. | S |
| 9 | **.pptx import fixes F1–F5:** better headings, fewer false questions, √/× and （ ） found, alt and chart text kept, outline drops hidden slides, keeps tables, uses the presentation order, no 40 MB cap. | 37 files measured; user's own decks hit F1, F2, F3 and F5 | The user's own 课件 import cleanly; quiz-on-phones finds real questions. | M (S each for F4, F5) |
| 10 | **Charts for reports:** an optional source/footnote line on chart and big-number slides; report and pitch rules say "the title states the finding". | 73% finding titles; 47–66% sources; Lectern charts have no source | Report decks look like published ones; the user's own report decks gain the most. | S |
| 11 | **Talk rules:** pace about 0.5–1 min a slide, a recap at the end of each part, the opening picture or diagram reprised at the close, the slide type changed every 1–3 slides. | Holman, VanderPlas, Karpathy, HubSpot | Talk drafts get rhythm and structure. | S |
| 12 | **Auto style:** pitches default to a light look; charts highlight one series with the rest grey when a takeaway is set. | 0/8 pitch PDFs dark; Evans, GitLab, Front | Better first look, no user effort. | S |
| 13 | **Picture choices in questions,** plus a picture-guess opener (answer on click). | Oak French and KS1, own 小马过河 and 生词, 守株待兔 | Young-learner and language lessons need fewer words. | S–M |
| 14 | **Passage spotlight and growing cloze.** Core: highlight one sentence per click on a text slide. Plugin: the reading slide fades more words on each repeat. | 守株待兔 (9 slides), own 小马过河 (4 slides), Netflix | Reading lessons without copying slides by hand. | M |
| 15 | **Table cells revealed on click,** or blank cells to fill. | 陶罐和铁罐 ×2, Oak French, Oak KS1 | Comparison tables built live in class or in a meeting. | M |
| 16 | **KPI tiles:** big numbers up to 6, with a footnote. | GitLab ×7, Moz, Airbnb, UNAIDS | Reports and pitches. | S |
| 17 | **Logo wall** (optionally on a 2×2) and **market-size circles.** | Airbnb, Buffer, Alan, LinkedIn | Pitch staples. | M |
| 18 | **Chinese plugin:** characters sorted by structure (can reuse #3), a 多音字 layout, one 写字 tip per character. | 守株待兔, 小马过河, 画杨桃 | Closer to how 课件 teach 生字. | M (plugin) |
| 19 | **Audio clip slide** for listen-and-repeat. | Oak French ×2 | Language lessons. | S–M |

**Not recommended for now** (large, and seen in only a few decks): a free-form diagram editor, stamp and overlay graphics, image collages over 4, and chart uncertainty ranges or target lines.
