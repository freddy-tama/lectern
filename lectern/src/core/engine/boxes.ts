// A slide is drawn as a flat list of positioned boxes on a 1920 × 1080 canvas.
// The same list feeds the on-screen renderer and the PowerPoint exporter, so
// what the presenter rehearses is what the exported file shows.

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;
/** PowerPoint 16:9 is 13.333 × 7.5 in, so 1 in = 144 canvas px. */
export const PX_PER_INCH = 144;
/** 960 pt across 1920 px. */
export const PT_PER_PX = 0.5;

export type FontRole = 'display' | 'body' | 'mono';

export interface TextStyle {
  font: FontRole;
  /** Font size in canvas px. */
  size: number;
  weight?: number;
  italic?: boolean;
  color: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  /** Letter spacing in em. */
  tracking?: number;
  uppercase?: boolean;
}

interface BoxBase {
  /** Stable within a slide; used for keys and click-to-edit. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Reveal step. 0 is always visible. Step n appears after the presenter
   * advances n times on this slide.
   */
  step?: number;
  /** Content field this box shows, so a click on the canvas can focus it in the editor. */
  bind?: string;
  /**
   * The id of the box this one belongs to, such as a list item's marker. When someone moves or
   * resizes that box on the canvas, this one goes with it.
   */
  moveWith?: string;
  /**
   * Dragging this box on the canvas writes where its centre lands into content fields, as
   * percentages across and down the box named by `within`, instead of storing an override.
   */
  drag?: { x: string; y: string; within: string };
  /** Hidden until the step, then emphasised (for answers). */
  reveal?: 'answer';
  opacity?: number;
}

export interface TextBox extends BoxBase {
  type: 'text';
  text: string;
  style: TextStyle;
  /** True when the text could not fit at the smallest allowed size. */
  overflow?: boolean;
}

export interface ShapeBox extends BoxBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  /** Lines only: dashed stroke. */
  dash?: boolean;
}

export interface ImageBox extends BoxBase {
  type: 'image';
  /** data: URL, http(s) URL, or "asset:<id>" resolved by the host. */
  src: string;
  fit: 'cover' | 'contain';
  radius?: number;
  alt?: string;
}

/** One data series of a chart. */
export interface ChartSeries {
  name: string;
  values: number[];
}

/** A chart drawn as SVG on screen and as a native, editable chart in PowerPoint. */
export interface ChartBox extends BoxBase {
  type: 'chart';
  chart: 'column' | 'bar' | 'line' | 'pie' | 'doughnut';
  /** Category labels (x axis, or slices for pie and doughnut). */
  labels: string[];
  series: ChartSeries[];
  /** Colours in order: one per series, or one per slice for pie and doughnut. */
  colors: string[];
  font: FontRole;
  /** Axis, label and legend text size in canvas px. */
  fontSize: number;
  /** Axis labels and legend. */
  textColor: string;
  /** Value labels beside bars, points and lines (default textColor). */
  valueColor?: string;
  /** Value labels drawn on pie and doughnut slices. */
  insideColor?: string;
  gridColor: string;
  /** Gaps between slices and the fill of line markers, usually the slide background. */
  edgeColor?: string;
  showValues?: boolean;
  showLegend?: boolean;
  /** Suffix or prefix shown with values, for example "%" or "$". */
  unit?: string;
  unitPosition?: 'before' | 'after';
  /** Decimal places shown in value labels. */
  decimals?: number;
  /** Value axis range and gridline spacing (column, bar and line). */
  axis?: { min: number; max: number; step: number };
}

/** A table drawn as positioned cells on screen and as a native table in PowerPoint. */
export interface TableBox extends BoxBase {
  type: 'table';
  /** Cell text, row by row. When header is true the first row is the header. */
  rows: string[][];
  header: boolean;
  /** Column widths in canvas px; they add up to w. */
  colWidths: number[];
  /** Row heights in canvas px; they add up to h. */
  rowHeights: number[];
  font: FontRole;
  /** Cell text size in canvas px. */
  fontSize: number;
  weight?: number;
  headerWeight?: number;
  lineHeight?: number;
  /** Cell padding in canvas px. */
  padX?: number;
  padY?: number;
  textColor: string;
  headerFill: string;
  headerText: string;
  /** Fill for every other body row, if any. */
  stripeFill?: string;
  lineColor: string;
  /** Per-column alignment. */
  align?: ('left' | 'center' | 'right')[];
}

/**
 * A video: a stored file ("asset:<id>"), a link to a video file, or a YouTube or Vimeo page.
 * It plays on screen; PowerPoint gets the file embedded, YouTube as an online video, others as a link.
 */
export interface VideoBox extends BoxBase {
  type: 'video';
  src: string;
  fit: 'cover' | 'contain';
  radius?: number;
  /** Seconds to start from. */
  start?: number;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  title?: string;
  /** Placeholder colours, for thumbnails and copies that can't play the video. */
  fill: string;
  ink: string;
}

/**
 * Live content in a frame: an activity's own HTML (sandboxed, no network) or a web page.
 * Thumbnails and PowerPoint show a still card instead.
 */
export interface EmbedBox extends BoxBase {
  type: 'embed';
  /** A complete HTML document, run in a sandbox. */
  html?: string;
  /** A web page to frame instead. */
  url?: string;
  /** Where people open it themselves, for links and QR codes in copies. */
  openUrl?: string;
  title: string;
  radius?: number;
  fill: string;
  ink: string;
  accent: string;
  onAccent: string;
  /** Lucide icon name for the still card. */
  icon?: string;
  /** Font for the still card. */
  font?: FontRole;
}

export type Box = TextBox | ShapeBox | ImageBox | ChartBox | TableBox | VideoBox | EmbedBox;

export interface SlideLayout {
  background: string;
  boxes: Box[];
  /** Highest reveal step used on the slide. */
  steps: number;
  /** Text that did not fit, for the studio's warnings. */
  warnings: string[];
  /** Words on the slide and the audience's budget. Only content slides carry a budget. */
  words?: { count: number; budget: number };
}

export function maxStep(boxes: Box[]): number {
  return boxes.reduce((m, b) => Math.max(m, b.step ?? 0), 0);
}
