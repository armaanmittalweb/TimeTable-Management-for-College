// Sign in, create an account, and reset a password with a code from the coordinator.

import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiFailure, IS_MOCK } from '../api';
import { Mark } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { Link, navigate, useLocation } from '../lib/router';
import { useDocumentTitle } from '../lib/hooks';
import { homeFor, useSession } from '../state/session';
import { getFollows } from '../state/follows';

export function AuthFrame({ title, sub, children, foot }: { title: string; sub?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="auth">
      <main id="main" className="auth-card">
        <Link className="auth-brand" href="/" aria-label="EduSched home">
          <Mark size={24} />
          <span>EduSched</span>
        </Link>
        <h1 className="auth-title">{title}</h1>
        {sub && <p className="auth-sub">{sub}</p>}
        {children}
      </main>
      {foot && <p className="auth-foot">{foot}</p>}
    </div>
  );
}

const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null);

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export function SignInScreen() {
  useDocumentTitle('Sign in');
  const { query } = useLocation();
  const { setMe } = useSession();
  const [email, setEmail] = useState(query.get('email') ?? '');
  const [password, setPassword] = useState('');
  const s = useSubmit();
  const next = safeNext(query.get('next'));
  const sync = query.get('sync') === '1';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void s.run(async () => {
      const me = await api.login({ email, password });
      setMe(me);
      if (sync) toast('Signed in. Your batches are synced to this account.');
      const follows = getFollows();
      navigate(next ?? homeFor(me) ?? (follows[0] ? `/b/${follows[0].code}` : '/new'), { replace: true });
    });
  };

  return (
    <AuthFrame
      title="Sign in"
      sub={sync ? 'Sign in to keep the batches you follow on every device.' : 'For coordinators and teachers. Students only need a class code.'}
      foot={<>No account? <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create one</Link> · <Link href="/join">I have a class code</Link></>}
    >
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <div className="field-row">
            <label htmlFor="password">Password</label>
            <Link className="field-link" href={`/forgot${email ? `?email=${encodeURIComponent(email)}` : ''}`}>Forgot it?</Link>
          </div>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {s.error && <p className="form-error" role="alert">{s.error}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={s.busy || !email || !password}>
          {s.busy ? 'Signing in…' : 'Sign in'}
        </button>
        {IS_MOCK && <p className="field-hint">Mock accounts: priya.menon@riverside.edu (coordinator) or meera.iyer@riverside.edu (teacher), password timetable-demo.</p>}
      </form>
    </AuthFrame>
  );
}

export function SignUpScreen() {
  useDocumentTitle('Create an account');
  const { query } = useLocation();
  const { setMe } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const s = useSubmit();
  const next = safeNext(query.get('next'));
  const short = password.length > 0 && password.length < 10;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return s.setError('Use at least 10 characters for the password.');
    void s.run(async () => {
      const me = await api.signup({ name: name.trim(), email: email.trim(), password });
      setMe(me);
      navigate(next ?? '/new', { replace: true });
    });
  };

  return (
    <AuthFrame
      title="Create an account"
      sub="Set up your department’s timetable, or join one with an invite from your coordinator."
      foot={<>Already have one? <Link href={`/signin${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link></>}
    >
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="name">Your name</label>
          <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. Priya Menon" />
        </div>
        <div className="field">
          <label htmlFor="email">Work email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={short} aria-describedby="pw-hint" required />
          <span id="pw-hint" className={short ? 'field-error' : 'field-hint'}>At least 10 characters{short ? ` (${10 - password.length} more)` : ''}.</span>
        </div>
        {s.error && <p className="form-error" role="alert">{s.error}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={s.busy || !name.trim() || !email.trim() || !password}>
          {s.busy ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
    </AuthFrame>
  );
}

export function ForgotScreen() {
  useDocumentTitle('Reset your password');
  const { query } = useLocation();
  const [email, setEmail] = useState(query.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const s = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return s.setError('Use at least 10 characters for the new password.');
    void s.run(async () => {
      await api.reset({ email: email.trim(), code: code.trim(), password });
      toast('Password changed. Sign in with the new one.');
      navigate(`/signin?email=${encodeURIComponent(email.trim())}`, { replace: true });
    });
  };
  return (
    <AuthFrame
      title="Reset your password"
      sub="EduSched doesn’t send email. Ask a coordinator in your workspace for a reset code: they make one in Setup → Codes and members. It works once, for an hour."
      foot={<Link href="/signin">Back to sign in</Link>}
    >
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="code">Reset code</label>
          <input id="code" className="input mono" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required placeholder="8 letters and digits" spellCheck={false} />
        </div>
        <div className="field">
          <label htmlFor="password">New password</label>
          <input id="password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-describedby="np-hint" />
          <span id="np-hint" className="field-hint">At least 10 characters. You’ll be signed out everywhere else.</span>
        </div>
        {s.error && <p className="form-error" role="alert">{s.error}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={s.busy || !email || !code || !password}>
          {s.busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </AuthFrame>
  );
}
