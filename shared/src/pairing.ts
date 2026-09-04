/**
 * Pure validators for the pairing/team invariants (plan §7). No I/O. Every
 * pairing/team mutation re-runs these inside its transaction before commit;
 * the nightly sweep (`verifyPairingConsistency`) runs them over everything.
 */

import { SOLO_ENTRY_STATUSES } from './enums.js';
import type { Entry, PartnerRef, Series, Team } from './models.js';
import type { Id } from './primitives.js';

function samePartner(a: PartnerRef, b: PartnerRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'member' && b.kind === 'member') return a.memberId === b.memberId;
  if (a.kind === 'visitor' && b.kind === 'visitor') return a.visitorId === b.visitorId;
  return false;
}

/**
 * Validates a set of `Entry` documents that together make up one or more
 * pairing groups (I1–I6). Entries are bucketed by `pairingId`; entries with a
 * null `pairingId` are checked individually. Returns every violation found
 * (empty array = valid).
 */
export function validatePairingGroup(entries: Entry[]): string[] {
  const issues: string[] = [];

  // I1: at most one entry per (session, member). The group may legitimately
  // span many sessions (the nightly sweep passes everything), so key on both.
  const seenMembers = new Set<string>();
  for (const e of entries) {
    const key = `${e.sessionId}:${e.memberId}`;
    if (seenMembers.has(key)) {
      issues.push(`duplicate entry for member ${e.memberId} in session ${e.sessionId} (${e.id})`);
    }
    seenMembers.add(key);
  }

  // I5/I6, checked per-entry regardless of grouping.
  for (const e of entries) {
    if ((SOLO_ENTRY_STATUSES as readonly string[]).includes(e.status)) {
      if (e.partner !== null) {
        issues.push(`${e.id}: solo status '${e.status}' must not have a partner`);
      }
      if (e.pairingId !== null) {
        issues.push(`${e.id}: solo status '${e.status}' must not have a pairingId`);
      }
      if (e.substitute !== null || e.partnerSubstitute !== null || e.isSubstituteFor !== null) {
        issues.push(`${e.id}: solo status '${e.status}' must not have substitution fields set`);
      }
    }
    if (e.status === 'cancelled') {
      // History is kept as-is; no shape constraints beyond I1/I6 above.
      continue;
    }
  }

  // Bucket the rest by pairingId; entries with pairingId == null but a
  // non-solo status must be team entries (checked by validateTeamGroup) or
  // otherwise flagged here as orphaned.
  const byPairing = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.pairingId) {
      const bucket = byPairing.get(e.pairingId) ?? [];
      bucket.push(e);
      byPairing.set(e.pairingId, bucket);
    } else if (e.status === 'confirmed' || e.status === 'substituted') {
      if (!e.teamId) {
        issues.push(`${e.id}: '${e.status}' entry has no pairingId and no teamId`);
      } else if (e.partner !== null) {
        issues.push(`${e.id}: team entry must not have a partner`);
      } else if (e.substitute !== null || e.partnerSubstitute !== null || e.isSubstituteFor !== null) {
        issues.push(`${e.id}: team entry must not have substitution fields set`);
      }
    }
  }

  for (const [pairingId, group] of byPairing) {
    const nonCancelled = group.filter((e) => e.status !== 'cancelled');
    if (nonCancelled.length === 0) continue;

    // A pairing is for exactly one session (I2: "S_B exists" — same S).
    const sessionIds = new Set(nonCancelled.map((e) => e.sessionId));
    if (sessionIds.size > 1) {
      issues.push(`pairing ${pairingId}: entries span more than one session`);
      continue;
    }

    // App-Store-review cohort partition (decided 2026-09-05): every entry in
    // one pairing group must belong to the same cohort — a club member and a
    // review member must never be paired together.
    const cohorts = new Set(nonCancelled.map((e) => e.cohort));
    if (cohorts.size > 1) {
      issues.push(`pairing ${pairingId}: entries span more than one cohort`);
      continue;
    }

    const visitorSides = nonCancelled.filter((e) => e.partner?.kind === 'visitor');
    if (visitorSides.length > 0) {
      // I3: a visitor pairing is one-sided — no other entry shares its pairingId —
      // and the member's entry is plainly confirmed. Substitution is not modelled
      // for visitor partners: if the visitor cannot come, the member cancels and
      // re-pairs (plan §12.8).
      if (nonCancelled.length > 1) {
        issues.push(`pairing ${pairingId}: visitor pairing must be one-sided`);
      }
      const v = visitorSides[0]!;
      if (v.status !== 'confirmed') {
        issues.push(`pairing ${pairingId}: visitor pairing entry must be 'confirmed'`);
      }
      if (v.substitute !== null || v.partnerSubstitute !== null || v.isSubstituteFor !== null) {
        issues.push(`pairing ${pairingId}: visitor pairing must not carry substitution fields`);
      }
      continue;
    }

    const subs = nonCancelled.filter((e) => e.isSubstituteFor);
    const mains = nonCancelled.filter((e) => !e.isSubstituteFor);

    if (mains.length === 0) {
      issues.push(`pairing ${pairingId}: no primary (non-substitute) entries`);
      continue;
    }
    if (mains.length === 1) {
      issues.push(`pairing ${pairingId}: member pairing is missing its mirror entry`);
      continue;
    }
    if (mains.length > 2) {
      issues.push(`pairing ${pairingId}: more than two primary entries share this pairingId`);
      continue;
    }

    const [a, b] = mains as [Entry, Entry];

    // I2 mirror shape.
    if (a.partner?.kind !== 'member' || b.partner?.kind !== 'member') {
      issues.push(`pairing ${pairingId}: both sides must reference a member partner`);
    } else if (a.partner.memberId !== b.memberId || b.partner.memberId !== a.memberId) {
      issues.push(`pairing ${pairingId}: partner references are not mirrored`);
    }

    const aSubbed = a.status === 'substituted';
    const bSubbed = b.status === 'substituted';

    if (a.status === 'confirmed' && b.status === 'confirmed') {
      if (subs.length > 0) {
        issues.push(`pairing ${pairingId}: substitute entry present but neither side is substituted`);
      }
      if (a.substitute !== null || b.substitute !== null || a.partnerSubstitute !== null || b.partnerSubstitute !== null) {
        issues.push(`pairing ${pairingId}: orphan substitution fields on a fully-confirmed pairing`);
      }
    } else if (aSubbed !== bSubbed) {
      // I4: exactly one side substituted this week.
      const covered = aSubbed ? a : b;
      const remaining = aSubbed ? b : a;
      if (!covered.substitute) {
        issues.push(`pairing ${pairingId}: substituted entry ${covered.id} is missing 'substitute'`);
      }
      if (!remaining.partnerSubstitute) {
        issues.push(`pairing ${pairingId}: remaining entry ${remaining.id} is missing 'partnerSubstitute'`);
      }
      if (covered.substitute && remaining.partnerSubstitute) {
        if (!samePartner(covered.substitute, remaining.partnerSubstitute)) {
          issues.push(`pairing ${pairingId}: substitute and partnerSubstitute do not match`);
        }
        if (covered.substitute.kind === 'member') {
          const subEntry = subs.find((s) => s.memberId === (covered.substitute as Extract<PartnerRef, { kind: 'member' }>).memberId);
          if (!subEntry) {
            issues.push(`pairing ${pairingId}: member substitute has no own entry`);
          } else {
            if (subEntry.status !== 'confirmed') {
              issues.push(`pairing ${pairingId}: substitute's own entry must be 'confirmed'`);
            }
            if (subEntry.partner?.kind !== 'member' || subEntry.partner.memberId !== remaining.memberId) {
              issues.push(`pairing ${pairingId}: substitute's own entry does not point back at the remaining partner`);
            }
            if (subEntry.isSubstituteFor !== covered.memberId) {
              issues.push(`pairing ${pairingId}: substitute's own entry has the wrong isSubstituteFor`);
            }
            if (subEntry.pairingId !== pairingId) {
              issues.push(`pairing ${pairingId}: substitute's own entry has a different pairingId`);
            }
          }
        }
      }
      if (covered.isSubstituteFor !== null || remaining.isSubstituteFor !== null) {
        issues.push(`pairing ${pairingId}: 'isSubstituteFor' must only be set on the substitute's own entry`);
      }
    } else {
      issues.push(`pairing ${pairingId}: unexpected status combination '${a.status}'/'${b.status}'`);
    }
  }

  return issues;
}

