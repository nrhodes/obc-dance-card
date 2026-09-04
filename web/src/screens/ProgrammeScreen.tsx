/**
 * Programme browser (`/programme`, plan Phase 2b task, §5.4, §14.1). Members
 * only ever see *published* programmes — `useProgramme` subscribes to every
 * `programmes/{year}` with `status: 'published'` (newest few years) and
 * their weekdays/series/sessions subcollections, and merges them into one
 * chronological, year-tagged view; drafts are invisible to members at the
 * rules layer, so there is nothing to filter here.
 *
 * Extended by plan §21 B3 ("Hide past events by default + two-year
 * horizon"): the timeline now spans every loaded published year, and past
 * sessions/series are hidden by default with a toggle to reveal them —
 * mirroring `HomeScreen`'s "Show past" pattern.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { WEEKDAYS, isPastNZ, todayNZ, type Series, type Session, type Weekday, type WeekdayProgramme } from '@obc/shared';
import { useProgramme } from '../programme/useProgramme';
import { useMembersDirectory } from '../members/useMembersDirectory';
import { formatDateNZ, formatTimeOfDay, shortWeekdayLabel } from '../lib/format';
import { buildWeekdayTimeline, defaultProgrammeWeekday, weekdaysWithData, type SeriesTimelineItem, type WeekdayTimelineItem } from '../lib/programmeView';
import { SubscriptionError } from '../components/SubscriptionError';

type Tagged<T> = T & { year: number };

/** A fully-past series (every session on it is before today, NZ) is hidden by default (plan §21 B3). */
function isSeriesFullyPast(item: SeriesTimelineItem): boolean {
  return item.sessions.length > 0 && item.sessions.every((s) => isPastNZ(s.date));
}

