/**
 * Anonymous page-view count for the Switchboard (api.amittal.dev/hit): the page path and the
 * referring site, sent as a beacon. No cookies, no ids, nothing about what you do on the page.
 * Skipped on localhost and in automated browsers.
 */
const ENDPOINT = 'https://api.amittal.dev/hit';

export function countViews(site: string) {
  if (typeof navigator === 'undefined' || !navigator.sendBeacon || navigator.webdriver || !location.hostname.endsWith('amittal.dev')) return;
  let last = '';
  const send = () => {
    const path = location.pathname;
    if (path === last) return;
    const ref = last ? '' : document.referrer;
    last = path;
    try {
      navigator.sendBeacon(ENDPOINT, JSON.stringify({ s: site, p: path, r: ref }));
    } catch {
      // Counting must never break the page.
    }
  };
  send();
  const push = history.pushState.bind(history);
  history.pushState = (...args: Parameters<History['pushState']>) => {
    push(...args);
    send();
  };
  addEventListener('popstate', send);
}
