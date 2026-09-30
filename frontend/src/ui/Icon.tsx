// 16px line icons drawn for EduSched (1.6 stroke, round joins). Decorative by default.

const P: Record<string, string> = {
  'chevron-left': 'M10 3.5 5.5 8l4.5 4.5',
  'chevron-right': 'M6 3.5 10.5 8 6 12.5',
  'chevron-down': 'm4 6 4 4 4-4',
  search: 'M7 12.2A5.2 5.2 0 1 0 7 1.8a5.2 5.2 0 0 0 0 10.4ZM10.8 10.8l3.4 3.4',
  x: 'M4 4l8 8M12 4l-8 8',
  check: 'm3.2 8.4 3 3 6.6-6.8',
  calendar: 'M2.5 4.2c0-.7.5-1.2 1.2-1.2h8.6c.7 0 1.2.5 1.2 1.2v8.6c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2V4.2ZM2.5 6.5h11M5.5 1.5v3M10.5 1.5v3',
  clock: 'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM8 4.5V8l2.4 1.6',
  room: 'M3 14V3.2c0-.6.5-1.2 1.2-1.2h7.6c.7 0 1.2.6 1.2 1.2V14M1.5 14h13M9.8 8.6v.4',
  batch: 'M5.8 7.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8ZM1.5 13.5c0-2.4 1.9-4.2 4.3-4.2s4.3 1.8 4.3 4.2M10.6 2.6a2.3 2.3 0 0 1 0 4.4M12.2 9.6c1.4.5 2.3 1.9 2.3 3.9',
  teacher: 'M8 7.4a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6ZM2.8 14.2c0-2.9 2.3-4.9 5.2-4.9s5.2 2 5.2 4.9',
  'arrow-right': 'M2.5 8h11M9.5 4l4 4-4 4',
  undo: 'M5.5 3 2.5 6l3 3M2.8 6h6.7a4 4 0 0 1 0 8H7',
  move: 'M2 8h12M11.5 5.5 14 8l-2.5 2.5M4.5 5.5 2 8l2.5 2.5M8 2v12',
  ban: 'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM3.6 3.6l8.8 8.8',
  printer: 'M4 6V2h8v4M4 12H2.8c-.7 0-1.3-.6-1.3-1.3V7.3C1.5 6.6 2 6 2.8 6h10.4c.7 0 1.3.6 1.3 1.3v3.4c0 .7-.6 1.3-1.3 1.3H12M4 9.5h8V14H4z',
  link: 'M6.7 9.3a3 3 0 0 0 4.3 0l2.2-2.2a3 3 0 0 0-4.3-4.3l-.7.7M9.3 6.7a3 3 0 0 0-4.3 0L2.8 8.9a3 3 0 0 0 4.3 4.3l.7-.7',
  copy: 'M5.5 5.5V3.2c0-.7.5-1.2 1.2-1.2h6.1c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2h-2.3M3.2 5.5h6.1c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2V6.7c0-.7.5-1.2 1.2-1.2Z',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  plus: 'M8 3v10M3 8h10',
  upload: 'M8 10.5V2.5M5 5.5l3-3 3 3M2.5 10.5v2.3c0 .7.5 1.2 1.2 1.2h8.6c.7 0 1.2-.5 1.2-1.2v-2.3',
  download: 'M8 2.5v8M5 7.5l3 3 3-3M2.5 10.5v2.3c0 .7.5 1.2 1.2 1.2h8.6c.7 0 1.2-.5 1.2-1.2v-2.3',
  settings: 'M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM12.9 9.8l1.1.9-1.3 2.2-1.4-.4a5 5 0 0 1-1.5.9L9.5 14.8h-3l-.3-1.4a5 5 0 0 1-1.5-.9l-1.4.4L2 10.7l1.1-.9a5 5 0 0 1 0-1.6L2 7.3l1.3-2.2 1.4.4a5 5 0 0 1 1.5-.9l.3-1.4h3l.3 1.4c.6.2 1 .5 1.5.9l1.4-.4L14 7.3l-1.1.9a5 5 0 0 1 0 1.6Z',
  logout: 'M6 14H3.2c-.7 0-1.2-.5-1.2-1.2V3.2C2 2.5 2.5 2 3.2 2H6M10.5 11.5 14 8l-3.5-3.5M14 8H6',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1',
  moon: 'M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z',
  monitor: 'M2.5 3h11c.3 0 .5.2.5.5v7c0 .3-.2.5-.5.5h-11a.5.5 0 0 1-.5-.5v-7c0-.3.2-.5.5-.5ZM5.5 14h5M8 11v3',
  alert: 'M8 6v3M8 11.5h.01M7 2.6 1.6 12c-.4.8.1 1.6 1 1.6h10.8c.9 0 1.4-.9 1-1.6L9 2.6c-.4-.8-1.6-.8-2 0Z',
  offline: 'M2 2l12 12M5.3 8.6a4.5 4.5 0 0 1 2.2-1.1M1.5 5.8A9 9 0 0 1 4 4.3M10.4 7.8c.5.2 1 .5 1.4.9M8.5 3.1a9 9 0 0 1 6 2.7M6.6 11a2 2 0 0 1 2.8 0M8 13.5h.01',
  info: 'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM8 7.3v4M8 4.9h.01',
  keyboard: 'M1.5 4.5c0-.6.4-1 1-1h11c.6 0 1 .4 1 1v7c0 .6-.4 1-1 1h-11c-.6 0-1-.4-1-1v-7ZM4 6.5h.01M6.7 6.5h.01M9.3 6.5h.01M12 6.5h.01M4.5 9.5h7',
  trash: 'M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.3c0 .7.6 1.2 1.2 1.2h4.2c.6 0 1.2-.5 1.2-1.2L12 4M6.8 7v4.5M9.2 7v4.5',
  refresh: 'M13.5 3v3.2h-3.2M2.5 13v-3.2h3.2M3.2 6.2A5.2 5.2 0 0 1 13.2 6M12.8 9.8a5.2 5.2 0 0 1-10 .2',
  external: 'M9.5 2.5h4v4M13.5 2.5 8 8M11.5 9.5v3.3c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2V5.7c0-.7.5-1.2 1.2-1.2h3.3',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  grid: 'M2 2.5h12v11H2zM2 6h12M6 2.5v11M10 2.5v11',
  today: 'M2.5 4.2c0-.7.5-1.2 1.2-1.2h8.6c.7 0 1.2.5 1.2 1.2v8.6c0 .7-.5 1.2-1.2 1.2H3.7c-.7 0-1.2-.5-1.2-1.2V4.2ZM2.5 6.5h11M5.5 1.5v3M10.5 1.5v3M8 9h2.5v2.5H8z',
  changes: 'M2 5h9.5M9 2.5 11.5 5 9 7.5M14 11H4.5M7 8.5 4.5 11 7 13.5',
  setup: 'M3 2.5h10M3 6h6M3 9.5h10M3 13h6',
  key: 'M10.5 9.5a4 4 0 1 0-3.9-3.1L1.5 11.5v3h3v-1.5H6v-1.5h1.5l1.1-1.1c.6.2 1.2.1 1.9.1ZM11 5h.01',
  lock: 'M4 7V5a4 4 0 0 1 8 0v2M3.2 7h9.6c.4 0 .7.3.7.7v6.1c0 .4-.3.7-.7.7H3.2a.7.7 0 0 1-.7-.7V7.7c0-.4.3-.7.7-.7Z',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16, className, label }: { name: IconName | string; size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} focusable="false"
    >
      <path d={P[name] ?? ''} />
    </svg>
  );
}

/** The product mark: a navy square with a white timetable grid. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="mark">
      <rect width="20" height="20" rx="4.5" fill="var(--navy)" />
      <path d="M4.5 7.5h11M4.5 11h11M4.5 14.5h11M8.2 4.5v11.5M11.8 4.5v11.5" stroke="var(--navy-ink)" strokeWidth="1.3" strokeLinecap="round" opacity="0.9" />
      <rect x="8.8" y="8.1" width="2.4" height="2.3" rx="0.5" fill="var(--navy-ink)" />
    </svg>
  );
}