export function ProgrammeScreen() {
  const { years, weekdays, series, sessions, loading, error } = useProgramme();
  const [activeWeekday, setActiveWeekday] = useState<Weekday>(defaultProgrammeWeekday());
  const [pastOpen, setPastOpen] = useState(false);

  const presentWeekdays = useMemo(
    () => weekdaysWithData(weekdays.map((w) => w.weekday), WEEKDAYS),
    [weekdays],
  );

  // Once real data arrives, correct the initial guess if it picked a weekday
  // this programme doesn't run.
  useEffect(() => {
    if (presentWeekdays.length > 0 && !presentWeekdays.includes(activeWeekday)) {
      setActiveWeekday(presentWeekdays[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentWeekdays]);

  function jumpToToday() {
    const today = todayNZ();
    const next = [...sessions]
      .filter((s) => s.kind !== 'noBridge' && s.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!next) return;
    setActiveWeekday(next.weekday);
    requestAnimationFrame(() => {
      document.getElementById(`session-row-${next.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (presentWeekdays.length === 0) return;
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % presentWeekdays.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + presentWeekdays.length) % presentWeekdays.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = presentWeekdays.length - 1;
    if (nextIndex == null) return;
    e.preventDefault();
    const next = presentWeekdays[nextIndex]!;
    setActiveWeekday(next);
    document.getElementById(`weekday-tab-${next}`)?.focus();
  }

  if (loading) {
    return (
      <div className="card">
        <p>Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h1>Programme</h1>
        <SubscriptionError resource="the programme" />
      </div>
    );
  }

  if (years.length === 0) {
    return (
      <div className="card">
        <h1>Programme</h1>
        <p>The programme hasn&apos;t been published yet.</p>
      </div>
    );
  }

  // `weekdays` is newest-year-first (see `ProgrammeProvider`), so a plain
  // `.find()` here already implements "prefer the newest year's weekday
  // doc, fall back to an older year's if the newest year lacks it."
  const weekdayDoc = weekdays.find((w) => w.weekday === activeWeekday);
  const timeline = buildWeekdayTimeline(activeWeekday, series, sessions);
  const isPastItem = (item: WeekdayTimelineItem) =>
    item.type === 'single' ? isPastNZ(item.session.date) : isSeriesFullyPast(item);
  // How many items the default (collapsed) view hides — the toggle only
  // renders when there is actually something behind it; a button that
  // visibly does nothing is confusing (plan §14.1's forgiving-UI intent).
  const hiddenPastCount = timeline.filter(isPastItem).length;
  const visibleTimeline = pastOpen ? timeline : timeline.filter((item) => !isPastItem(item));
  const heading = `${years.slice().reverse().join(' & ')} Programme`;

  return (
    <div className="stack">
      <div className="card">
        <h1>{heading}</h1>
        <button type="button" className="button button-secondary" onClick={jumpToToday}>
          Jump to today
        </button>
      </div>

      <div role="tablist" aria-label="Weekday" className="weekday-tabs">
        {presentWeekdays.map((wd, index) => {
          const selected = wd === activeWeekday;
          return (
            <button
              key={wd}
              id={`weekday-tab-${wd}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`weekday-panel-${wd}`}
              tabIndex={selected ? 0 : -1}
              className={`weekday-tab${selected ? ' weekday-tab-active' : ''}`}
              onClick={() => setActiveWeekday(wd)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
            >
              {shortWeekdayLabel(wd)}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`weekday-panel-${activeWeekday}`} aria-labelledby={`weekday-tab-${activeWeekday}`} className="stack">
        {weekdayDoc && <WeekdayInfo weekday={weekdayDoc} />}

        {hiddenPastCount > 0 && (
          <div className="card">
            <button
              type="button"
              className="button button-link"
              aria-expanded={pastOpen}
              onClick={() => setPastOpen((open) => !open)}
            >
              {pastOpen ? 'Hide earlier sessions' : 'Show earlier sessions'}
            </button>
          </div>
        )}

        {timeline.length === 0 && (
          <div className="card">
            <p className="muted">No sessions scheduled for this weekday.</p>
          </div>
        )}
        {timeline.length > 0 && visibleTimeline.length === 0 && (
          <div className="card">
            <p className="muted">No upcoming sessions for this weekday.</p>
          </div>
        )}
        {visibleTimeline.map((item) => (
          <TimelineItemView key={item.type === 'series' ? `${item.year}:${item.series.id}` : item.session.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function WeekdayInfo({ weekday }: { weekday: WeekdayProgramme }) {
  const { nameOf, byId } = useMembersDirectory();
  const stewardId = weekday.partnerStewardMemberId;
  const steward = stewardId ? byId.get(stewardId) : undefined;
  return (
    <div className="card">
      <h2>{weekday.label}</h2>
      <p>
        Starts {formatTimeOfDay(weekday.startTime)} &middot; seated by {formatTimeOfDay(weekday.seatedByTime)}
      </p>
      {stewardId && (
        <p>
          <strong>Partner steward:</strong> {nameOf(stewardId)}
          {steward?.phone && (
            <>
              {' '}
              &middot;{' '}
              <a className="contact-link" href={`tel:${steward.phone}`} aria-label={`Call ${nameOf(stewardId)}, ${steward.phone}`}>
                {steward.phone}
              </a>
            </>
          )}
        </p>
      )}
      {weekday.notes && <p className="muted">{weekday.notes}</p>}
    </div>
  );
}

function TimelineItemView({ item }: { item: WeekdayTimelineItem }) {
  if (item.type === 'series') {
    return <SeriesCard series={item.series} sessions={item.sessions} />;
  }
  return <SingleRow session={item.session} />;
}

function SeriesCard({ series, sessions }: { series: Series; sessions: Tagged<Session>[] }) {
  return (
    <div className="card">
      <h3>{series.name}</h3>
      <p className="badges">
        <span className="badge">{series.scoring}</span>
        <span className="badge">{series.format}</span>
        {series.bestOf && (
          <span className="badge">
            best {series.bestOf.n} of {series.bestOf.m}
          </span>
        )}
        {!series.allowSubstitute && <span className="badge">no substitutes</span>}
      </p>
      {series.eligibilityNote && <p className="muted">{series.eligibilityNote}</p>}
      {series.generalNote && <p className="muted">{series.generalNote}</p>}
      <ul className="session-date-list">
        {sessions.map((session) => (
          <li key={session.id} id={`session-row-${session.id}`}>
            <Link to={`/session/${session.year}/${session.id}`} className={isPastNZ(session.date) ? 'session-past' : undefined}>
              {formatDateNZ(session.date)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SingleRow({ session }: { session: Tagged<Session> }) {
  const isNoBridge = session.kind === 'noBridge';
  return (
    <div className={`card single-row${isNoBridge ? ' single-row-nobridge' : ''}`} id={`session-row-${session.id}`}>
      <Link
        to={`/session/${session.year}/${session.id}`}
        className={isPastNZ(session.date) || isNoBridge ? 'session-past' : undefined}
      >
        {formatDateNZ(session.date)} &mdash; {isNoBridge ? 'No bridge' : session.title}
      </Link>
    </div>
  );
}
