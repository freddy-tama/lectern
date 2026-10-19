import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { type Box, CANVAS_H, CANVAS_W, type SlideLayout } from '../../core/engine/boxes';
import { layoutSlide } from '../../core/engine/layout';
import { type Theme, fontFamily, getTheme, subscribeThemes, themesRevision } from '../../core/engine/themes';
import type { Deck, Slide } from '../../core/deck/types';
import { assetUrl } from '../../data/repo';
import { useFontsReady, useWidth } from '../../ui/hooks';
import { ChartView } from './ChartView';
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
  onSelectBind?(bind: string): void;
  activeBind?: string | null;
  onLayout?(layout: SlideLayout): void;
  className?: string;
  /** Rounded corners and a hairline border, for thumbnails and cards. */
  framed?: boolean;
  label?: string;
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
  const { slide, deck, step, mode = 'show', ghostLater, onSelectBind, activeBind, onLayout, className, framed, label } = props;
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
      role="img"
      aria-label={label ?? 'Slide'}
    >
      {scale > 0 && (
        <div className="slide-canvas" style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}>
          {layout.boxes.map((box) => {
            const later = (box.step ?? 0) > (step ?? Number.POSITIVE_INFINITY);
            const state = later ? (ghostLater ? 'ghost' : 'hidden') : 'shown';
            return (
              <BoxView
                key={box.id}
                box={box}
                theme={theme}
                state={state}
                editable={Boolean(onSelectBind && box.bind)}
                active={Boolean(activeBind && box.bind && (box.bind === activeBind || box.bind.startsWith(`${activeBind}.`)))}
                onSelect={onSelectBind}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

/** One positioned box. Exported for static rendering (the view-only web page). */
export function BoxView({ box, theme, state, editable, active, onSelect }: {
  box: Box; theme: Theme; state: 'shown' | 'hidden' | 'ghost'; editable: boolean; active: boolean; onSelect?(bind: string): void;
}) {
  const style: React.CSSProperties = {
    left: box.x, top: box.y, width: box.w, height: box.h,
    opacity: state === 'ghost' ? (box.opacity ?? 1) * 0.28 : box.opacity ?? 1,
  };
  const classes = ['box', `box-${box.type}`, state === 'hidden' ? 'is-hidden' : '', box.reveal === 'answer' ? 'is-answer' : '', editable ? 'is-editable' : '', active ? 'is-active' : ''].filter(Boolean).join(' ');
  const onClick = editable && box.bind ? (e: React.MouseEvent) => { e.stopPropagation(); onSelect?.(box.bind!); } : undefined;
  const step = box.step ? { 'data-step': box.step } : {};

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
    return <div className={classes} style={style} onClick={onClick} {...step}><span>{box.text}</span></div>;
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
    return <div className={classes} style={style} onClick={onClick} {...step} />;
  }
  if (box.type === 'chart') {
    return <div className={classes} style={style} onClick={onClick} {...step}><ChartView box={box} theme={theme} /></div>;
  }
  if (box.type === 'table') {
    return <div className={classes} style={style} onClick={onClick} {...step}><TableView box={box} theme={theme} /></div>;
  }
  return (
    <div className={classes} style={{ ...style, borderRadius: box.radius ?? 0 }} onClick={onClick} {...step}>
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
