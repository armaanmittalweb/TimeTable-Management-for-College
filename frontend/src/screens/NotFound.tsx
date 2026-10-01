import type { ApiFailure } from '../api';
import { Icon } from '../ui/Icon';
import { Link } from '../lib/router';
import { useDocumentTitle } from '../lib/hooks';
import { homeFor, useSession } from '../state/session';
import { unfollow } from '../state/follows';
import { AuthFrame } from './Auth';

export function NotFound({ inline }: { inline?: boolean }) {
  useDocumentTitle('Page not found');
  const { me } = useSession();
  const home = homeFor(me);
  const body = (
    <div className="notfound">
      <p className="notfound-code mono">404</p>
      <h1>There’s no page here</h1>
      <p>The address may be mistyped, or the page was moved. Nothing on your timetable has changed.</p>
      <div className="notfound-actions">
        <Link className="btn btn-primary" href={home ?? '/'}>{home ? 'Back to your timetable' : 'Go to the front page'}</Link>
        <Link className="btn" href="/join">Enter a class code</Link>
      </div>
    </div>
  );
  if (inline) return body;
  return <main id="main" className="auth">{body}</main>;
}

/** A workspace or batch we can't show: missing, not a member, not published. */
export function Blocked({ error, code }: { error: ApiFailure; code?: string }) {
  useDocumentTitle(code ? 'Code not found' : 'Workspace not available');
  const { me } = useSession();
  const home = homeFor(me);
  return (
    <AuthFrame
      title={code ? 'That code doesn’t open a timetable' : error.code === 'forbidden' ? 'You don’t have access' : 'This workspace isn’t available'}
      sub={error.message}
      foot={<Link href="/">EduSched home</Link>}
    >
      <div className="form">
        {code && (
          <button type="button" className="btn btn-block" onClick={() => unfollow(code)}>
            <Icon name="trash" /> Forget {code} on this device
          </button>
        )}
        <Link className="btn btn-primary btn-block" href={home ?? '/join'}>{home ? 'Go to your timetable' : 'Enter a different code'}</Link>
        {!me && <Link className="btn btn-ghost btn-block" href="/signin">Sign in</Link>}
      </div>
    </AuthFrame>
  );
}
