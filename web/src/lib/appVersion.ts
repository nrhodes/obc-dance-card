/**
 * Which build of the app is running in this tab — for the Help screen, so a
 * member reporting a problem (or an admin checking a deploy) can read it out.
 */

/** e.g. `455ba94`, or `unknown` for a build made outside a git checkout. */
export function shortCommit(commit: string): string {
  return /^[0-9a-f]{40}$/.test(commit) ? commit.slice(0, 7) : commit || 'unknown';
}

/** e.g. `28 Nov 2026, 1:21 pm`, in the club's time zone. Empty for an unparseable value. */
export function formatBuiltAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export const APP_VERSION = {
  commit: shortCommit(__APP_COMMIT__),
  builtAt: formatBuiltAt(__APP_BUILT_AT__),
};
