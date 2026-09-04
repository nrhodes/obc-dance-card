/**
 * Shared setup helpers for emulator-backed tests (`src/**\/*.emu.test.ts`).
 * See `src/testing/README.md` for the testing conventions this supports.
 */
import { randomUUID } from 'node:crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  DEFAULT_NOTIFICATION_PREFS,
  paths,
  todayNZ,
  validatePairingGroup,
  validateTeamGroup,
  type Entry,
  type IsoDate,
  type MemberGrade,
  type MemberPrivate,
  type MemberRole,
  type Notification,
  type NotificationType,
  type Programme,
  type Series,
  type SeriesFormat,
  type Session,
  type Team,
  type TimeOfDay,
  type Weekday,
  type WeekdayProgramme,
} from '@obc/shared';
import { expect } from 'vitest';
import { auth, db } from '../lib/admin.js';
import { sessionIdForSeries, slugify } from '../admin/programmeIds.js';

export interface MakeMemberOptions {
  role?: MemberRole;
  active?: boolean;
  grade?: MemberGrade;
  phone?: string;
  firstName?: string;
  lastName?: string;
  hasPassword?: boolean;
}

/** Creates a real emulator Auth user plus matching `members`/`memberPrivate` docs. */
export async function makeMember(email: string, opts: MakeMemberOptions = {}): Promise<string> {
  const user = await auth.createUser({ email, emailVerified: true, disabled: opts.active === false });
  const now = new Date().toISOString();
  await db.doc(paths.member(user.uid)).set({
    id: user.uid,
    firstName: opts.firstName ?? 'Test',
    lastName: opts.lastName ?? 'Member',
    phone: opts.phone ?? '',
    email: email.toLowerCase(),
    grade: opts.grade ?? 'Open',
    role: opts.role ?? 'member',
    active: opts.active ?? true,
    createdAt: now,
    updatedAt: now,
  });
  const memberPrivate: MemberPrivate = {
    id: user.uid,
    emailLower: email.toLowerCase(),
    notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
    devices: [],
    hasPassword: opts.hasPassword ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await db.doc(paths.memberPrivate(user.uid)).set(memberPrivate);
  return user.uid;
}

/** A minimal fake `CallableRequest` for calling an exported `xxxHandler` directly. */
export function fakeCallableRequest<T>(
  data: T,
  opts: { uid?: string; ip?: string; authTimeSeconds?: number } = {},
): CallableRequest<T> {
  return {
    data,
    auth: opts.uid
      ? {
          uid: opts.uid,
          // Defaults to "now" (fresh sign-in) so every existing test that
          // doesn't care about recency keeps behaving as before; pass
          // `authTimeSeconds` explicitly to simulate a stale session (e.g.
          // for the setPassword recent-login check, audit M1).
          token: { auth_time: opts.authTimeSeconds ?? Math.floor(Date.now() / 1000) } as never,
        }
      : undefined,
    rawRequest: { headers: {}, ip: opts.ip ?? '203.0.113.1' } as never,
  } as unknown as CallableRequest<T>;
}

/* -------------------------------------------------------------------------- */
/* Programme fixtures (entries/invariant tests)                              */
/* -------------------------------------------------------------------------- */

const JS_WEEKDAY_INDEX: Record<Weekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
};

