import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { paths, type Programme, type Series, type Session, type WeekdayProgramme } from '@obc/shared';
import { db } from '../firebase';
import { ProgrammeContext, type ProgrammeContextValue } from './ProgrammeContext';

export function ProgrammeProvider({ children }: { children: ReactNode }) {
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [programmeLoaded, setProgrammeLoaded] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, paths.programmes()),
      where('status', '==', 'published'),
      orderBy('year', 'desc'),
      limit(1),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setProgramme(snap.empty ? null : (snap.docs[0]!.data() as Programme));
        setProgrammeLoaded(true);
      },
      () => {
        setProgramme(null);
        setProgrammeLoaded(true);
      },
    );
    return unsub;
  }, []);

  const year = programme?.year ?? null;

  const [weekdays, setWeekdays] = useState<WeekdayProgramme[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [subsLoaded, setSubsLoaded] = useState(false);

  useEffect(() => {
    if (year == null) {
      setWeekdays([]);
      setSeries([]);
      setSessions([]);
      setSubsLoaded(true);
      return;
    }
    setSubsLoaded(false);
    let weekdaysDone = false;
    let seriesDone = false;
    let sessionsDone = false;
    const maybeDone = () => {
      if (weekdaysDone && seriesDone && sessionsDone) setSubsLoaded(true);
    };

    const unsubWeekdays = onSnapshot(collection(db, paths.weekdays(year)), (snap) => {
      setWeekdays(snap.docs.map((d) => d.data() as WeekdayProgramme));
      weekdaysDone = true;
      maybeDone();
    });
    const unsubSeries = onSnapshot(collection(db, paths.series(year)), (snap) => {
      setSeries(snap.docs.map((d) => d.data() as Series));
      seriesDone = true;
      maybeDone();
    });
    const unsubSessions = onSnapshot(collection(db, paths.sessions(year)), (snap) => {
      setSessions(snap.docs.map((d) => d.data() as Session));
      sessionsDone = true;
      maybeDone();
    });

    return () => {
      unsubWeekdays();
      unsubSeries();
      unsubSessions();
    };
  }, [year]);

  const value = useMemo<ProgrammeContextValue>(
    () => ({
      year,
      programme,
      weekdays,
      series,
      sessions,
      loading: !programmeLoaded || !subsLoaded,
    }),
    [year, programme, weekdays, series, sessions, programmeLoaded, subsLoaded],
  );

  return <ProgrammeContext.Provider value={value}>{children}</ProgrammeContext.Provider>;
}
