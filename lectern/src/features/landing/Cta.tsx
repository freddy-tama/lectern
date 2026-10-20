import { Link } from 'react-router-dom';
import { getProfile } from '../../data/profile';
import { markWelcomed } from './hooks';

/**
 * A link into the app. Following it marks the front page as seen. Someone who hasn't
 * answered the setup questions goes through them first, then on to the link.
 */
export function Cta({ to, variant = 'brand', size, children, className }: {
  to: string;
  variant?: 'brand' | 'dark' | 'quiet' | 'link';
  size?: 'lg';
  children: React.ReactNode;
  className?: string;
}) {
  const target = to.startsWith('/') && !getProfile().onboarded ? `/start?next=${encodeURIComponent(to)}` : to;
  return (
    <Link to={target} onClick={markWelcomed} className={`lp-btn lp-btn-${variant} ${size ? `lp-btn-${size}` : ''} ${className ?? ''}`}>
      {children}
    </Link>
  );
}
