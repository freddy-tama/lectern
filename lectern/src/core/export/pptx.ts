// PowerPoint export. The same positioned boxes the on-screen renderer draws are
// written as native, editable PowerPoint objects, so what the presenter rehearsed
// is what the file shows. Reveal steps become on-click "Appear" animations
// (animate), extra slides (build) or are all shown at once (final).

import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import type { Deck, KeyNotes } from '../deck/types';
import { type Box, type ChartBox, type ImageBox, type ShapeBox, type TableBox, type TextBox, PT_PER_PX, PX_PER_INCH } from '../engine/boxes';
import { layoutDeck } from '../engine/layout';
import { type Theme, fontFamily, fontWeight, getTheme } from '../engine/themes';

export type StepMode = 'animate' | 'build' | 'final';

export interface PptxOptions {
  /** How reveal steps are exported. Default 'animate'. */
  steps?: StepMode;
  /** Put the key notes in the speaker notes. Default true. */
  includeNotes?: boolean;
  /** Turns an image source into a data: URL, or null to skip the image. Default: data: URLs pass, others are skipped. */
  resolveImage?: (src: string) => Promise<string | null>;
  /** Default 'blob' in browsers, 'nodebuffer' otherwise. */
  output?: 'blob' | 'nodebuffer';
  /** A credit line for each picture source. Slides that show a credited picture get it in their speaker notes. */
  credits?: Record<string, string>;
}

export interface PptxResult {
  data: Blob | Uint8Array;
  fileName: string;
  warnings: string[];
}

const CANVAS_IN = { w: 1920 / PX_PER_INCH, h: 1080 / PX_PER_INCH };
/** PowerPoint's single line spacing is about 1.2 × the font size; layout line heights are CSS multiples. */
const NATURAL_LINE = 1.2;

const inches = (px: number) => px / PX_PER_INCH;
const round = (n: number, places = 4) => Number(n.toFixed(places));
const round2 = (n: number) => round(n, 2);
const round4 = (n: number) => round(n, 4);

function hex(color: string | undefined, fallback = '000000'): string {
  const h = String(color ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) return h.split('').map((c) => c + c).join('').toUpperCase();
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return h.slice(0, 6).toUpperCase();
  return fallback;
}

const transparencyOf = (opacity: number | undefined) =>
  opacity == null || opacity >= 1 ? undefined : Math.round((1 - Math.max(0, opacity)) * 100);

/** Plain-text speaker notes for one slide. Empty sections are left out. */
export function keyNotesText(notes: KeyNotes): string {
  const blocks: string[] = [];
  const script = (notes.script ?? '').trim();
  if (script) blocks.push(script);
  const points = (notes.keyPoints ?? []).filter(Boolean);
  if (points.length) blocks.push(['Key points', ...points.map((p) => `• ${p}`)].join('\n'));
  const lines: string[] = [];
  const cues = (notes.cues ?? []).filter(Boolean);
  if (cues.length) lines.push(`Cues: ${cues.join(' · ')}`);
  if (notes.check?.question) lines.push(`Check: ${notes.check.question}${notes.check.answer ? ` — ${notes.check.answer}` : ''}`);
  if (notes.minutes > 0) lines.push(`About ${notes.minutes} min`);
  const links = (notes.links ?? []).filter((l) => l.url);
  if (links.length) lines.push(`Links: ${links.map((l) => (l.label ? `${l.label} — ${l.url}` : l.url)).join('; ')}`);
  if (lines.length) blocks.push(lines.join('\n'));
  return blocks.join('\n\n');
}

/** The speaker-notes block that credits the pictures on one slide. Empty when none of them has a credit. */
export function pictureCreditsText(boxes: Box[], credits: Record<string, string> | undefined): string {
  if (!credits) return '';
  const lines = [...new Set(boxes.filter((b): b is ImageBox => b.type === 'image').map((b) => credits[b.src]?.trim()).filter(Boolean))];
  return lines.length ? [lines.length === 1 ? 'Picture credit' : 'Picture credits', ...lines.map((l) => `• ${l}`)].join('\n') : '';
}

function safeFileName(title: string): string {
  const base = (title ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80)
    .trim();
  return `${base || 'Lesson'}.pptx`;
}

// ─── Images ───────────────────────────────────────────────────────────

