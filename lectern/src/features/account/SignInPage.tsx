import { AlertCircle, Check, Loader2, LogOut, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatCredits } from './AccountUi';
import { type AccountConfig, accountConfig, safeNext, signInWithEmail, signInWithGitHub, signOut, takeSignInNext, useAccount } from './session';
import { syncStudy } from './study-sync';

const GITHUB_MARK = 'M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z';

export default function SignInPage() {
  const account = useAccount();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [config, setConfig] = useState<AccountConfig | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'github' | 'email' | 'out' | null>(null);
  const [sent, setSent] = useState('');
  // Supabase sends people back here with the reason when a sign-in fails.
  const [error, setError] = useState(params.get('error_description') ?? '');

  useEffect(() => { accountConfig().then(setConfig); }, []);
  useEffect(() => { document.title = 'Sign in · Lectern'; return () => { document.title = 'Lectern'; }; }, []);

  // Back from GitHub or an emailed link: carry on to where the person was going.
  useEffect(() => {
    if (account.status !== 'signed-in') return;
    const back = takeSignInNext();
    if (back !== '/') navigate(back, { replace: true });
  }, [account.status, navigate]);

  const github = async () => {
    setBusy('github');
    setError('');
    const problem = await signInWithGitHub(next);
    // On success the browser is already on its way to GitHub.
    if (problem) { setError(problem); setBusy(null); }
  };

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) { setError('Enter an email address, like name@example.com.'); return; }
    setBusy('email');
    setError('');
    const problem = await signInWithEmail(address, next);
    setBusy(null);
    if (problem) setError(problem);
    else setSent(address);
  };

  const leave = async () => {
    setBusy('out');
    await syncStudy();
    await signOut();
    setBusy(null);
  };

  if (!config || account.status === 'loading') {
    return <div className="page-loading" aria-busy="true"><div className="spinner" /></div>;
  }

  if (!config.accounts || account.status === 'off') {
    return (
      <div className="page account-page">
        <p className="eyebrow">Account</p>
        <h1 className="display">Sign in</h1>
        <p className="muted account-lead">Accounts aren’t set up on this copy of Lectern. Everything here works without signing in.</p>
        <Link className="btn btn-primary" to="/">Go to Home</Link>
      </div>
    );
  }

  if (account.status === 'signed-in') {
    const start = config.startCredits ?? 4000;
    const left = account.credits;
    return (
      <div className="page account-page">
        <p className="eyebrow">Account</p>
        <h1 className="display">You’re signed in</h1>
        <p className="muted account-lead">
          As <strong>{account.user.name}</strong>{account.user.email && account.user.email !== account.user.name ? ` (${account.user.email})` : ''}. Your study progress is saved to this account.
        </p>
        <section className="card account-credits" aria-labelledby="account-credits-title">
          <h2 id="account-credits-title">AI credits</h2>
          {left === null ? (
            <p className="muted"><Loader2 size={14} className="spin" /> Reading your balance…</p>
          ) : (
            <>
              <p className="account-balance"><span className="tabular" data-testid="credits-left">{formatCredits(left)}</span> left of {formatCredits(start)}</p>
              <div className="progress" role="presentation"><span style={{ width: `${Math.max(0, Math.min(100, (left / start) * 100))}%` }} /></div>
              {left <= 0 && <p className="account-empty">You’ve used all your AI credits. Everything else in Lectern still works.</p>}
            </>
          )}
          <p className="faint">Credits pay for the AI’s work, at what it costs Lectern. One credit is half a US cent, so 4,000 credits is $20 of AI use.</p>
        </section>
        <div className="account-actions">
          <Link className="btn btn-brand" to={next === '/' ? '/make' : next}>{next === '/' ? 'Make a deck' : 'Continue'}</Link>
          <button type="button" className="btn btn-ghost" onClick={leave} disabled={busy === 'out'}>
            {busy === 'out' ? <Loader2 size={15} className="spin" /> : <LogOut size={15} />} Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page account-page">
      <p className="eyebrow">Account</p>
      <h1 className="display">Sign in to use AI</h1>
      <p className="muted account-lead">
        Browsing, presenting and your notes work without an account. Sign in to draft with AI and to keep your study progress. Every account starts with {formatCredits(config.startCredits ?? 4000)} free AI credits.
      </p>

      <div className="card account-box">
        {config.github !== false && (
          <button type="button" className="btn btn-secondary btn-lg account-github" onClick={github} disabled={busy !== null}>
            {busy === 'github' ? <Loader2 size={17} className="spin" /> : <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d={GITHUB_MARK} /></svg>}
            Continue with GitHub
          </button>
        )}
        {config.github !== false && config.email !== false && <p className="account-or" aria-hidden><span>or</span></p>}
        {config.email !== false && (sent ? (
          <p className="account-sent" role="status">
            <Check size={16} /> <span>Check your email. We sent a sign-in link to <strong>{sent}</strong>. Open it in this browser. <button type="button" className="ad-link" onClick={() => setSent('')}>Use another address</button></span>
          </p>
        ) : (
          <form className="account-email" onSubmit={sendLink} noValidate>
            <label className="field">
              <span className="field-label">Email address</span>
              <input className="input" type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy !== null}>
              {busy === 'email' ? <Loader2 size={15} className="spin" /> : <Mail size={15} />} Email me a sign-in link
            </button>
          </form>
        ))}
        {error && <p role="alert" className="account-error"><AlertCircle size={15} /> {error}</p>}
      </div>

      <p className="faint account-foot">Lectern uses your email address only to sign you in.</p>
    </div>
  );
}
