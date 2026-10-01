// The signed-out front page: not a landing page, the demo college's real week, with a slim bar to get in.

import { useState, type FormEvent } from 'react';
import { Mark } from '../ui/Icon';
import { Link, navigate } from '../lib/router';
import { useDocumentTitle } from '../lib/hooks';
import { previewScope } from '../state/scope';
import { WeekScreen } from './Week';

export function Front() {
  useDocumentTitle('');
  const [code, setCode] = useState('');
  const go = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) navigate(`/join/${encodeURIComponent(c)}`);
  };
  return (
    <div className="front">
      <a className="skip-link" href="#main">Skip to the timetable</a>
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
          <Link className="btn btn-primary" href="/demo">Open the demo college</Link>
        </div>
      </header>
      <main id="main" className="main front-main" tabIndex={-1}>
        <div className="front-context">
          <span><b>CSE-2A</b> · Computer Science, Riverside Institute of Technology</span>
          <span className="front-context-note">A demo college. Click any class; open the demo to move one.</span>
        </div>
        <WeekScreen scope={previewScope} title="CSE-2A" />
        <section className="front-text" aria-labelledby="about">
          <h2 id="about" className="sr-only">About EduSched</h2>
          <div>
            <h3>What it does</h3>
            <p>
              EduSched keeps a department’s weekly timetable in one place: every batch, teacher and room on one week grid. When a class is cancelled or moved,
              it changes for that day only, and everyone who follows the batch sees it straight away, with who changed it and why.
            </p>
          </div>
          <div>
            <h3>For coordinators and teachers</h3>
            <p>
              Import rooms, teachers, batches and courses from a spreadsheet, place classes on the week, and publish. Teachers reschedule their own classes: EduSched
              shows the free slots, checks the batch, the teacher and the room for clashes, and refuses a double booking even when two people click at once.
            </p>
          </div>
          <div>
            <h3>For students</h3>
            <p>
              Enter the class code your coordinator shares. No account needed: your batch’s week and today’s classes open on this device, work offline, and subscribe
              to Google or Apple Calendar so moved classes update there too.
            </p>
          </div>
        </section>
        <footer className="front-foot">
          <span>EduSched · built by Armaan Mittal</span>
          <a href="https://www.amittal.dev/" rel="noopener">Case study on amittal.dev</a>
          <Link href="/join">Enter a class code</Link>
          <Link href="/signup">Create a workspace</Link>
        </footer>
      </main>
    </div>
  );
}
