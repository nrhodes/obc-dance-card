/**
 * Admin: Members (`/admin/members`, plan §14.1, Phase 6b task deliverable 2).
 * Tabs: **Members** (the searchable table + row actions) and **Import CSV**
 * (the pre-existing `MembersImportScreen`, unchanged, just relocated under a
 * tab here instead of being the whole route).
 */
import { useState } from 'react';
import { MembersImportScreen } from './MembersImportScreen';
import { MembersTable } from './MembersTable';

type Tab = 'members' | 'import';

export function MembersScreen() {
  const [tab, setTab] = useState<Tab>('members');

  return (
    <div className="stack">
      <div className="card">
        <h1>Members</h1>
        <div className="app-nav" role="tablist" aria-label="Members admin">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'members'}
            className={`button ${tab === 'members' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setTab('members')}
          >
            Members
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'import'}
            className={`button ${tab === 'import' ? 'button-primary' : 'button-secondary'}`}
            onClick={() => setTab('import')}
          >
            Import CSV
          </button>
        </div>
      </div>

      {tab === 'members' && <MembersTable />}
      {tab === 'import' && <MembersImportScreen />}
    </div>
  );
}
