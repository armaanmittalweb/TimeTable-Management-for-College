// Codes and members: class codes to share with students, teacher invites, and the people in the workspace.

import { useState } from 'react';
import type { Invite, Member, WorkspaceFull } from '../../contract';
import { api, ApiFailure } from '../../api';
import { Icon } from '../../ui/Icon';
import { Dialog } from '../../ui/Dialog';
import { toast } from '../../ui/Toast';
import { ago } from '../../lib/time';
import { useQuery, invalidate } from '../../state/query';
import { useSession } from '../../state/session';

const copy = (text: string, what: string) => void navigator.clipboard?.writeText(text).then(() => toast(`${what} copied.`), () => toast('Could not copy.', { tone: 'error' }));
const joinLink = (code: string) => `${location.origin}/join/${code}`;

export function CodesStep({ full, onSaved }: { full: WorkspaceFull; onSaved: () => void }) {
  const w = api.w(full.workspace.slug);
  const { me } = useSession();
  const members = useQuery<Member[]>(`ws:${full.workspace.slug}:members`, () => w.members());
  const invites = useQuery<Invite[]>(`ws:${full.workspace.slug}:invites`, () => w.invites());
  const [rotate, setRotate] = useState<number | null>(null);
  const [inviteFor, setInviteFor] = useState<string>(() => String(full.teachers.find((t) => !t.hasAccount)?.id ?? ''));
  const [made, setMade] = useState<{ title: string; code: string; note: string } | null>(null);
  const noAccount = full.teachers.filter((t) => !t.hasAccount);
  const pendingFor = (tid: number | null) => invites.data?.find((i) => i.teacherId === tid);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      invalidate();
      onSaved();
    } catch (x) {
      toast(x instanceof ApiFailure ? x.message : 'That didn’t work.', { tone: 'error' });
    }
  };
  const invite = async () => {
    const teacherId = inviteFor === 'coord' ? undefined : Number(inviteFor);
    try {
      const r = await w.invite(inviteFor === 'coord' ? { role: 'coordinator' } : { role: 'teacher', teacherId });
      const t = full.teachers.find((x) => x.id === teacherId);
      setMade({ title: t ? `Invite for ${t.name}` : 'Coordinator invite', code: r.code, note: `Works once, until ${new Date(r.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. They sign in or create an account, then enter it.` });
      invites.reload();
    } catch (x) {
      toast(x instanceof ApiFailure ? x.message : 'Could not make an invite.', { tone: 'error' });
    }
  };
  const resetCode = async (m: Member) => {
    try {
      const r = await w.resetCode(m.userId);
      setMade({ title: `Reset code for ${m.name}`, code: r.code, note: 'Give it to them in person or by message. It works once, for one hour, at “Forgot it?” on the sign-in page.' });
    } catch (x) {
      toast(x instanceof ApiFailure ? x.message : 'Could not make a reset code.', { tone: 'error' });
    }
  };

  return (
    <div className="setup-form">
      <p className="setup-lead">Students follow a batch with its class code: no account, nothing to install. Teachers join with a one-time invite so they can move their own classes.</p>

      <h3 className="setup-h3">Class codes</h3>
      {!full.workspace.published && <p className="notice notice-quiet"><Icon name="info" /> Codes start working once you publish.</p>}
      <table className="tbl">
        <thead><tr><th scope="col">Batch</th><th scope="col">Code</th><th scope="col">Link to share</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {full.batches.map((b) => (
            <tr key={b.id}>
              <td className="mono">{b.name}</td>
              <td><span className="code-pill mono">{b.code}</span></td>
              <td className="mono muted tbl-link">{joinLink(b.code).replace(/^https?:\/\//, '')}</td>
              <td className="tbl-actions">
                <button type="button" className="btn btn-sm" onClick={() => copy(joinLink(b.code), `Link for ${b.name}`)}><Icon name="copy" /> Copy link</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRotate(b.id)}>New code</button>
              </td>
            </tr>
          ))}
          {!full.batches.length && <tr><td colSpan={4} className="muted">Add batches first; each gets a code.</td></tr>}
        </tbody>
      </table>

      <h3 className="setup-h3">Invite a teacher</h3>
      <div className="invite-row">
        <label className="sr-only" htmlFor="inv-who">Who</label>
        <select id="inv-who" className="select select-sm" value={inviteFor} onChange={(e) => setInviteFor(e.target.value)}>
          {noAccount.map((t) => <option key={t.id} value={t.id}>{t.name}{pendingFor(t.id) ? ' (invite pending)' : ''}</option>)}
          <option value="coord">Another coordinator</option>
        </select>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void invite()} disabled={!inviteFor}>Make an invite code</button>
        <span className="muted">{noAccount.length ? `${noAccount.length} of ${full.teachers.length} teachers haven’t joined yet.` : 'Every teacher has joined.'}</span>
      </div>
      {!!invites.data?.length && (
        <table className="tbl tbl-compact">
          <thead><tr><th scope="col">Pending invite</th><th scope="col">For</th><th scope="col">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {invites.data.map((i) => (
              <tr key={i.code}>
                <td><span className="code-pill mono">{i.code}</span></td>
                <td>{i.teacherId ? full.teachers.find((t) => t.id === i.teacherId)?.name : i.role === 'coordinator' ? 'A coordinator' : 'A teacher'}</td>
                <td className="muted">{new Date(i.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                <td className="tbl-actions">
                  <button type="button" className="btn btn-sm" onClick={() => copy(joinLink(i.code), 'Invite link')}><Icon name="copy" /> Copy link</button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => void act(() => w.revokeInvite(i.code), 'Invite revoked.')}>Revoke</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="setup-h3">Members</h3>
      {!members.data ? (
        <div className="skel" style={{ height: 120 }} />
      ) : (
        <table className="tbl">
          <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Teaches as</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {members.data.map((m) => {
              const self = m.userId === me?.user?.id;
              return (
                <tr key={m.userId}>
                  <td><b>{m.name}</b>{self && <span className="muted"> (you)</span>}<div className="muted tbl-sub">{m.email}</div></td>
                  <td>
                    <label className="sr-only" htmlFor={`role-${m.userId}`}>Role for {m.name}</label>
                    <select id={`role-${m.userId}`} className="select select-sm" value={m.role} onChange={(e) => void act(() => w.setRole(m.userId, e.target.value as Member['role']), `${m.name} is now a ${e.target.value}.`).then(() => members.reload())}>
                      <option value="coordinator">Coordinator</option>
                      <option value="teacher">Teacher</option>
                    </select>
                  </td>
                  <td>{m.teacherId ? full.teachers.find((t) => t.id === m.teacherId)?.name : <span className="muted">–</span>}</td>
                  <td className="muted">{ago(m.joinedAt)}</td>
                  <td className="tbl-actions">
                    {!self && <button type="button" className="btn btn-sm btn-ghost" onClick={() => void resetCode(m)}>Password reset code</button>}
                    {!self && <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={`Remove ${m.name}`} onClick={() => void act(() => w.removeMember(m.userId), `${m.name} removed.`).then(() => members.reload())}><Icon name="trash" /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Dialog
        open={rotate !== null}
        onClose={() => setRotate(null)}
        title="Make a new class code?"
        size="sm"
        description="The old code stops working straight away. Students already following the batch will need the new one."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRotate(null)}>Keep the old code</button>
            <button type="button" className="btn btn-danger" onClick={() => { const id = rotate!; setRotate(null); void act(() => w.rotateCode(id), 'New code made. Share it with the batch.'); }}>Make a new code</button>
          </>
        }
      />
      <Dialog open={!!made} onClose={() => setMade(null)} title={made?.title ?? ''} size="sm" description={made?.note}>
        {made && (
          <div className="made">
            <span className="made-code mono">{made.code}</span>
            <div className="made-actions">
              <button type="button" className="btn" onClick={() => copy(made.code, 'Code')}><Icon name="copy" /> Copy code</button>
              {!made.title.startsWith('Reset') && <button type="button" className="btn" onClick={() => copy(joinLink(made.code), 'Link')}><Icon name="link" /> Copy link</button>}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