interface ImageData { data: string; width: number; height: number }

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Pixel size from the file header of a PNG, JPEG, GIF or WebP. */
function readImageSize(b: Uint8Array): { width: number; height: number } | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32be(16), height: u32be(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
    return null;
  }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (tag === 'VP8 ') return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
    if (tag === 'VP8L') {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** Normalises a data: URL to the "image/png;base64,…" form pptxgenjs expects, and reads the image size. */
function parseDataUrl(url: string): ImageData | { error: string } {
  const m = /^data:([^;,]+)((?:;[^;,]*)*),([\s\S]*)$/i.exec(url.trim());
  if (!m) return { error: 'not a data: URL' };
  const mime = m[1].toLowerCase();
  if (!mime.startsWith('image/')) return { error: `unsupported type ${mime}` };
  if (mime.includes('svg')) return { error: 'SVG images are not supported in PowerPoint export' };
  let b64: string;
  if (/;base64/i.test(m[2])) b64 = m[3].replace(/\s+/g, '');
  else b64 = bytesToBase64(new TextEncoder().encode(decodeURIComponent(m[3])));
  const size = readImageSize(base64ToBytes(b64));
  return { data: `${mime};base64,${b64}`, width: size?.width ?? 0, height: size?.height ?? 0 };
}

// ─── Boxes → PowerPoint objects ───────────────────────────────────────

interface PageMeta {
  /** Rounded pictures: object name → corner radius as an OOXML adjust value. */
  rounded: Map<string, number>;
}

interface Ctx {
  theme: Theme;
  warnings: string[];
  images: Map<string, ImageData | null>;
}

function textOptions(box: TextBox, theme: Theme, name: string): PptxGenJS.TextPropsOptions {
  const s = box.style;
  const face = fontFamily(theme, s.font, 'pptx');
  const weight = s.weight ?? fontWeight(theme, s.font);
  const sizePt = round(s.size * PT_PER_PX, 2);
  const opts: PptxGenJS.TextPropsOptions = {
    x: round(inches(box.x)), y: round(inches(box.y)), w: round(inches(box.w)), h: round(inches(box.h)),
    objectName: name,
    fontFace: face,
    fontSize: sizePt,
    bold: weight >= 600 && !/semibold|bold|black|heavy/i.test(face),
    italic: !!s.italic,
    color: hex(s.color),
    align: s.align ?? 'left',
    valign: s.valign ?? 'top',
    margin: 0,
    fit: 'none',
    wrap: true,
  };
  if (s.lineHeight) opts.lineSpacingMultiple = round(Math.min(9, Math.max(0.5, s.lineHeight / NATURAL_LINE)), 3);
  if (s.tracking) opts.charSpacing = round(s.tracking * sizePt, 2);
  const t = transparencyOf(box.opacity);
  if (t != null) opts.transparency = t;
  return opts;
}

function addText(slide: PptxGenJS.Slide, box: TextBox, ctx: Ctx, name: string) {
  const value = box.style.uppercase ? box.text.toUpperCase() : box.text;
  slide.addText(value, textOptions(box, ctx.theme, name));
}

function addShape(slide: PptxGenJS.Slide, pptx: PptxGenJS, box: ShapeBox, name: string) {
  const t = transparencyOf(box.opacity);
  const base = { x: round(inches(box.x)), y: round(inches(box.y)), w: round(inches(Math.max(0, box.w))), h: round(inches(Math.max(0, box.h))), objectName: name };
  if (box.shape === 'line') {
    const color = box.stroke ?? box.fill;
    slide.addShape(pptx.ShapeType.line, {
      ...base,
      line: { color: hex(color), width: round((box.strokeWidth ?? 2) * PT_PER_PX, 2), dashType: box.dash ? 'dash' : 'solid', ...(t != null ? { transparency: t } : {}) },
    });
    return;
  }
  const opts: PptxGenJS.ShapeProps = { ...base };
  opts.fill = box.fill ? { color: hex(box.fill), ...(t != null ? { transparency: t } : {}) } : { type: 'none' };
  const sw = (box.strokeWidth ?? 0) * PT_PER_PX;
  opts.line = box.stroke && sw > 0
    ? { color: hex(box.stroke), width: round(sw, 2), ...(t != null ? { transparency: t } : {}) }
    : { type: 'none' };
  if (box.shape === 'ellipse') {
    slide.addShape(pptx.ShapeType.ellipse, opts);
  } else if (box.radius && box.radius > 0) {
    // pptxgenjs takes the corner radius in inches; PowerPoint allows at most half the short side.
    opts.rectRadius = round(inches(Math.min(box.radius, Math.min(box.w, box.h) / 2)));
    slide.addShape(pptx.ShapeType.roundRect, opts);
  } else {
    slide.addShape(pptx.ShapeType.rect, opts);
  }
}

function addImage(slide: PptxGenJS.Slide, box: ImageBox, ctx: Ctx, name: string, meta: PageMeta) {
  const img = ctx.images.get(box.src);
  if (!img) return;
  const bx = inches(box.x);
  const by = inches(box.y);
  const bw = inches(box.w);
  const bh = inches(box.h);
  const opts: PptxGenJS.ImageProps = { data: img.data, x: round(bx), y: round(by), w: round(bw), h: round(bh), objectName: name, altText: box.alt || 'Image' };
  let shapeW = box.w;
  let shapeH = box.h;
  if (img.width > 0 && img.height > 0) {
    const ratio = img.height / img.width;
    if (box.fit === 'cover') {
      // pptxgenjs: w/h describe the picture's own proportions, sizing describes the frame it is cropped to.
      opts.w = round(bw);
      opts.h = round(bw * ratio);
      opts.sizing = { type: 'cover', w: round(bw), h: round(bh) };
    } else {
      // Contain: place the picture itself at the fitted size, centred in the frame.
      const fitW = ratio > box.h / box.w ? box.h / ratio : box.w;
      const fitH = ratio > box.h / box.w ? box.h : box.w * ratio;
      opts.x = round(inches(box.x + (box.w - fitW) / 2));
      opts.y = round(inches(box.y + (box.h - fitH) / 2));
      opts.w = round(inches(fitW));
      opts.h = round(inches(fitH));
      shapeW = fitW;
      shapeH = fitH;
    }
  }
  const t = transparencyOf(box.opacity);
  if (t != null) opts.transparency = t;
  slide.addImage(opts);
  if (box.radius && box.radius > 0) {
    const adj = Math.round(Math.min(0.5, box.radius / Math.min(shapeW, shapeH)) * 100000);
    meta.rounded.set(name, adj);
  }
}

/** An Excel number format for chart values: "$"#,##0 or #,##0.0"%". */
function numberFormat(box: ChartBox): string {
  const decimals = Math.max(0, Math.min(4, box.decimals ?? 0));
  const body = decimals ? `#,##0.${'0'.repeat(decimals)}` : '#,##0';
  const unit = (box.unit ?? '').replace(/["&<>\\]/g, '');
  if (!unit) return body;
  if (box.unitPosition === 'before') return `"${unit}"${body}`;
  return `${body}"${/^[\p{L}]{2,}/u.test(unit) ? ' ' : ''}${unit}"`;
}

function addChart(slide: PptxGenJS.Slide, pptx: PptxGenJS, box: ChartBox, ctx: Ctx, name: string) {
  const round = box.chart === 'pie' || box.chart === 'doughnut';
  const face = fontFamily(ctx.theme, box.font, 'pptx');
  const pt = round2(box.fontSize * PT_PER_PX);
  const text = hex(box.textColor);
  let labels = box.labels.map((l) => l || ' ');
  let series = round ? box.series.slice(0, 1) : box.series;
  if (box.chart === 'bar') {
    // PowerPoint lists bar categories bottom-up; reverse so the first row is on top, as on screen.
    labels = [...labels].reverse();
    series = series.map((s) => ({ ...s, values: [...s.values].reverse() }));
  }
  const data = series.map((s) => ({ name: s.name, labels, values: s.values.map((v) => (Number.isFinite(v) ? v : 0)) }));
  const format = numberFormat(box);
  const opts: PptxGenJS.IChartOpts = {
    x: round4(inches(box.x)), y: round4(inches(box.y)), w: round4(inches(box.w)), h: round4(inches(box.h)),
    objectName: name,
    altText: `${box.chart} chart: ${box.labels.join(', ')}`,
    chartColors: box.colors.map((c) => hex(c)),
    showLegend: !!box.showLegend,
    legendPos: round ? 'r' : 't',
    legendFontFace: face, legendFontSize: pt, legendColor: text,
    showValue: !!box.showValues,
    showPercent: false,
    showLabel: false,
    dataLabelFontFace: face, dataLabelFontSize: pt,
    dataLabelColor: hex(round ? box.insideColor ?? box.valueColor ?? box.textColor : box.valueColor ?? box.textColor),
    dataLabelFormatCode: format,
    dataNoEffects: true,
  };
  if (round) {
    opts.firstSliceAng = 0;
    opts.dataBorder = { pt: 2, color: hex(box.edgeColor, 'FFFFFF') };
    if (box.chart === 'pie') opts.dataLabelPosition = 'ctr';
    else opts.holeSize = 55;
  } else {
    Object.assign(opts, {
      catAxisLabelColor: text, catAxisLabelFontFace: face, catAxisLabelFontSize: pt,
      catAxisLineShow: true, catAxisLineColor: hex(box.gridColor), catAxisLineSize: 1.5, catAxisMajorTickMark: 'none',
      valAxisLabelColor: text, valAxisLabelFontFace: face, valAxisLabelFontSize: pt,
      valAxisLineShow: false, valAxisMajorTickMark: 'none', valAxisLabelFormatCode: format,
      valGridLine: { color: hex(box.gridColor), size: 1, style: 'solid' },
      catGridLine: { style: 'none' },
    } satisfies PptxGenJS.IChartOpts);
    if (box.axis) {
      opts.valAxisMinVal = box.axis.min;
      opts.valAxisMaxVal = box.axis.max;
      opts.valAxisMajorUnit = box.axis.step;
    }
    if (box.chart === 'line') {
      opts.lineSize = 3;
      opts.lineDataSymbol = 'circle';
      opts.lineDataSymbolSize = 8;
      opts.lineDataSymbolLineColor = hex(box.edgeColor, 'FFFFFF');
      opts.lineDataSymbolLineSize = 1;
      opts.dataLabelPosition = 't';
    } else {
      opts.barDir = box.chart === 'bar' ? 'bar' : 'col';
      opts.barGrouping = 'clustered';
      opts.barGapWidthPct = 60;
      opts.barOverlapPct = -12;
      opts.dataLabelPosition = 'outEnd';
    }
  }
  const type = round ? (box.chart === 'pie' ? pptx.ChartType.pie : pptx.ChartType.doughnut) : box.chart === 'line' ? pptx.ChartType.line : pptx.ChartType.bar;
  slide.addChart(type, data, opts);
}

function addTable(slide: PptxGenJS.Slide, box: TableBox, ctx: Ctx, name: string) {
  const face = fontFamily(ctx.theme, box.font, 'pptx');
  const pt = round2(box.fontSize * PT_PER_PX);
  const padX = round4(inches(box.padX ?? box.fontSize * 0.65));
  const padY = round4(inches(box.padY ?? box.fontSize * 0.42));
  const line: PptxGenJS.BorderProps = { type: 'solid', pt: 0.75, color: hex(box.lineColor) };
  const none: PptxGenJS.BorderProps = { type: 'none' };
  const boldFace = /semibold|bold|black|heavy/i.test(face);
  const lh = box.lineHeight ?? 1.25;
  const rows: PptxGenJS.TableRow[] = box.rows.map((row, i) => {
    const head = box.header && i === 0;
    const bodyIndex = box.header ? i - 1 : i;
    const fill = head ? box.headerFill : box.stripeFill && bodyIndex % 2 === 1 ? box.stripeFill : undefined;
    return row.map((cell, j) => ({
      text: cell,
      options: {
        fontFace: face, fontSize: pt,
        bold: !boldFace && (head ? box.headerWeight ?? 700 : box.weight ?? 400) >= 600,
        color: hex(head ? box.headerText : box.textColor),
        align: box.align?.[j] ?? 'left',
        valign: 'middle',
        margin: [padY, padX, padY, padX],
        lineSpacingMultiple: round(Math.min(9, Math.max(0.5, lh / NATURAL_LINE)), 3),
        border: [none, none, head ? none : line, none],
        ...(fill ? { fill: { color: hex(fill) } } : {}),
      },
    }));
  });
  slide.addTable(rows, {
    x: round4(inches(box.x)), y: round4(inches(box.y)), w: round4(inches(box.w)), h: round4(inches(box.h)),
    colW: box.colWidths.map((w) => round4(inches(w))),
    rowH: box.rowHeights.map((h) => round4(inches(h))),
    objectName: name,
    fontFace: face, fontSize: pt,
  });
}

/** Names carry the reveal step so the animation pass can find the shapes: s{step}-{id}. */
function objectName(box: Box, used: Set<string>): string {
  const base = `s${box.step ?? 0}-${String(box.id).replace(/[^A-Za-z0-9_.-]+/g, '_')}`;
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
  used.add(name);
  return name;
}

// ─── Post-processing the written file ─────────────────────────────────

const SHAPE_BLOCK = /<p:(sp|pic|graphicFrame)>[\s\S]*?<\/p:\1>/g;
const NAMED = /<p:cNvPr id="(\d+)" name="s(\d+)-[^"]*"/;

interface Click { step: number; targets: { spid: number; text: boolean }[] }

/**
 * pptxgenjs numbers a table's frame from the slide number, which can repeat
 * another shape's id. Give every table frame an id no other shape uses.
 */
function uniqueFrameIds(xml: string): string {
  const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((m) => Number(m[1]));
  let next = Math.max(1, ...ids) + 1;
  return xml.replace(/<p:graphicFrame>(\s*<p:nvGraphicFramePr>\s*<p:cNvPr id=")(\d+)("[\s\S]*?<\/p:graphicFrame>)/g, (all, head: string, _id: string, rest: string) => (
    rest.includes('<a:tbl>') ? `<p:graphicFrame>${head}${next++}${rest}` : all
  ));
}

/** The shapes that appear on each click, in step order. */
function clicksOf(xml: string): Click[] {
  const byStep = new Map<number, Click>();
  for (const block of xml.match(SHAPE_BLOCK) ?? []) {
    const hit = NAMED.exec(block);
    if (!hit) continue;
    const step = Number(hit[2]);
    if (step < 1) continue;
    const click = byStep.get(step) ?? { step, targets: [] };
    click.targets.push({ spid: Number(hit[1]), text: block.startsWith('<p:sp>') });
    byStep.set(step, click);
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

function appear(id: number, spid: number, first: boolean): string {
  return `<p:par><p:cTn id="${id}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="${first ? 'clickEffect' : 'withEffect'}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>`
    + `<p:set><p:cBhvr><p:cTn id="${id + 1}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>`
    + '<p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par>';
}

/** A `<p:timing>` with one click per step; everything in a step appears together on its click. */
function timingXml(clicks: Click[]): string {
  let id = 3;
  const sequence = clicks.map((click) => {
    const own = id;
    id += 2;
    const effects = click.targets.map((t, i) => {
      const xml = appear(id, t.spid, i === 0);
      id += 2;
      return xml;
    }).join('');
    return `<p:par><p:cTn id="${own}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${own + 1}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
  }).join('');
  const built = clicks.flatMap((c) => c.targets).filter((t) => t.text).map((t) => `<p:bldP spid="${t.spid}" grpId="0" animBg="1"/>`);
  return '<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
    + `${sequence}</p:childTnLst></p:cTn>`
    + '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>'
    + `${built.length ? `<p:bldLst>${built.join('')}</p:bldLst>` : ''}</p:timing>`;
}

function roundPictures(xml: string, rounded: Map<string, number>): string {
  if (!rounded.size) return xml;
  return xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (block) => {
    const name = /<p:cNvPr id="\d+" name="([^"]*)"/.exec(block)?.[1];
    const adj = name != null ? rounded.get(name) : undefined;
    if (adj == null) return block;
    return block.replace('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`);
  });
}

/** pptxgenjs writes the whole note as one run with line breaks inside; PowerPoint wants one paragraph per line. */
function splitNotesParagraphs(xml: string): string {
  return xml.replace(
    /<a:p><a:r><a:rPr lang="en-US" dirty="0"\/><a:t>([\s\S]*?)<\/a:t><\/a:r><a:endParaRPr lang="en-US" dirty="0"\/><\/a:p>/,
    (_all, body: string) => body.split(/\r?\n/).map((line) => (line
      ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${line}</a:t></a:r></a:p>`
      : '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>')).join(''),
  );
}

async function postProcess(buffer: ArrayBuffer, pages: PageMeta[], animate: boolean[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(buffer);
  for (let i = 0; i < pages.length; i++) {
    const path = `ppt/slides/slide${i + 1}.xml`;
    const file = zip.file(path);
    if (!file) continue;
    let xml = await file.async('string');
    xml = uniqueFrameIds(roundPictures(xml, pages[i].rounded));
    if (animate[i] && !/<p:timing[ >]/.test(xml)) {
      const clicks = clicksOf(xml);
      if (clicks.length) {
        const timing = timingXml(clicks);
        xml = xml.includes('</p:clrMapOvr>') ? xml.replace('</p:clrMapOvr>', `</p:clrMapOvr>${timing}`) : xml.replace('</p:sld>', `${timing}</p:sld>`);
      }
    }
    zip.file(path, xml);
  }
  for (const path of Object.keys(zip.files)) {
    if (!/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(path)) continue;
    const xml = await zip.file(path)!.async('string');
    zip.file(path, splitNotesParagraphs(xml));
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// ─── Export ───────────────────────────────────────────────────────────

async function loadImages(sources: string[], options: PptxOptions, warnings: string[]): Promise<Map<string, ImageData | null>> {
  const out = new Map<string, ImageData | null>();
  for (const src of sources) {
    if (out.has(src)) continue;
    try {
      const url = options.resolveImage ? await options.resolveImage(src) : (src.startsWith('data:') ? src : null);
      if (!url) {
        warnings.push(`An image was left out because it could not be loaded (${src.slice(0, 40)}).`);
        out.set(src, null);
        continue;
      }
      const parsed = parseDataUrl(url);
      if ('error' in parsed) {
        warnings.push(`An image was left out: ${parsed.error}.`);
        out.set(src, null);
      } else {
        if (!parsed.width) warnings.push('An image size could not be read, so it is stretched to its frame.');
        out.set(src, parsed);
      }
    } catch (error) {
      warnings.push(`An image was left out: ${error instanceof Error ? error.message : String(error)}.`);
      out.set(src, null);
    }
  }
  return out;
}

export async function exportDeckToPptx(deck: Deck, options: PptxOptions = {}): Promise<PptxResult> {
  const mode: StepMode = options.steps ?? 'animate';
  const includeNotes = options.includeNotes ?? true;
  const warnings: string[] = [];
  const theme = getTheme(deck.themeId);
  const laid = layoutDeck(deck, { target: 'pptx', mode: 'show' });

  const sources = laid.flatMap(({ layout }) => layout.boxes.filter((b): b is ImageBox => b.type === 'image').map((b) => b.src));
  const images = await loadImages(sources, options, warnings);
  const ctx: Ctx = { theme, warnings, images };

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'LECTERN_16x9', width: CANVAS_IN.w, height: CANVAS_IN.h });
  pptx.layout = 'LECTERN_16x9';
  pptx.title = deck.title || 'Lesson';
  pptx.company = 'Lectern';
  pptx.subject = '';
  pptx.author = '';

  const pages: PageMeta[] = [];
  const animate: boolean[] = [];

  laid.forEach(({ slide, layout }, index) => {
    const label = `Slide ${index + 1}`;
    const steps = layout.steps;
    // Build mode: one copy per step, each showing what is revealed so far.
    const shown = mode === 'build' ? Array.from({ length: steps + 1 }, (_, k) => k) : [Infinity];
    for (const upTo of shown) {
      const page = pptx.addSlide();
      const meta: PageMeta = { rounded: new Map() };
      page.background = { color: hex(layout.background, 'FFFFFF') };
      const used = new Set<string>();
      for (const box of layout.boxes) {
        if ((box.step ?? 0) > upTo) continue;
        try {
          const name = objectName(box, used);
          if (box.type === 'text') {
            addText(page, box, ctx, name);
            if (box.overflow) warnings.push(`${label}: some text may not fit its box.`);
          } else if (box.type === 'shape') addShape(page, pptx, box, name);
          else if (box.type === 'image') addImage(page, box, ctx, name, meta);
          else if (box.type === 'chart') addChart(page, pptx, box, ctx, name);
          else if (box.type === 'table') addTable(page, box, ctx, name);
        } catch (error) {
          warnings.push(`${label}: a ${box.type} could not be exported (${error instanceof Error ? error.message : String(error)}).`);
        }
      }
      const notes = [includeNotes && slide.notes ? keyNotesText(slide.notes) : '', pictureCreditsText(layout.boxes, options.credits)].filter(Boolean).join('\n\n');
      if (notes) page.addNotes(notes);
      pages.push(meta);
      animate.push(mode === 'animate' && steps > 0);
    }
  });

  if (!laid.length) pptx.addSlide();

  const written = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  const bytes = await postProcess(written, pages, animate);
  const wantBlob = (options.output ?? (typeof Blob !== 'undefined' && typeof window !== 'undefined' ? 'blob' : 'nodebuffer')) === 'blob' && typeof Blob !== 'undefined';
  const data: Blob | Uint8Array = wantBlob
    ? new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
    : bytes;
  return { data, fileName: safeFileName(deck.title), warnings: [...new Set(warnings)] };
}
