/**
 * `icalFeed` — the app's first unauthenticated read endpoint (plan §21 B1).
 * Serves one member's bridge schedule as an RFC 5545 `text/calendar` feed so
 * Apple/Google Calendar can subscribe to it. Calendar clients can do neither
 * Firebase Auth nor App Check, so this is deliberately `onRequest`, not
 * `onCall`, and deliberately does NOT enforce App Check — everything else
 * about it is designed to make that safe: an unguessable 256-bit token,
 * hash-keyed server-only lookup, a uniform 404 for every "no" case, per-token
 * and per-IP rate limits, and a feed that carries only the member's own
 * schedule with names already denormalised onto the entry (never a visitor
 * or memberPrivate doc). See `docs/implementation-plan.md` §21 B1 for the
 * full design this follows exactly, and §8.1 for the threat-model row.
 *
 * Mounted at `/ical/**` by a Hosting rewrite (`firebase/firebase.json`) —
 * the token is always the URL's last path segment with a trailing `.ics`
 * stripped, which tolerates both that rewritten shape (`/ical/<token>.ics`)
 * and a direct function URL (`/<token>.ics`, or the function name still
 * ahead of it) without caring how many path segments precede it.
 */
import { createHash } from 'node:crypto';
import { onRequest, HttpsError, type Request } from 'firebase-functions/v2/https';
import type { Response } from 'express';
import {
  addDaysNZ,
  paths,
  todayNZ,
  type Entry,
  type EntryStatus,
  type IcalToken,
  type Member,
  type Session,
  type Team,
  type Weekday,
  type WeekdayProgramme,
} from '@obc/shared';
import { db } from '../lib/admin.js';
import { assertRateLimit } from '../lib/rateLimit.js';
import { logger } from '../lib/logger.js';
import { buildCalendar, type IcsEvent } from './ics.js';

/** 32 CSPRNG bytes, base64url — exactly 43 characters (plan §21 B1 token model). */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const PROD_ID = '-//Orewa Bridge Club//OBC Dance Card//EN';
/** Include recently-past sessions too, not just future ones (plan §21 B1 step 4). */
const LOOKBACK_DAYS = 30;
const SESSION_DURATION_MINUTES = 180;
const DEFAULT_START_TIME = '13:00';

const FEED_STATUSES: ReadonlySet<EntryStatus> = new Set<EntryStatus>([
  'confirmed',
  'substituted',
  'looking_for_partner',
  'available',
]);

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** The URL's last path segment, `.ics` suffix stripped — or `null` if the shape is wrong. */
function parseTokenFromPath(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || !last.endsWith('.ics')) return null;
  const token = last.slice(0, -'.ics'.length);
  return token.length > 0 ? token : null;
}

/** First `x-forwarded-for` hop, falling back to the connection IP — same convention as `auth/emailCode.ts#clientIp`. */
function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.length > 0) {
    return first.split(',')[0]!.trim();
  }
  return req.ip ?? 'unknown';
}

/**
 * The one shared "no" response (plan §21 B1): invalid token shape, unknown
 * token, and an inactive member's token all return the identical
 * status+body — no signal to distinguish them.
 */
function sendUniformNotFound(res: Response, method: string): void {
  res.status(404).set('Content-Type', 'text/plain; charset=utf-8').set('X-Content-Type-Options', 'nosniff');
  if (method === 'HEAD') res.end();
  else res.send('Not found');
}

export async function icalFeedHandler(req: Request, res: Response): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.status(405).set('Allow', 'GET, HEAD').send('Method not allowed');
    return;
  }

  const token = parseTokenFromPath(req.path ?? '');
  if (!token || !TOKEN_RE.test(token)) {
    sendUniformNotFound(res, method);
    return;
  }
  const tokenHash = sha256Hex(token);
  // Never logged in full — only the first 8 hex characters (plan §21 B1 "Log only").
  const tokenHashPrefix = tokenHash.slice(0, 8);

  try {
    try {
      await assertRateLimit('ical:token', tokenHash, 60, 60 * 60);
      await assertRateLimit('ical:ip', clientIp(req), 300, 60 * 60);
    } catch (err) {
      if (err instanceof HttpsError && err.code === 'resource-exhausted') {
        logger.warn('ical_feed_rate_limited', { tokenPrefix: tokenHashPrefix });
        res.status(429).set('Retry-After', '3600').send('Too many requests.');
        return;
      }
      throw err;
    }

    const tokenSnap = await db.doc(paths.icalToken(tokenHash)).get();
    const tokenDoc = tokenSnap.data() as IcalToken | undefined;
    if (!tokenDoc) {
      sendUniformNotFound(res, method);
      return;
    }

    const memberSnap = await db.doc(paths.member(tokenDoc.memberId)).get();
    const member = memberSnap.data() as Member | undefined;
    if (!member || member.active !== true) {
      // Deactivation kills the feed immediately (plan §21 B1 step 3).
      sendUniformNotFound(res, method);
      return;
    }

    const events = await loadFeedEvents(member.id);
    const icsText = buildCalendar(events, { prodId: PROD_ID });

    res
      .status(200)
      .set('Content-Type', 'text/calendar; charset=utf-8')
      .set('Cache-Control', 'private, max-age=300')
      .set('X-Content-Type-Options', 'nosniff')
      .set('Content-Disposition', 'inline; filename="obc-bridge.ics"');

    logger.info('ical_feed_served', {
      tokenPrefix: tokenHashPrefix,
      memberId: member.id,
      entries: events.length,
      status: 200,
    });

    if (method === 'HEAD') res.end();
    else res.send(icsText);
  } catch (err) {
    logger.error('ical_feed_error', { name: err instanceof Error ? err.name : 'unknown' });
    res.status(500).set('Content-Type', 'text/plain; charset=utf-8').send('Something went wrong.');
  }
}

