/**
 * Programme browser (`/programme`, plan Phase 2b task, §5.4, §14.1). Members
 * only ever see the *published* programme — `useProgramme` subscribes to the
 * latest `programmes/{year}` with `status: 'published'` and its
 * weekdays/series/sessions subcollections; drafts are invisible to members
 * at the rules layer, so there is nothing to filter here.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { WEEKDAYS, isPastNZ, todayNZ, type Series, type Session, type Weekday, type WeekdayProgramme } from '@obc/shared';
import { useProgramme } from '../programme/useProgramme';
import { useMembersDirectory } from '../members/useMembersDirectory';
import { formatDateNZ, formatTimeOfDay, shortWeekdayLabel } from '../lib/format';
import { buildWeekdayTimeline, defaultProgrammeWeekday, weekdaysWithData, type WeekdayTimelineItem } from '../lib/programmeView';

export function ProgrammeScreen() {
  const { year, weekdays, series, sessions, loading } = useProgramme();
  const [activeWeekday, setActiveWeekday] = useState<Weekday>(defaultProgrammeWeekday());

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

  if (year == null) {
    return (
      <div className="card">
        <h1>Programme</h1>
        <p>The programme hasn&apos;t been published yet.</p>
      </div>
    );
  }

  const weekdayDoc = weekdays.find((w) => w.weekday === activeWeekday);
  const timeline = buildWeekdayTimeline(activeWeekday, series, sessions);

  return (
    <div className="stack">
      <div className="card">
        <h1>{year} Programme</h1>
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
        {timeline.length === 0 && (
          <div className="card">
            <p className="muted">No sessions scheduled for this weekday.</p>
          </div>
        )}
        {timeline.map((item) => (
          <TimelineItemView key={item.type === 'series' ? item.series.id : item.session.id} item={item} year={year} />
        ))}
      </div>
    </div>
  );
}

function WeekdayInfo({ weekday }: { weekday: WeekdayProgramme }) {
  const { nameOf } = useMembersDirectory();
  return (
    <div className="card">
      <h2>{weekday.label}</h2>
      <p>
        Starts {formatTimeOfDay(weekday.startTime)} &middot; seated by {formatTimeOfDay(weekday.seatedByTime)}
      </p>
      {weekday.partnerStewardMemberId && (
        <p>
          <strong>Partner steward:</strong> {nameOf(weekday.partnerStewardMemberId)}
        </p>
      )}
      {weekday.notes && <p className="muted">{weekday.notes}</p>}
    </div>
  );
}

function TimelineItemView({ item, year }: { item: WeekdayTimelineItem; year: number }) {
  if (item.type === 'series') {
    return <SeriesCard series={item.series} sessions={item.sessions} year={year} />;
  }
  return <SingleRow session={item.session} year={year} />;
}

function SeriesCard({ series, sessions, year }: { series: Series; sessions: Session[]; year: number }) {
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
            <Link to={`/session/${year}/${session.id}`} className={isPastNZ(session.date) ? 'session-past' : undefined}>
              {formatDateNZ(session.date)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SingleRow({ session, year }: { session: Session; year: number }) {
  const isNoBridge = session.kind === 'noBridge';
  return (
    <div className={`card single-row${isNoBridge ? ' single-row-nobridge' : ''}`} id={`session-row-${session.id}`}>
      <Link
        to={`/session/${year}/${session.id}`}
        className={isPastNZ(session.date) || isNoBridge ? 'session-past' : undefined}
      >
        {formatDateNZ(session.date)} &mdash; {isNoBridge ? 'No bridge' : session.title}
      </Link>
    </div>
  );
}
