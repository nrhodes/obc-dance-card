import { useContext } from 'react';
import { VisitorsContext, type VisitorsContextValue } from './VisitorsContext';

export function useVisitors(): VisitorsContextValue {
  const ctx = useContext(VisitorsContext);
  if (!ctx) {
    throw new Error('useVisitors must be used within a VisitorsProvider');
  }
  return ctx;
}
