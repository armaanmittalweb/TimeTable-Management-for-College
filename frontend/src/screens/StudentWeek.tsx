import { useState } from 'react';
import type { FollowedBatch } from '../contract';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/Toast';
import { Link } from '../lib/router';
import { follow } from '../state/follows';
import { useSession } from '../state/session';
import type { Scope } from '../state/scope';
import { FeedDialog, WeekScreen } from './Week';

/** The week of a batch followed by code, with "follow on this device", the calendar feed and sign-in-to-sync. */
export function StudentWeek({ scope, fb, following }: { scope: Scope; fb: FollowedBatch; following: boolean }) {
  const { me } = useSession();
  const [feed, setFeed] = useState(false);
  return (
    <>
      <div className="notice">
        {following ? (
          <>
            <Icon name="batch" />
            <span>
              You follow <b>{fb.batch.name}</b> on this device.{' '}
              {me?.user ? 'It’s synced to your account.' : <><Link href="/signin?sync=1">Sign in to sync</Link> it to your other devices.</>}
            </span>
          </>
        ) : (
          <>
            <Icon name="info" />
            <span>This is <b>{fb.batch.name}</b>’s timetable at {fb.workspace.institution}.</span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                follow(fb);
                toast(`Following ${fb.batch.name}. It opens here next time.`);
              }}
            >
              Follow on this device
            </button>
          </>
        )}
        <button type="button" className="btn btn-sm notice-end" onClick={() => setFeed(true)}>
          <Icon name="calendar" /> Add to calendar
        </button>
      </div>
      <WeekScreen scope={scope} title={fb.batch.name} />
      <FeedDialog open={feed} onClose={() => setFeed(false)} code={fb.code} label={fb.batch.name} />
    </>
  );
}
