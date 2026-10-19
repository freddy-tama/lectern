import { Link } from 'react-router-dom';
import { markWelcomed } from './hooks';

/** A link into the app. Following it marks the front page as seen. */
export function Cta({ to, variant = 'brand', size, children, className }: {
  to: string;
  variant?: 'brand' | 'dark' | 'quiet' | 'link';
  size?: 'lg';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} onClick={markWelcomed} className={`lp-btn lp-btn-${variant} ${size ? `lp-btn-${size}` : ''} ${className ?? ''}`}>
      {children}
    </Link>
  );
}
