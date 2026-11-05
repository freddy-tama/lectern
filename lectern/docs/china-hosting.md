# Hosting Lectern for mainland China

Researched on 4 November 2026. Platform limits change, so check the linked pages before relying on a number.

## The plan in brief

- **Host:** [Tencent EdgeOne Makers](https://pages.edgeone.ai) (called EdgeOne Pages until this year). Use the free plan with the acceleration region **Global (excluding Chinese mainland)** and your own domain. This needs no ICP filing (备案). Visitors in the mainland reach the site through Tencent's nodes just outside it, instead of hitting a blocked `*.vercel.app`.
- **Cost:** the hosting is free. A domain costs about US$10 a year, and it's the one thing you have to pay for. EdgeOne's own addresses only work from the mainland as 3-hour preview links.
- **Claude Code:** Claude Code can build and deploy from this PC with EdgeOne's CLI and an API token. EdgeOne also offers an MCP server and deploys on every push to GitHub.
- **AI features:** Lectern keeps Claude for now; see [The AI question](#the-ai-question). The AI providers don't serve mainland China, Hong Kong or Macau, and hosting can't change that, so this is to be revisited.
- **Time limit:** Cloud Functions stop at 120 s, streaming or not. EdgeOne's Agents functions ran a 330 s stream and a 200 s wait to the end in a test on 4 November, so the long AI routes belong there. See [The 120-second limit](#the-120-second-limit).

Why leave Vercel: Vercel's own guide says it has no mainland nodes and that `.vercel.app` addresses can be blocked or throttled there ([Vercel KB, updated 2026-09-11](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)).

## What fails in China, and what this branch changes

| Part of Lectern | In mainland China | Status |
|---|---|---|
| The site on `*.vercel.app` | Blocked or throttled | Moves to EdgeOne with your own domain |
| AI drafting, notes, activities, the deck assistant (Claude); AI pictures (OpenAI, Gemini) | The providers refuse these regions. See below. | Claude kept for now (decision of 4 November) |
| Speech engine (the 21.6 MB WebAssembly file) | transformers.js fetched it from jsDelivr, which is intermittent in China | **Fixed:** production builds load the copy the build already puts in `/assets/` |
| Speech models (Whisper) | huggingface.co is blocked. hf-mirror.com no longer lets other sites read its files. | **Fixed:** the worker tries Hugging Face, then `/hf/` on Lectern's own address, which an EdgeOne edge function forwards to Hugging Face |
| Share to phones: introductions (PeerJS's public server) | Untested | Test it. If it fails, run your own PeerServer (`VITE_PEER_HOST`) on a small Hong Kong server, which isn't free |
| Share to phones: STUN | Google's is blocked | The defaults already include Xiaomi's `stun.miwifi.com`, the best-reported one in China |
| Share to phones: relay (TURN) | PeerJS's free relay and Cloudflare's are outside China, so they're slow | Fine to start with. Your own coturn server later, if phones fail on school Wi-Fi |
| Accounts (Supabase) | Thin evidence. It probably works, sometimes slowly. | Accounts are off today. Test sign-in from the mainland before turning them on. |
| Video slides: YouTube, Vimeo, Loom | Blocked | Follow-up: Bilibili videos |
| Web slides: Google Docs, Figma, Canva, Miro | Mostly blocked | Depends on what the presenter links |
| Picture search (Openverse, Wikimedia, Pexels) | The server fetches pictures from Singapore, so the browser never contacts those sites | Works |
| Fonts | Bundled with the app | Works |

## EdgeOne free plan against Vercel

| | Vercel (now) | EdgeOne Makers, free plan |
|---|---|---|
| Longest function run | 300 s | **120 s** for Cloud Functions, and up to 1,800 s for Agents functions (tested to 330 s) |
| Largest request | 4.5 MB | 6 MB. Tested: 5.9 MB passes on both kinds; 8 MB fails on Agents functions. |
| Largest file | — | 25 MB. Lectern's largest is the 21.6 MB speech engine. |
| Function calls | — | 1 million a month for Cloud Functions, 3 million for Edge Functions |
| Traffic | — | Listed as unlimited while the free plan lasts |
| Where functions run | US | **Singapore**, set in `edgeone.json`. Not Hong Kong or the mainland: the AI providers refuse both. Tested: both kinds of function reach the internet from Singapore, and Anthropic accepts them. |
| Default address | Works | Blocked from the mainland except 3-hour preview links |

Sources: [limits and quotas](https://pages.edgeone.ai/document/limits-and-quotas), [Cloud Functions](https://pages.edgeone.ai/document/cloud-functions), [edgeone.json](https://pages.edgeone.ai/document/edgeone-json), [domains](https://pages.edgeone.ai/document/domain-overview).

Other hosts were checked and ruled out:

- **Alibaba ESA** runs only small JavaScript functions (a 4 MB package, 4 outside requests each), so Lectern's routes don't fit.
- **Tencent CloudBase** has long functions (900 s), but its free allowance is about ¥3 a month for six months. Production use there needs an ICP-filed domain.
- **Cloudflare and Netlify** have the same reachability problem as Vercel.

## What this branch adds

- [`edgeone.json`](../edgeone.json): the build (`npm install` rather than `npm ci`, because the CLI runs it on this PC and `npm ci` deletes `node_modules` first), the single-page fallback, the same cache headers as `vercel.json`, functions in Singapore, 120 s for Cloud Functions, and 300 s for Agents functions (`agents.timeout`). An Agents session is recycled after 60 s idle (`agents.idleTimeout`), so idle time doesn't eat the free memory allowance.
- [`server/edgeone.ts`](../server/edgeone.ts): hands each request to its route in `api/`, unchanged. It copies EdgeOne's settings into `process.env`, where the routes read them, and rebuilds the `Request` for Agents functions, which receive the body already parsed.
- One small file per route. The five short routes are in `cloud-functions/api/`: `account`, `deck-questions`, `ice`, `picture-fetch` and `picture-search`. The seven routes Vercel gives more than 120 s are in `agents/api/`: `deck-assistant`, `draft-deck`, `lecture-notes`, `make-code`, `picture-generate`, `revise-slide` and `teleprompter`. A test checks that this split follows `vercel.json`. Vercel ignores these folders.
- [`src/features/account/session.ts`](../src/features/account/session.ts): every AI request and status check sends a new `makers-conversation-id`, which Agents functions require. Vercel ignores it.
- [`edge-functions/hf/[[default]].js`](../edge-functions/hf/%5B%5Bdefault%5D%5D.js): forwards the Whisper model files, and only those, to Hugging Face.
- [`src/core/transcribe/model-hosts.ts`](../src/core/transcribe/model-hosts.ts): picks the first model host that answers, or the one a model was cached from so it still opens offline. Set `VITE_MODEL_HOSTS=/hf/,https://huggingface.co/` to try the forward first.
- Tests in `tests/edgeone.test.ts` and `tests/model-hosts.test.ts`. Every entry was also bundled with esbuild, the bundler EdgeOne's CLI uses, and answered when called the way EdgeOne calls it.

Nothing in this branch changes the Vercel deployment. The speech engine now loads from Lectern's own `/assets/` there too, which removes a third-party request.

## The 120-second limit

EdgeOne's Cloud Functions stop after 120 s, where Vercel allows 300 s. Most of Lectern's AI calls are short: drafting goes outline first, then slides in batches of up to eight, and slide fixes, quiz questions and each deck-assistant step are quick. The ones that can run longer are activities and drawings (`api/make-code.ts`, up to 64,000 tokens at high effort), AI pictures, class notes from long recordings, and teleprompter notes for ten slides.

### What a test deploy showed (4 November 2026)

A throwaway project went up through an anonymous deploy (no account needed) and was checked from this PC:

| Check | Cloud Function | Agents function |
|---|---|---|
| Where it reaches the internet from | Singapore (`ap-singapore`), Node 20.19 | Singapore, Node 24 |
| Anthropic, called with a made-up key | 401, so the region is accepted | 401, so the region is accepted |
| A stream of 180 s or 330 s | **Cut at 120 s** | Ran the full 330 s |
| Waiting 150 s or 200 s, then answering once | **504 at 122 s** | Answered after 200 s |
| Stream timing | Each piece arrived as it was sent | Each piece arrived as it was sent |
| Uploads | 4.4 MB and 5.9 MB pass | 4.4 MB and 5.9 MB pass; 8 MB fails |
| The Anthropic library | Loads | Loads |
| A file at `agents/api/nested.js` | — | Answers at `/api/nested` |

The `/hf/` forward (an Edge Function) passed `config.json` and a full 53.7 MB model file intact. Other paths got 404.

### What that means for Lectern (now built)

- **The long AI routes run as Agents functions.** These are drafting, slide revisions, teleprompter notes, class notes, activities and drawings, AI pictures and the deck assistant. A file per route in `agents/api/` keeps the `/api/...` addresses, and `agents.timeout` is 300 s, the same as Vercel.
- **The short routes run as Cloud Functions:** `ice`, `account`, picture search and picture fetch, and quiz questions.
- **Agents functions hand over requests differently.** The body arrives already parsed, and the headers come as a plain object, so `server/edgeone.ts` rebuilds the `Request` the routes expect.
- **Agents functions refuse a request without a `makers-conversation-id` header** (6–36 characters). The browser now sends a new one with each AI request and status check. Vercel ignores the extra header.
- **The free allowance for Agents functions** includes 200,000 runs and 100,000 GB-s of memory time a month. Long AI calls use the memory time fastest. EdgeOne doesn't say how much memory each run gets, so watch the usage page after the move.

### Lectern itself on EdgeOne (5 November 2026)

A throwaway copy of Lectern, with no keys, went up through an anonymous deploy and was checked from this PC and in a browser:

- **The site:** the front page, the app's own addresses (through the single-page fallback), `sw.js` and the manifest load with the headers from `edgeone.json`. The 21.6 MB speech engine is served as `application/wasm`, cached for good.
- **The routes:** all 5 Cloud Functions and all 7 Agents functions answer. Without keys, each AI route says it isn't set up, and an AI request is refused with that message (503). An Agents request without `makers-conversation-id` gets EdgeOne's 400, as expected.
- **The app:** the sample talk opens in the studio with all 19 slides. The service worker takes over, the AI status checks succeed, and the console shows no errors.
- **Transcription:** it ran in the browser on the live copy, model download included.
- **Picture search:**
  - Wikimedia Commons refused the Singapore functions (403) until Lectern's user agent said how to reach its operator, as Wikimedia's rules ask of requests from servers. With the project's address added, search returns results and the picture downloads.
  - Openverse refused EdgeOne (403), but it was failing for everyone at the time (500 from this PC). Check it again; `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET` may also help. Until then, picture search runs on Commons, and on Pexels when it has a key.
- **One difference from Vercel:** an unknown address under `/api/` gets the app's page rather than a 404, because EdgeOne's single-page fallback catches it. Lectern checks for JSON before trusting an answer, so nothing breaks.

Splitting the work into smaller calls is the fallback if Agents functions ever stop being free. The browser runs short calls in order and asks again only for a piece that failed. Prompt caching keeps the shared start of each call cheap to resend: a tenth of the input price. Picking up the same answer halfway through isn't possible: Claude Opus 5.5 and Sonnet 5.5 refuse an assistant prefill, and the routes ask for one complete JSON answer.

## Moving, step by step

You do the steps that involve accounts, money or secret keys. Claude Code does the rest.

1. **You: create an account** at [edgeone.ai](https://edgeone.ai). The international site is the simpler one for a project without ICP filing. The China site uses a Tencent Cloud account, which will probably ask for real-name verification.
2. **You: create an API token** in the Makers console. Save it on this PC as a user environment variable named `EDGEONE_API_TOKEN`, so it never has to be pasted into a chat.
3. **Claude Code: first deploy, as a preview.** Run this from the `lectern` folder. It builds on this PC, then uploads the site and the three function folders. `--area overseas` is the region without ICP filing:
   ```bash
   npx edgeone makers deploy -n lectern -t "$EDGEONE_API_TOKEN" -e preview --site global --area overseas
   ```
4. **Claude Code: check the AI with real keys.** Lectern itself was checked on EdgeOne without keys on 5 November (see above). What's left needs the keys you enter in step 7:
   - A real AI draft, a long activity and a deck-assistant run all finish.
   - Picture search through Openverse works.
5. **You: test from the mainland.** Use a phone on mobile data with no VPN, and the 3-hour preview link. Open the site, present a sample deck, join with a second phone through Share to phones, and transcribe a short recording.
6. **You: add the domain.** Buy one from any registrar. In the Makers console, add it with the region **Global (excluding Chinese mainland)**, then add the CNAME record it shows you at the registrar.
7. **You: enter the settings** in the Makers console, under the same names as on Vercel (see the README's table). Set `VITE_PUBLIC_ORIGIN` to the new address. If accounts are on, add the new address to Supabase's redirect URLs.
8. **Claude Code: deploy to production**, using the same command with `-e production`. Keep Vercel running until the new site has proved itself.

Decks live in each visitor's browser, under the site's address. People moving from the Vercel address to the new one take their decks across with **Preferences ▸ Your data ▸ Download a backup**, then **Restore from a backup** on the new site.

## Connecting Claude Code

- **CLI (recommended).** The command above is all Claude Code needs. `npx edgeone makers env ls` lists the settings and `env set` changes one. The CLI is the `edgeone` package on npm (1.6.47 when checked) and runs without a global install.
- **MCP server.** Add it to Claude Code from PowerShell. The token comes from the environment variable, so it doesn't appear in the command:
  ```powershell
  claude mcp add edgeone-makers -e EDGEONE_PAGES_API_TOKEN=$env:EDGEONE_API_TOKEN -- npx -y @edgeone/makers-mcp@latest
  ```
  The package was at version 0.0.4 when checked, so it's early. The CLI covers the same ground. Tencent also publishes Claude Code skills for Makers at [TencentEdgeOne/edgeone-makers-tools](https://github.com/TencentEdgeOne/edgeone-makers-tools).
- **GitHub.** In the console, import `freddy-tama/lectern` with `lectern` as the root folder, and every push to `main` deploys. One catch: EdgeOne's build machines offer Node 22.11 at most, and Vite 8 asks for 22.12 or later. If the cloud build fails for that reason, keep deploying from this PC with the CLI.

## The AI question

**Decision, 4 November 2026:** Lectern keeps Claude as its AI provider for now, with no region check. This is to be revisited.

From 12 November 2026, Anthropic's [supported countries](https://www.anthropic.com/supported-countries) page covers both the API and Claude.ai, and it excludes "Use by persons while physically located in an unsupported region". Mainland China, Hong Kong and Macau are all unsupported. OpenAI and Google list the same three regions as unsupported for their APIs. So a server in Singapore can technically call Claude, but people in China may not use Claude through Lectern.

The options:

- **A. AI off for China.** Don't set the AI keys on the China site. Everything else works: decks, presenting, the teleprompter, Share to phones, the quiz, transcription on the device, notes and study.
- **B. A model provider that serves China,** such as DeepSeek, Qwen, Kimi or GLM, behind a provider setting. Several offer Anthropic-compatible APIs. Lectern relies on structured JSON output, strict tools, prompt caching and slide pictures, so each provider needs checking and some fallbacks. This is a project of its own.
- **C. One site for everyone.** Claude stays on for visitors outside mainland China, Hong Kong and Macau. Visitors inside see that AI isn't available in their region, until B is added. EdgeOne passes each visitor's location to functions (`context.geo`), but its exact shape still needs checking.

C keeps a single address and one set of data for everyone, and it gives B somewhere to plug in later.
