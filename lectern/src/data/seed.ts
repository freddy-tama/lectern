// Sample content shown on first launch: three courses, a lesson schedule that
// lines up with today's date, and four ready-to-teach lesson decks and two general
// decks (a talk and a report) that belong to no course.

import type { Audience, Deck, DeckPurpose, KeyNotes, Slide } from '../core/deck/types';
import type { Course, CourseColor, CourseMeeting, Lesson, Note } from './db';
import { buildSeedNotes } from './seed-notes';

// ─── Dates ────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/** Local-time ISO date, YYYY-MM-DD. */
function isoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Monday of the week that contains d (local time). */
function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

// ─── Builders ─────────────────────────────────────────────────────────

type Content = Record<string, unknown>;

function slide(id: string, kind: string, content: Content, notes: KeyNotes, variant?: string): Slide {
  return { id, kind, content, notes, ...(variant ? { variant } : {}) };
}

interface NoteOptions {
  min: number;
  points?: string[];
  cues?: string[];
  check?: [question: string, answer: string];
}

function notes(script: string, o: NoteOptions): KeyNotes {
  return {
    script,
    keyPoints: o.points ?? [],
    cues: o.cues ?? [],
    check: o.check ? { question: o.check[0], answer: o.check[1] } : null,
    minutes: o.min,
    links: [],
  };
}

function sumMinutes(slides: Slide[]): number {
  return slides.reduce((sum, s) => sum + s.notes.minutes, 0);
}

interface DeckInput {
  id: string;
  title: string;
  themeId: string;
  audience: Audience;
  purpose?: DeckPurpose;
  lessonId?: string;
  slides: Slide[];
  createdAt: number;
  updatedAt: number;
}

function deck(d: DeckInput): Deck {
  return { ...d, minutes: Math.round(sumMinutes(d.slides)) };
}

// ─── Deck: The Water Cycle (teen) ─────────────────────────────────────

function waterCycleSlides(): Slide[] {
  return [
    slide('s_wc_01', 'title', {
      eyebrow: 'Week 1 · Earth & Climate',
      title: 'The Water Cycle',
      subtitle: 'Where the water you drink has been',
      presenter: 'Science · Year 9',
      image: '',
    }, notes(
      "Welcome, everyone. Today we're going to follow one drop of water on a journey that has been running for billions of years. By the end of the lesson you'll be able to name every stage of the water cycle and explain what powers it.",
      { min: 1, cues: ['Greet students at the door', 'Leave this slide up while they settle'] },
    ), 'left'),

    slide('s_wc_02', 'agenda', {
      title: 'Today',
      items: ['One drop, one journey', 'The four stages', "Where Earth's water is", 'Check and recall'],
    }, notes(
      "Here's our plan. First a look at the journey of a single drop, then the four stages one at a time. After that we'll look at some surprising numbers about where Earth's water actually is, and we'll finish with a short quiz and a recall round. If you only remember one idea today, make it this one: water is never used up, it just moves.",
      { min: 1, points: ['Water moves in a loop', 'Today: four stages, then the numbers'], cues: ['Keep this under a minute'] },
    )),

    slide('s_wc_03', 'quote', {
      quote: 'If there is magic on this planet, it is contained in water.',
      attribution: 'Loren Eiseley',
    }, notes(
      "The writer Loren Eiseley put it this way in nineteen fifty-seven, and I think he had a point. Water is one of the very few things we regularly see as a solid, a liquid and a gas without any special equipment, and that is exactly what lets it travel in a loop. Hold on to the word magic for a moment. By the end of the lesson, I want you to be able to replace it with the word physics.",
      {
        min: 1.5,
        points: ['Water exists as solid, liquid and gas on Earth', 'Changing state is what lets it travel'],
        cues: ['Read the quote aloud, slowly', "Ask: what could 'magic' really mean here?"],
      },
    )),

    slide('s_wc_04', 'section', {
      number: '01',
      title: 'Up, across, down, back',
      subtitle: 'Four stages make one loop',
    }, notes(
      "Let's start the journey. Four stages, one loop, and it never really starts or ends.",
      { min: 0.5 },
    )),

    slide('s_wc_05', 'term', {
      label: 'Stage 1',
      term: 'Evaporation',
      definition: 'Heat from the Sun turns liquid water into invisible water vapour.',
      example: 'A puddle disappearing on a sunny pavement.',
      image: '',
    }, notes(
      "Stage one is evaporation. The Sun's energy makes water molecules move faster until they escape from the surface as water vapour, a gas you can't see. Most of it happens over the oceans, but plants contribute too: they release vapour through tiny pores in their leaves, which we call transpiration. Notice that evaporation leaves the salt behind, so the vapour is fresh water even when it rises from the sea. That is a quiet gift from the cycle.",
      {
        min: 3.5,
        points: ['Liquid water becomes water vapour, a gas', 'The Sun supplies the energy', 'Oceans supply most of the vapour', 'Plants add vapour by transpiration'],
        cues: ['Wipe a patch of the whiteboard and watch it dry', 'Pause for puddle examples'],
        check: ['Why is vapour rising from the ocean not salty?', "Salt doesn't evaporate. It stays behind in the sea."],
      },
    )),

    slide('s_wc_06', 'term', {
      label: 'Stage 2',
      term: 'Condensation',
      definition: 'Rising vapour cools and turns back into tiny liquid droplets.',
      example: 'Mist forming on a cold bathroom mirror.',
      image: '',
    }, notes(
      "Stage two is condensation. As warm, moist air rises it cools, because the air higher up is thinner and colder. Cool air can't hold as much vapour, so the vapour turns back into liquid. The droplets form around tiny specks of dust and salt and gather in huge numbers, and that is what a cloud is: not vapour, but millions of tiny droplets or ice crystals. The same thing happens when your breath fogs up a cold window.",
      {
        min: 3.5,
        points: ['Vapour cools and becomes liquid droplets', 'Clouds are droplets, not vapour', 'Tiny particles give droplets something to form on'],
        cues: ['Show a cold glass with water beading on the outside', 'Ask: where have you seen this today?'],
      },
    )),

    slide('s_wc_07', 'image', {
      title: 'The whole loop',
      body: 'Follow the arrows. What powers the loop?',
      image: '/samples/water-cycle.svg',
      caption: 'The water cycle',
      whole: true,
    }, notes(
      "Here's the whole loop in one picture. Take thirty seconds and trace it with your finger: start at the lake, follow the orange arrows up, then the purple arrow into the cloud, down as rain onto the mountain, and back to the lake by the stream. Where could a drop get stuck on the way? Some water spends years frozen in a glacier, or hundreds of years underground, before it moves on. The loop is continuous, but the timing is wildly uneven.",
      {
        min: 5,
        points: ['The cycle is continuous', 'Energy from the Sun drives the loop', 'Water can pause in ice, lakes and underground'],
        cues: ['Point to each label as you name it', 'Give 30 seconds for students to trace it silently'],
      },
    ), 'right'),

    slide('s_wc_08', 'steps', {
      title: "One drop's journey",
      steps: [
        { label: 'Evaporation', detail: 'Sun warms a lake' },
        { label: 'Condensation', detail: 'Vapour cools into cloud' },
        { label: 'Precipitation', detail: 'Rain, snow or hail' },
        { label: 'Collection', detail: 'Rivers, lakes, soil' },
      ],
      reveal: true,
    }, notes(
      "Now let's put the stages in order, one click at a time. Before I reveal each one, shout out what you think comes next. Notice that precipitation isn't only rain: it's snow, sleet and hail too, anything that falls from a cloud. And collection is where it gets interesting, because the water might run off into a river, soak into the soil as groundwater, or freeze on a glacier. Whichever way it goes, the Sun will eventually lift it again.",
      {
        min: 5,
        points: ['Order: evaporation, condensation, precipitation, collection', 'Precipitation includes snow, sleet and hail', 'Collected water can run off, soak in or freeze'],
        cues: ['Click to reveal one step at a time', 'Take guesses before each reveal'],
        check: ['Name three forms of precipitation.', 'Rain, snow, sleet or hail.'],
      },
    )),

    slide('s_wc_09', 'stats', {
      title: "Earth's water at a glance",
      stats: [
        { value: '97%', label: 'Salt water', detail: 'Mostly the oceans' },
        { value: '2%', label: 'Frozen fresh water', detail: 'Ice caps and glaciers' },
        { value: '1%', label: 'Liquid fresh water', detail: 'Lakes, rivers, groundwater' },
      ],
    }, notes(
      "Here's why this matters. Roughly ninety-seven percent of Earth's water is salty. Of the rest, about two percent is locked up as ice, which leaves only around one percent as liquid fresh water in lakes, rivers and underground, and most of that is groundwater. The water cycle is the process that keeps topping up that tiny slice, which is why a drought can happen even on a planet that is mostly ocean.",
      {
        min: 4,
        points: ['About 97% of Earth\'s water is salty', 'Only about 1% is liquid fresh water', 'Most of that fresh water is underground'],
        cues: ['Pause after the 1%', "Ask: what's the most surprising number here?"],
        check: ['Why can droughts happen on a planet covered in water?', 'Most water is salty or frozen; the usable fresh share is tiny and unevenly spread.'],
      },
    )),

    slide('s_wc_10', 'compare', {
      title: 'Opposite processes',
      leftHeading: 'Evaporation',
      leftPoints: ['Liquid to gas', 'Takes in heat', 'Needs warmth'],
      rightHeading: 'Condensation',
      rightPoints: ['Gas to liquid', 'Gives out heat', 'Needs cooling'],
      reveal: true,
    }, notes(
      "Let's compare our first two stages, because they're mirror images. Evaporation turns liquid into gas and takes in heat from its surroundings, which is why sweating cools you down. Condensation does the reverse: gas to liquid, and it releases that heat. That released heat is a big deal, because it's part of the energy that powers thunderstorms and hurricanes. So the cycle isn't only moving water around, it's moving energy too.",
      {
        min: 4,
        points: ['Evaporation: liquid to gas, absorbs heat', 'Condensation: gas to liquid, releases heat', 'Released heat helps fuel storms'],
        cues: ['Ask students to predict the right column before you reveal it'],
        check: ['Why does sweating cool you down?', 'Evaporating sweat takes heat from your skin.'],
      },
    )),

    slide('s_wc_11', 'question', {
      question: 'On a sunny day, what moves water from a lake into the air?',
      options: ['Condensation', 'Evaporation', 'Precipitation'],
      correct: 1,
      answer: 'Evaporation. Sun-warmed liquid water becomes vapour.',
    }, notes(
      "Time to check understanding. Read the question, choose silently, and show me with your fingers: one for A, two for B, three for C. I'm looking at the whole room, not at individuals. If the room splits, we'll talk it through before I reveal the answer. Here's a trick that always works: say what state the water starts in and what state it ends in. Liquid to gas is the clue.",
      {
        min: 3.5,
        points: ['Liquid to gas is evaporation'],
        cues: ['Fingers held against the chest so neighbours cannot copy', 'Reveal the answer only after a second vote'],
      },
    )),

    slide('s_wc_12', 'recall', {
      title: 'Quick recall',
      cards: [
        { prompt: 'What powers the water cycle?', answer: 'The Sun' },
        { prompt: 'Vapour cooling into droplets?', answer: 'Condensation' },
        { prompt: 'Rain, snow and hail?', answer: 'Precipitation' },
        { prompt: 'Where does rain end up?', answer: 'Rivers, lakes, oceans, soil' },
      ],
    }, notes(
      "Final recall round. I'll point to a card, you answer in chorus, and then I'll click to reveal. If you're not sure, say your best guess out loud anyway, because retrieving something with effort is what makes it stick. We'll go quickly, one card at a time, and if the room gets one wrong, we'll circle back to it at the end rather than moving on.",
      {
        min: 4,
        points: ['The Sun powers the cycle', 'Cooling vapour condenses', 'Precipitation falls from clouds', 'Collection returns water to the surface'],
        cues: ['Click once per card', 'Cold-call two students per card'],
      },
    )),

    slide('s_wc_13', 'summary', {
      title: 'Takeaways',
      points: [
        'Water moves in a continuous loop',
        'The Sun supplies the energy',
        'Four stages: evaporation, condensation, precipitation, collection',
        'Only about 1% of Earth\'s water is liquid fresh water',
      ],
    }, notes(
      "Let's pull it together. Water moves in a continuous loop and the Sun supplies the energy. The four stages are evaporation, condensation, precipitation and collection, and any drop can pause for a day or for ten thousand years along the way. And remember the number that surprised us: only about one percent of Earth's water is liquid fresh water. That is why understanding the cycle is the first step to protecting it.",
      { min: 3, points: ['Four stages, one loop', 'Sun-powered', 'Fresh water is scarce'], cues: ['Have students say each takeaway before you read it'] },
    )),

    slide('s_wc_14', 'closing', {
      title: 'Exit ticket',
      prompts: ['Explain the cycle to a friend in two sentences', 'One question you still have'],
      closing: 'See you Thursday',
    }, notes(
      "Last task before you go. Write your answers on a sticky note and put it on the door on your way out. I'll read them tonight and start Thursday's lesson with your questions. On Thursday we dig into where all this water is actually stored: glaciers, aquifers and the ocean.",
      { min: 3, cues: ['Hand out sticky notes', 'Stand at the door as they leave'] },
    )),
  ];
}

