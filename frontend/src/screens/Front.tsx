// The signed-out front page: what EduSched is, the demo college's real week (today's classes on a phone), and
// how each role uses it, step by step, with screenshots of the real screens (scripts/landing-shots.mjs).

import { useState, type FormEvent } from 'react';
import { Icon, Mark } from '../ui/Icon';
import { Link, navigate } from '../lib/router';
import { useDocumentTitle, usePhone } from '../lib/hooks';
import { previewScope } from '../state/scope';
import { WeekScreen } from './Week';
import { TodayScreen } from './Today';

type Role = 'coord' | 'teacher' | 'student';
interface Step { title: string; body: string; alt: string }

const ROLES: { id: Role; label: string; who: string; steps: Step[] }[] = [
  {
    id: 'coord',
    label: 'Coordinator',
    who: 'You set the department up once. About an hour with your spreadsheets ready.',
    steps: [
      {
        title: 'Bring in rooms, teachers, batches and courses',
        body: 'Type them in, or import a CSV exported from Excel or Google Sheets. EduSched checks every line first and saves nothing until the whole file is right.',
        alt: 'The CSV import for rooms, listing three problems by line and column, with nothing saved',
      },
      {
        title: 'Place each batch’s classes on the week',
        body: 'Drag a course onto a period, or import the classes as a CSV. A batch, a teacher or a room can never be in two places at once.',
        alt: 'The timetable step: courses on the left, CSE-2A’s week of classes on the grid',
      },
      {
        title: 'Publish, then share the codes',
        body: 'Each batch gets a class code for its students. Each teacher gets a one-time invite code, so they can sign in and move their own classes.',
        alt: 'The codes and members step, with a class code for each batch',
      },
    ],
  },
  {
    id: 'teacher',
    label: 'Teacher',
    who: 'You move or cancel your own classes. It takes under a minute.',
    steps: [
      {
        title: 'Open your class and choose Reschedule',
        body: 'Free slots light up: times when the batch, you and a big enough room are all free. Hover a grey one to see who has it.',
        alt: 'Meera Iyer’s week with Friday’s CS201 being moved; free slots are outlined and listed by day',
      },
      {
        title: 'Pick a slot, a room and a reason',
        body: 'The move is for that one day; next week’s class stays where it was. The reason is what students see.',
        alt: 'The confirm bar: move CS201 from Friday 10:00 to Thursday 09:00 in CR-201, reason “Lab exam on Friday”',
      },
      {
        title: 'Confirm, and it is everyone’s',
        body: 'If someone booked the room a moment earlier, EduSched refuses the double booking and offers the nearest free room instead.',
        alt: 'A refused move: CR-201 was just booked by another class, with a button to use CR-204 instead',
      },
    ],
  },
  {
    id: 'student',
    label: 'Student',
    who: 'You follow your batch with its class code. No account.',
    steps: [
      {
        title: 'Enter the class code',
        body: 'Your coordinator shares it. Your batch’s week opens on this device and stays there next time.',
        alt: 'The join screen for CSE-2A, with a Follow this batch button',
      },
      {
        title: 'Check Today',
        body: 'What is on now, where and with whom. Moved and cancelled classes are marked for that day, with the reason. The last copy still opens without signal.',
        alt: 'Today for CSE-2A on a phone: the class happening now, then the rest of the day',
      },
      {
        title: 'Add it to your calendar',
        body: 'Subscribe once in Google or Apple Calendar. Moved and cancelled classes update there by themselves within a few hours.',
        alt: 'The Add to calendar dialog with the calendar address and steps for Google and Apple Calendar',
      },
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: 'What does it cost?', a: 'Nothing. EduSched is a project by Armaan Mittal that runs on free tiers (Vercel, Cloudflare Workers and Neon Postgres). There is no paid plan.' },
  { q: 'Do students need an account?', a: 'No. A class code opens the batch on that device. An account only keeps followed batches in sync across devices.' },
  { q: 'Can we bring our existing timetable?', a: 'Yes, as CSV: rooms, teachers, batches, courses and classes each import from a file, with a template to download. EduSched checks the whole file before it saves any of it.' },
  { q: 'What if two people move a class into the same room at once?', a: 'The second move is refused. The batch, the teacher and the room are checked together when the change is saved, not just when the slot is shown, so a double booking cannot get in.' },
  { q: 'What happens in the demo?', a: 'Opening the demo makes a private copy of a made-up college, Riverside Institute of Technology, that lasts 24 hours. Switch between the coordinator and any teacher from the bar at the top and move whatever you like.' },
  { q: 'What does it not do?', a: 'It does not generate a timetable for you: you place the classes and EduSched keeps them clash-free. It sends no emails or push alerts; students see changes in the app and in their calendar. Password resets go through the coordinator.' },
];

function HowItWorks() {
  const [role, setRole] = useState<Role>('coord');
  const [step, setStep] = useState(0);
  const r = ROLES.find((x) => x.id === role)!;
  const s = r.steps[step];
  const shot = `/landing/${role}-${step + 1}`;
  const pick = (id: Role) => { setRole(id); setStep(0); };
  const phone = usePhone();
  // On a phone the screenshot sits under the step it belongs to; on wider screens it stays beside the list.
  const figure = (
    <figure className="lp-shot" aria-live="polite">
      <picture key={shot}>
        <source media="(max-width: 720px)" srcSet={`${shot}.phone.webp`} width={600} height={1298} />
        <img src={`${shot}.desktop.webp`} width={1200} height={750} alt={s.alt} loading="lazy" decoding="async" />
      </picture>
      <figcaption className="muted">Step {step + 1} of 3 · {s.title}</figcaption>
    </figure>
  );
  return (
    <section className="lp-how" id="how" aria-labelledby="how-h">
      <div className="lp-wrap">
        <h2 id="how-h" className="lp-h2">How it works</h2>
        <p className="lp-sub">Pick who you are. Each step shows the real screen from the demo college.</p>
        <div className="seg lp-roles" role="tablist" aria-label="Your role">
          {ROLES.map((x) => (
            <button key={x.id} type="button" role="tab" id={`tab-${x.id}`} aria-selected={x.id === role} aria-controls="how-panel" className="seg-btn" onClick={() => pick(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="lp-panel" role="tabpanel" id="how-panel" aria-labelledby={`tab-${role}`}>
          <div className="lp-steps-col">
            <p className="lp-who">{r.who}</p>
            <ol className="lp-steps">
              {r.steps.map((x, i) => (
                <li key={x.title}>
                  <button type="button" className="lp-step" aria-pressed={i === step} onClick={() => setStep(i)}>
                    <span className="lp-num mono" aria-hidden="true">{i + 1}</span>
                    <span>
                      <b>{x.title}</b>
                      <span className="lp-step-body">{x.body}</span>
                    </span>
                  </button>
                  {phone && i === step && figure}
                </li>
              ))}
            </ol>
          </div>
          {!phone && figure}
        </div>
      </div>
    </section>
  );
}

export function Front() {
  useDocumentTitle('');
  const phone = usePhone();
  const [code, setCode] = useState('');
  const go = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) navigate(`/join/${encodeURIComponent(c)}`);
  };
  return (
    <div className="front">
      <a className="skip-link" href="#main">Skip to the content</a>
      <header className="front-bar">
        <Link className="top-brand" href="/" aria-label="EduSched home">
          <Mark />
          <span className="top-word">EduSched</span>
        </Link>
        <span className="front-tag">the timetable your department runs on</span>
        <form className="front-code" onSubmit={go} role="search" aria-label="Open a class code">
          <label className="sr-only" htmlFor="front-code">Class code</label>
          <input id="front-code" className="input mono" placeholder="Have a class code?" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          <button type="submit" className="btn" disabled={!code.trim()}>Open</button>
        </form>
        <div className="front-actions">
          <Link className="btn btn-ghost" href="/signin">Sign in</Link>
          <Link className="btn btn-primary" href="/demo">{phone ? 'Open the demo' : 'Open the demo college'}</Link>
        </div>
      </header>
      <main id="main" className="main front-main" tabIndex={-1}>
        <section className="lp-hero" aria-labelledby="hero-h">
          <div className="lp-wrap">
            <p className="lp-kicker">For college departments</p>
            <h1 id="hero-h">The timetable your department runs on</h1>
            <p className="lp-lede">
              Every batch, teacher and room on one week. When a class is cancelled or moved, it changes for that day only, and every student who follows the
              batch sees it straight away, with who changed it and why.
            </p>
            <div className="lp-actions">
              <Link className="btn btn-primary btn-lg" href="/demo">Open the demo college</Link>
              <a className="btn btn-lg" href="#how">See how it works</a>
            </div>
            <p className="lp-note">The demo is your own 24-hour copy of a made-up college. Switch between its coordinator and teachers, and move anything.</p>
          </div>
        </section>

        <section className="lp-live" aria-label="The demo college’s timetable">
          <div className="front-context">
            <span><b>CSE-2A</b> · Computer Science, Riverside Institute of Technology</span>
            <span className="front-context-note">{phone ? 'Today in the demo college, live.' : 'The demo college’s week, live. Click any class; open the demo to move one.'}</span>
          </div>
          {phone ? <TodayScreen scope={previewScope} title="CSE-2A" /> : <WeekScreen scope={previewScope} title="CSE-2A" />}
        </section>

        <HowItWorks />

        <section className="lp-story" aria-labelledby="story-h">
          <div className="lp-wrap">
            <h2 id="story-h" className="lp-h2">One change, start to finish</h2>
            <ol className="lp-timeline">
              <li><span className="lp-when mono">Wed 11:20</span><b>Meera moves Friday’s CS201</b><span>to Thursday 09:00 in CR-201, reason “Lab exam on Friday”. She picks from the free slots EduSched shows her.</span></li>
              <li><span className="lp-when mono">Wed 11:20</span><b>The server checks it again</b><span>CSE-2A, Meera and CR-201 are all free at that moment, so the move is saved for 2 October only. Every other Friday is untouched.</span></li>
              <li><span className="lp-when mono">Wed 11:21</span><b>CSE-2A sees it</b><span>On Today and in Changes: “moved from Fri 10:00”, with Meera’s reason. Anyone offline sees it the next time they have signal.</span></li>
              <li><span className="lp-when mono">Within hours</span><b>Calendars catch up</b><span>Google and Apple Calendar subscribers get the class on Thursday at their calendar’s next refresh. Nobody had to send a message.</span></li>
            </ol>
          </div>
        </section>

        <section className="lp-faq" aria-labelledby="faq-h">
          <div className="lp-wrap">
            <h2 id="faq-h" className="lp-h2">Questions</h2>
            <div className="lp-faq-list">
              {FAQ.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}<Icon name="plus" /></summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
            <div className="lp-actions lp-end">
              <Link className="btn btn-primary btn-lg" href="/demo">Open the demo college</Link>
              <Link className="btn btn-lg" href="/signup">Create a workspace</Link>
              <Link className="btn btn-lg btn-ghost" href="/join">Enter a class code</Link>
            </div>
          </div>
        </section>

        <footer className="front-foot">
          <span>EduSched · built by Armaan Mittal</span>
          <a href="https://www.amittal.dev/" rel="noopener">Case study on amittal.dev</a>
          <a href="https://github.com/armaanmittalweb/TimeTable-Management-for-College" rel="noopener">Source on GitHub</a>
          <Link href="/join">Enter a class code</Link>
          <Link href="/signup">Create a workspace</Link>
        </footer>
      </main>
    </div>
  );
}
