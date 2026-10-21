import { Link } from 'react-router-dom';
import { getProfile } from '../../data/profile';
import { markWelcomed } from './hooks';

/**
 * Where a front-page link goes. With setup 'ask', someone who hasn't answered the setup
 * questions goes through them first, then on to the link; 'skip' goes straight there.
 */
export function ctaTarget(to: string, setup: 'ask' | 'skip' = 'skip'): string {
  return setup === 'ask' && to.startsWith('/') && !getProfile().onboarded ? `/start?next=${encodeURIComponent(to)}` : to;
}

/** A link into the app. Following it marks the front page as seen. */
export function Cta({ to, variant = 'brand', size, children, className, setup = 'skip', testId }: {
  to: string;
  variant?: 'brand' | 'dark' | 'quiet' | 'link';
  size?: 'lg';
  children: React.ReactNode;
  className?: string;
  /** 'ask' sends someone who hasn't set up yet through /start first. */
  setup?: 'ask' | 'skip';
  testId?: string;
}) {
  return (
    <Link to={ctaTarget(to, setup)} onClick={markWelcomed} data-testid={testId} className={`lp-btn lp-btn-${variant} ${size ? `lp-btn-${size}` : ''} ${className ?? ''}`}>
      {children}
    </Link>
  );
}