// ─── Deck: Weather vs. Climate (teen) ─────────────────────────────────

function weatherClimateSlides(): Slide[] {
  return [
    slide('s_wv_01', 'title', {
      eyebrow: 'Week 3 · Earth & Climate',
      title: 'Weather vs. Climate',
      subtitle: 'Same sky, different time scales',
      presenter: 'Science · Year 9',
      image: '',
    }, notes(
      "Welcome back. Last week we studied weather. Today we zoom out and ask a different question: what is climate, and why do scientists treat it so differently from the forecast?",
      { min: 1, cues: ['Have last week\'s weather maps ready to refer to'] },
    ), 'left'),

    slide('s_wv_02', 'question', {
      question: 'It snowed in April. Is the climate cooling?',
      options: [],
      correct: -1,
      answer: 'No. One snowy day is weather. Climate is a long-term pattern.',
    }, notes(
      "Let's start with a claim you may have heard. It snowed in April, so the climate must be cooling, right? Turn to a partner and give me a yes or no and one reason. You have one minute. I'll take answers from a few pairs and we'll keep the best reasons on the board, then test them against a proper definition in a few minutes.",
      {
        min: 3.5,
        points: ["One unusual event can't show a climate trend"],
        cues: ['Pair talk for one minute', 'Cold-call two pairs', 'Write the best reasons on the board'],
      },
    )),

    slide('s_wv_03', 'compare', {
      title: 'Weather vs. climate',
      leftHeading: 'Weather',
      leftPoints: ['The air right now', 'Minutes to days', 'Rain at 3 p.m.'],
      rightHeading: 'Climate',
      rightPoints: ['The usual pattern', '30 years or more', 'Wet winters, dry summers'],
      reveal: true,
    }, notes(
      "Weather is what the atmosphere is doing at a particular place and time: temperature, wind, cloud, rain. It changes in minutes and can be wildly different from one day to the next. Climate is the average of that weather over many years, together with how much it varies. Meteorologists use thirty years as the standard period, so one cold week, or even one cold year, doesn't change a climate. It's like the difference between one test score and your overall grade.",
      {
        min: 4.5,
        points: ['Weather: the short-term state of the atmosphere', 'Climate: the long-term average and its variation', 'The standard climate period is 30 years'],
        cues: ['Discuss weather first, then reveal the climate column'],
        check: ["Is 'it's hot today' about weather or climate?", 'Weather.'],
      },
    )),

    slide('s_wv_04', 'term', {
      label: 'Key term',
      term: 'Climate',
      definition: 'The average weather of a place over about 30 years.',
      example: 'Singapore: hot, humid and rainy all year.',
      image: '',
    }, notes(
      "Here's the formal definition to copy down. Climate is the average weather of a place over a long period, usually thirty years. The important word is average. Singapore's climate is hot, humid and rainy all year round, even though a single day might be cloudy and cool. Climate also includes the extremes and the variation, not only the mean, which is why two places with the same average temperature can feel completely different to live in.",
      {
        min: 3.5,
        points: ['Climate is long-term average weather', 'It includes variation and extremes', 'It describes a region, not a single day'],
        cues: ['Students copy the definition', 'Ask for a place whose climate they know well'],
      },
    )),

    slide('s_wv_05', 'stats', {
      title: 'Extremes are weather',
      stats: [
        { value: '56.7°C', label: 'Hottest recorded', detail: 'Death Valley, 1913' },
        { value: '−89.2°C', label: 'Coldest recorded', detail: 'Vostok, Antarctica, 1983' },
        { value: '30 years', label: 'Climate window', detail: 'The standard averaging period' },
      ],
    }, notes(
      "Look at these numbers. The official world record for the hottest air temperature is 56.7 degrees Celsius, set in Death Valley in 1913, and the lowest ever measured is minus 89.2 at Vostok Station in Antarctica in 1983. Both are extreme weather, not climate. A single record tells you what is possible on one day. Climate scientists instead average weather over thirty years, a window long enough to smooth out the ups and downs.",
      {
        min: 4,
        points: ['Records describe single days, not climates', 'Climate averages many years of weather', 'Thirty years is the standard window'],
        cues: ['Pause: ask which numbers are weather and which is climate'],
        check: ["Why isn't a record high a measure of climate?", "It's one day's weather, not a long-term average."],
      },
    )),

    slide('s_wv_06', 'section', {
      number: '02',
      title: 'What shapes a climate?',
      subtitle: 'Four big drivers',
    }, notes(
      "Now that we know what climate is, let's ask why places differ. Four big factors do most of the work.",
      { min: 0.5 },
    )),

    slide('s_wv_07', 'bullets', {
      title: 'Four drivers of climate',
      bullets: [
        'Latitude: how direct the sunlight is',
        'Altitude: higher means colder',
        'Distance from the sea: oceans even out temperatures',
        'Ocean currents: carry heat around the world',
      ],
      reveal: true,
      image: '',
    }, notes(
      "Four factors explain most of the climate map. Latitude first: near the equator the Sun's rays hit more directly, so it's warmer, while near the poles they arrive at a slant and spread out. Altitude: air cools by roughly six and a half degrees Celsius for every thousand metres you climb. Distance from the sea: water heats and cools slowly, so coasts have milder swings than inland places. And ocean currents: the Gulf Stream is a big reason north-west Europe is milder than Canada at the same latitude.",
      {
        min: 5,
        points: ['Latitude sets how much sunlight arrives', 'Higher altitude means colder air', 'The sea moderates temperature swings', 'Currents move heat around the planet'],
        cues: ['Reveal one driver at a time', 'Ask students to predict the effect before each reveal'],
      },
    )),

    slide('s_wv_08', 'steps', {
      title: 'From weather to climate',
      steps: [
        { label: 'Measure', detail: 'Thermometers and rain gauges, daily' },
        { label: 'Average', detail: 'Daily readings into monthly means' },
        { label: 'Repeat', detail: 'Keep records for 30 years' },
        { label: 'Compare', detail: 'Today against the long-term normal' },
      ],
      reveal: true,
    }, notes(
      "So how do we actually get from weather to climate? First, weather stations measure temperature, rainfall and wind every day. Second, those daily readings are averaged into monthly values. Third, we keep going for thirty years, which gives us what's called a climate normal for each place and month. And fourth, we compare any period against that normal to see whether it's typical or unusual. That comparison step is how scientists can say something is changing without being fooled by one odd season.",
      {
        min: 4.5,
        points: ['Climate comes from long records of daily weather', 'A 30-year average is called a normal', 'Comparing with the normal shows what is unusual'],
        cues: ['Reveal one step per click'],
        check: ["What is a climate 'normal'?", 'The 30-year average for a place.'],
      },
    )),

    slide('s_wv_09', 'quote', {
      quote: 'Climate is what you expect, weather is what you get.',
      attribution: 'Robert A. Heinlein',
    }, notes(
      "You'll often see this line credited to Mark Twain, but there's no good evidence he said it. Versions of the idea appear in print in the early nineteen hundreds, and the novelist Robert Heinlein made it famous in the nineteen seventies. Whoever said it first, it sums up the lesson: climate is the expectation you build from decades of experience, and weather is the surprise you get on any particular day.",
      { min: 1.5, points: ['Weather is the day; climate is the expectation'], cues: ['Let the quote sit for a moment'] },
    )),

    slide('s_wv_10', 'question', {
      question: 'Which of these describes climate?',
      options: ['A thunderstorm at 3 p.m.', 'Snow forecast for tomorrow', 'Dry summers and wet winters, year after year'],
      correct: 2,
      answer: 'C. A pattern repeated over many years is climate.',
    }, notes(
      "Let's check. Look at the three statements and vote with a raised hand for the one that describes climate. Be ready to explain why you rejected the other two. A thunderstorm this afternoon and snow tomorrow are both single events, so they're weather. The third one describes a repeating pattern over many years, which is the signature of climate. If you chose A or B, tell me what would have to be true to make it climate.",
      {
        min: 3.5,
        points: ['Climate is a repeating long-term pattern'],
        cues: ['Vote by raised hands', 'Ask someone who chose A to explain their thinking'],
      },
    )),

    slide('s_wv_11', 'summary', {
      title: 'Takeaways',
      points: [
        'Weather is short-term; climate is the 30-year pattern',
        "One cold day or record doesn't change a climate",
        'Latitude, altitude, sea and currents shape climate',
        'Thursday: climate zones around the world',
      ],
    }, notes(
      "Let's wrap up. Weather is the short-term state of the atmosphere, and climate is the long-term pattern, usually averaged over thirty years. A single cold day or a record high can't change a climate on its own. Latitude, altitude, distance from the sea and ocean currents shape the climate of every place on Earth. On Thursday we'll use these ideas to map the world's climate zones.",
      {
        min: 3,
        points: ['Weather is short-term, climate is the long-term pattern', 'Four drivers shape every climate'],
        cues: ['Ask students to close their notebooks and say one takeaway each'],
      },
    )),

    slide('s_wv_12', 'closing', {
      title: 'Exit ticket',
      prompts: ["Weather or climate? 'Cairo is hot and dry all year.'", "Reply in one sentence: 'It snowed in April, so the climate is cooling.'"],
      closing: 'See you Thursday',
    }, notes(
      "Two quick questions before you leave. First, decide whether the statement about Cairo is weather or climate. Second, write a one-sentence reply to the claim we started with, using what you've learned today. Hand your answers in at the door.",
      { min: 3, cues: ['Collect answers at the door', 'Read a few aloud at the start of Thursday'] },
    )),
  ];
}

