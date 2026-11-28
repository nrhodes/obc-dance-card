/**
 * Canonical Firestore collection/document path builders. Using these keeps path
 * strings identical between the security rules tests, Cloud Functions, and the
 * clients.
 *
 * Two families (plan §21 B14.2):
 *  - `clubPaths(clubId)` — everything a club owns: its members, programme,
 *    entries, invites, teams, visitors, audit log, imports, integrity runs.
 *  - `paths` — everything that belongs to a person or to the platform, whatever
 *    clubs they are in: `memberPrivate`, notifications, iCal tokens, rate
 *    limits, login codes.
 *
 * Stage 1b (B14.8) moved the data: club-owned collections live under
 * `clubs/{clubId}/…`, and `memberPrivate` became `userPrivate`. The
 * pre-migration top-level collections are no longer read or written by
 * anything; `LEGACY_PATHS` names them for the migration script alone.
 */

import type { Id } from './primitives.js';
import type { Weekday } from './enums.js';

/** Stable, URL-safe club slug. Chosen at club creation and never renamed. */
export type ClubId = string;

/**
 * The original club. No longer a server-side fallback (stage 1c made `clubId`
 * required on every club-scoped callable): it is what a client shows before
 * it knows the person's clubs, and what seeds, scripts and tests act in.
 */
export const DEFAULT_CLUB_ID: ClubId = 'orewa';

export interface ClubPaths {
  readonly clubId: ClubId;

  members(): string;
  member(memberId: Id): string;

  visitors(): string;
  visitor(visitorId: Id): string;

  teams(): string;
  team(teamId: Id): string;

  imports(): string;
  import(importId: Id): string;

  programmes(): string;
  programme(year: number | string): string;
  weekdays(year: number | string): string;
  weekday(year: number | string, weekday: Weekday): string;
  series(year: number | string): string;
  seriesDoc(year: number | string, seriesId: Id): string;
  sessions(year: number | string): string;
  session(year: number | string, sessionId: Id): string;

  entries(): string;
  entry(entryId: Id): string;

  invites(): string;
  invite(inviteId: Id): string;

  auditLog(): string;
  auditLogEntry(id: Id): string;

  integrity(): string;
  integrityRun(id: Id): string;
}

/** Path builders for one club's data, all under `clubs/{clubId}/`. */
export function clubPaths(clubId: ClubId): ClubPaths {
  const root = `clubs/${clubId}/`;
  return {
    clubId,

    members: () => `${root}members`,
    member: (memberId) => `${root}members/${memberId}`,

    visitors: () => `${root}visitors`,
    visitor: (visitorId) => `${root}visitors/${visitorId}`,

    teams: () => `${root}teams`,
    team: (teamId) => `${root}teams/${teamId}`,

    imports: () => `${root}imports`,
    import: (importId) => `${root}imports/${importId}`,

    programmes: () => `${root}programmes`,
    programme: (year) => `${root}programmes/${year}`,
    weekdays: (year) => `${root}programmes/${year}/weekdays`,
    weekday: (year, weekday) => `${root}programmes/${year}/weekdays/${weekday}`,
    series: (year) => `${root}programmes/${year}/series`,
    seriesDoc: (year, seriesId) => `${root}programmes/${year}/series/${seriesId}`,
    sessions: (year) => `${root}programmes/${year}/sessions`,
    session: (year, sessionId) => `${root}programmes/${year}/sessions/${sessionId}`,

    entries: () => `${root}entries`,
    entry: (entryId) => `${root}entries/${entryId}`,

    invites: () => `${root}invites`,
    invite: (inviteId) => `${root}invites/${inviteId}`,

    auditLog: () => `${root}auditLog`,
    auditLogEntry: (id) => `${root}auditLog/${id}`,

    integrity: () => `${root}integrity`,
    integrityRun: (id) => `${root}integrity/${id}`,
  };
}

/** Person-level and platform-level paths: not owned by any one club. */
export const paths = {
  /** The club record itself: name, colour, status (plan §21 B14.2). */
  clubs: () => 'clubs',
  club: (clubId: ClubId) => `clubs/${clubId}`,

  /** The person: which clubs they are an active member of. Server-maintained. */
  users: () => 'users',
  user: (uid: Id) => `users/${uid}`,

  /** The person's private record: login email, devices, notification prefs, iCal token. */
  userPrivates: () => 'userPrivate',
  userPrivate: (uid: Id) => `userPrivate/${uid}`,

  rateLimits: () => 'rateLimits',
  rateLimit: (key: Id) => `rateLimits/${key}`,

  icalTokens: () => 'icalTokens',
  icalToken: (hash: Id) => `icalTokens/${hash}`,

  notifications: () => 'notifications',
  notification: (notificationId: Id) => `notifications/${notificationId}`,

  emailCodes: () => 'emailCodes',
} as const;

/**
 * Where club-owned data lived before stage 1b. Used ONLY by
 * `firebase/scripts/migrate-to-clubs.ts` to read the old layout; nothing in
 * the app reads or writes these, and the rules deny them.
 */
export const LEGACY_PATHS = {
  /** Top-level collections that moved under `clubs/{clubId}/`, same collection name. */
  clubCollections: ['members', 'visitors', 'teams', 'imports', 'entries', 'invites', 'auditLog', 'integrity'],
  /** `programmes/{year}` and its sub-collections moved under the club as a tree. */
  programmes: 'programmes',
  programmeSubcollections: ['weekdays', 'series', 'sessions'],
  /** Renamed to `userPrivate`. */
  memberPrivate: 'memberPrivate',
} as const;
