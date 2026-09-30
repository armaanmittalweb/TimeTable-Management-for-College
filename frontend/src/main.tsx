import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { countViews } from './beacon';
import { setTransport } from './api';
import { applyTheme } from './lib/theme';
import { SessionProvider } from './state/session';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/grid.css';
import './styles/panel.css';
import './styles/screens.css';
import './styles/setup.css';
import './styles/print.css';

applyTheme();
countViews('edusched');

async function start() {
  if (import.meta.env.VITE_API === 'mock') {
    // The mock is only bundled into mock builds.
    const { mockTransport } = await import('./api/mock');
    setTransport(mockTransport);
  }
  const isEmbed = /^\/embed\/?$/.test(location.pathname);
  const root = createRoot(document.getElementById('root')!);
  if (isEmbed) {
    const { Embed } = await import('./screens/Embed');
    root.render(<StrictMode><Embed /></StrictMode>);
  } else {
    const { default: App } = await import('./App');
    root.render(
      <StrictMode>
        <SessionProvider>
          <App />
        </SessionProvider>
      </StrictMode>,
    );
  }
  if ('serviceWorker' in navigator && import.meta.env.PROD && !isEmbed) {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    // Hand the service worker the lazily loaded chunks this page used, so the app opens offline next time.
    void navigator.serviceWorker.ready.then((reg) => {
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => u.startsWith(`${location.origin}/assets/`)).map((u) => new URL(u).pathname);
      reg.active?.postMessage({ type: 'cache', urls });
    });
  }
}
void start();
