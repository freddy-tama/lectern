import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { type Box, CANVAS_H, CANVAS_W, type SlideLayout } from '../../core/engine/boxes';
import { layoutSlide } from '../../core/engine/layout';
import { type Theme, fontFamily, getTheme, subscribeThemes, themesRevision } from '../../core/engine/themes';
import type { Deck, Slide } from '../../core/deck/types';
import { assetUrl } from '../../data/repo';
import { useFontsReady, useWidth } from '../../ui/hooks';
import { ChartView } from './ChartView';
import { EmbedView, VideoView } from './MediaView';
import { TableView } from './TableView';

export interface SlideViewProps {
  slide: Slide;
  deck: Pick<Deck, 'themeId' | 'audience' | 'title'>;
  number?: number;
  count?: number;
  /** Reveal steps shown. Undefined shows everything. */
  step?: number;
  mode?: 'edit' | 'show';
  /** Edit mode: draw boxes of later steps faintly instead of hiding them. */
  ghostLater?: boolean;
  flags?: Record<string, boolean>;
  /** A click on a box that shows content: its bind, and the box's id. */
  onSelectBind?(bind: string, boxId: string): void;
  activeBind?: string | null;
  onLayout?(layout: SlideLayout): void;
  className?: string;
  /** Rounded corners and a hairline border, for thumbnails and cards. */
  framed?: boolean;
  label?: string;
  /** Play videos and run activities and web pages. Off for thumbnails, which show stills. */
  live?: boolean;
  /** Boxes drawn by something else for now, such as the text being typed into. */
  hiddenBoxes?: string[];
  /** A press on a box that shows content, for dragging it on the canvas. */
  onBoxPointerDown?(e: React.PointerEvent, box: Box): void;
  /** Drawn over the boxes in slide coordinates, for example an editor. */
  overlay?: React.ReactNode;
}

export function useSlideLayout(slide: Slide, deck: SlideViewProps['deck'], o: { number?: number; count?: number; mode?: 'edit' | 'show'; flags?: Record<string, boolean> } = {}) {
  const fonts = useFontsReady();
  // Redraw when a custom look is edited, not only when the deck switches looks.
  const looks = useSyncExternalStore(subscribeThemes, themesRevision);
  return useMemo(
    () => layoutSlide(slide, {
      theme: getTheme(deck.themeId), audience: deck.audience, mode: o.mode ?? 'show',
      slideNumber: o.number ?? 1, slideCount: o.count ?? 1, deckTitle: deck.title, flags: o.flags,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slide, deck.themeId, deck.audience, deck.title, o.number, o.count, o.mode, o.flags, fonts, looks],
  );
}

export const SlideView = memo(function SlideView(props: SlideViewProps) {
  const { slide, deck, step, mode = 'show', ghostLater, onSelectBind, activeBind, onLayout, className, framed, label, live = false, hiddenBoxes, overlay, onBoxPointerDown } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const layout = useSlideLayout(slide, deck, { number: props.number, count: props.count, mode, flags: props.flags });
  const theme = getTheme(deck.themeId);
  useEffect(() => { onLayout?.(layout); }, [layout, onLayout]);
  const scale = width ? width / CANVAS_W : 0;
  return (
    <div
      ref={ref}
      className={`slide-frame ${framed ? 'framed' : ''} ${className ?? ''}`}
      style={{ background: layout.background }}
      // A live slide can hold controls (a timer, a picker, a video), which an img role would hide.
      role={live ? 'group' : 'img'}
      aria-label={label ?? 'Slide'}
    >
      {scale > 0 && (
        <div className="slide-canvas" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}>
          {layout.boxes.map((box) => {
            const later = (box.step ?? 0) > (step ?? Number.POSITIVE_INFINITY);
            const state = hiddenBoxes?.includes(box.id) ? 'hidden' : later ? (ghostLater ? 'ghost' : 'hidden') : 'shown';
            return (
              <BoxView
                key={box.id}
                box={box}
                theme={theme}
                state={state}
                editable={Boolean(onSelectBind && box.bind)}
                active={Boolean(activeBind && box.bind && (box.bind === activeBind || box.bind.startsWith(`${activeBind}.`)))}
                onSelect={onSelectBind}
                onPress={onBoxPointerDown}
                live={live && state !== 'hidden'}
              />
            );
          })}
          {overlay}
        </div>
      )}
    </div>
  );
});

