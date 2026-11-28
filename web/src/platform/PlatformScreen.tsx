/**
 * Platform area (`/platform`, plan §21 B14.3, stage 2): every club, with its
 * status, active-member count and admins; create a club; rename, suspend or
 * reactivate one; appoint or remove its admins.
 *
 * Visible only to a platform administrator, and every action is re-checked
 * by the server. A platform admin has no view inside a club from here: to
 * manage a club's members or programme they appoint themselves one of its
 * admins, after which the club appears in their club switcher like any other.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ClubSummary } from '@obc/shared';
import type { AppError } from '../firebase';
import { createClub, listClubs, setClubAdmin, updateClub } from '../api';
import { mapAdminActionError } from '../admin/adminErrors';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dialog } from '../components/Dialog';

type Open =
  | { kind: 'create' }
  | { kind: 'edit'; summary: ClubSummary }
  | { kind: 'status'; summary: ClubSummary }
  | { kind: 'addAdmin'; summary: ClubSummary }
  | { kind: 'removeAdmin'; summary: ClubSummary; admin: ClubSummary['admins'][number] };

const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function PlatformScreen() {
  const [clubs, setClubs] = useState<ClubSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setClubs((await listClubs({})).clubs);
      setLoadError(null);
    } catch (err) {
      setLoadError(mapAdminActionError(err as AppError));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function close() {
    setOpen(null);
    setError(null);
  }

  /** Runs one platform action; on success closes the dialog, reports it and refreshes the list. */
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(null);
      setNotice(message);
      await reload();
    } catch (err) {
      setError(mapAdminActionError(err as AppError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <h1>Platform</h1>
        <p className="muted">
          Every club on this system. To manage a club&apos;s members or programme, make yourself one of its admins
          here; it then appears in your club list.
        </p>
        <button type="button" className="button button-primary" onClick={() => setOpen({ kind: 'create' })}>
          Create a club
        </button>
      </div>

      {notice && (
        <div className="card alert-success" role="status">
          {notice}
        </div>
      )}
      {loadError && (
        <div className="card alert alert-error" role="alert">
          {loadError}
        </div>
      )}
      {clubs === null && !loadError && <p>Loading…</p>}

      {clubs?.map((summary) => {
        const { club, activeMembers, admins } = summary;
        return (
          <section className="card" key={club.id} aria-label={club.name}>
            <h2>
              {club.name} {club.status === 'suspended' && <span className="badge">Suspended</span>}
            </h2>
            <p className="muted">
              Id <code>{club.id}</code> · short name {club.shortName} · {activeMembers} active member
              {activeMembers === 1 ? '' : 's'}
              {club.contactEmail ? ` · contact ${club.contactEmail}` : ''}
            </p>

            <h3>Admins</h3>
            {admins.length === 0 ? (
              <p className="muted">No admins yet.</p>
            ) : (
              <ul>
                {admins.map((admin) => (
                  <li key={admin.memberId}>
                    {admin.name}
                    {admin.email && <span className="muted"> · {admin.email}</span>}{' '}
                    {admin.email && (
                      <button
                        type="button"
                        className="button button-link"
                        onClick={() => setOpen({ kind: 'removeAdmin', summary, admin })}
                      >
                        Remove admin
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="actions-row">
              <button type="button" className="button button-secondary" onClick={() => setOpen({ kind: 'addAdmin', summary })}>
                Add an admin
              </button>
              <button type="button" className="button button-secondary" onClick={() => setOpen({ kind: 'edit', summary })}>
                Rename
              </button>
              <button type="button" className="button button-secondary" onClick={() => setOpen({ kind: 'status', summary })}>
                {club.status === 'active' ? 'Suspend' : 'Reactivate'}
              </button>
            </div>
          </section>
        );
      })}

      {open?.kind === 'create' && <CreateClubDialog busy={busy} error={error} onClose={close} onRun={run} />}
      {open?.kind === 'edit' && <RenameClubDialog summary={open.summary} busy={busy} error={error} onClose={close} onRun={run} />}
      {open?.kind === 'addAdmin' && <AddAdminDialog summary={open.summary} busy={busy} error={error} onClose={close} onRun={run} />}

      {open?.kind === 'status' && (
        <ConfirmDialog
          title={open.summary.club.status === 'active' ? `Suspend ${open.summary.club.name}?` : `Reactivate ${open.summary.club.name}?`}
          body={
            open.summary.club.status === 'active'
              ? 'Its members will no longer be able to use the club, and those who belong to no other club will not be able to sign in. Nothing is deleted; you can reactivate it.'
              : 'Its members will be able to use the club again.'
          }
          confirmLabel={open.summary.club.status === 'active' ? 'Suspend' : 'Reactivate'}
          danger={open.summary.club.status === 'active'}
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() => {
            const { club } = open.summary;
            const status = club.status === 'active' ? 'suspended' : 'active';
            void run(
              () => updateClub({ clubId: club.id, patch: { status } }),
              status === 'suspended' ? `${club.name} is suspended.` : `${club.name} is active again.`,
            );
          }}
        />
      )}

      {open?.kind === 'removeAdmin' && (
        <ConfirmDialog
          title="Remove admin access?"
          body={`${open.admin.name} will stay a member of ${open.summary.club.name} but will no longer be one of its admins.`}
          confirmLabel="Remove admin"
          danger
          busy={busy}
          error={error}
          onClose={close}
          onConfirm={() => {
            const { admin, summary } = open;
            void run(
              () => setClubAdmin({ clubId: summary.club.id, email: admin.email!, admin: false }),
              `${admin.name} is no longer an admin of ${summary.club.name}.`,
            );
          }}
        />
      )}
    </div>
  );
}

interface DialogProps {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onRun: (action: () => Promise<unknown>, message: string) => Promise<void>;
}

function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert-error" role="alert">
      {message}
    </div>
  );
}

function CreateClubDialog({ busy, error, onClose, onRun }: DialogProps) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [clubId, setClubId] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = clubId.trim();
    if (!name.trim() || !shortName.trim()) {
      setLocalError('Give the club a name and a short name.');
      return;
    }
    if (!SLUG.test(id)) {
      setLocalError('The id must be 2–40 lower-case letters, digits or hyphens, starting with a letter or digit.');
      return;
    }
    setLocalError(null);
    void onRun(
      () => createClub({ clubId: id, name: name.trim(), shortName: shortName.trim() }),
      `${name.trim()} has been created. Add an admin to get it started.`,
    );
  }

  return (
    <Dialog title="Create a club" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorAlert message={localError ?? error} />
        <div className="field">
          <label htmlFor="club-name">Name</label>
          <input id="club-name" type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="club-short-name">Short name</label>
          <input
            id="club-short-name"
            type="text"
            maxLength={20}
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
          />
          <p className="muted">Used where space is tight, such as badges.</p>
        </div>
        <div className="field">
          <label htmlFor="club-id">Id</label>
          <input
            id="club-id"
            type="text"
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
            value={clubId}
            onChange={(e) => setClubId(e.target.value.toLowerCase())}
          />
          <p className="muted">
            Lower-case letters, digits and hyphens, for example <code>northshore</code>. It appears in web addresses
            and can never be changed.
          </p>
        </div>
        <div className="actions-row">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create club'}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameClubDialog({ summary, busy, error, onClose, onRun }: DialogProps & { summary: ClubSummary }) {
  const { club } = summary;
  const [name, setName] = useState(club.name);
  const [shortName, setShortName] = useState(club.shortName);
  const [contactEmail, setContactEmail] = useState(club.contactEmail ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const nextName = name.trim();
    const nextShort = shortName.trim();
    const nextContact = contactEmail.trim().toLowerCase();
    if (!nextName || !nextShort) {
      setLocalError('Give the club a name and a short name.');
      return;
    }
    setLocalError(null);
    const patch = {
      ...(nextName !== club.name ? { name: nextName } : {}),
      ...(nextShort !== club.shortName ? { shortName: nextShort } : {}),
      ...(nextContact !== (club.contactEmail ?? '') ? { contactEmail: nextContact || null } : {}),
    };
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    void onRun(() => updateClub({ clubId: club.id, patch }), `${nextName} updated.`);
  }

  return (
    <Dialog title={`Rename ${club.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorAlert message={localError ?? error} />
        <div className="field">
          <label htmlFor="club-rename-name">Name</label>
          <input id="club-rename-name" type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="club-rename-short">Short name</label>
          <input
            id="club-rename-short"
            type="text"
            maxLength={20}
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="club-rename-contact">Contact email (optional)</label>
          <input
            id="club-rename-contact"
            type="email"
            maxLength={320}
            autoComplete="off"
            aria-describedby="club-rename-contact-hint"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <p className="muted" id="club-rename-contact-hint">
            Visitors are told to write here if they want their details removed.
          </p>
        </div>
        <p className="muted">
          The id <code>{club.id}</code> cannot be changed.
        </p>
        <div className="actions-row">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AddAdminDialog({ summary, busy, error, onClose, onRun }: DialogProps & { summary: ClubSummary }) {
  const { club } = summary;
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(address)) {
      setLocalError('Enter a valid email address.');
      return;
    }
    if (Boolean(firstName.trim()) !== Boolean(lastName.trim())) {
      setLocalError('Give both a first and a last name, or leave both empty.');
      return;
    }
    setLocalError(null);
    void onRun(
      () =>
        setClubAdmin({
          clubId: club.id,
          email: address,
          admin: true,
          ...(firstName.trim() ? { firstName: firstName.trim(), lastName: lastName.trim() } : {}),
        }),
      `${address} is now an admin of ${club.name}.`,
    );
  }

  return (
    <Dialog title={`Add an admin to ${club.name}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorAlert message={localError ?? error} />
        <div className="field">
          <label htmlFor="club-admin-email">Their sign-in email</label>
          <input
            id="club-admin-email"
            type="email"
            maxLength={320}
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <p className="muted">
          If they already use this system, that is all that is needed. For someone new, also give their name and an
          account is created for them.
        </p>
        <div className="field">
          <label htmlFor="club-admin-first">First name (new people only)</label>
          <input
            id="club-admin-first"
            type="text"
            maxLength={80}
            autoComplete="off"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="club-admin-last">Last name (new people only)</label>
          <input
            id="club-admin-last"
            type="text"
            maxLength={80}
            autoComplete="off"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="actions-row">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Adding…' : 'Add admin'}
          </button>
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