// ─── Deck: Say the Main Thing First (adult) ───────────────────────────

function mainThingSlides(): Slide[] {
  return [
    slide('s_ww_01', 'title', {
      eyebrow: 'Week 1 · Writing That Works',
      title: 'Say the Main Thing First',
      subtitle: 'Put the point where the reader will actually see it',
      presenter: 'Communication · Evening workshop',
      image: '',
    }, notes(
      "Welcome to week one. Tonight's skill sounds simple and is surprisingly hard: put the main thing first. Everything else in this workshop builds on it.",
      { min: 1, cues: ['Greet people by name as they arrive'] },
    ), 'left'),

    slide('s_ww_02', 'question', {
      question: 'Think of the last long email you received. How far in did you find the point?',
      options: [],
      correct: -1,
      answer: 'Most readers decide within the first two lines whether to keep reading. Make those lines count.',
    }, notes(
      "Let's begin with your own experience. Think of the last long email or message you received at work. Where in it did you finally understand what the sender wanted? Take a minute to jot down your answer, then share with the person next to you. I suspect for many of you it was the third paragraph, or never. Hold on to that feeling, because it's exactly how your readers feel about your writing.",
      {
        min: 4,
        points: ['Readers decide early whether to keep reading', 'A buried point costs the reader time'],
        cues: ['Give people a full minute of quiet', 'Share a bad example of your own'],
      },
    )),

    slide('s_ww_03', 'term', {
      label: 'Method',
      term: 'BLUF',
      definition: 'Bottom line up front: lead with the conclusion or the request, then give the support.',
      example: "We need to move the launch to 12 June. Here's why.",
      image: '',
    }, notes(
      "The technique has a name: BLUF, short for bottom line up front. It comes from military and government writing, where a misunderstood message can be costly. The idea is to open with the conclusion, the decision or the request, then supply the reasons in order of importance. Your reader can stop at any point and still have the essentials. This isn't about being blunt, it's about being generous with their time. You can still be warm; just don't make them dig for the point.",
      {
        min: 3,
        points: ['Lead with the conclusion or request', 'Then support it, most important first', 'Readers can stop anywhere and still know what matters'],
        cues: ['Write BLUF on the board', 'Ask who has used it already'],
        check: ['What goes in the first sentence of a BLUF message?', 'The conclusion, decision or request.'],
      },
    )),

    slide('s_ww_04', 'compare', {
      title: 'Before and after',
      leftHeading: 'Before',
      leftPoints: [
        'Following our discussion, and given various constraints, I wanted to share some thoughts on the deadline.',
        'Please let me know if that works.',
      ],
      rightHeading: 'After',
      rightPoints: [
        'Can we move the deadline to Friday? Two tasks are blocked.',
        'I need a yes or no by noon.',
      ],
      reveal: true,
    }, notes(
      "Here's the difference in practice. On the left, the writer opens with context and throat-clearing, and the reader has to guess what's being asked. On the right, the first sentence is the request and the second gives the reason. Same information, same person, but the second email gets an answer before lunch. Notice what changed: we cut the warm-up, replaced a vague 'thoughts' with a specific proposal, and ended with a clear deadline for the reply. Which version would you rather receive on a busy Monday?",
      {
        min: 6,
        points: ['Open with the request, not the backstory', 'Be specific: dates, numbers, decisions', 'End with what you need and by when'],
        cues: ['Read both aloud in a flat voice', 'Ask pairs to circle the main thing in the left version', 'Reveal the right column after students react'],
      },
    )),

    slide('s_ww_05', 'section', {
      number: '02',
      title: 'A four-step method',
      subtitle: 'Find it, front it, trim the rest',
    }, notes(
      "Now the method itself: four moves you can apply to any message in under two minutes.",
      { min: 0.5 },
    )),

    slide('s_ww_06', 'steps', {
      title: 'Lead with the point',
      steps: [
        { label: 'Find it', detail: 'What must they know or do?' },
        { label: 'Say it first', detail: 'One plain sentence' },
        { label: 'Add the why', detail: 'Only what they need' },
        { label: 'Cut the rest', detail: 'Delete, do not hide' },
      ],
      reveal: true,
    }, notes(
      "Here's the method in four moves. First, find the point: finish the sentence 'After reading this, I want them to...'. If you can't finish it, you're not ready to write. Second, say it first, in one plain sentence. Third, add only the reasons the reader needs in order to act, not every reason you have. Fourth, cut the rest, or move it to an attachment. Be ruthless: if it doesn't help them decide or act, it belongs in your notes, not in their inbox.",
      {
        min: 6,
        points: ["Finish: 'After reading this, I want them to...'", 'One plain sentence, first', 'Only the reasons they need', 'Move the rest out of the message'],
        cues: ['Reveal a step at a time', "Model step one live with a volunteer's real message"],
        check: ['How do you find the point of a message?', "Finish the sentence: 'After reading this, I want them to...'"],
      },
    )),

    slide('s_ww_07', 'bullets', {
      title: 'Where the main thing goes',
      bullets: [
        'Emails: the first two lines',
        'Reports: a summary on page one',
        'Slides: the title states the claim',
        'Meetings: open with the decision needed',
      ],
      reveal: false,
      image: '',
    }, notes(
      "The principle travels. In an email, it's the first two lines. In a report, it's an executive summary on page one, written last but read first. On slides, the title should be a full sentence that states the claim, so someone skimming only the titles gets your argument. In meetings, open with the decision you need, then walk through the evidence. Different formats, same rule: the reader's first few seconds are the most valuable real estate you have.",
      {
        min: 4.5,
        points: ['The same rule works in every format', 'A slide title should state the claim', 'The first seconds are the most valuable'],
        cues: ['Ask for a format from their own work to add to the list'],
        check: ['What makes a good slide title?', 'A full sentence that states the claim.'],
      },
    )),

    slide('s_ww_08', 'quote', {
      quote: 'I have made this longer than usual because I have not had time to make it shorter.',
      attribution: 'Blaise Pascal, 1657',
    }, notes(
      "Pascal wrote this at the end of a very long letter in sixteen fifty-seven, and it's still the best excuse for a long email anyone has found. Brevity isn't laziness; it's the result of work. Cutting costs the writer time so that reading doesn't cost the reader time. When you're tempted to send the long version, remember that you're not saving time, you're just moving the cost to someone else.",
      { min: 1.5, points: ['Short is harder than long', 'Cutting moves effort from the reader to the writer'], cues: ['Pause after reading it', 'Smile and let it land'] },
    )),

    slide('s_ww_09', 'question', {
      question: 'Which opening puts the main thing first?',
      options: [
        "I've been thinking a lot about the quarterly numbers.",
        'We missed the Q3 target by 8%; we need to approve a recovery plan today.',
        'Hope your week is going well! Just a quick note about something.',
      ],
      correct: 1,
      answer: 'B. It states the result and the request in one sentence.',
    }, notes(
      "Let's test it. Read the three openings and decide which one puts the main thing first. Vote by raising your hand for A, B or C, then turn to a neighbour and explain your reasoning in one sentence. A sets a topic but no point; C is friendly but empty. B gives the result and the request before anything else. Notice it's still polite, just efficient. Anyone who chose A or C: what would you change to fix it?",
      {
        min: 4,
        points: ['A good opening states the result and the request'],
        cues: ['Vote by raised hands', 'Ask for a rewrite of A from the room'],
      },
    )),

    slide('s_ww_10', 'summary', {
      title: 'Takeaways',
      points: [
        'Lead with the point or the request',
        "Find it first: what do you want them to do?",
        'Give only the reasons they need',
        'Cut the rest: shorter takes more work',
      ],
    }, notes(
      "Let's pull it together. Lead with the point or the request. To find it, ask what you want the reader to know or do. Give only the reasons they need to act on it, and cut everything else, remembering that shorter takes more work, not less. If you do only one thing differently this week, rewrite the first two lines of one real message using these ideas.",
      {
        min: 3,
        points: ['Lead with the point or the request', 'Find it, front it, trim the rest'],
        cues: ['Ask each table to name one takeaway'],
      },
    )),

    slide('s_ww_11', 'closing', {
      title: 'Before you go',
      prompts: ['Pick one real message you will send this week', 'Rewrite its first line so the main thing comes first'],
      closing: 'Bring it on Wednesday',
    }, notes(
      "Before you go, here's your practice for the week. Pick one real message you'll be sending anyway, and rewrite the first line so the main thing comes first. Bring both versions on Wednesday and we'll compare them in pairs. Thank you all, and see you then.",
      { min: 4, cues: ['Write the task on the board', 'Stay for questions'] },
    )),
  ];
}

