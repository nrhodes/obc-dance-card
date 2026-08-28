import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element not found');
}

// No <StrictMode> (plan Phase 3b finding): its dev-only double-invoked
// effects — mount, cleanup, mount again — multiply every onSnapshot
// subscription this app now has (My Card, Invites, Notifications, the
// session page's own entries/teams listeners, on top of the shared
// programme/members providers). Against the Firestore *emulator* specifically
// (not observed against production Firestore), that churn — especially with
// a second concurrent browser session also subscribing/unsubscribing, as in
// `e2e/dancecard.spec.ts` — reliably triggers a Firestore JS SDK internal
// bug ("INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9)") in the
// watch-stream target bookkeeping that leaves every listener in the tab
// permanently stuck loading. StrictMode has no effect in production builds
// either way, so removing it costs nothing there and fixes real e2e/dev
// reliability against the emulator.
createRoot(rootEl).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
