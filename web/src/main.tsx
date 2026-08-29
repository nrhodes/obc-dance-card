import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root element not found');
}

// <StrictMode> is back on (Phase 7b task deliverable A). Phase 3b removed it
// after StrictMode's dev-only double-invoked effects (mount, cleanup, mount
// again) reliably triggered a Firestore JS SDK internal assertion against
// the *emulator* with two concurrent sessions. Root cause and fix are
// documented in `docs/web-hardening.md`; see that file before touching this
// again. It is guarded off only for the E2E suite, which still exercises
// two concurrent real browser contexts against the emulator in
// `dancecard.spec.ts`/`teams.spec.ts`/`admin.spec.ts` — see the doc for why
// that residual case needs the guard even after the fix.
const strictModeDisabled = import.meta.env.VITE_DISABLE_STRICT_MODE === 'true';

const tree = strictModeDisabled ? (
  <BrowserRouter>
    <App />
  </BrowserRouter>
) : (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

createRoot(rootEl).render(tree);