// ─── Deck: Animal Homes (young) ───────────────────────────────────────

function animalHomesSlides(): Slide[] {
  return [
    slide('s_ah_01', 'title', {
      eyebrow: 'Week 1 · Curious Creatures',
      title: 'Animal Homes',
      subtitle: 'Where do animals live?',
      presenter: '',
      image: '',
    }, notes(
      "Hello, explorers! Today we are going to find out where animals live. Are you ready to be nature detectives?",
      { min: 1, cues: ['Greet each child by name', 'Wave like an explorer'] },
    ), 'center'),

    slide('s_ah_02', 'question', {
      question: 'Do animals have homes?',
      options: [],
      correct: -1,
      answer: 'Yes! Every animal needs a safe place.',
    }, notes(
      "Let's start with a question. Do you think animals have homes, like we do? Put your thumb up for yes and down for no. Now ask a friend: where do you think a bird, a rabbit or a spider lives? Let's collect some ideas, and then go and find out.",
      {
        min: 2,
        points: ['Animals need a safe place to live'],
        cues: ['Thumbs up or thumbs down', 'Take three ideas from the group'],
      },
    )),

    slide('s_ah_03', 'term', {
      label: 'Home word',
      term: 'Burrow',
      definition: 'A tunnel home under the ground.',
      example: 'Rabbits sleep in burrows.',
      image: '/samples/burrow.svg',
    }, notes(
      "This word is burrow. A burrow is a tunnel that an animal digs under the ground. Look at the picture. Can you spot the rabbit? There are little rooms for sleeping, for babies, and for keeping food. It is dark, cool and safe down there. Let's all say it together: burrow!",
      {
        min: 2.5,
        points: ['A burrow is a tunnel home under the ground', 'Rabbits live in burrows'],
        cues: ['Point to the baby rabbits', 'Say the word together two times'],
        check: ['What is a burrow?', 'A tunnel home under the ground.'],
      },
    )),

    slide('s_ah_04', 'term', {
      label: 'Home word',
      term: 'Nest',
      definition: 'A bird home made of twigs and grass.',
      example: 'Robins lay blue eggs in nests.',
      image: '/samples/nest.svg',
    }, notes(
      "Here is another home word: nest. Birds build nests in trees. Look at the picture. How many eggs can you count? The mother bird sits on the eggs to keep them warm, and later the baby birds hatch. Can you flap your wings and say nest?",
      {
        min: 2.5,
        points: ['A nest is a bird home', 'Nests hold eggs and baby birds'],
        cues: ['Count the eggs together', 'Flap arms like wings'],
      },
    )),

    slide('s_ah_05', 'bullets', {
      title: 'Why do animals need homes?',
      bullets: ['To stay safe', 'To keep warm and dry', 'To look after babies'],
      reveal: true,
      image: '',
    }, notes(
      "Why do animals need homes? Think about why you need one! A home keeps animals safe from big, hungry animals. It keeps them warm when it is cold and dry when it rains. And it is a cosy place to look after their babies. Which reason do you think is the most important?",
      {
        min: 2,
        points: ['Homes keep animals safe', 'Homes keep animals warm and dry', 'Homes are for looking after babies'],
        cues: ['Reveal one reason at a time', 'Let children share about their own homes'],
      },
    )),

    slide('s_ah_06', 'compare', {
      title: 'Burrow or nest?',
      leftHeading: 'Burrow',
      leftPoints: ['Under the ground', 'Rabbits'],
      rightHeading: 'Nest',
      rightPoints: ['Up in a tree', 'Birds'],
      reveal: true,
    }, notes(
      "Let's compare our two homes. A burrow is under the ground, and rabbits live there. A nest is up in a tree, and birds live there. One is down, one is up. Point down for burrow. Now point up for nest. You are so good at this!",
      {
        min: 2,
        points: ['Burrows are underground', 'Nests are up in trees'],
        cues: ['Point down for burrow, up for nest'],
        check: ['Which home is up in a tree?', 'A nest.'],
      },
    )),

    slide('s_ah_07', 'steps', {
      title: 'Building a nest',
      steps: [
        { label: 'Find', detail: 'Twigs and grass' },
        { label: 'Weave', detail: 'Make a round bowl' },
        { label: 'Lay', detail: 'Eggs go inside' },
      ],
      reveal: true,
    }, notes(
      "How does a bird build a nest? Step one: find twigs, leaves and grass. Step two: weave them into a round bowl, a bit like a basket. Step three: the mother bird lays her eggs inside, and then she keeps them warm. Can you wiggle your fingers like a bird weaving?",
      {
        min: 3,
        points: ['Find twigs and grass', 'Weave a round bowl', 'Lay the eggs inside'],
        cues: ['Reveal one step at a time', 'Wiggle fingers to weave'],
        check: ['What goes inside the nest?', 'Eggs.'],
      },
    )),

    slide('s_ah_08', 'recall', {
      title: 'Quick recall',
      cards: [
        { prompt: 'Who lives in a burrow?', answer: 'A rabbit' },
        { prompt: 'Who lives in a nest?', answer: 'A bird' },
        { prompt: 'Why do animals need homes?', answer: 'To stay safe' },
      ],
    }, notes(
      "Let's see what we remember. I will read a question, and you shout the answer. Ready? Then I will click to see if you were right. Do not worry if you get one wrong. We learn by trying, and I will help you.",
      {
        min: 3,
        points: ['Rabbits live in burrows', 'Birds live in nests', 'Homes keep animals safe'],
        cues: ['Click once per card', 'Cheer for every answer'],
      },
    )),

    slide('s_ah_09', 'question', {
      question: 'Where does a rabbit live?',
      options: ['In a nest', 'In a burrow', 'In a tree'],
      correct: 1,
      answer: 'A burrow, under the ground!',
    }, notes(
      "Here is a puzzle. Where does a rabbit live? Look at the three answers and think. Show me with your fingers: one finger for A, two for B, three for C. Ready? Everyone point at the answer on three. One, two, three!",
      {
        min: 2,
        points: ['A rabbit lives in a burrow'],
        cues: ['Count down from three', 'Reveal the answer with a drum roll on the desk'],
      },
    )),

    slide('s_ah_10', 'closing', {
      title: 'Before you go',
      prompts: ['Draw your favourite animal home'],
      closing: 'Great work, explorers!',
    }, notes(
      "Wonderful work today, explorers! Before you go, draw an animal home on your paper. It can be a burrow, a nest or anything you like. Then show a friend and tell them who lives there.",
      { min: 1, cues: ['Hand out paper and crayons'] },
    )),
  ];
}

