// Chinese, Japanese and Korean text in a PowerPoint file. pptxgenjs writes one font name into
// <a:latin>, <a:ea> and <a:cs> and marks every run en-US. A Latin theme font has no hanzi, so
// PowerPoint picks a fallback of its own and proofs the text as English. These helpers find the
// language of a run and the East Asian font that suits it, for the XML pass in pptx.ts.

export type CjkLang = 'zh-CN' | 'ja-JP' | 'ko-KR';

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const HAN = /\p{Script=Han}/u;

/** The language of CJK text, or null when it has none. Kana wins over Han, since Japanese mixes both. */
export function cjkLang(text: string): CjkLang | null {
  if (KANA.test(text)) return 'ja-JP';
  if (HANGUL.test(text)) return 'ko-KR';
  if (HAN.test(text)) return 'zh-CN';
  return null;
}

/** The East Asian typeface written for each language. */
export const EA_FONT: Record<CjkLang, string> = {
  'zh-CN': 'Microsoft YaHei',
  'ja-JP': 'Yu Gothic',
  'ko-KR': 'Malgun Gothic',
};

/** Fonts that already have CJK glyphs; a box that asks for one keeps it. */
const CJK_FONT = /yahei|simsun|simhei|kaiti|fangsong|nsimsun|dengxian|songti|heiti|kaiu|mingliu|pingfang|hiragino|yu gothic|yu mincho|meiryo|ms p?gothic|ms p?mincho|malgun|batang|gulim|dotum|noto (sans|serif) (cjk|sc|tc|jp|kr)|source han|wenquanyi|stkaiti|stsong|stheiti|stfangsong|宋体|黑体|楷体|仿宋|微软雅黑|等线/i;

export function isCjkFont(face: string): boolean {
  return CJK_FONT.test(face);
}

/** Rewrites one run's properties: its language, and an East Asian font unless the one named already is. */
export function tagRun(rPr: string, lang: CjkLang): string {
  let out = rPr.replace(/ lang="[^"]*"/, ` lang="${lang}"`);
  if (!/ altLang="/.test(out)) out = out.replace(` lang="${lang}"`, ` lang="${lang}" altLang="en-US"`);
  return out.replace(/<a:ea typeface="([^"]*)"[^>]*\/>/, (all, face: string) => (isCjkFont(face) ? all : `<a:ea typeface="${EA_FONT[lang]}"/>`));
}

const RUN = /<a:r>(<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>))(<a:t>)([^<]*)(<\/a:t><\/a:r>)/g;

/** Tags every text run that holds CJK characters, in a slide's XML. Runs without any are left as written. */
export function tagCjkRuns(xml: string): string {
  return xml.replace(RUN, (all, rPr: string, open: string, text: string, close: string) => {
    const lang = cjkLang(text);
    return lang ? `<a:r>${tagRun(rPr, lang)}${open}${text}${close}` : all;
  });
}

/** Chart text has no runs to tag: give every font in a chart that shows CJK an East Asian partner. */
export function tagCjkChart(xml: string): string {
  const lang = cjkLang([...xml.matchAll(/<(?:c:v|a:t)>([^<]*)</g)].map((m) => m[1]).join(' '));
  if (!lang) return xml;
  return xml.replace(/<a:latin typeface="([^"]*)"([^>]*)\/>(?!<a:ea )/g, (all, face: string) => (isCjkFont(face) ? all : `${all}<a:ea typeface="${EA_FONT[lang]}"/>`));
}
