import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, Unreachable } from '../api';
import { setSound, useSound } from '../sound';
import { useReducedMotion } from '../motion';
import { collegeNow, COLLEGE_TZ_LABEL, headerDate } from '../time';
import type { Demo } from '../useDemo';

export function Clock() {
  const [now, setNow] = useState(() => collegeNow());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(collegeNow());
      t = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return () => clearTimeout(t);
  }, []);
  return (
    <time className="clock" dateTime={now.time} aria-label={`College time ${now.time.slice(0, 5)}`}>
      <span className="clock-hm">{now.time.slice(0, 5)}</span>
      <span className="clock-s">:{now.time.slice(6)}</span>
      <span className="clock-tz">{COLLEGE_TZ_LABEL}</span>
    </time>
  );
}

export function SoundToggle() {
  const [on] = useSound();
  const reduced = useReducedMotion();
  if (reduced) {
    return (
      <span className="chip is-static" title="Reduced motion is on, so the board swaps without flipping or sound">
        SOUND OFF · REDUCED MOTION
      </span>
    );
  }
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={() => setSound(!on)}>
      <span className={`lamp${on ? ' is-on' : ''}`} aria-hidden="true" />
      SOUND {on ? 'ON' : 'OFF'}
    </button>
  );
}

export function ResetButton({ demo, label = 'RESET MY CHANGES' }: { demo: Demo; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="chip"
      disabled={busy || demo.conn === 'connecting'}
      onClick={async () => {
        setBusy(true);
        try {
          await demo.reset();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? 'RESETTING…' : label}
    </button>
  );
}

export function SandboxTag({ id }: { id: string | null }) {
  return (
    <span className="chip is-static" title={id ? `Sandbox ${id}: your changes are stored under this id` : 'No sandbox yet'}>
      <span className="chip-key">SANDBOX</span> <span className="board-type">{id ? id.slice(0, 4).toUpperCase() : '····'}</span>
    </span>
  );
}

export function StationHeader({ demo }: { demo: Demo }) {
  return (
    <header className="station-head">
      <div className="station-id">
        <span className="station-mark" aria-hidden="true">
          E
        </span>
        <h1 className="station-name">
          EDUSCHED <span className="station-sep" aria-hidden="true">·</span> <span className="station-sub">CENTRAL TIMETABLE</span>
        </h1>
      </div>
      <div className="station-tools">
        <SoundToggle />
        <ResetButton demo={demo} />
        <SandboxTag id={demo.sandbox} />
      </div>
      <div className="station-time">
        <span className="station-date board-type">{headerDate(demo.today)}</span>
        <Clock />
      </div>
    </header>
  );
}

export function SignIn({ demo }: { demo: Demo }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [state, setState] = useState<{ busy: boolean; text: string; ok?: boolean }>({ busy: false, text: '' });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true, text: '' });
    try {
      const s = await demo.signIn(user.trim(), pass);
      setState({ busy: false, ok: true, text: `SIGNED IN · ${user.trim().toUpperCase()} · ${s.role === 'professor' ? 'CONTROL ROOM' : 'PLATFORM'}` });
      setPass('');
    } catch (err) {
      setState({
        busy: false,
        text:
          err instanceof Unreachable
            ? 'SIGNAL FAILURE · API UNREACHABLE'
            : err instanceof ApiError
              ? `REFUSED · ${err.status} · ${err.message}`
              : String(err),
      });
    }
  }

  return (
    <details className="signin">
      <summary>Sign in with another account</summary>
      <form className="signin-form" onSubmit={submit}>
        <p className="signin-note">
          A professor account takes over the control room; a student account takes over the platform. Demo accounts: prof.meera and
          student.aarav, password edusched-demo.
        </p>
        <div className="fields">
          <label className="field">
            <span className="label">USERNAME</span>
            <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" required spellCheck={false} />
          </label>
          <label className="field">
            <span className="label">PASSWORD</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" required />
          </label>
          <button type="submit" className="btn btn-ghost" disabled={state.busy}>
            {state.busy ? 'SIGNING IN…' : 'SIGN IN'}
          </button>
        </div>
        {state.text && (
          <p className={`outcome board-type ${state.ok ? 'is-ok' : 'is-fault'}`} role={state.ok ? 'status' : 'alert'}>
            {state.text}
          </p>
        )}
      </form>
    </details>
  );
}

export function DemoNote() {
  return (
    <p className="demo-note">
      <span className="tag">PUBLIC DEMO</span> Both accounts are signed in for you. Your changes are private to this browser and cleared
      after 24 hours.
    </p>
  );
}
