import type { Change } from '../contract';
import { DAY_SHORT, dow } from '../lib/time';

/** "moved Tue 09:00 → Thu 12:00, LT-101" with each time and room kept on one line. */
export function ChangeText({ c }: { c: Change }) {
  const d = (date: string) => DAY_SHORT[dow(date)];
  if (c.kind === 'cancelled') return <>cancelled on <span className="nowrap">{d(c.from.date)} {c.from.start}</span></>;
  const to = c.to!;
  return (
    <>
      moved <span className="nowrap">{d(c.from.date)} {c.from.start}</span> → <span className="nowrap">{d(to.date)} {to.start}</span>
      {to.room !== c.from.room && <>, <span className="nowrap">{to.room}</span></>}
    </>
  );
}
