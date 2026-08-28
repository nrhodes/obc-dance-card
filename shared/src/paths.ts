/**
 * Canonical Firestore collection/document path builders. Using these keeps path
 * strings identical between the security rules tests, Cloud Functions, and the
 * clients.
 */

import type { Id } from './primitives.js';
import type { Weekday } from './enums.js';

export const paths = {
  members: () => 'members',
  member: (memberId: Id) => `members/${memberId}`,

  programmes: () => 'programmes',
  programme: (year: number | string) => `programmes/${year}`,

  weekdays: (year: number | string) => `programmes/${year}/weekdays`,
  weekday: (year: number | string, weekday: Weekday) =>
    `programmes/${year}/weekdays/${weekday}`,

  series: (year: number | string) => `programmes/${year}/series`,
  seriesDoc: (year: number | string, seriesId: Id) =>
    `programmes/${year}/series/${seriesId}`,

  sessions: (year: number | string) => `programmes/${year}/sessions`,
  session: (year: number | string, sessionId: Id) =>
    `programmes/${year}/sessions/${sessionId}`,

  entries: () => 'entries',
  entry: (entryId: Id) => `entries/${entryId}`,

  invites: () => 'invites',
  invite: (inviteId: Id) => `invites/${inviteId}`,

  notifications: () => 'notifications',
  notification: (notificationId: Id) => `notifications/${notificationId}`,

  auditLog: () => 'auditLog',
  emailCodes: () => 'emailCodes',
} as const;