// ─── Deck: Designing Meetings People Want to Attend (talk, adult) ─────

function meetingsSlides(): Slide[] {
  return [
    slide('s_mt_01', 'title', {
      eyebrow: 'Team offsite · Talk',
      title: 'Designing Meetings People Want to Attend',
      subtitle: 'Fewer meetings, better ones',
      presenter: 'Maya Chen · Product',
      image: '',
    }, notes(
      "Good morning, everyone. Thanks for giving me twenty minutes of your offsite. I'm going to make one promise: if you try three small changes, you will lose at least one meeting a week and enjoy most of the rest.",
      { min: 1, cues: ['Start on time, even if the room is not full'] },
    ), 'left'),

    slide('s_mt_02', 'statement', {
      kicker: 'The problem',
      statement: 'Most meetings fail before anyone joins.',
      support: 'No purpose, no outcome, no preparation.',
    }, notes(
      "Here's my claim. Most meetings fail before anyone joins the call. Not because people are rude or distracted, but because nobody decided what the meeting was for. When there is no stated purpose, the loudest voice sets the agenda, the conversation wanders, and people leave unsure whether anything was decided. The good news is that this is a design problem, not a people problem. Design problems can be fixed with a few small, repeatable habits.",
      {
        min: 1.5,
        points: ['A meeting is something you design', 'Failure usually starts with no purpose'],
        cues: ['Pause after the first sentence'],
      },
    ), 'bold'),

    slide('s_mt_03', 'stats', {
      title: 'What our team told us',
      stats: [
        { value: '62%', label: 'No written purpose', detail: 'Of meetings last month' },
        { value: '5.4 h', label: 'Per person, per week', detail: 'In meetings rated "not useful"' },
        { value: '1 in 3', label: 'Ended with no owner', detail: 'For the next step' },
      ],
    }, notes(
      "Last month we asked a hundred and forty people on this team to rate every meeting they attended. Sixty-two percent had no written purpose in the invite. On average, each of us spent five and a half hours a week in meetings we rated as not useful. And one in three ended without anyone owning the next step. That last number bothers me most, because it means we talked for an hour and then nothing happened.",
      {
        min: 2,
        points: ['Most invites had no written purpose', 'About 5 hours a week go to meetings people rate as not useful', 'A third end with no owner'],
        cues: ['Let the second number sink in', 'Say it is our data, not an industry average'],
      },
    )),

    slide('s_mt_04', 'chart', {
      title: 'Usefulness rating by meeting size',
      rows: [
        { label: '2 to 4', value: '8.1', value2: '' },
        { label: '5 to 7', value: '7.2', value2: '' },
        { label: '8 to 12', value: '5.4', value2: '' },
        { label: '13 or more', value: '3.6', value2: '' },
      ],
      series: 'Average rating', series2: '', unit: '', unitBefore: false,
      takeaway: 'Past seven people, usefulness drops fast.',
      values: true, legend: false, reveal: true,
    }, notes(
      "Here's what the survey says about size. People rated each meeting from one to ten. Small meetings of two to four people average over eight. Add a few more and the score slides, and once you pass twelve people it falls to three and a half. Nobody planned this, it just happens: every extra person adds a little social cost, and fewer people speak. Click for the takeaway. Past seven, usefulness drops fast.",
      {
        min: 2.5,
        points: ['Usefulness falls as meetings grow', 'The sharpest drop is past seven people'],
        cues: ['Click once to show the takeaway', 'Ask who has been in a meeting of 13 or more this week'],
        check: ['At what size does the rating fall below six?', 'Between eight and twelve people.'],
      },
    ), 'column'),

    slide('s_mt_05', 'section', {
      number: '01',
      title: 'Three small fixes',
      subtitle: 'Decide, invite, run',
    }, notes(
      "So what do we change? Three fixes, one for each stage of a meeting: deciding whether to hold it, writing the invite, and running the hour.",
      { min: 0.5 },
    )),

    slide('s_mt_06', 'diagram', {
      title: 'Should this be a meeting?',
      items: [
        { label: 'Quick call', detail: 'A few people, one decision' },
        { label: 'Decision meeting', detail: 'Deciders only' },
        { label: 'Send a message', detail: 'Write it down' },
        { label: 'Cancel it', detail: 'Share the notes' },
      ],
      xAxis: 'People involved',
      yAxis: 'Decision needed',
      reveal: false,
    }, notes(
      "Fix one: decide whether to meet at all. Ask two questions. Do we need a decision? And how many people does it truly involve? If a few people need a decision, a short call is perfect. If many people need a decision, hold a proper decision meeting, but invite only the deciders and send everyone else the outcome. If there is no decision, a written message almost always works better. And if many people are involved and nothing needs deciding, cancel it and share the notes.",
      {
        min: 3,
        points: ['Ask: is a decision needed, and how many people?', 'No decision usually means a message', 'Invite deciders, inform the rest'],
        cues: ['Walk the quadrants clockwise', 'Name a real recurring meeting for each box'],
        check: ['What do you do with a large meeting where nothing needs deciding?', 'Cancel it and share the notes.'],
      },
    ), 'matrix'),

    slide('s_mt_07', 'steps', {
      title: 'The three-line invite',
      steps: [
        { label: 'Purpose', detail: 'Why we are meeting' },
        { label: 'Outcome', detail: 'What exists at the end' },
        { label: 'Prep', detail: 'What to read or bring' },
      ],
      reveal: true,
    }, notes(
      "Fix two is the invite. Every invite gets three lines. Purpose: why are we meeting, in one sentence. Outcome: what will exist at the end that does not exist now, such as a decision, a list or a draft. And prep: what people should read or bring, with a link. If you cannot write the outcome line, that is a signal to cancel. It takes about a minute, and it is the single biggest improvement you can make.",
      {
        min: 2.5,
        points: ['Purpose, outcome, prep', 'The outcome is something that exists afterwards', 'No outcome line means no meeting'],
        cues: ['Click once per line'],
      },
    )),

    slide('s_mt_08', 'code', {
      title: 'Copy this into your next invite',
      language: 'Invite',
      code: 'Purpose: Pick the launch date for Beta 2.\nOutcome: One date, one owner, written down.\nPrep: Read the 1-page plan (link) before we start.\n\nLength: 30 min\nWho: Product, Engineering, Support leads',
      caption: 'Short enough to write in a minute.',
    }, notes(
      "Here is a real invite you can copy. It reads purpose, outcome and prep, then length and who is coming. Notice the outcome is concrete: one date, one owner, written down. Anyone reading it knows whether they need to be there, which makes it easier to decline politely, and that's a feature. Take a screenshot if you like, and paste it into your next calendar invite this week.",
      {
        min: 1.5,
        points: ['Concrete outcomes beat topics', 'A clear invite lets people decline well'],
        cues: ['Give people ten seconds to photograph it'],
      },
    )),

    slide('s_mt_09', 'table', {
      title: 'Four meeting types, four rules',
      cells: 'Type | Length | Who | Leaves with\nDaily sync | 15 min | The team | Blockers\nDecision | 30 min | Deciders | A written decision\nWorkshop | 90 min | Mixed | A prototype\nReview | 45 min | Team + guests | An action list',
      header: true, stripes: true, caption: 'Our proposed defaults, not strict rules.',
    }, notes(
      "Fix three is running the hour. We'll start with defaults by type. A daily sync is fifteen minutes and leaves with a list of blockers. A decision meeting is thirty minutes, deciders only, and ends with a written decision. A workshop can run ninety minutes, but it must produce something you can touch, like a prototype. A review is forty-five minutes and ends with an action list. These are defaults, so break them when you have a good reason.",
      {
        min: 2,
        points: ['Each meeting type has a default length', 'Each type leaves with a named output', 'Defaults can be broken with a reason'],
        cues: ['Do not read every row', 'Ask which type they run most'],
      },
    )),

    slide('s_mt_10', 'timeline', {
      title: 'Running a 30-minute decision meeting',
      milestones: [
        { date: '0:00', title: 'Frame', detail: 'Restate the outcome' },
        { date: '0:05', title: 'Options', detail: 'Two or three, pre-read' },
        { date: '0:15', title: 'Decide', detail: 'Name who decides' },
        { date: '0:25', title: 'Owners', detail: 'Who does what, by when' },
      ],
      reveal: true,
    }, notes(
      "Here's the shape of a thirty-minute decision meeting. In the first five minutes, restate the outcome. Next ten minutes: walk through two or three options, which people have already read. At fifteen minutes, decide, and say out loud who makes the call, because that removes the awkward silence. The last five minutes assign owners and dates. If you reach minute twenty-five without a decision, don't extend the meeting, write down what is missing and schedule the follow-up.",
      {
        min: 3,
        points: ['Frame, options, decide, owners', 'Name the decider out loud', 'No decision by 25 minutes: write down what is missing'],
        cues: ['Click through one milestone at a time', 'Mention the timer on screen'],
      },
    )),

    slide('s_mt_11', 'people', {
      title: 'Join the pilot',
      people: [
        { photo: '', name: 'Maya Chen', role: 'Product' },
        { photo: '', name: 'Tom Alvarez', role: 'Engineering' },
        { photo: '', name: 'Priya Nair', role: 'Design' },
      ],
    }, notes(
      "We would like to try this for six weeks, and these three are the pilot owners. Maya will review invites, Tom runs the engineering decision meetings, and Priya is gathering feedback from design. You don't need permission to start, though. Pick one recurring meeting of your own, write the three-line invite, and see what happens. If you want help, find any of us at lunch today.",
      {
        min: 1.5,
        points: ['A six-week pilot starts next Monday', 'Anyone can start with one meeting'],
        cues: ['Ask the three to wave'],
      },
    )),

    // Three scored questions: the deck's quiz, on screen or on phones.
    slide('s_mt_q1', 'question', {
      question: 'At what size does the usefulness rating fall below six?',
      options: ['2 to 4 people', '5 to 7 people', '8 to 12 people', '13 or more'],
      correct: 2,
      answer: 'Between eight and twelve people.',
    }, notes(
      "A quick quiz to check what stuck, three questions, and you can answer on your phone. The first one goes back to the survey chart. People rated every meeting from one to ten, and the score fell as the room got bigger. At what size did the average rating first drop below six? Take a moment, pick one of the four sizes, and then I'll show you the answer.",
      {
        min: 0.5,
        points: ['The rating first falls below six at eight to twelve people'],
        cues: ['Give everyone time to answer'],
      },
    )),

    slide('s_mt_q2', 'question', {
      question: 'Which three lines go in every invite?',
      options: ['Purpose, outcome, prep', 'Agenda, attendees, time', 'Topic, room, length', 'Goal, owner, deadline'],
      correct: 0,
      answer: 'Purpose, outcome and prep.',
    }, notes(
      "Question two is about the invite. We said every invite gets three short lines, and that writing them takes about a minute. Some of these options sound sensible, and plenty of teams use them, but only one is the set we talked about. Which three lines go in every invite? Answer now, and remember the one line that tells you whether to cancel.",
      {
        min: 0.5,
        points: ['Every invite has a purpose, an outcome and prep'],
        cues: ['Give everyone time to answer'],
      },
    )),

    slide('s_mt_q3', 'question', {
      question: 'A big meeting where nothing needs deciding. What do you do?',
      options: ['Make it shorter', 'Invite fewer people', 'Cancel it and share the notes', 'Add an agenda'],
      correct: 2,
      answer: 'Cancel it and share the notes.',
    }, notes(
      "Last question, and it comes from the grid we used to decide whether to meet at all. Picture a large recurring meeting, with lots of people invited, where nothing actually needs to be decided. Shortening it or adding an agenda would help a little. But what does the grid say you should do with it? Pick your answer, then we'll look at your own calendar.",
      {
        min: 0.5,
        points: ['Many people and no decision: cancel and share the notes'],
        cues: ['Give everyone time to answer'],
      },
    )),

    slide('s_mt_12', 'question', {
      question: 'Which meeting on your calendar could be a message?',
      options: [],
      correct: -1,
      answer: 'If it has no decision and no outcome, it probably can.',
    }, notes(
      "Before I finish, a small exercise. Look at your calendar for the coming week and find one meeting that has no decision and no clear outcome. Turn to the person beside you and tell them which one it is, and what you would send instead. You have two minutes. I'll ask for a few examples, and I promise I won't ask for names.",
      {
        min: 3,
        points: ['No decision and no outcome often means a message'],
        cues: ['Set a two-minute timer', 'Collect three examples'],
      },
    )),

    slide('s_mt_13', 'summary', {
      title: 'Takeaways',
      points: [
        'Design the meeting before you invite anyone',
        'Write purpose, outcome and prep in every invite',
        'Keep decision meetings small and short',
        'Try it with one meeting this week',
      ],
    }, notes(
      "To wrap up. A meeting is something you design, so decide first whether it should happen at all. Write purpose, outcome and prep in every invite. Keep decision meetings small and short, with a named decider. And try it with a single meeting this week, not all of them. If it works, you will have gained back an hour, and your colleagues will notice that your meetings are the ones they actually want to attend.",
      {
        min: 2,
        points: ['Design first', 'Three-line invite', 'Small, short decision meetings'],
        cues: ['Slow down on the last line'],
      },
    )),

    slide('s_mt_14', 'closing', {
      title: 'Questions?',
      prompts: ['Which meeting will you change first?', 'What would make this harder for your team?'],
      closing: 'Thank you',
    }, notes(
      "Thank you for your time. I would love to take questions now, and I'll share the invite template and the survey results in the team channel this afternoon. If you only try one thing, make it the outcome line. It is the hardest to write and the most useful to read.",
      { min: 2, cues: ['Stay at the front for questions'] },
    )),
  ];
}

