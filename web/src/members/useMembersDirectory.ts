import { useContext } from 'react';
import { MembersDirectoryContext, type MembersDirectoryContextValue } from './MembersDirectoryContext';

export function useMembersDirectory(): MembersDirectoryContextValue {
  const ctx = useContext(MembersDirectoryContext);
  if (!ctx) {
    throw new Error('useMembersDirectory must be used within a MembersDirectoryProvider');
  }
  return ctx;
}
