import { Link } from 'react-router-dom';

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--primary)" />
      <path d="M20 46h24" stroke="var(--brand)" strokeWidth="5" strokeLinecap="round" />
      <path d="M24 40l4-22h8l4 22" fill="none" stroke="var(--primary-ink)" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Lectern home">
      <LogoMark />
      <span className="logo-word">Lectern</span>
    </Link>
  );
}
