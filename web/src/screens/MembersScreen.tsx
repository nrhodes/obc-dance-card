/**
 * "Members" directory (`/members`, docs/implementation-plan.md §2 visibility
 * row, amended 2026-09-05: name/grade/phone/email — a full contact directory
 * for the club, Neil's sign-off). Read-only: no callable, no client write.
 * Data comes from `useMembersDirectory` (already active-members-only,
 * subscribed to the full `members` collection — see
 * `MembersDirectoryProvider`), so this screen only sorts/filters/renders it.
 *
 * Phone and email render as real `tel:`/`mailto:` links with a 48px tap
 * target (plan §1: members skew elderly — tapping a phone number should
 * start a call on mobile, not just display text) and are omitted entirely
 * (not "undefined"/blank cell) when a member has no phone/email on file yet
 * — `email` is optional until `backfill-member-emails.ts` runs against a
 * given member.
 */
import { useMemo, useState } from 'react';
import type { Member } from '@obc/shared';
import { useMembersDirectory } from '../members/useMembersDirectory';
import { SubscriptionError } from '../components/SubscriptionError';

function fullName(m: Member): string {
  return `${m.firstName} ${m.lastName}`.trim();
}

export function MembersScreen() {
  const { members, loading, error } = useMembersDirectory();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members
      .filter((m) => (q ? fullName(m).toLowerCase().includes(q) : true))
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  }, [members, search]);

  return (
    <div className="stack">
      <div className="card">
        <h1>Members</h1>
        <p className="muted">Every active club member&apos;s name, grade, phone, and email.</p>
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="members-directory-search">Search by name</label>
          <input
            id="members-directory-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members"
          />
        </div>
      </div>

      <div className="card">
        {error && <SubscriptionError resource="members" />}
        {loading && <p>Loading…</p>}
        {!loading && filtered.length === 0 && <p className="muted">No members match.</p>}
        {!loading && filtered.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <caption className="sr-only">Club members, sorted by last name</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Email</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">{fullName(m)}</th>
                    <td>
                      <span className="badge">{m.grade}</span>
                    </td>
                    <td>
                      {m.phone && (
                        <a className="contact-link" href={`tel:${m.phone}`} aria-label={`Call ${fullName(m)}, ${m.phone}`}>
                          {m.phone}
                        </a>
                      )}
                    </td>
                    <td>
                      {m.email && (
                        <a
                          className="contact-link"
                          href={`mailto:${m.email}`}
                          aria-label={`Email ${fullName(m)}, ${m.email}`}
                        >
                          {m.email}
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