// ─── Deck: Q3 Product Update (report, adult) ──────────────────────────

function q3UpdateSlides(): Slide[] {
  return [
    slide('s_q3_01', 'title', {
      eyebrow: 'Quarterly review · Q3 2026',
      title: 'Q3 Product Update',
      subtitle: 'Results, lessons and what comes next',
      presenter: 'Product team',
      image: '',
    }, notes(
      "Thanks for joining. This is our Q3 product update. I'll cover how we did against our goals, what shipped, what slipped, and the decisions we need from you before Q4 starts.",
      { min: 1, cues: ['Share the recording link in the chat'] },
    ), 'left'),

    slide('s_q3_02', 'stats', {
      title: 'Q3 at a glance',
      stats: [
        { value: '128k', label: 'Weekly active users', detail: '+22% on Q2' },
        { value: '74%', label: 'Finish onboarding', detail: 'Up from 66%' },
        { value: '4.6%', label: 'Monthly churn', detail: 'Down from 5.3%' },
      ],
    }, notes(
      "The headline is a good quarter. Weekly active users reached a hundred and twenty-eight thousand, up twenty-two percent on Q2. Seventy-four percent of new users now finish onboarding, up from sixty-six. And monthly churn fell from five point three percent to four point six. Those three numbers move together for a reason: the new onboarding flow we shipped in July is doing most of the work.",
      {
        min: 2,
        points: ['Weekly active users: 128k, up 22%', 'Onboarding completion: 74%', 'Churn: 4.6%, down from 5.3%'],
        cues: ['Give the numbers, then pause', 'Credit the onboarding team by name'],
      },
    )),

    slide('s_q3_03', 'chart', {
      title: 'Weekly active users',
      rows: [
        { label: "Q4 '25", value: '84', value2: '' },
        { label: "Q1 '26", value: '91', value2: '' },
        { label: "Q2 '26", value: '105', value2: '' },
        { label: "Q3 '26", value: '128', value2: '' },
      ],
      series: 'Thousands of users', series2: '', unit: 'k', unitBefore: false,
      takeaway: 'Growth is speeding up: +23k this quarter, +14k last quarter.',
      values: true, legend: false, reveal: true,
    }, notes(
      "Here's the trend over four quarters. We added seven thousand users in Q1, fourteen thousand in Q2, and twenty-three thousand in Q3. So growth isn't just continuing, it's accelerating. Two things drove it: the shared workspaces launch in July brought in whole teams at once, and better onboarding meant more of those people stayed. I'd be cautious about assuming this pace holds, because part of the jump was a one-off promotion in August.",
      {
        min: 2.5,
        points: ['Added 23k users this quarter, 14k last quarter', 'Shared workspaces and onboarding drove the growth', 'August promotion inflated the quarter'],
        cues: ['Click to reveal the takeaway', 'Be explicit about the one-off promotion'],
        check: ['How many users did we add in Q3?', 'About 23 thousand.'],
      },
    ), 'line'),

    slide('s_q3_04', 'chart', {
      title: 'Revenue by plan',
      rows: [
        { label: 'Team', value: '46', value2: '' },
        { label: 'Business', value: '33', value2: '' },
        { label: 'Starter', value: '14', value2: '' },
        { label: 'Enterprise', value: '7', value2: '' },
      ],
      series: 'Share of revenue', series2: '', unit: '%', unitBefore: false,
      takeaway: 'Team and Business bring in four of every five dollars.',
      values: true, legend: true, reveal: false,
    }, notes(
      "Revenue tells a similar story. Team and Business plans together account for seventy-nine percent of revenue, so roughly four dollars in every five. Starter is fourteen percent, mostly individuals, and Enterprise is only seven percent today, though that slice has the longest sales cycle and the largest contracts. Enterprise is where we expect to see the biggest change next year, which is why a couple of the Q4 priorities later on are aimed squarely at it.",
      {
        min: 2,
        points: ['Team and Business bring in 79% of revenue', 'Enterprise is small today but growing'],
        cues: ['Point at the largest slice first'],
        check: ['Which plans bring in most of our revenue?', 'Team and Business.'],
      },
    ), 'doughnut'),

    slide('s_q3_05', 'table', {
      title: 'Goals and results',
      cells: 'Goal | Target | Result | Status\nWeekly active users | 120k | 128k | Ahead\nOnboarding completion | 70% | 74% | Ahead\nMonthly churn | Under 5% | 4.6% | On track\nMobile app launch | Sep 30 | Oct 14 | Late',
      header: true, stripes: true, caption: 'Targets were set in June.',
    }, notes(
      "Here's the scorecard against what we promised in June. Users and onboarding are ahead of target. Churn is on track at four point six percent against a target of under five. And the one miss is the mobile app, which we planned for the thirtieth of September and shipped on the fourteenth of October, two weeks late. I'll explain what caused the delay in a moment, because it's the most important lesson from this quarter.",
      {
        min: 2,
        points: ['Three of four goals met or ahead', 'Mobile launch slipped by two weeks'],
        cues: ['Say plainly that mobile was late'],
        check: ['How late did the mobile app ship?', 'Two weeks: Oct 14 instead of Sep 30.'],
      },
    )),

    slide('s_q3_06', 'timeline', {
      title: 'What shipped in Q3',
      milestones: [
        { date: 'Jul 8', title: 'Shared workspaces', detail: 'Teams in one place' },
        { date: 'Aug 19', title: 'Mobile beta', detail: '2,000 testers' },
        { date: 'Sep 24', title: 'Faster search', detail: 'Results in under 1 s' },
        { date: 'Oct 14', title: 'Mobile app', detail: 'Two weeks late' },
      ],
      reveal: false,
    }, notes(
      "This is the delivery timeline. Shared workspaces went out on the eighth of July. The mobile beta opened on the nineteenth of August with two thousand testers. Faster search followed on the twenty-fourth of September, with results now under a second. And the full mobile app launched on the fourteenth of October. The delay came from a sync bug we found in beta that took longer to fix than we estimated, and we chose to fix it rather than ship around it.",
      {
        min: 2.5,
        points: ['Four releases in the quarter', 'Mobile slipped because of a sync bug', 'We chose quality over the date'],
        cues: ['Own the delay without excuses'],
        check: ['Why did the mobile app slip?', 'A sync bug found in the beta took longer to fix.'],
      },
    )),

    slide('s_q3_07', 'chart', {
      title: 'Support tickets by theme',
      rows: [
        { label: 'Billing', value: '310', value2: '240' },
        { label: 'Sync', value: '420', value2: '280' },
        { label: 'Mobile', value: '90', value2: '210' },
        { label: 'Search', value: '260', value2: '150' },
      ],
      series: 'Q2', series2: 'Q3', unit: '', unitBefore: false,
      takeaway: 'Sync tickets fell by a third, mobile tickets more than doubled.',
      values: true, legend: true, reveal: true,
    }, notes(
      "Support tickets show where we helped and where we created work. Sync tickets fell by a third, from four hundred and twenty to two hundred and eighty, and search tickets are down too. Billing improved as well. But mobile tickets more than doubled, from ninety to two hundred and ten, which is exactly what you would expect from a beta with two thousand new testers. The question is whether that number comes down after launch, and I'll show you what we're doing about it.",
      {
        min: 2.5,
        points: ['Sync, search and billing tickets fell', 'Mobile tickets more than doubled during the beta'],
        cues: ['Click for the takeaway', 'Expect a question about mobile quality'],
        check: ['Which theme grew the most?', 'Mobile, from 90 to 210 tickets.'],
      },
    ), 'bar'),

    slide('s_q3_08', 'statement', {
      kicker: 'Our focus for Q4',
      statement: 'Make mobile as reliable as the web app.',
      support: 'Beta users stay twice as long, and crash 3.1% of the time.',
    }, notes(
      "This is the one sentence I'd like everyone to remember. Make mobile as reliable as the web app. The upside is clear: beta users stay about twice as long as web-only users. The risk is just as clear: three point one percent of sessions end in a crash, and our target is under half a percent. If we fix reliability, mobile becomes our biggest growth channel. If we don't, the ticket numbers on the previous slide will keep climbing.",
      {
        min: 1.5,
        points: ['Mobile users stay twice as long', 'Crash rate is 3.1% against a 0.5% target'],
        cues: ['Let the statement stand alone for a moment'],
        check: ['How often does the mobile app crash today?', 'In 3.1% of sessions, against a 0.5% target.'],
      },
    ), 'bold'),

    slide('s_q3_09', 'diagram', {
      title: 'Q4 candidates',
      items: [
        { label: 'Crash fixes', detail: 'Mobile stability' },
        { label: 'Offline mode', detail: 'Work without signal' },
        { label: 'Dark mode', detail: 'Polish and contrast' },
        { label: 'Custom reports', detail: 'For Enterprise' },
      ],
      xAxis: 'Effort',
      yAxis: 'Impact',
      reveal: false,
    }, notes(
      "We shortlisted four ideas for Q4 and placed them by effort and impact. Crash fixes sit top left: high impact, comparatively low effort, so they go first. Offline mode is high impact but a big build, so we'd start it and finish in Q1. Dark mode polish is cheap but doesn't change our numbers. Custom reports matter to Enterprise, but they're expensive and can wait. I'd like your reaction to that ordering, especially custom reports.",
      {
        min: 3,
        points: ['Crash fixes come first', 'Offline mode starts in Q4 and finishes in Q1', 'Custom reports can wait'],
        cues: ['Invite pushback on custom reports'],
        check: ['Why do crash fixes come first?', 'High impact for relatively low effort.'],
      },
    ), 'matrix'),

    slide('s_q3_10', 'code', {
      title: 'What changes for API users',
      language: 'HTTP',
      code: 'GET /v1/search?q=roadmap\n  -> deprecated on 31 Jan 2027\n\nGET /v2/search?q=roadmap\n  -> results in under 1 s\n  -> adds "workspace_id"',
      caption: 'Both versions run side by side until January.',
    }, notes(
      "A short note for developers and our partners. The faster search runs on a new version of the endpoint. The old one, slash v1 slash search, keeps working until the thirty-first of January. The new one returns results in under a second and adds a workspace identifier to each result. Both versions run side by side until then, so nothing breaks today, but please plan your migration in Q4.",
      {
        min: 1.5,
        points: ['v1 search is deprecated on 31 January 2027', 'v2 adds workspace_id and is faster'],
        cues: ['Skip this slide if no partners are present'],
      },
    )),

    slide('s_q3_11', 'people', {
      title: 'Who owns Q4',
      people: [
        { photo: '', name: 'Priya Nair', role: 'Mobile reliability' },
        { photo: '', name: 'Tom Alvarez', role: 'Offline mode' },
        { photo: '', name: 'Sam Okafor', role: 'Research and support' },
      ],
    }, notes(
      "Every priority has a named owner. Priya leads mobile reliability, with the crash rate as her single measure. Tom owns offline mode and will report a design review in November. Sam brings together research and support, and will report ticket trends monthly, so we know early if mobile quality isn't improving. If you have questions about any of these, talk to the owner directly, and they'll be in the channel after this call.",
      {
        min: 1.5,
        points: ['Priya owns mobile reliability', 'Tom owns offline mode', 'Sam tracks support trends'],
        cues: ['Ask each owner to unmute and say hello'],
      },
    )),

    slide('s_q3_12', 'summary', {
      title: 'Decisions we need today',
      points: [
        'Approve crash fixes as the top Q4 priority',
        'Approve starting offline mode, finishing in Q1',
        'Agree to move custom reports to Q1 planning',
        'Confirm the v1 API shutdown on 31 January',
      ],
    }, notes(
      "Here are the four decisions we need from you. First, agree that crash fixes are the top priority for Q4. Second, approve starting offline mode now and finishing it in Q1. Third, agree to move custom reports into Q1 planning. Fourth, confirm the thirty-first of January as the final shutdown date for the old search API. If any of these needs more discussion, tell me now, and we'll put it on the agenda for Thursday's planning meeting.",
      {
        min: 2.5,
        points: ['Crash fixes first', 'Offline mode starts now', 'Custom reports move to Q1', 'v1 API shutdown on 31 January'],
        cues: ['Ask for a clear yes or no on each', 'Write the decisions in the notes as they are made'],
      },
    )),

    slide('s_q3_13', 'closing', {
      title: 'Questions?',
      prompts: ['What would you like to see in Q4?', 'Where did this quarter surprise you?'],
      closing: 'Thank you',
    }, notes(
      "That's the Q3 update. Thank you for your time and your feedback this quarter. I'll post the slides, the full numbers and the decision log in the product channel after this call. Now I'd like to hear your questions, and especially anything that surprised you or that you disagree with.",
      { min: 2, cues: ['Pause longer than feels comfortable before the first question'] },
    )),
  ];
}

