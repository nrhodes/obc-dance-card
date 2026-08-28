// Intentionally no `@testing-library/jest-dom` import — it is not in the
// closed dependency list for this workspace. Tests use plain vitest
// assertions (`.textContent`, `element != null`, etc.) instead of jest-dom's
// `toBeInTheDocument()`-style matchers.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
