import { useEffect, useMemo, useRef, useState } from 'react';
import { DemoNote, SignIn, StationHeader } from './components/Chrome';
import { ControlRoom, Platform } from './components/Views';
import { useMedia } from './motion';
import { boardWeek, defaultDay } from './time';
import { useDemo } from './useDemo';

type View = 'platform' | 'control';

export default function App() {
  const demo = useDemo();
  const week = useMemo(() => boardWeek(demo.today), [demo.today]);
  const [controlDay, setControlDay] = useState(() => defaultDay(demo.today));
  const [platformDay, setPlatformDay] = useState(() => defaultDay(demo.today));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const phone = useMedia('(max-width: 480px)');
  const [view, setView] = useState<View>('platform');
  const [unseen, setUnseen] = useState(false);
  const lastFollow = useRef(0);

  // A change that touches the platform's classes brings its board to that day.
  useEffect(() => {
    const f = demo.platformFollow;
    if (!f || f.n === lastFollow.current) return;
    lastFollow.current = f.n;
    setPlatformDay(f.day);
    if (phone && view !== 'platform') setUnseen(true);
  }, [demo.platformFollow, phone, view]);

  // Pick a sensible first selection once the professor's board arrives: the next class on the day shown.
  useEffect(() => {
    if (selectedId !== null || !demo.profRows?.length) return;
    const first = demo.profRows.find((r) => r.day_of_week === controlDay && !r.modification_type) ?? demo.profRows[0];
    setSelectedId(first.id);
  }, [demo.profRows, controlDay, selectedId]);

  const show = (v: View) => {
    setView(v);
    if (v === 'platform') setUnseen(false);
  };

  return (
    <div className="station">
      <StationHeader demo={demo} />

      {phone && (
        <nav className="switch" aria-label="View">
          <button type="button" aria-pressed={view === 'platform'} aria-controls="view-platform" onClick={() => show('platform')}>
            PLATFORM
            {unseen && (
              <span className="switch-badge">
                <span className="lamp is-on" aria-hidden="true" />
                <span className="sr-only">, updated</span>
              </span>
            )}
          </button>
          <button type="button" aria-pressed={view === 'control'} aria-controls="view-control" onClick={() => show('control')}>
            CONTROL ROOM
          </button>
        </nav>
      )}

      <main className="split">
        <ControlRoom
          demo={demo}
          week={week}
          day={controlDay}
          onDay={setControlDay}
          selectedId={selectedId}
          onSelect={setSelectedId}
          hidden={phone && view !== 'control'}
        />
        {/* On a phone the hidden platform is unmounted, so its cells flip from what it last showed when it comes back. */}
        {(!phone || view === 'platform') && <Platform demo={demo} week={week} day={platformDay} onDay={setPlatformDay} />}
      </main>

      <footer className="station-foot">
        <DemoNote />
        <SignIn demo={demo} />
      </footer>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {demo.announcement}
      </div>
    </div>
  );
}
