import { useContext } from 'react';
import { TeamsContext, type TeamsContextValue } from './TeamsContext';

export function useTeams(): TeamsContextValue {
  const ctx = useContext(TeamsContext);
  if (!ctx) {
    throw new Error('useTeams must be used within a TeamsProvider');
  }
  return ctx;
}
