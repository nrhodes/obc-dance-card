import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Programme, type Series, type Session, type WeekdayProgramme } from '@obc/shared';
import { db } from '../firebase';
import { ProgrammeContext, type ProgrammeContextValue, type ProgrammeYearData } from './ProgrammeContext';

/**
 * How many of the newest published years to load at once (plan §21 B3:
 * "current + next + one back for past viewing; club scale makes the extra
 * listeners trivial").
 */
const MAX_YEARS = 3;

interface YearSubState {
  weekdays: WeekdayProgramme[];
  series: Series[];
  sessions: Session[];
  loaded: boolean;
  error: { code: string } | null;
}

const EMPTY_YEAR_STATE: YearSubState = { weekdays: [], series: [], sessions: [], loaded: false, error: null };

type YearUpdate = Partial<Omit<YearSubState, 'loaded'>> & { loaded?: true };

/**
 * Mounts one instance per loaded published year — not visible, renders
 * nothing — and owns that year's three subcollection subscriptions. Mounting
 * per-year like this (rather than one big effect keyed on the whole year
 * list) means React's own mount/unmount lifecycle handles years appearing
 * and disappearing across a `programmes` snapshot update: a year dropped
 * from the list simply stops being rendered, and its cleanup unsubscribes
 * all three listeners.
 */
function YearSubscriber({ year, onUpdate }: { year: number; onUpdate: (year: number, patch: YearUpdate) => void }) {
  useEffect(() => {
    let weekdaysDone = false;
    let seriesDone = false;
    let sessionsDone = false;
    const maybeDone = () => {
      if (weekdaysDone && seriesDone && sessionsDone) onUpdate(year, { loaded: true });
    };
    const onSubError = (name: string) => (err: { code: string }) => {
      console.error('subscription_failed', name, err.code, 'year', year);
      onUpdate(year, { error: { code: err.code }, loaded: true });
    };

    const unsubWeekdays = onSnapshot(
      collection(db, paths.weekdays(year)),
      (snap) => {
        onUpdate(year, { weekdays: snap.docs.map((d) => d.data() as WeekdayProgramme) });
        weekdaysDone = true;
        maybeDone();
      },
      onSubError('weekdays'),
    );
    const unsubSeries = onSnapshot(
      collection(db, paths.series(year)),
      (snap) => {
        onUpdate(year, { series: snap.docs.map((d) => d.data() as Series) });
        seriesDone = true;
        maybeDone();
      },
      onSubError('series'),
    );
    const unsubSessions = onSnapshot(
      collection(db, paths.sessions(year)),
      (snap) => {
        onUpdate(year, { sessions: snap.docs.map((d) => d.data() as Session) });
        sessionsDone = true;
        maybeDone();
      },
      onSubError('sessions'),
    );

    return () => {
      unsubWeekdays();
      unsubSeries();
      unsubSessions();
    };
  }, [year, onUpdate]);

  return null;
}

export function ProgrammeProvider({ children }: { children: ReactNode }) {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [programmeLoaded, setProgrammeLoaded] = useState(false);
  const [programmeError, setProgrammeError] = useState<{ code: string } | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, paths.programmes()),
      where('status', '==', 'published'),
      orderBy('year', 'desc'),
      limit(MAX_YEARS),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProgrammes(snap.docs.map((d) => d.data() as Programme));
        setProgrammeError(null);
        setProgrammeLoaded(true);
      },
      (err) => {
        console.error('subscription_failed', 'programmes', err.code);
        setProgrammes([]);
        setProgrammeError({ code: err.code });
        setProgrammeLoaded(true);
      },
    );
    return unsub;
  }, []);

  // `programmes` is already ordered newest-year-first (the query's `orderBy`)
  // — every merged array below inherits that order, which is what lets
  // screens use a plain `.find()` over the merged `weekdays`/`series` to get
  // "prefer the newest year, fall back to an older one" for free.
  const years = useMemo(() => programmes.map((p) => p.year), [programmes]);
  const yearsKey = years.join(',');

  const [yearState, setYearState] = useState<Map<number, YearSubState>>(new Map());

  // Keep `yearState` in sync with the currently-published year list: add an
  // entry (starting unloaded) for a newly published year, drop entries for a
  // year that fell out of the newest-`MAX_YEARS` window. `YearSubscriber`
  // mounting/unmounting (driven by `years` below) handles the corresponding
  // subscribe/unsubscribe; this just keeps the read-side state map tidy.
  useEffect(() => {
    setYearState((prev) => {
      const next = new Map<number, YearSubState>();
      for (const y of years) {
        next.set(y, prev.get(y) ?? EMPTY_YEAR_STATE);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearsKey]);

  // Stable identity (functional update, no closed-over `year`) so
  // `YearSubscriber`'s effect never re-runs just because a sibling year's
  // update produced a new callback.
  const handleYearUpdate = useCallback((year: number, patch: YearUpdate) => {
    setYearState((prev) => {
      const existing = prev.get(year);
      if (!existing) return prev; // this year was dropped from the list; ignore a late update.
      const next = new Map(prev);
      next.set(year, { ...existing, ...patch });
      return next;
    });
  }, []);

  const value = useMemo<ProgrammeContextValue>(() => {
    const allYearsLoaded = years.every((y) => yearState.get(y)?.loaded);
    const subsError = years.map((y) => yearState.get(y)?.error).find((e): e is { code: string } => e != null) ?? null;

    const byYear: ProgrammeYearData[] = years.map((y) => {
      const programme = programmes.find((p) => p.year === y)!;
      const st = yearState.get(y) ?? EMPTY_YEAR_STATE;
      return { year: y, programme, weekdays: st.weekdays, series: st.series, sessions: st.sessions };
    });

    return {
      loading: !programmeLoaded || !allYearsLoaded,
      error: programmeError ?? subsError,
      years,
      byYear,
      weekdays: byYear.flatMap((yd) => yd.weekdays.map((w) => ({ ...w, year: yd.year }))),
      series: byYear.flatMap((yd) => yd.series.map((s) => ({ ...s, year: yd.year }))),
      sessions: byYear.flatMap((yd) => yd.sessions.map((s) => ({ ...s, year: yd.year }))),
      year: years[0] ?? null,
      programme: programmes[0] ?? null,
    };
  }, [years, programmes, yearState, programmeLoaded, programmeError]);

  return (
    <ProgrammeContext.Provider value={value}>
      {years.map((y) => (
        <YearSubscriber key={y} year={y} onUpdate={handleYearUpdate} />
      ))}
      {children}
    </ProgrammeContext.Provider>
  );
}
