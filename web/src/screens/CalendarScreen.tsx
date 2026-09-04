/**
 * Calendar overview (`/calendar`, plan §21 B4, plus the B2 "Set
 * availability…" bulk action). Three modes — List (default), Month, Year —
 * all built from the same two live sources every other screen already
 * subscribes to: `useProgramme()` (published sessions, plan §21 B3) and
 * `useMyEntries()` (the signed-in — or acted-on-behalf-of, plan Phase 6b —
 * member's own entries, shared with `HomeScreen`). The point of the Month
 * and (especially) Year views is to make `open` days — a bookable session
 * the member has no relationship with yet — easy to spot at a glance.
 *
 * Every day cell's status is colour *and* a letter glyph (never colour
 * alone, WCAG 1.4.1); the legend under the Month/Year grids spells out what
 * each glyph/colour means in words.
 */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addDaysNZ, todayNZ, type IsoDate, type Session, type Weekday } from '@obc/shared';
import type { AppError } from '../firebase';
import { useProgramme } from '../programme/useProgramme';
import { useMyEntries } from '../entries/useMyEntries';
import { useEffectiveMember } from '../admin/useEffectiveMember';
import { setBulkSoloStatus } from '../api';
import { mapActionError } from '../lib/actionErrors';
import { formatDateNZ } from '../lib/format';
import {
  buildAgenda,
  buildMonthGrid,
  buildYearOverview,
  type DayStatus,
  type MonthDayCell,
} from '../lib/overview';
import { SubscriptionError } from '../components/SubscriptionError';
import { SetAvailabilityDialog, type BulkAvailabilityStatus } from '../components/SetAvailabilityDialog';

const LIST_PAGE_DAYS = 14;

