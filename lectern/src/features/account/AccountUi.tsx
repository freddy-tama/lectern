import { CircleUser, LogIn } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { type AiAccess, useAccount } from './session';

export const formatCredits = (n: number) => Math.max(0, Math.floor(n)).toLocaleString('en-US');

/**
 * Why AI can't be used right now, where AI is offered: sign in first, or the credits are used up.
 * Shows nothing when AI can be used, or when accounts are off.
 */
export function AiAccessNotice({ access, what = 'use AI', children }: { access: AiAccess; what?: string; children?: React.ReactNode }) {
  const { pathname, search } = useLocation();
  if (access === 'sign_in') {
    return (
      <div className="notice account-notice" data-testid="ai-sign-in">
        <p><strong>Sign in to {what}.</strong> Every account starts with 4,000 free AI credits.{children && <> {children}</>}</p>
        <Link className="btn btn-secondary btn-sm" to={`/signin?next=${encodeURIComponent(pathname + search)}`}><LogIn size={15} /> Sign in</Link>
      </div>
    );
  }
  if (access === 'no_credits') {
    return (
      <div className="notice account-notice" data-testid="ai-no-credits">
        <p><strong>You’ve used all your AI credits.</strong> {children ?? 'Everything else in Lectern still works.'}</p>
      </div>
    );
  }
  return null;
}

/** The sidebar's way into the account: "Sign in", or who is signed in and their credits. */
export function AccountNavLink() {
  const account = useAccount();
  if (account.status === 'signed-out') {
    return <NavLink to="/signin" className="nav-link" data-testid="nav-sign-in"><LogIn size={17} /> Sign in</NavLink>;
  }
  if (account.status !== 'signed-in') return null;
  return (
    <NavLink to="/signin" className="nav-link account-nav" data-testid="nav-account" title={account.user.email}>
      <CircleUser size={17} />
      <span className="nav-text">{account.user.name}</span>
      {account.credits !== null && (
        <span className="nav-count tabular" aria-label={`${formatCredits(account.credits)} AI credits left`}>{formatCredits(account.credits)}</span>
      )}
    </NavLink>
  );
}