/**
 * Reads `memberId`'s feed-eligible entries and everything needed to render
 * them (session titles, weekday start times, team names), caching each
 * distinct session/weekday/team lookup once per request rather than once per
 * entry.
 */
async function loadFeedEvents(memberId: string): Promise<IcsEvent[]> {
  const cutoff = addDaysNZ(todayNZ(), -LOOKBACK_DAYS);
  const entriesSnap = await db
    .collection(paths.entries())
    .where('memberId', '==', memberId)
    .where('date', '>=', cutoff)
    .orderBy('date')
    .get();

  const entries = entriesSnap.docs
    .map((d) => d.data() as Entry)
    .filter((e) => FEED_STATUSES.has(e.status));

  const sessionCache = new Map<string, Session | null>();
  const weekdayCache = new Map<string, WeekdayProgramme | null>();
  const teamCache = new Map<string, Team | null>();

  async function loadSession(year: number, sessionId: string): Promise<Session | null> {
    const key = `${year}/${sessionId}`;
    if (!sessionCache.has(key)) {
      const snap = await db.doc(paths.session(year, sessionId)).get();
      sessionCache.set(key, (snap.data() as Session | undefined) ?? null);
    }
    return sessionCache.get(key) ?? null;
  }

  async function loadStartTime(year: number, weekday: Weekday): Promise<string> {
    const key = `${year}/${weekday}`;
    if (!weekdayCache.has(key)) {
      const snap = await db.doc(paths.weekday(year, weekday)).get();
      weekdayCache.set(key, (snap.data() as WeekdayProgramme | undefined) ?? null);
    }
    return weekdayCache.get(key)?.startTime ?? DEFAULT_START_TIME;
  }

  async function loadTeamName(teamId: string): Promise<string | null> {
    if (!teamCache.has(teamId)) {
      const snap = await db.doc(paths.team(teamId)).get();
      teamCache.set(teamId, (snap.data() as Team | undefined) ?? null);
    }
    return teamCache.get(teamId)?.name ?? null;
  }

  const events: IcsEvent[] = [];
  for (const entry of entries) {
    const year = Number(entry.date.slice(0, 4));
    const session = await loadSession(year, entry.sessionId);
    const title = session?.title ?? 'Bridge session';
    const startTime = await loadStartTime(year, entry.weekday);

    let summary = title;
    let status: 'CONFIRMED' | 'TENTATIVE' = 'CONFIRMED';
    if (entry.status === 'looking_for_partner') {
      status = 'TENTATIVE';
      summary += ' (looking for a partner)';
    } else if (entry.status === 'available') {
      status = 'TENTATIVE';
      summary += ' (available)';
    } else if (entry.status === 'substituted' && entry.substitute) {
      summary += ` covered by ${entry.substitute.displayName}`;
    } else if (entry.partner) {
      summary += ` with ${entry.partner.displayName}`;
    }
    if (entry.teamId) {
      const teamName = await loadTeamName(entry.teamId);
      if (teamName) summary += ` — ${teamName}`;
    }

    events.push({
      uid: `${entry.id}@obc-dance-card`,
      summary,
      location: 'Orewa Bridge Club',
      status,
      date: entry.date,
      startTime,
      durationMinutes: SESSION_DURATION_MINUTES,
      dtstamp: entry.updatedAt,
      lastModified: entry.updatedAt,
    });
  }

  return events;
}

export const icalFeed = onRequest(
  {
    region: 'australia-southeast1',
    maxInstances: 5,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  icalFeedHandler,
);