function addDaysIso(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function nearestDateOnWeekday(weekday: Weekday, direction: 1 | -1): IsoDate {
  const target = JS_WEEKDAY_INDEX[weekday];
  let candidate = todayNZ();
  for (let i = 0; i < 7; i++) {
    const dow = new Date(`${candidate}T00:00:00Z`).getUTCDay();
    if (dow === target) return candidate;
    candidate = addDaysIso(candidate, direction);
  }
  /* c8 ignore next */
  throw new Error(`unreachable: ${weekday} not found within a week`);
}

/**
 * A date on `weekday`, `weeksAhead` weeks from today (real wall-clock time) —
 * comfortably unlocked for "session is open" tests. Default 4 weeks leaves
 * margin regardless of what time the test happens to run.
 */
export function sessionInFuture(weekday: Weekday = 'monday', weeksAhead = 4): IsoDate {
  return addDaysIso(nearestDateOnWeekday(weekday, 1), weeksAhead * 7);
}

/** A date on `weekday`, `weeksAgo` weeks before today — always locked. */
export function sessionInPast(weekday: Weekday = 'monday', weeksAgo = 4): IsoDate {
  return addDaysIso(nearestDateOnWeekday(weekday, -1), -weeksAgo * 7);
}

export interface MakeProgrammeOptions {
  weekday?: Weekday;
  startTime?: TimeOfDay;
  seatedByTime?: TimeOfDay;
  seriesFormat?: SeriesFormat;
  seriesName?: string;
  allowSubstitute?: boolean;
  teamMin?: number;
  teamMax?: number;
  /** Session dates (`YYYY-MM-DD`), in order. Use `sessionInFuture`/`sessionInPast`. */
  dates: IsoDate[];
  /** Defaults to `'published'` — most tests need an open programme. */
  programmeStatus?: 'draft' | 'published';
}

export interface MadeProgramme {
  year: number;
  weekday: Weekday;
  seriesId: string;
  sessionIds: string[];
}

/**
 * Writes a minimal published programme (weekday + one series + its sessions)
 * directly with the Admin SDK — mirrors what `importProgramme` would produce,
 * without going through CSV parsing. Every entries/invariant test builds its
 * fixture session(s) with this.
 *
 * `year` is deliberately *not* a caller-supplied parameter: it is derived
 * from `opts.dates[0]` (a real calendar date, from `sessionInFuture`/
 * `sessionInPast`), because production code (`cancelEntry`) derives a
 * session's programme year from its entry's `date` field — a fixture that
 * let the two disagree would build states that can never occur for real.
 * Every `makeProgramme` call gets a unique `seriesId` (see below), so tests
 * don't need distinct years to stay isolated from each other.
 */
export async function makeProgramme(opts: MakeProgrammeOptions): Promise<MadeProgramme> {
  if (opts.dates.length === 0) {
    throw new Error('makeProgramme: at least one date is required');
  }
  const year = Number(opts.dates[0]!.slice(0, 4));
  const weekday = opts.weekday ?? 'monday';
  const startTime = opts.startTime ?? '13:00';
  const seatedByTime = opts.seatedByTime ?? '12:45';
  const format: SeriesFormat = opts.seriesFormat ?? 'Pairs';
  // `sessionInFuture`/`sessionInPast` compute dates from real wall-clock time, so
  // two tests using the same weekday/weeksAhead land on the identical calendar
  // date. `entries` is a flat top-level collection keyed by `sessionId`, which is
  // derived from `seriesId` + date — so without a unique series name here, two
  // tests' sessions (and thus their entries) would collide under one `sessionId`
  // even though they belong to different `year`s. A short random suffix keeps
  // every `makeProgramme` call's session ids globally unique regardless of dates.
  const seriesName = `${opts.seriesName ?? `Test ${format} Series`} ${randomUUID().slice(0, 8)}`;
  const seriesId = `${weekday}-${slugify(seriesName)}`;
  const now = new Date().toISOString();

  const programme: Programme = {
    id: String(year),
    year,
    status: opts.programmeStatus ?? 'published',
    importedAt: now,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await db.doc(paths.programme(year)).set(programme);

  const weekdayDoc: WeekdayProgramme = {
    id: weekday,
    weekday,
    label: `Test ${weekday}`,
    startTime,
    seatedByTime,
    createdAt: now,
    updatedAt: now,
  };
  await db.doc(paths.weekday(year, weekday)).set(weekdayDoc);

  const sessionIds = opts.dates.map((date) => sessionIdForSeries(seriesId, date));

  const series: Series = {
    id: seriesId,
    weekday,
    name: seriesName,
    scoring: 'Scr',
    format,
    bestOf: null,
    allowSubstitute: opts.allowSubstitute ?? true,
    order: 0,
    sessionIds,
    teamMin: opts.teamMin ?? 4,
    teamMax: opts.teamMax ?? 6,
    createdAt: now,
    updatedAt: now,
  };
  await db.doc(paths.seriesDoc(year, seriesId)).set(series);

  const partnerRequired = format !== 'Teams';
  for (let i = 0; i < opts.dates.length; i++) {
    const date = opts.dates[i]!;
    const session: Session = {
      id: sessionIds[i]!,
      date,
      weekday,
      seriesId,
      kind: 'series',
      title: seriesName,
      partnerRequired,
      seriesName,
      scoring: 'Scr',
      format,
      createdAt: now,
      updatedAt: now,
    };
    await db.doc(paths.session(year, sessionIds[i]!)).set(session);
  }

  return { year, weekday, seriesId, sessionIds };
}

/* -------------------------------------------------------------------------- */
/* Invariant assertions (plan §7 / §17 "after every mutation")               */
/* -------------------------------------------------------------------------- */

/** Every entry doc for one session, straight from Firestore. */
export async function entriesForSession(sessionId: string): Promise<Entry[]> {
  const snap = await db.collection(paths.entries()).where('sessionId', '==', sessionId).get();
  return snap.docs.map((d) => d.data() as Entry);
}

/**
 * Reads every entry for `sessionId` and asserts `validatePairingGroup` finds
 * no violations (plan §7 — "law"; every test asserts this after every
 * mutation). Returns the entries read, so callers can chain further
 * assertions without a second read.
 */
export async function assertSessionPairingValid(sessionId: string): Promise<Entry[]> {
  const entries = await entriesForSession(sessionId);
  const issues = validatePairingGroup(entries);
  expect(issues, `validatePairingGroup violations for session ${sessionId}`).toEqual([]);
  return entries;
}

/** Every entry doc currently tagged with `teamId`, straight from Firestore. */
export async function entriesForTeam(teamId: string): Promise<Entry[]> {
  const snap = await db.collection(paths.entries()).where('teamId', '==', teamId).get();
  return snap.docs.map((d) => d.data() as Entry);
}

/**
 * Reads `teamId`'s team doc, its series, and every entry tagged with it, and
 * asserts `validateTeamGroup` finds no I9 violations (plan §7 — "law"; every
 * team test asserts this after every mutation). Returns everything read, so
 * callers can chain further assertions without a second read.
 */
export async function assertTeamValid(teamId: string): Promise<{ team: Team; series: Series; entries: Entry[] }> {
  const teamSnap = await db.doc(paths.team(teamId)).get();
  const team = teamSnap.data() as Team;
  const seriesSnap = await db.doc(paths.seriesDoc(team.year, team.seriesId)).get();
  const series = seriesSnap.data() as Series;
  const entries = await entriesForTeam(teamId);
  const issues = validateTeamGroup(team, series, entries);
  expect(issues, `validateTeamGroup violations for team ${teamId}`).toEqual([]);
  return { team, series, entries };
}

/** Every notification doc for one member, optionally filtered by type. */
export async function notificationsFor(memberId: string, type?: NotificationType): Promise<Notification[]> {
  const snap = await db.collection(paths.notifications()).where('memberId', '==', memberId).get();
  const all = snap.docs.map((d) => d.data() as Notification);
  return type ? all.filter((n) => n.type === type) : all;
}
