import { useContext } from 'react';
import { InvitesContext, type InvitesContextValue } from './InvitesContext';

export function useInvites(): InvitesContextValue {
  const ctx = useContext(InvitesContext);
  if (!ctx) {
    throw new Error('useInvites must be used within an InvitesProvider');
  }
  return ctx;
}
