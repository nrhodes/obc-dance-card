/**
 * "Reset this browser": removes everything this site has saved in this
 * browser — the service worker, its caches, IndexedDB (Firebase Auth and App
 * Check state) and web storage — then reloads. It is the in-app equivalent
 * of the browser's "Clear site data", for members who cannot be asked to
 * open developer tools. Nothing on the server changes; the member simply
 * has to sign in again.
 *
 * Every step is best-effort: a browser that lacks an API, or refuses one,
 * must not stop the others or the final reload.
 */
export async function resetSiteDataAndReload(): Promise<void> {
  const attempt = async (step: () => Promise<unknown>): Promise<void> => {
    try {
      await step();
    } catch {
      // best-effort
    }
  };

  await attempt(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  });
  await attempt(async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  });
  await attempt(async () => {
    // `indexedDB.databases()` is missing in some browsers; the names below
    // are the ones the Firebase SDK uses, as a fallback.
    const listed = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    const names = new Set<string>([
      'firebaseLocalStorageDb',
      'firebase-app-check-database',
      'firebase-installations-database',
      'firebase-messaging-database',
      'firebase-heartbeat-database',
    ]);
    for (const db of listed) if (db.name) names.add(db.name);
    for (const name of names) indexedDB.deleteDatabase(name);
  });
  await attempt(async () => {
    localStorage.clear();
    sessionStorage.clear();
  });

  window.location.replace('/signin');
}
