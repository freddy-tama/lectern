# Writing a mod

A mod is a folder in `plugins/` with an `index.ts` whose default export is a `LecternPlugin` (see [`src/core/plugins/api.ts`](../src/core/plugins/api.ts)). The core uses the same contracts for its own features, so a mod's slide types, exports and fields work everywhere a built-in one does: in the studio, presenter view, teleprompter, study mode, the handout, PowerPoint export and AI drafting.

```ts
// plugins/music/index.ts
import type { LecternPlugin } from '../../src/core/plugins/api';
import { staff } from './kinds';

const music: LecternPlugin = {
  id: 'music',                       // folder name; lowercase letters, digits and dashes
  name: 'Music lessons',
  version: '1.0.0',
  description: 'A staff slide that reveals notes one at a time.',
  kinds: [staff],
};

export default music;
```

Run it with `npx cross-env LECTERN_PLUGINS=music npm run dev`. Add more mods with commas.

## What a mod can add

| Field | What it adds | Where it shows |
|---|---|---|
| `kinds` | Slide types. Ids must start with the mod id, for example `music.staff`. | Add slide menu, Change type, AI drafting, every view and export |
| `themes` | Looks: colours, web and PowerPoint fonts, decoration, corner radius, size bias | The Look menu and the New deck dialog |
| `deckSources` | A way to start a deck: a React panel that hands back a `DeckDraft` | A tab in the New deck dialog |
| `exporters` | `run(deck, helpers)` returns a file. `helpers.lesson` carries the lesson's title, date, time, minutes and course. | The studio's Export menu |
| `toggles` | A presenter key that flips a flag your layouts read from `ctx.flags` | Present and presenter view, the help overlay |
| `notesFields` | Extra key-note fields, saved at `slide.notes.extra[modId][key]` | Under the key notes in the studio |
| `deckFields` | Deck-level details, saved at `deck.extra[modId][key]` | The studio's Details dialog |
| `draftingHints` | A paragraph added to AI drafting requests | The AI system prompt |

Fields (`notesFields`, `deckFields`) are strings. Give `options` for a select, `rows: 1` for a single line, or more rows for a text area.

## Slide types

A slide type describes its fields and lays itself out. It never touches the DOM or React, which is what lets one layout drive both the browser and PowerPoint.

```ts
import { type Box } from '../../src/core/engine/boxes';
import { M, read, slideTitle, text } from '../../src/core/kinds/kit';
import type { SlideKindDefinition } from '../../src/core/kinds/types';

export const staff: SlideKindDefinition<Record<string, unknown>> = {
  kind: 'music.staff',
  label: 'Staff',
  description: 'A line of notes to sing or play, revealed one at a time.',
  icon: 'list',                              // a name from src/ui/KindIcon.tsx
  group: 'Explain',                          // Open, Explain, Data, Visual, Engage or Close
  fields: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'notes', label: 'Notes', type: 'list', itemLabel: 'Note', max: 8 },
  ],
  create: () => ({ title: 'Sing it back', notes: ['C', 'E', 'G'] }),
  heading: (c) => read.str(c, 'title') || 'Staff',
  text: (c) => [read.str(c, 'title'), ...read.list(c, 'notes')],   // search, word counts, key-note drafts
  layout(c, ctx) {
    const { box, bottom } = slideTitle(ctx, read.str(c, 'title'));
    const boxes: Box[] = [box];
    read.list(c, 'notes').forEach((n, i) => {
      boxes.push(text(ctx, {
        id: `n${i}`, text: n, x: M.x + i * 200, y: bottom, w: 180, h: 200,
        role: 'display', max: 120, min: 60, align: 'center',
        step: i + 1,              // appears on click i + 1
        bind: `notes.${i}`,       // clicking it in the studio focuses that field
      }));
    });
    return { boxes };
  },
};
```

What you get from the layout kit ([`src/core/kinds/kit.ts`](../src/core/kinds/kit.ts)):

- **The canvas.** It's 1920 × 1080. `M` is the safe area inside the margins.
- **`text()`** fits text between a `max` and `min` size, scaled for the audience. Pass `hug` to shrink the box to the text. If the text can't fit, it adds a warning that the studio shows.
- **`list()`** draws points that share one size, with dot, number or check markers and optional reveal steps.
- **`slideTitle()`, `card()`, `shape()`, `imageSrc()`** and the **`read`** helpers cover the rest.
- **`ctx.audience`** is `young`, `teen` or `adult`. **`ctx.mode`** is `edit` or `show`; only draw placeholders in `edit`. **`ctx.flags`** holds your presenter toggles, already set to their defaults.

The decoration, footer and slide number are added for you. Return `frame: 'bare'` to leave them off.

## Rules that keep decks portable

- **Prefix every kind id with your mod id.** If the mod is missing, those slides show a short note and keep their content, so turning the mod back on restores them.
- **Store mod data in `extra`.** Use `notes.extra[modId]` and `deck.extra[modId]`. Don't add new top-level fields to slides or decks.
- **Keep slide text audience-facing.** Slide text is what the room sees. Presenter-only terms belong in key notes, notes fields or exports.
- **Write a test.** Lay out each kind with `create()` for all three audiences and check that `layout.warnings` is empty. [`tests/mods.test.ts`](../tests/mods.test.ts) does this for the included mods.
