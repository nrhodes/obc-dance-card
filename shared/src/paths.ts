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
 * **Stage 1a (B14.8): the club is threaded through the code, but the data has
 * not moved.** `clubPaths` deliberately ignores `clubId` when spelling a path,
 * so every builder still returns today's top-level location. Stage 1b flips
 * the builders in this one file to `clubs/{clubId}/…` together with the data
 * migration and the rules.
 */

import type { Id } from './primitives.js';
import type { Weekday } from './enums.js';

/** Stable, URL-safe club slug. Chosen at club creation and never renamed. */
export type ClubId = string;

/**
 * The one club that exists today. Server callables fall back to it when a
 * request carries no `clubId`; stage 1c removes that fallback and makes
 * `clubId` required.
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

/** Path builders for one club's data. See the file header for the stage-1a caveat. */
export function clubPaths(clubId: ClubId): ClubPaths {
  // Stage 1b: `const root = `clubs/${clubId}/`;` — until then the data is top-level.
  const root = '';
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
  memberPrivates: () => 'memberPrivate',
  memberPrivate: (memberId: Id) => `memberPrivate/${memberId}`,

  rateLimits: () => 'rateLimits',
  rateLimit: (key: Id) => `rateLimits/${key}`,

  icalTokens: () => 'icalTokens',
  icalToken: (hash: Id) => `icalTokens/${hash}`,

  notifications: () => 'notifications',
  notification: (notificationId: Id) => `notifications/${notificationId}`,

  emailCodes: () => 'emailCodes',
} as const;
