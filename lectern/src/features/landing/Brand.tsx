import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useState } from 'react';
import { AUDIENCES } from '../../core/deck/types';
import { THEMES, registerTheme, unregisterTheme } from '../../core/engine/themes';
import { SlideView } from '../slides/SlideView';
import { BRAND_COLORS, BRAND_SLIDES, BRAND_TYPES, type BrandChoice, brandTheme } from './samples';

/** The id the playground's look is registered under while the page is open. */
const BRAND_THEME_ID = 'landing-brand';

const TYPE_FONTS: Record<string, string> = {
  editorial: 'var(--font-display)',
  modern: 'var(--font-ui)',
  friendly: "'Nunito Variable', Nunito, var(--font-ui)",
};

export function Brand() {
  const [choice, setChoice] = useState<BrandChoice>({
    color: 'ocean', type: 'editorial', logo: true, footer: 'Juniper Labs · Board update', audience: 'adult',
  });
  // Every slide on the page redraws when a look changes, so the slides follow the controls a beat behind.
  const shown = useDeferredValue(choice);
  const theme = useMemo(() => brandTheme(shown), [shown]);
  const ids = useId();

  // The look being tried is registered under its own id, so only the two slides below use it.
  // Registered before paint, replaced in place on each change, and removed when the page closes.
  useLayoutEffect(() => { registerTheme({ ...theme, id: BRAND_THEME_ID, custom: true }); }, [theme]);
  useEffect(() => () => unregisterTheme(BRAND_THEME_ID), []);

  const set = <K extends keyof BrandChoice>(key: K, value: BrandChoice[K]) => setChoice((c) => ({ ...c, [key]: value }));
  const deck = { title: 'Juniper Labs board update', themeId: BRAND_THEME_ID, audience: shown.audience };

  return (
    <section id="looks" className="lp-section brand" aria-labelledby="brand-title" tabIndex={-1}>
      <div className="lp-container">
        <div className="lp-head">
          <p className="lp-eyebrow">Looks and audience</p>
          <h2 id="brand-title" className="lp-h2">Your brand, <em>on every slide.</em></h2>
          <p className="lp-sub">
            Here: colours, type, audience, logo and footer. In the app you can also pick fonts and corners and upload
            your own logo. Start from {THEMES.length} built-in looks or make your own.
          </p>
        </div>

        <div className="brand-layout">
          <form className="brand-controls" onSubmit={(e) => e.preventDefault()} aria-label="Try a look">
            <fieldset className="bc-group">
              <legend>Colour</legend>
              <div className="bc-swatches">
                {BRAND_COLORS.map((c) => (
                  <label key={c.id} className="bc-swatch" title={c.label}>
                    <input type="radio" name={`${ids}-color`} value={c.id} checked={choice.color === c.id} onChange={() => set('color', c.id)} />
                    <span className="bc-swatch-dot" style={{ background: c.hex }} aria-hidden />
                    <span className="visually-hidden">{c.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="bc-group">
              <legend>Type</legend>
              <div className="bc-options bc-options-3">
                {BRAND_TYPES.map((t) => (
                  <label key={t.id} className="bc-option">
                    <input type="radio" name={`${ids}-type`} value={t.id} checked={choice.type === t.id} onChange={() => set('type', t.id)} />
                    <span className="bc-option-face" style={{ fontFamily: TYPE_FONTS[t.id] }} aria-hidden>Aa</span>
                    <span className="bc-option-label">{t.label}</span>
                    <span className="bc-option-detail">{t.detail}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="bc-group">
              <legend>Audience</legend>
              <div className="bc-segment">
                {AUDIENCES.map((a) => (
                  <label key={a.id} className="bc-seg">
                    <input type="radio" name={`${ids}-aud`} value={a.id} checked={choice.audience === a.id} onChange={() => set('audience', a.id)} />
                    <span>{a.label}</span>
                  </label>
                ))}
              </div>
              <p className="bc-help">{AUDIENCES.find((a) => a.id === choice.audience)?.detail}</p>
            </fieldset>

            <div className="bc-group bc-row">
              <label className="bc-switch">
                <input type="checkbox" role="switch" checked={choice.logo} onChange={(e) => set('logo', e.target.checked)} />
                <span className="bc-switch-track" aria-hidden><span /></span>
                Show logo
              </label>
            </div>

            <div className="bc-group">
              <label className="bc-label" htmlFor={`${ids}-footer`}>Footer</label>
              <input
                id={`${ids}-footer`}
                className="bc-input"
                type="text"
                value={choice.footer}
                maxLength={48}
                onChange={(e) => set('footer', e.target.value)}
                autoComplete="off"
              />
            </div>
          </form>

          <div className="brand-preview">
            <div className="brand-slide brand-slide-a">
              <SlideView slide={BRAND_SLIDES[0]} deck={deck} number={1} count={12} framed label="Title slide in the custom look" />
            </div>
            <div className="brand-slide brand-slide-b">
              <SlideView slide={BRAND_SLIDES[1]} deck={deck} number={5} count={12} framed label="Chart slide in the custom look" />
            </div>
            <p className="brand-note"><span className="lp-tag">Sample brand</span> Saved looks apply to the whole deck and travel into the PowerPoint file.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
