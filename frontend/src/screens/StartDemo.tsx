// /demo: make a private copy of the demo college (24 h) and open it as its coordinator.

import { useEffect, useRef, useState } from 'react';
import { api, ApiFailure } from '../api';
import { Link, navigate } from '../lib/router';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../state/session';
import { invalidate } from '../state/query';
import { AuthFrame } from './Auth';

export function StartDemo() {
  useDocumentTitle('Opening the demo college');
  const { me, setMe } = useSession();
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);
  const [confirmed, setConfirmed] = useState(!me?.user);
  useEffect(() => {
    if (started.current || !confirmed) return;
    started.current = true;
    if (me?.demo && new Date(me.demo.expiresAt).getTime() > Date.now()) {
      navigate(`/w/${me.demo.workspace}`, { replace: true });
      return;
    }
    api.startDemo().then(
      (m) => {
        setMe(m);
        invalidate();
        navigate(`/w/${m.demo!.workspace}`, { replace: true });
      },
      (e: unknown) => setErr(e instanceof ApiFailure ? e.message : 'The demo could not be opened.'),
    );
  }, [me, setMe, confirmed]);
  if (!confirmed) {
    return (
      <AuthFrame title="Open the demo college?" sub={<>You’re signed in as {me?.user?.name}. Opening the demo signs you out in this browser; your own workspaces are untouched and you can sign back in any time.</>} foot={<Link href="/">Back to your timetable</Link>}>
        <div className="form">
          <button type="button" className="btn btn-primary btn-block" onClick={() => setConfirmed(true)}>Sign out and open the demo</button>
        </div>
      </AuthFrame>
    );
  }
  if (err) {
    return (
      <AuthFrame title="The demo didn’t open" sub={err} foot={<Link href="/">EduSched home</Link>}>
        <div className="form"><button type="button" className="btn btn-primary btn-block" onClick={() => location.reload()}>Try again</button></div>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame title="Opening the demo college" sub="Making your private copy: three batches, five teachers, six rooms and this week’s changes. It resets after 24 hours.">
      <div className="progress-line" role="progressbar" aria-label="Opening the demo" />
    </AuthFrame>
  );
}