/** One positioned box. Exported for static rendering (the view-only web page). */
export function BoxView({ box, theme, state, editable, active, onSelect, onPress, live = false }: {
  box: Box; theme: Theme; state: 'shown' | 'hidden' | 'ghost'; editable: boolean; active: boolean; onSelect?(bind: string, boxId: string): void;
  onPress?(e: React.PointerEvent, box: Box): void; live?: boolean;
}) {
  const style: React.CSSProperties = {
    left: box.x, top: box.y, width: box.w, height: box.h,
    opacity: state === 'ghost' ? (box.opacity ?? 1) * 0.28 : box.opacity ?? 1,
  };
  const classes = ['box', `box-${box.type}`, state === 'hidden' ? 'is-hidden' : '', box.reveal === 'answer' ? 'is-answer' : '', editable ? 'is-editable' : '', active ? 'is-active' : ''].filter(Boolean).join(' ');
  const onClick = editable && box.bind ? (e: React.MouseEvent) => { e.stopPropagation(); onSelect?.(box.bind!, box.id); } : undefined;
  // A playing video or a running page takes its own presses.
  const playing = live && (box.type === 'video' || box.type === 'embed');
  const onPointerDown = editable && box.bind && onPress && !playing ? (e: React.PointerEvent) => onPress(e, box) : undefined;
  const step = { ...(box.step ? { 'data-step': box.step } : {}), ...(editable && box.bind ? { 'data-box-bind': box.bind } : {}) };

  if (box.type === 'text') {
    const s = box.style;
    Object.assign(style, {
      fontFamily: fontFamily(theme, s.font, 'web'),
      fontSize: s.size,
      fontWeight: s.weight,
      fontStyle: s.italic ? 'italic' : undefined,
      color: s.color,
      textAlign: s.align ?? 'left',
      lineHeight: s.lineHeight ?? 1.3,
      letterSpacing: s.tracking ? `${s.tracking}em` : undefined,
      textTransform: s.uppercase ? 'uppercase' : undefined,
      justifyContent: s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start',
    } satisfies React.CSSProperties);
    return <div className={classes} style={style} onClick={onClick} onPointerDown={onPointerDown} {...step}><span>{box.text}</span></div>;
  }
  if (box.type === 'shape') {
    if (box.shape === 'line') {
      Object.assign(style, { height: 0, borderTop: `${box.strokeWidth ?? 2}px ${box.dash ? 'dashed' : 'solid'} ${box.stroke ?? theme.colors.line}` });
    } else {
      Object.assign(style, {
        background: box.fill ?? 'transparent',
        borderRadius: box.shape === 'ellipse' ? '50%' : box.radius ?? 0,
        boxShadow: box.stroke && box.strokeWidth ? `inset 0 0 0 ${box.strokeWidth}px ${box.stroke}` : undefined,
        outline: box.dash && box.stroke ? `${box.strokeWidth ?? 2}px dashed ${box.stroke}` : undefined,
        outlineOffset: box.dash ? -(box.strokeWidth ?? 2) : undefined,
      } satisfies React.CSSProperties);
      if (box.dash) style.boxShadow = undefined;
    }
    return <div className={classes} style={style} onClick={onClick} onPointerDown={onPointerDown} {...step} />;
  }
  if (box.type === 'chart') {
    return <div className={classes} style={style} onClick={onClick} onPointerDown={onPointerDown} {...step}><ChartView box={box} theme={theme} /></div>;
  }
  if (box.type === 'table') {
    return <div className={classes} style={style} onClick={onClick} onPointerDown={onPointerDown} {...step}><TableView box={box} theme={theme} /></div>;
  }
  if (box.type === 'video' || box.type === 'embed') {
    // A running frame takes its own clicks; a still selects the field like any other box.
    const media = box.type === 'video' ? <VideoView box={box} live={live} /> : <EmbedView box={box} live={live} />;
    return <div className={`${classes}${live ? ' is-live' : ''}`} style={{ ...style, borderRadius: box.radius ?? 0 }} onClick={live ? undefined : onClick} onPointerDown={onPointerDown} {...step}>{media}</div>;
  }
  return (
    <div className={classes} style={{ ...style, borderRadius: box.radius ?? 0 }} onClick={onClick} onPointerDown={onPointerDown} {...step}>
      <SlideImage src={box.src} fit={box.fit} alt={box.alt ?? ''} />
    </div>
  );
}

function SlideImage({ src, fit, alt }: { src: string; fit: 'cover' | 'contain'; alt: string }) {
  const [url, setUrl] = useState<string | null>(src.startsWith('asset:') ? null : src);
  useEffect(() => {
    let alive = true;
    if (src.startsWith('asset:')) assetUrl(src).then((u) => alive && setUrl(u));
    else setUrl(src);
    return () => { alive = false; };
  }, [src]);
  if (!url) return null;
  return <img src={url} alt={alt} draggable={false} style={{ objectFit: fit }} />;
}
