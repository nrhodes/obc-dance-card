/**
 * Pure (no React, no Firestore) "My Dance Card" grouping + status-label logic
 * (plan Phase 3b task, §5.6, §7). Kept separate from the screen component so
 * every status/substitution shape is unit-testable without mounting React or
 * mocking Firestore — mirrors `lib/roster.ts`'s split for the session page.
 *
 * Status wording deliberately does not repeat "You:" (unlike
 * `roster.ts#describeOwnEntry`, used on the shared session page where the
 * line needs to be picked out from other members' rows) — every row on this
 * screen is already the signed-in member's own, so the status text alone
 * ("with X", "Looking for a partner", …) reads naturally.
 */
import { ACTIVE_ENTRY_STATUSES, WEEKDAYS, type Entry, type Series, type Session, type Team, type Weekday, type WeekdayProgramme } from '@obc/shared';

const ACTIVE = new Set<string>(ACTIVE_ENTRY_STATUSES as readonly string[]);

/**
 * `sessions`/`series`/`weekdays` may come from `useProgramme()`'s merged,
 * multi-year view (plan §21 B3), where each item is tagged with its year —
 * or from a plain single-year fixture (`year` absent). `seriesId` can
 * collide across years (`${weekday}-${slug(name)}`), so a series lookup
 * must only match a same-year doc when the year is known; an untagged item
 * (`year` absent, e.g. older tests/callers) always matches, preserving the
 * pre-B3 single-year behaviour.
 */
type Tagged<T> = T & { year?: number };

function entryYear(entry: Entry): number {
  return Number(entry.date.slice(0, 4));
}

/** True for any entry that still occupies a place on the card (plan §5.6 status list, minus `cancelled`). */
export function isActiveCardEntry(entry: Entry): boolean {
  return ACTIVE.has(entry.status);
}

/**
 * One line's status text, e.g. `"with John Smith"`, `"with Bob Visitor
 * (visitor)"`, `"with John Smith — sub: Amy Lee for John Smith"`,
 * `"with John Smith — you're covered by Amy Lee"`, `"Looking for a
 * partner"`, `"Available"`, or a team's name.
 */
export function describeCardStatus(entry: Entry, teams: Team[] = []): string {
  if (entry.teamId) {
    const team = teams.find((t) => t.id === entry.teamId);
    return team ? team.name : 'On a team';
  }
  if (entry.status === 'looking_for_partner') return 'Looking for a partner';
  if (entry.status === 'available') return 'Available';
  if (entry.status === 'confirmed' && entry.partner) {
    let text = `with ${entry.partner.displayName}`;
    if (entry.partner.kind === 'visitor') text += ' (visitor)';
    if (entry.partnerSubstitute) {
      text += ` — sub: ${entry.partnerSubstitute.displayName} for ${entry.partner.displayName}`;
    }
    return text;
  }
  if (entry.status === 'substituted') {
    if (entry.partner && entry.substitute) {
      return `with ${entry.partner.displayName} — you're covered by ${entry.substitute.displayName}`;
    }
    return 'Substituted';
  }
  return 'Confirmed';
}

/** The title to show for one entry's session: the session's own title, or its series name as a fallback. */
export function cardSessionTitle(entry: Entry, sessions: Tagged<Session>[], series: Tagged<Series>[]): string {
  const session = sessions.find((s) => s.id === entry.sessionId);
  if (session) return session.title;
  if (entry.seriesId) {
    const year = entryYear(entry);
    const s = series.find((sr) => sr.id === entry.seriesId && (sr.year == null || sr.year === year));
    if (s) return s.name;
  }
  return 'Session';
}

export interface CardRow {
  entry: Entry;
  title: string;
  date: string;
  statusText: string;
  /** True for a Teams-series entry — the row shows a "Team" badge (plan Phase 4c task, keep it simple). */
  isTeam: boolean;
}

export interface CardGroup {
  /** `seriesId`, or `single:{sessionId}` for a standalone (non-series) session. */
  key: string;
  title: string;
  rows: CardRow[];
}

export interface CardWeekdayGroup {
  weekday: Weekday;
  label: string;
  groups: CardGroup[];
}

function toRow(entry: Entry, sessions: Tagged<Session>[], series: Tagged<Series>[], teams: Team[]): CardRow {
  return {
    entry,
    title: cardSessionTitle(entry, sessions, series),
    date: entry.date,
    statusText: describeCardStatus(entry, teams),
    isTeam: entry.teamId != null,
  };
}

/**
 * Groups the signed-in member's upcoming entries by weekday (Mon→Fri order),
 * then by series (or standalone session) within each weekday, with rows in
 * date order. Cancelled entries are dropped — they no longer occupy a place
 * on the card (plan Phase 3b task, deliverable 1).
 */
export function groupCardEntries(
  entries: Entry[],
  sessions: Tagged<Session>[],
  series: Tagged<Series>[],
  weekdays: Tagged<WeekdayProgramme>[],
  teams: Team[] = [],
): CardWeekdayGroup[] {
  const active = entries.filter(isActiveCardEntry);
  const byWeekday = new Map<Weekday, Entry[]>();
  for (const e of active) {
    const list = byWeekday.get(e.weekday) ?? [];
    list.push(e);
    byWeekday.set(e.weekday, list);
  }

  const result: CardWeekdayGroup[] = [];
  for (const wd of WEEKDAYS) {
    const list = byWeekday.get(wd);
    if (!list || list.length === 0) continue;

    // Grouping key is year-qualified from the *entry's own* date, not from a
    // series lookup — `seriesId` can collide across years, so two entries in
    // different years' identically-slugged series must never land in the
    // same group (plan §21 B3 id-collision note).
    const bySeries = new Map<string, Entry[]>();
    for (const e of list) {
      const key = e.seriesId ? `${entryYear(e)}:${e.seriesId}` : `single:${e.sessionId}`;
      const group = bySeries.get(key) ?? [];
      group.push(e);
      bySeries.set(key, group);
    }

    const groups: CardGroup[] = [];
    for (const [key, groupEntries] of bySeries) {
      const sorted = [...groupEntries].sort((a, b) => a.date.localeCompare(b.date));
      const first = sorted[0]!;
      const seriesDoc = first.seriesId
        ? series.find((s) => s.id === first.seriesId && (s.year == null || s.year === entryYear(first)))
        : undefined;
      const title = seriesDoc ? seriesDoc.name : cardSessionTitle(first, sessions, series);
      groups.push({ key, title, rows: sorted.map((e) => toRow(e, sessions, series, teams)) });
    }
    groups.sort((a, b) => (a.rows[0]?.date ?? '').localeCompare(b.rows[0]?.date ?? ''));

    // `weekdays` is newest-year-first when it comes from `useProgramme()`'s
    // merged view (see `ProgrammeProvider`), so this `.find()` already
    // prefers the newest year's label for a repeated weekday.
    const weekdayDoc = weekdays.find((w) => w.weekday === wd);
    result.push({ weekday: wd, label: weekdayDoc?.label ?? wd, groups });
  }
  return result;
}

/** Flat, most-recent-first rows for the collapsed "Past" section. */
export function buildPastRows(entries: Entry[], sessions: Tagged<Session>[], series: Tagged<Series>[], teams: Team[] = []): CardRow[] {
  return [...entries.filter(isActiveCardEntry)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => toRow(e, sessions, series, teams));
}