/**
 * Validates one team against I9: roster/entry consistency for every session
 * in the team's series, `teamMax`, and captain membership. `entries` must be
 * every entry with `teamId === team.id` (any session, any status).
 */
export function validateTeamGroup(team: Team, series: Series, entries: Entry[]): string[] {
  const issues: string[] = [];

  const memberRefIds = team.members
    .filter((m): m is { ref: Extract<PartnerRef, { kind: 'member' }>; joinedAt: string } => m.ref.kind === 'member')
    .map((m) => m.ref.memberId);

  const refKeys = team.members.map((m) =>
    m.ref.kind === 'member' ? `member:${m.ref.memberId}` : `visitor:${m.ref.visitorId}`,
  );
  if (new Set(refKeys).size !== refKeys.length) {
    issues.push(`team ${team.id}: team.members contains a duplicate reference`);
  }

  if (!memberRefIds.includes(team.captainMemberId)) {
    issues.push(`team ${team.id}: captain ${team.captainMemberId} is not in team.members`);
  }

  if (team.members.length > series.teamMax) {
    issues.push(`team ${team.id}: ${team.members.length} members exceeds teamMax ${series.teamMax}`);
  }

  if (team.status === 'disbanded') {
    return issues; // I9 only applies to forming/active teams.
  }

  const entriesBySession = new Map<Id, Entry[]>();
  for (const e of entries) {
    if (e.teamId !== team.id) continue;
    // App-Store-review cohort partition (decided 2026-09-05): every entry on
    // this team's roster — including a session-only substitute — must share
    // the team's own cohort.
    if (e.status !== 'cancelled' && e.cohort !== team.cohort) {
      issues.push(`team ${team.id}: entry ${e.id} has cohort '${e.cohort}', team is '${team.cohort}'`);
    }
    const bucket = entriesBySession.get(e.sessionId) ?? [];
    bucket.push(e);
    entriesBySession.set(e.sessionId, bucket);
  }

  for (const sessionId of series.sessionIds) {
    const sessionEntries = entriesBySession.get(sessionId) ?? [];
    const roster = sessionEntries.filter((e) => !e.teamSessionOnly);
    const rosterActive = roster.filter((e) => e.status !== 'cancelled');
    const rosterActiveMemberIds = new Set(rosterActive.map((e) => e.memberId));

    for (const memberId of memberRefIds) {
      if (!rosterActiveMemberIds.has(memberId)) {
        const hasAnyEntry = roster.some((e) => e.memberId === memberId);
        if (!hasAnyEntry) {
          issues.push(`team ${team.id}, session ${sessionId}: missing entry for member ${memberId}`);
        }
        // If the member has a cancelled entry for this session, that's fine —
        // I9 only requires *non-cancelled* entries to match the roster.
      }
    }
    for (const e of rosterActive) {
      if (!memberRefIds.includes(e.memberId)) {
        issues.push(`team ${team.id}, session ${sessionId}: entry for ${e.memberId} is not on the team roster`);
      }
      if (e.status !== 'confirmed') {
        issues.push(`team ${team.id}, session ${sessionId}: team entry ${e.id} must be 'confirmed', not '${e.status}'`);
      }
      if (e.partner !== null) {
        issues.push(`team ${team.id}, session ${sessionId}: team entry ${e.id} must not have a partner`);
      }
      if (e.pairingId !== null) {
        issues.push(`team ${team.id}, session ${sessionId}: team entry ${e.id} must not have a pairingId`);
      }
      if (e.substitute !== null || e.partnerSubstitute !== null || e.isSubstituteFor !== null) {
        issues.push(`team ${team.id}, session ${sessionId}: team entry ${e.id} must not have substitution fields`);
      }
    }

    const sessionOnly = sessionEntries.filter((e) => e.teamSessionOnly && e.status !== 'cancelled');
    if (sessionOnly.length > 0) {
      const someRosterMemberCancelled = roster.some((e) => e.status === 'cancelled');
      if (!someRosterMemberCancelled) {
        issues.push(
          `team ${team.id}, session ${sessionId}: teamSessionOnly entry exists without a cancelled roster member`,
        );
      }
      for (const e of sessionOnly) {
        if (memberRefIds.includes(e.memberId)) {
          issues.push(`team ${team.id}, session ${sessionId}: teamSessionOnly entry ${e.id} belongs to a rostered member`);
        }
        if (e.status !== 'confirmed' || e.partner !== null || e.pairingId !== null) {
          issues.push(`team ${team.id}, session ${sessionId}: teamSessionOnly entry ${e.id} has the wrong shape`);
        }
      }
    }
  }

  return issues;
}
