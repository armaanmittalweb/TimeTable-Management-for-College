// /join and /join/:code: a student follows a batch on this device; a teacher links their account with an invite.

import { useEffect, useState, type FormEvent } from 'react';
import type { FollowedBatch } from '../contract';
import { api, ApiFailure } from '../api';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { Link, navigate } from '../lib/router';
import { useDocumentTitle } from '../lib/hooks';
import { DAY_SHORT } from '../lib/time';
import { follow, syncFollows, useFollows } from '../state/follows';
import { useSession } from '../state/session';
import { invalidate } from '../state/query';
import { AuthFrame } from './Auth';

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'batch'; fb: FollowedBatch } | { kind: 'signin'; message: string } | { kind: 'error'; message: string };

export function JoinScreen({ code }: { code?: string }) {
  useDocumentTitle(code ? `Join ${code.toUpperCase()}` : 'Enter a class code');
  const { me, refresh } = useSession();
  const follows = useFollows();
  const [state, setState] = useState<State>(code ? { kind: 'loading' } : { kind: 'idle' });
  const [input, setInput] = useState(code?.toUpperCase() ?? '');

  useEffect(() => {
    if (!code) return setState({ kind: 'idle' });
    let live = true;
    setState({ kind: 'loading' });
    api.join(code.toUpperCase()).then(
      async (res) => {
        if (!live) return;
        if ('batch' in res) return setState({ kind: 'batch', fb: res });
        await refresh();
        invalidate();
        toast(`You’ve joined ${res.workspace.name}.`);
        navigate(`/w/${res.workspace.slug}`, { replace: true });
      },
      (e: unknown) => {
        if (!live) return;
        const err = e instanceof ApiFailure ? e : new ApiFailure(0, null, true);
        if (err.code === 'unauthenticated') setState({ kind: 'signin', message: err.message });
        else setState({ kind: 'error', message: err.message });
      },
    );
    return () => {
      live = false;
    };
  }, [code, refresh]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = input.trim().toUpperCase();
    if (c) navigate(`/join/${encodeURIComponent(c)}`);
  };

  if (state.kind === 'batch') {
    const fb = state.fb;
    const already = follows.some((f) => f.code === fb.code);
    const teaching = fb.periods.filter((p) => !p.isBreak);
    const days = fb.workspace.days.slice().sort();
    return (
      <AuthFrame title={fb.batch.name} sub={<>{fb.workspace.name} · {fb.workspace.institution}</>} foot={<Link href="/">EduSched home</Link>}>
        <dl className="joinfacts">
          <div><dt>Days</dt><dd>{DAY_SHORT[days[0]]}–{DAY_SHORT[days[days.length - 1]]}</dd></div>
          <div><dt>Hours</dt><dd className="mono">{teaching[0]?.start}–{teaching[teaching.length - 1]?.end}</dd></div>
          <div><dt>Class code</dt><dd className="mono">{fb.code}</dd></div>
        </dl>
        <p className="auth-sub">
          Following saves this batch on this device, so its week opens here, works offline and shows changes as they happen. No account needed.
        </p>
        <div className="form">
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            onClick={() => {
              follow(fb);
              if (me?.user) void syncFollows();
              toast(already ? `Opening ${fb.batch.name}.` : `Following ${fb.batch.name} on this device.`);
              navigate(`/b/${fb.code}`);
            }}
          >
            {already ? 'Open the timetable' : 'Follow this batch'}
          </button>
          {!already && (
            <Link className="btn btn-ghost btn-block" href={`/b/${fb.code}`}>Just look this once</Link>
          )}
        </div>
      </AuthFrame>
    );
  }

  if (state.kind === 'signin') {
    const next = `/join/${encodeURIComponent(code!.toUpperCase())}`;
    return (
      <AuthFrame title="Teacher invite" sub="This code adds you to a workspace as a teacher. Sign in, or create an account, and you’ll be brought straight back here." foot={<Link href="/join">Use a different code</Link>}>
        <div className="form">
          <Link className="btn btn-primary btn-lg btn-block" href={`/signin?next=${encodeURIComponent(next)}`}>Sign in to accept</Link>
          <Link className="btn btn-lg btn-block" href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Enter a class code"
      sub="Your coordinator shares a code for each batch, like CSE2A-K7QD. Teachers get an invite code the same way."
      foot={<>Setting up a department? <Link href="/signup">Create a workspace</Link></>}
    >
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="code">Code</label>
          <input
            id="code"
            className="input mono input-code"
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="CSE2A-K7QD"
            aria-invalid={state.kind === 'error'}
            aria-describedby={state.kind === 'error' ? 'code-err' : undefined}
            autoFocus
          />
        </div>
        {state.kind === 'error' && (
          <p id="code-err" className="form-error" role="alert">
            <Icon name="alert" size={14} /> {state.message}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!input.trim() || state.kind === 'loading'}>
          {state.kind === 'loading' ? 'Checking the code…' : 'Continue'}
        </button>
      </form>
    </AuthFrame>
  );
}
