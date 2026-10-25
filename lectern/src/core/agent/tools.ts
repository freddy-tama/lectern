// The deck assistant's tools, as Claude sees them. The server sends these definitions with every model call
// (api/deck-assistant.ts); the browser runs the calls against its working copy of the deck
// (src/features/studio/agent), where the layout engine, the slide pictures and the picture library live.
// Nothing here imports anything, so the Vercel function can load it as it is.

/** Model calls in one request of the presenter's that may use tools. The call after the last has to answer. */
export const MAX_STEPS = 14;
/** A review looks at every slide, fixes, and looks again, so it gets more room. */
export const MAX_REVIEW_STEPS = 24;
/** The server refuses to go past this many calls for one request, whatever the browser asks. */
export const HARD_STEPS = 26;

export interface ToolSpec {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  /** Shown on the step card while the call streams in. */
  running: string;
}

const nullable = (schema: Record<string, unknown>, description: string) => ({ anyOf: [schema, { type: 'null' }], description });
const REASON = { type: 'string', description: 'One short line for the presenter on why, shown with the proposal.' };
const SLIDE_REF = { type: 'string', description: 'The slide id from the outline, like "s_3f9a1c2b7d4e". A slide number works too, but numbers shift as slides are added, moved or deleted.' };
const SLIDE_LIST = { type: 'array', items: SLIDE_REF, description: 'Slide ids (or numbers).' };
const AFTER = { type: 'string', description: 'The id of the slide it goes after, or "start" for the very beginning.' };

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'deck_outline',
    description: 'The deck as it stands with your changes so far: every slide with its id, type, layout, heading, minutes, warnings (text that overflows, too many words, empty picture frames) and whether you changed it, plus the total time.',
    properties: {},
    running: 'Reading the outline',
  },
  {
    name: 'read_slides',
    description: 'The full content and key notes of slides, the fields and layouts their slide type has, and every box on the slide: its id, what it shows, and where it sits on the 1920 × 1080 canvas. Read a slide before you change it. Read several at once.',
    properties: { slides: { ...SLIDE_LIST, description: 'Up to 12 slide ids (or numbers).' } },
    running: 'Reading slides',
  },
  {
    name: 'view_slides',
    description: 'Pictures of slides exactly as the audience will see them, with your changes so far. Text that overflows has a red dashed outline and empty picture frames a dashed frame. Look before you judge a design, and look again after changing a layout to check it worked. whole_deck gives numbered thumbnails of every slide on a few sheets; otherwise name up to 6 slides to see them large.',
    properties: { slides: { ...SLIDE_LIST, description: 'Up to 6 slides to see large. Leave empty with whole_deck.' }, whole_deck: { type: 'boolean', description: 'True for thumbnails of the whole deck.' } },
    running: 'Looking at slides',
  },
  {
    name: 'find_text',
    description: 'Finds slides whose text or key notes contain some words (not case-sensitive). Returns where each match sits.',
    properties: { query: { type: 'string', description: 'The words to look for, as they would appear in the deck.' } },
    running: 'Searching the deck',
  },
  {
    name: 'edit_slide',
    description: 'Proposes new values for a slide’s fields: wording, list items, and pictures. A picture field takes "" or a picture reference you got from the deck, draw_picture or find_pictures ("asset:…" or "found:…"). Fields left out stay as they are.',
    properties: {
      slide: SLIDE_REF,
      content_json: { type: 'string', description: 'A JSON object of the slide type’s fields and their new values, as read_slides shows them.' },
      reason: REASON,
    },
    running: 'Editing a slide',
  },
  {
    name: 'edit_notes',
    description: 'Proposes changes to a slide’s key notes: the presenter’s script, key points, cues, check question and planned minutes. Pass null for anything that stays as it is.',
    properties: {
      slide: SLIDE_REF,
      script: nullable({ type: 'string' }, 'What the presenter says, as natural speech. Blank lines between beats.'),
      keyPoints: nullable({ type: 'array', items: { type: 'string' } }, 'The points to keep, 2-4.'),
      cues: nullable({ type: 'array', items: { type: 'string' } }, 'Short delivery reminders, like "Pause".'),
      checkQuestion: nullable({ type: 'string' }, 'A question for this slide, or "" for none.'),
      checkAnswer: nullable({ type: 'string' }, 'The answer to the check question.'),
      minutes: nullable({ type: 'number' }, 'Planned minutes on this slide, in halves: 0.5, 1, 1.5…'),
      reason: REASON,
    },
    running: 'Editing key notes',
  },
  {
    name: 'add_slide',
    description: 'Proposes a new slide of a given type and layout, with its content and key notes.',
    properties: {
      after: AFTER,
      kind: { type: 'string', description: 'The slide type, like "bullets" or "summary".' },
      layout: nullable({ type: 'string' }, 'One of the slide type’s layouts, or null for its first.'),
      content_json: { type: 'string', description: 'A JSON object of the slide type’s fields and values. Fields left out start empty.' },
      script: { type: 'string', description: 'What the presenter says on this slide.' },
      keyPoints: { type: 'array', items: { type: 'string' }, description: 'The points to keep, 2-4, or none for title and section slides.' },
      minutes: { type: 'number', description: 'Planned minutes for the slide.' },
      reason: REASON,
    },
    running: 'Adding a slide',
  },
  {
    name: 'move_slide',
    description: 'Proposes moving a slide to another place in the deck.',
    properties: { slide: SLIDE_REF, after: AFTER, reason: REASON },
    running: 'Moving a slide',
  },
  {
    name: 'delete_slide',
    description: 'Proposes deleting a slide. The presenter must tick each deletion before it happens, so delete only when the request calls for it.',
    properties: { slide: SLIDE_REF, reason: REASON },
    running: 'Deleting a slide',
  },
  {
    name: 'set_layout',
    description: 'Proposes another layout for a slide (picture left or right, two columns, a big number…), or another slide type for the same content. Boxes moved by hand go back into place. Look at the slide afterwards.',
    properties: {
      slide: SLIDE_REF,
      layout: nullable({ type: 'string' }, 'A layout id the slide type offers, as read_slides lists them, or null to keep it.'),
      kind: nullable({ type: 'string' }, 'Another slide type to turn the slide into, or null to keep its type. Content moves across where the fields match.'),
      reason: REASON,
    },
    running: 'Changing a layout',
  },
  {
    name: 'arrange',
    description: 'Proposes moving, resizing or removing boxes on one slide, for a better composition: give each box id (from read_slides) a new x, y, w and h on the 1920 × 1080 canvas. Text refits itself to a new size. Works on the slide’s own boxes, on its theme decorations ("deco-…") and on elements you added ("el-…"). Look at the slide afterwards.',
    properties: {
      slide: SLIDE_REF,
      moves_json: { type: 'string', description: 'A JSON array like [{"box":"title","x":128,"y":120,"w":900,"h":200}]. Leave out x, y, w or h to keep them. {"box":"deco-a","hide":true} leaves a box off this slide; {"box":"title","reset":true} puts it back where the layout places it.' },
      reason: REASON,
    },
    running: 'Arranging a slide',
  },
  {
    name: 'add_elements',
    description: 'Proposes adding free elements to a slide, over or under its layout: pictures, drawings, text boxes, shapes and decorations. Use them for decoration, a picture on a slide type without a picture frame, a callout, a label or a highlight. Returns the new element ids.',
    properties: {
      slide: SLIDE_REF,
      elements_json: {
        type: 'string',
        description: 'A JSON array of elements. Every element has "type" and x, y, w, h on the 1920 × 1080 canvas, and optionally "layer":"back" (under the slide’s content), "opacity". Types: {"type":"picture","picture":"asset:… or found:…","fit":"contain"|"cover","radius":24,"alt":"…"}; {"type":"drawing","svg":"<svg viewBox=…>…</svg>","alt":"…"} (you write the SVG); {"type":"text","text":"…","size":48,"color":"accent","font":"display"|"body","weight":700,"align":"center","fill":"surface"}; {"type":"shape","shape":"rect"|"ellipse"|"line","fill":"accent2","stroke":"accent","strokeWidth":4,"radius":24}; {"type":"decor","motif":"waves","colors":["accent","accent2"]}. Colours are look colour names (accent, accent2, ink, muted, surface, bg, line, onAccent, good) or "#rrggbb".',
      },
      reason: REASON,
    },
    running: 'Adding to a slide',
  },
  {
    name: 'change_element',
    description: 'Proposes changing or removing one element you or the presenter added to a slide (an "el-…" box from read_slides).',
    properties: {
      slide: SLIDE_REF,
      element: { type: 'string', description: 'The element’s box id, like "el-e_1a2b3c".' },
      changes_json: { type: 'string', description: 'A JSON object of the fields to change, as for add_elements (for example {"text":"…","color":"ink"} or {"x":1400,"y":80}). "{}" when removing.' },
      remove: { type: 'boolean', description: 'True to take the element off the slide.' },
      reason: REASON,
    },
    running: 'Changing an element',
  },
  {
    name: 'draw_picture',
    description: 'Saves an SVG drawing you write (an illustration, diagram, icon or decoration) as a picture of this deck, and shows it back to you. Returns its reference, which edit_slide puts in a picture field and add_elements in a picture element.',
    properties: {
      svg: { type: 'string', description: 'One complete <svg> with a viewBox, in the deck’s colours. No scripts, no external links, no embedded fonts. Keep words in it few and large.' },
      title: { type: 'string', description: 'What it shows, in a few words. Used as its alt text and its name in the deck’s pictures.' },
    },
    running: 'Drawing a picture',
  },
  {
    name: 'find_pictures',
    description: 'Searches free photo libraries (Openverse, Wikimedia Commons and others this server has) and shows you up to 8 candidates as numbered thumbnails with their licences. Put the one you choose in a picture field or a picture element by its "found:…" reference; it is downloaded and credited then.',
    properties: {
      query: { type: 'string', description: 'What the picture should show, in a few plain words, usually in English.' },
      shape: { type: 'string', enum: ['wide', 'square', 'tall'], description: 'The shape of the frame it goes in.' },
    },
    running: 'Searching for pictures',
  },
];

export const toolSpec = (name: string) => TOOL_SPECS.find((t) => t.name === name);

/** The tools as the Messages API takes them: strict schemas, input streamed as it is written. */
export function apiTools() {
  return TOOL_SPECS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object' as const, properties: t.properties, required: Object.keys(t.properties), additionalProperties: false },
    strict: true,
    eager_input_streaming: true,
  }));
}
