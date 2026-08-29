/**
 * "Arrange a substitute" dialog (plan §9.2 `setSubstitute`, §12.7). Step 1:
 * plain-words choice of which side of the pairing the substitute covers
 * (`coverFor: 'self' | 'partner'`). Step 2: pick a club member (excluding
 * self, the partner, and anyone already confirmed on this session) or one of
 * the caller's own visitors, via `PartnerPickerDialog`.
 */
import { useState } from 'react';
import type { Member, Visitor } from '@obc/shared';
import { PartnerPickerDialog, type PartnerRefInput } from './PartnerPickerDialog';
import { Dialog } from './Dialog';
import type { VisitorFormValues } from './VisitorForm';

export interface SubstituteDialogProps {
  partnerName: string;
  members: Member[];
  visitors: Visitor[];
  busy: boolean;
  error?: string | null | undefined;
  onClose: () => void;
  onSubmit: (coverFor: 'self' | 'partner', substitute: PartnerRefInput) => void;
  onCreateVisitor: (values: VisitorFormValues) => Promise<Visitor>;
}

export function SubstituteDialog({
  partnerName,
  members,
  visitors,
  busy,
  error,
  onClose,
  onSubmit,
  onCreateVisitor,
}: SubstituteDialogProps) {
  const [coverFor, setCoverFor] = useState<'self' | 'partner' | null>(null);

  if (coverFor === null) {
    return (
      <Dialog title="Arrange a substitute" onClose={onClose}>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="stack">
          <button type="button" className="button button-secondary" onClick={() => setCoverFor('self')}>
            I can&apos;t come — someone will play with {partnerName} instead
          </button>
          <button type="button" className="button button-secondary" onClick={() => setCoverFor('partner')}>
            {partnerName} can&apos;t come — someone will play with me instead
          </button>
        </div>
        <div className="actions-row">
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <PartnerPickerDialog
      title="Who will stand in?"
      members={members}
      visitors={visitors}
      busy={busy}
      error={error}
      onClose={onClose}
      onSelectMember={(memberId) => onSubmit(coverFor, { kind: 'member', memberId })}
      onSelectVisitor={(visitorId) => onSubmit(coverFor, { kind: 'visitor', visitorId })}
      onCreateVisitor={onCreateVisitor}
    />
  );
}
