/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FUNCTIONS_REGION: string;
  readonly VITE_USE_EMULATORS: string;
  /** E2E-only escape hatch — see `main.tsx` and `docs/web-hardening.md`. Not set in production. */
  readonly VITE_DISABLE_STRICT_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
