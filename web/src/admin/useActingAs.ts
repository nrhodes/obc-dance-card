import { useContext } from 'react';
import { ActingAsContext, type ActingAsContextValue } from './ActingAsContext';

export function useActingAs(): ActingAsContextValue {
  const ctx = useContext(ActingAsContext);
  if (!ctx) {
    throw new Error('useActingAs must be used within an ActingAsProvider');
  }
  return ctx;
}