// ─── Courses and lessons ──────────────────────────────────────────────

interface LessonSpec {
  week: number;
  order: number;
  title: string;
  summary: string;
  /** Days after Monday of the lesson's week. */
  dayOffset: number;
  time: string;
  deckId?: string;
}

interface CourseSpec {
  id: string;
  slug: string;
  title: string;
  subject: string;
  description: string;
  color: CourseColor;
  start: Date;
  weekTitles: Record<number, string>;
  durationMinutes: number;
  meetings: CourseMeeting[];
  lessons: LessonSpec[];
}

export function buildSeed(today: Date): { courses: Course[]; lessons: Lesson[]; decks: Deck[]; notes: Note[] } {
  const base = today.getTime();
  const thisMonday = mondayOf(today);
  // Two weeks back, so today falls in week 3 of the longer courses.
  const earlierStart = addDays(thisMonday, -14);

  // Science classes run on two weekdays: Tuesday and Thursday normally. When the
  // first of those has already passed this week, shift so the week-3 lesson is not in the past.
  const todayDow = (today.getDay() + 6) % 7;
  const earthDays = todayDow <= 1 ? [1, 3] : [todayDow, Math.min(todayDow + 1, 6)];
  const [d1, d2] = earthDays as [number, number];

  const specs: CourseSpec[] = [
    {
      id: 'course_earth',
      slug: 'earth',
      title: 'Earth & Climate',
      subject: 'Science · Year 9',
      description: 'How water, weather and climate shape our planet, and what is changing. Four weeks of evidence, models and discussion.',
      color: 'teal',
      start: earlierStart,
      weekTitles: { 1: 'Water on the move', 2: 'Weather', 3: 'Climate', 4: 'Changing planet' },
      durationMinutes: 50,
      meetings: [{ weekday: d1, time: '09:00', durationMinutes: 50, room: 'Lab 2' }, { weekday: d2, time: '13:30', durationMinutes: 50, room: 'Lab 2' }],
      lessons: [
        { week: 1, order: 1, title: 'The Water Cycle', summary: 'Follow a drop of water through evaporation, condensation, precipitation and collection, and see how little of Earth\'s water is fresh.', dayOffset: d1, time: '09:00', deckId: 'deck_water_cycle' },
        { week: 1, order: 2, title: 'Where Water Is Stored', summary: 'Compare oceans, ice, groundwater and the atmosphere as water stores, and how long a drop stays in each.', dayOffset: d2, time: '13:30' },
        { week: 2, order: 1, title: 'Air Pressure and Wind', summary: 'Explain how differences in air pressure drive wind, and read pressure on a weather map.', dayOffset: d1, time: '09:00' },
        { week: 2, order: 2, title: 'Clouds, Fronts and Forecasts', summary: 'Link cloud types and weather fronts to what the sky does next, and make a simple forecast.', dayOffset: d2, time: '13:30' },
        { week: 3, order: 1, title: 'Weather vs. Climate', summary: 'Separate short-term weather from the 30-year climate pattern, and see what shapes a climate.', dayOffset: d1, time: '09:00', deckId: 'deck_weather_climate' },
        { week: 3, order: 2, title: 'Climate Zones of the World', summary: 'Use temperature and rainfall data to map the major climate zones and explain why they sit where they do.', dayOffset: d2, time: '13:30' },
        { week: 4, order: 1, title: 'The Greenhouse Effect', summary: 'Model how greenhouse gases trap heat, and why more of them warms the planet.', dayOffset: d1, time: '09:00' },
        { week: 4, order: 2, title: 'Evidence and Action', summary: 'Weigh the evidence for a changing climate and compare actions that people and communities can take.', dayOffset: d2, time: '13:30' },
      ],
    },
    {
      id: 'course_writing',
      slug: 'writing',
      title: 'Writing That Works',
      subject: 'Communication · Evening workshop',
      description: 'A practical three-week workshop on clear, useful writing for work: emails, reports and feedback that people act on.',
      color: 'plum',
      start: earlierStart,
      weekTitles: { 1: 'Lead with the point', 2: 'Write for action', 3: 'Polish and share' },
      durationMinutes: 90,
      meetings: [{ weekday: 0, time: '18:30', durationMinutes: 90, room: 'Online' }, { weekday: 2, time: '18:30', durationMinutes: 90, room: 'Online' }],
      lessons: [
        { week: 1, order: 1, title: 'Say the Main Thing First', summary: 'Learn the bottom-line-up-front habit and rewrite buried openings so the point comes first.', dayOffset: 0, time: '18:30', deckId: 'deck_main_thing_first' },
        { week: 1, order: 2, title: 'Cut the Clutter', summary: 'Trim filler, hedges and long sentences without losing warmth or meaning.', dayOffset: 2, time: '18:30' },
        { week: 2, order: 1, title: 'Emails People Act On', summary: 'Structure subject lines, requests and deadlines so busy readers reply the first time.', dayOffset: 2, time: '18:30' },
        { week: 3, order: 1, title: 'Edit Like a Stranger', summary: 'Use a repeatable checklist to review your own draft the way a first-time reader would.', dayOffset: 0, time: '18:30' },
        { week: 3, order: 2, title: 'Feedback Without Friction', summary: 'Give and receive written feedback that is specific, kind and easy to act on.', dayOffset: 2, time: '18:30' },
      ],
    },
    {
      id: 'course_creatures',
      slug: 'creatures',
      title: 'Curious Creatures',
      subject: 'Science · Ages 7–9',
      description: 'A hands-on after-school introduction to animal life for young scientists: homes, food, growing up and staying safe.',
      color: 'amber',
      // Starts this week so the first lesson is today and the deck is ready to teach.
      start: thisMonday,
      weekTitles: { 1: 'Where animals live', 2: 'Growing up and staying safe' },
      durationMinutes: 30,
      meetings: [{ weekday: 0, time: '15:30', durationMinutes: 30, room: 'Library corner' }, { weekday: 3, time: '15:30', durationMinutes: 30, room: 'Library corner' }],
      lessons: [
        { week: 1, order: 1, title: 'Animal Homes', summary: 'Meet burrows and nests, and find out why every animal needs a safe place to live.', dayOffset: 0, time: '15:30', deckId: 'deck_animal_homes' },
        { week: 1, order: 2, title: 'Who Eats What?', summary: 'Sort animals into plant eaters and meat eaters, and match each one to its favourite food.', dayOffset: 3, time: '15:30' },
        { week: 2, order: 1, title: 'From Egg to Adult', summary: 'Follow a frog and a butterfly through their life cycles, one stage at a time.', dayOffset: 0, time: '15:30' },
        { week: 2, order: 2, title: 'Hide and Seek in Nature', summary: 'Discover how camouflage helps animals hide, then play a camouflage spotting game.', dayOffset: 3, time: '15:30' },
      ],
    },
  ];

  const courses: Course[] = specs.map((c, i) => ({
    id: c.id,
    title: c.title,
    subject: c.subject,
    description: c.description,
    color: c.color,
    startDate: isoDate(c.start),
    weekTitles: c.weekTitles,
    meetings: c.meetings,
    createdAt: base - (specs.length - i) * 3 * DAY,
    updatedAt: base - i * 3_600_000,
  }));

  const lessons: Lesson[] = [];
  specs.forEach((c, ci) => {
    c.lessons.forEach((l, li) => {
      lessons.push({
        id: `lesson_${c.slug}_w${l.week}_${l.order}`,
        courseId: c.id,
        week: l.week,
        order: l.order,
        title: l.title,
        summary: l.summary,
        date: isoDate(addDays(c.start, (l.week - 1) * 7 + l.dayOffset)),
        time: l.time,
        durationMinutes: c.durationMinutes,
        ...(l.deckId ? { deckId: l.deckId } : {}),
        createdAt: base - (specs.length - ci) * 3 * DAY + li * 1000,
        updatedAt: base - ci * 3_600_000 - li * 1000,
      });
    });
  });

  const decks: Deck[] = [
    deck({
      id: 'deck_water_cycle', title: 'The Water Cycle', themeId: 'paper', audience: 'teen',
      lessonId: 'lesson_earth_w1_1', slides: waterCycleSlides(),
      createdAt: base - 6 * DAY, updatedAt: base - 2 * 3_600_000,
    }),
    deck({
      id: 'deck_weather_climate', title: 'Weather vs. Climate', themeId: 'campus', audience: 'teen',
      lessonId: 'lesson_earth_w3_1', slides: weatherClimateSlides(),
      createdAt: base - 2 * DAY, updatedAt: base - 3 * 3_600_000,
    }),
    deck({
      id: 'deck_main_thing_first', title: 'Say the Main Thing First', themeId: 'minimal', audience: 'adult',
      lessonId: 'lesson_writing_w1_1', slides: mainThingSlides(),
      createdAt: base - 4 * DAY, updatedAt: base - 4 * 3_600_000,
    }),
    deck({
      id: 'deck_animal_homes', title: 'Animal Homes', themeId: 'sunny', audience: 'young',
      lessonId: 'lesson_creatures_w1_1', slides: animalHomesSlides(),
      createdAt: base - 1 * DAY, updatedAt: base - 5 * 3_600_000,
    }),
    deck({
      id: 'deck_meetings_talk', title: 'Designing Meetings People Want to Attend', themeId: 'minimal', audience: 'adult',
      purpose: 'talk', slides: meetingsSlides(),
      createdAt: base - 3 * DAY, updatedAt: base - 20 * 60_000,
    }),
    deck({
      id: 'deck_q3_update', title: 'Q3 Product Update', themeId: 'midnight', audience: 'adult',
      purpose: 'report', slides: q3UpdateSlides(),
      createdAt: base - 2 * DAY, updatedAt: base - 50 * 60_000,
    }),
  ];

  const notes = buildSeedNotes(today, isoDate(today), lessons);

  return { courses, lessons, decks, notes };
}
