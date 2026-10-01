import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiFailure } from '../api';
import { navigate, Link } from '../lib/router';
import { useDocumentTitle } from '../lib/hooks';
import { useSession } from '../state/session';
import { AuthFrame } from './Auth';

export const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Dhaka', 'Asia/Kathmandu', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

export function NewWorkspaceScreen() {
  useDocumentTitle('New workspace');
  const { me, ready, refresh } = useSession();
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [timezone, setTimezone] = useState(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return TIMEZONES.includes(tz) ? tz : 'Asia/Kolkata';
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (ready && !me?.user) navigate('/signup?next=/new', { replace: true });
  }, [ready, me]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const ws = await api.createWorkspace({ name: name.trim(), institution: institution.trim(), timezone });
      await refresh();
      navigate(`/w/${ws.slug}/setup`, { replace: true });
    } catch (x) {
      setErr(x instanceof ApiFailure ? x.message : 'Could not create the workspace.');
    } finally {
      setBusy(false);
    }
  };
  const first = !me?.memberships.length;
  return (
    <AuthFrame
      title={first ? 'Set up your department' : 'New workspace'}
      sub="A workspace holds one department’s timetable: its rooms, teachers, batches and courses. You can invite teachers and share class codes once it’s published."
      foot={first ? <>Joining someone else’s? <Link href="/join">Use an invite code</Link></> : <Link href="/">Back</Link>}
    >
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="ws-name">Department</label>
          <input id="ws-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Science" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="ws-inst">Institution</label>
          <input id="ws-inst" className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Riverside Institute of Technology" required />
        </div>
        <div className="field">
          <label htmlFor="ws-tz">Timezone</label>
          <select id="ws-tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <span className="field-hint">Class times and “today” follow this, wherever people open the timetable.</span>
        </div>
        {err && <p className="form-error" role="alert">{err}</p>}
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !name.trim() || !institution.trim()}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </AuthFrame>
  );
}