type CalendarMode = 'list' | 'month' | 'year';
const MODES: Array<{ value: CalendarMode; label: string }> = [
  { value: 'list', label: 'List' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_HEADER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const STATUS_META: Record<DayStatus, { label: string; glyph: string; className: string }> = {
  none: { label: 'No session', glyph: '', className: 'day-status-none' },
  booked: { label: 'Booked', glyph: 'B', className: 'day-status-booked' },
  partly: { label: 'Partly booked', glyph: 'P', className: 'day-status-partly' },
  seeking: { label: 'Seeking a partner', glyph: 'S', className: 'day-status-seeking' },
  unavailable: { label: 'Unavailable', glyph: 'U', className: 'day-status-unavailable' },
  open: { label: 'Open — you could book', glyph: 'O', className: 'day-status-open' },
};

const LEGEND_STATUSES: DayStatus[] = ['booked', 'partly', 'seeking', 'open', 'unavailable'];

function entryYear(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

function sessionYear(session: Session): number {
  return entryYear(session.date);
}

export function CalendarScreen() {
  const navigate = useNavigate();
  const { sessions, years, loading: programmeLoading, error: programmeError } = useProgramme();
  const { entries, loading: entriesLoading, error: entriesError } = useMyEntries();
  const { onBehalfOfMemberId, actingAsName } = useEffectiveMember();

  const today = todayNZ();
  const currentYear = entryYear(today);
  const currentMonth = Number(today.slice(5, 7));

  const [mode, setMode] = useState<CalendarMode>('list');

  // ---- List mode ----
  const [daysShown, setDaysShown] = useState(LIST_PAGE_DAYS);
  const [anchorDate, setAnchorDate] = useState<IsoDate | null>(null);

  // ---- Month mode ----
  const [viewYear, setViewYear] = useState(currentYear);
  const [viewMonth, setViewMonth] = useState(currentMonth);

  // ---- Year mode ----
  const [yearViewYear, setYearViewYear] = useState(currentYear);

  // Once the published years load, make sure Month/Year default to a year
  // that's actually loaded (mirrors `ProgrammeScreen`'s correction of its
  // initial weekday guess once real data arrives).
  useEffect(() => {
    if (years.length === 0) return;
    if (!years.includes(viewYear)) setViewYear(years.includes(currentYear) ? currentYear : years[0]!);
    if (!years.includes(yearViewYear)) setYearViewYear(years.includes(currentYear) ? currentYear : years[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [years]);

  // ---- Bulk "Set availability…" dialog ----
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);

  const loading = programmeLoading || entriesLoading;
  const minYear = years.length > 0 ? Math.min(...years) : currentYear;
  const maxYear = years.length > 0 ? Math.max(...years) : currentYear;
  const horizonEnd: IsoDate = `${maxYear}-12-31`;

  function goToDate(date: IsoDate) {
    setMode('list');
    setAnchorDate(date);
  }

  function handleDayCellClick(cell: MonthDayCell) {
    if (cell.sessions.length === 0) return;
    if (cell.sessions.length === 1) {
      const session = cell.sessions[0]!;
      navigate(`/session/${sessionYear(session)}/${session.id}`);
      return;
    }
    goToDate(cell.date);
  }

  function handleModeKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % MODES.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + MODES.length) % MODES.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = MODES.length - 1;
    if (nextIndex == null) return;
    e.preventDefault();
    const next = MODES[nextIndex]!.value;
    setMode(next);
    document.getElementById(`calendar-mode-tab-${next}`)?.focus();
  }

  function prevMonth() {
    if (viewYear === minYear && viewMonth === 1) return;
    if (viewMonth === 1) {
      setViewYear(viewYear - 1);
      setViewMonth(12);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewYear === maxYear && viewMonth === 12) return;
    if (viewMonth === 12) {
      setViewYear(viewYear + 1);
      setViewMonth(1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  async function handleConfirmBulk(input: { status: BulkAvailabilityStatus; weekdays: Weekday[]; fromDate: IsoDate; toDate: IsoDate }) {
    setBulkBusy(true);
    setBulkError(null);
    try {
      const result = await setBulkSoloStatus({
        status: input.status,
        filter: {
          weekdays: input.weekdays,
          fromDate: input.fromDate,
          toDate: input.toDate,
        },
        ...(onBehalfOfMemberId ? { onBehalfOfMemberId } : {}),
      });
      setDialogOpen(false);
      const statusLabel = input.status === 'clear' ? 'cleared' : input.status;
      const summary = `Marked ${result.updated} session${result.updated === 1 ? '' : 's'} as ${statusLabel}.`;
      const skippedDates = result.skipped.map((s) => formatDateNZ(s.date)).join(', ');
      setBulkNotice(result.skipped.length > 0 ? `${summary} Kept your bookings on: ${skippedDates}.` : summary);
    } catch (err) {
      setBulkError(mapActionError(err as AppError));
    } finally {
      setBulkBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <p>Loading…</p>
      </div>
    );
  }

  const listFrom = anchorDate ?? today;
  const agenda = buildAgenda(listFrom, daysShown, sessions, entries);
  const lastShownDate = addDaysNZ(listFrom, daysShown - 1);
  const canShowMore = lastShownDate < horizonEnd;

  const monthWeeks = buildMonthGrid(viewYear, viewMonth, sessions, entries, today);
  const yearOverview = buildYearOverview(yearViewYear, sessions, entries, today);

  return (
    <div className="stack">
      <div className="card">
        <h1>Calendar</h1>
        {actingAsName && <p className="muted">Showing {actingAsName}&apos;s calendar.</p>}
        <button type="button" className="button button-primary" onClick={() => setDialogOpen(true)}>
          Set availability…
        </button>
      </div>

      {(programmeError || entriesError) && <SubscriptionError resource="the calendar" />}

      {bulkNotice && (
        <div className="card alert-success" role="status">
          {bulkNotice}
        </div>
      )}

      <div role="tablist" aria-label="Calendar view" className="weekday-tabs">
        {MODES.map((m, index) => {
          const selected = mode === m.value;
          return (
            <button
              key={m.value}
              id={`calendar-mode-tab-${m.value}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`calendar-mode-panel-${m.value}`}
              tabIndex={selected ? 0 : -1}
              className={`weekday-tab${selected ? ' weekday-tab-active' : ''}`}
              onClick={() => setMode(m.value)}
              onKeyDown={(e) => handleModeKeyDown(e, index)}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {mode === 'list' && (
        <div role="tabpanel" id="calendar-mode-panel-list" aria-labelledby="calendar-mode-tab-list" className="stack">
          {anchorDate && (
            <p className="muted">
              Showing from {formatDateNZ(anchorDate)}.{' '}
              <button type="button" className="button button-link" onClick={() => setAnchorDate(null)}>
                Back to today
              </button>
            </p>
          )}
          {agenda.length === 0 && <p className="muted">No sessions in the next {daysShown} days.</p>}
          {agenda.map((day) => (
            <div key={day.date} className="card">
              <h3>{formatDateNZ(day.date)}</h3>
              <ul className="roster-list">
                {day.sessions.map(({ session, year, status }) => {
                  const meta = STATUS_META[status];
                  return (
                    <li key={session.id}>
                      <Link to={`/session/${year}/${session.id}`}>{session.title}</Link>
                      {' — '}
                      <span className={`status-pill ${meta.className}`}>
                        <span aria-hidden="true">{meta.glyph}</span> {meta.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {canShowMore && (
            <button type="button" className="button button-secondary" onClick={() => setDaysShown((d) => d + LIST_PAGE_DAYS)}>
              Show more
            </button>
          )}
        </div>
      )}

      {mode === 'month' && (
        <div role="tabpanel" id="calendar-mode-panel-month" aria-labelledby="calendar-mode-tab-month" className="stack">
          <div className="actions-row">
            <button type="button" className="button button-secondary" disabled={viewYear === minYear && viewMonth === 1} onClick={prevMonth}>
              &larr; Prev
            </button>
            <h2 className="month-nav-title">
              {MONTH_NAMES[viewMonth - 1]} {viewYear}
            </h2>
            <button type="button" className="button button-secondary" disabled={viewYear === maxYear && viewMonth === 12} onClick={nextMonth}>
              Next &rarr;
            </button>
          </div>

          <div className="month-grid">
            <div className="month-grid-header">
              {WEEKDAY_HEADER.map((label) => (
                <div key={label}>{label}</div>
              ))}
            </div>
            {monthWeeks.map((week, i) => (
              <div className="month-grid-week" key={i}>
                {week.map((cell, j) => (
                  <DayCell key={cell?.date ?? `blank-${i}-${j}`} cell={cell} today={today} onSelect={handleDayCellClick} />
                ))}
              </div>
            ))}
          </div>

          <Legend />
        </div>
      )}

      {mode === 'year' && (
        <div role="tabpanel" id="calendar-mode-panel-year" aria-labelledby="calendar-mode-tab-year" className="stack">
          <div className="field">
            <label htmlFor="calendar-year-picker">Year</label>
            <select id="calendar-year-picker" value={yearViewYear} onChange={(e) => setYearViewYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="year-grid">
            {yearOverview.map((m) => (
              <div className="card year-month-card" key={m.month}>
                <h3>{MONTH_NAMES[m.month - 1]}</h3>
                <div className="month-grid month-grid-compact">
                  <div className="month-grid-header">
                    {WEEKDAY_HEADER.map((label) => (
                      <div key={label}>{label[0]}</div>
                    ))}
                  </div>
                  {m.weeks.map((week, i) => (
                    <div className="month-grid-week" key={i}>
                      {week.map((cell, j) => (
                        <DayCell key={cell?.date ?? `blank-${i}-${j}`} cell={cell} today={today} onSelect={handleDayCellClick} compact />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <Legend />
        </div>
      )}

      {dialogOpen && (
        <SetAvailabilityDialog
          sessions={sessions}
          entries={entries}
          defaultToDate={horizonEnd}
          busy={bulkBusy}
          error={bulkError}
          onClose={() => setDialogOpen(false)}
          onConfirm={(input) => void handleConfirmBulk(input)}
        />
      )}
    </div>
  );
}

function DayCell({
  cell,
  today,
  onSelect,
  compact,
}: {
  cell: MonthDayCell | null;
  today: IsoDate;
  onSelect: (cell: MonthDayCell) => void;
  compact?: boolean;
}) {
  // Blank cells must carry the same size classes as real ones — a 48px blank
  // next to 22px compact cells makes the year grid's rows ragged.
  if (!cell) return <div className={`month-cell month-cell-blank${compact ? ' month-cell-compact' : ''}`} aria-hidden="true" />;
  const meta = STATUS_META[cell.status];
  const isToday = cell.date === today;
  const clickable = cell.sessions.length > 0;
  return (
    <button
      type="button"
      className={`month-cell ${meta.className}${isToday ? ' month-cell-today' : ''}${compact ? ' month-cell-compact' : ''}`}
      disabled={!clickable}
      aria-label={`${formatDateNZ(cell.date)}${isToday ? ' (today)' : ''} — ${meta.label}`}
      onClick={() => onSelect(cell)}
    >
      <span className="month-cell-day">{cell.dayOfMonth}</span>
      {/* Always rendered (nbsp when statusless) so every cell is two lines
          tall — otherwise glyph-less cells are shorter and rows misalign. */}
      <span className="month-cell-glyph" aria-hidden="true">
        {meta.glyph || '\u00A0'}
      </span>
    </button>
  );
}

function Legend() {
  return (
    <div className="calendar-legend">
      <h3 className="calendar-legend-heading">Legend</h3>
      <div className="calendar-legend-list">
        {LEGEND_STATUSES.map((status) => {
          const meta = STATUS_META[status];
          return (
            <span className="calendar-legend-item" key={status}>
              <span className={`calendar-legend-swatch ${meta.className}`} aria-hidden="true">
                {meta.glyph}
              </span>
              {meta.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
