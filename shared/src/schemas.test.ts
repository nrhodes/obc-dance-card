import { describe, expect, it } from 'vitest';
import {
  BroadcastInputSchema,
  CreateVisitorInputSchema,
  ImportProgrammeInputSchema,
  MarkNotificationsReadInputSchema,
  RemoveFromTeamInputSchema,
  RequestLoginCodeInputSchema,
  SendInviteInputSchema,
  SeriesCsvRowSchema,
  SetSoloStatusInputSchema,
  SetSubstituteInputSchema,
  VerifyLoginCodeInputSchema,
} from './schemas.js';

describe('RequestLoginCodeInputSchema', () => {
  it('accepts and normalises a valid email', () => {
    const parsed = RequestLoginCodeInputSchema.parse({ email: '  Jane.DOE@Example.COM ' });
    expect(parsed.email).toBe('jane.doe@example.com');
  });
  it('rejects a non-email string', () => {
    expect(() => RequestLoginCodeInputSchema.parse({ email: 'not-an-email' })).toThrow();
  });
});

describe('VerifyLoginCodeInputSchema', () => {
  it('accepts a 6-digit code', () => {
    expect(() => VerifyLoginCodeInputSchema.parse({ email: 'a@b.com', code: '012345' })).not.toThrow();
  });
  it('rejects a code of the wrong shape', () => {
    expect(() => VerifyLoginCodeInputSchema.parse({ email: 'a@b.com', code: '12345' })).toThrow();
    expect(() => VerifyLoginCodeInputSchema.parse({ email: 'a@b.com', code: 'abcdef' })).toThrow();
  });
});

describe('SendInviteInputSchema', () => {
  it('accepts a session-scoped invite', () => {
    expect(() =>
      SendInviteInputSchema.parse({ scope: 'session', sessionId: 's1', toMemberId: 'bob' }),
    ).not.toThrow();
  });
  it('accepts a series-scoped invite', () => {
    expect(() =>
      SendInviteInputSchema.parse({ scope: 'series', seriesId: 'ser1', toMemberId: 'bob' }),
    ).not.toThrow();
  });
  it('rejects a session scope with no sessionId', () => {
    expect(() => SendInviteInputSchema.parse({ scope: 'session', toMemberId: 'bob' })).toThrow();
  });
  it('rejects a message over 200 chars', () => {
    expect(() =>
      SendInviteInputSchema.parse({
        scope: 'session',
        sessionId: 's1',
        toMemberId: 'bob',
        message: 'x'.repeat(201),
      }),
    ).toThrow();
  });
  it('rejects a team scope (not accepted by sendInvite)', () => {
    expect(() =>
      SendInviteInputSchema.parse({ scope: 'team', sessionId: 's1', toMemberId: 'bob' }),
    ).toThrow();
  });
});

describe('SetSoloStatusInputSchema', () => {
  it('accepts looking_for_partner and available', () => {
    expect(() => SetSoloStatusInputSchema.parse({ sessionId: 's1', status: 'looking_for_partner' })).not.toThrow();
    expect(() => SetSoloStatusInputSchema.parse({ sessionId: 's1', status: 'available' })).not.toThrow();
  });
  it('rejects other statuses', () => {
    expect(() => SetSoloStatusInputSchema.parse({ sessionId: 's1', status: 'confirmed' })).toThrow();
  });
});

describe('SetSubstituteInputSchema', () => {
  it('accepts a member substitute', () => {
    expect(() =>
      SetSubstituteInputSchema.parse({ entryId: 'e1', substitute: { kind: 'member', memberId: 'x' } }),
    ).not.toThrow();
  });
  it('accepts a visitor substitute', () => {
    expect(() =>
      SetSubstituteInputSchema.parse({ entryId: 'e1', substitute: { kind: 'visitor', visitorId: 'v1' } }),
    ).not.toThrow();
  });
  it('rejects a substitute missing its id field', () => {
    expect(() =>
      SetSubstituteInputSchema.parse({ entryId: 'e1', substitute: { kind: 'member' } }),
    ).toThrow();
  });
});

describe('RemoveFromTeamInputSchema', () => {
  it('accepts a member ref', () => {
    expect(() =>
      RemoveFromTeamInputSchema.parse({ teamId: 't1', ref: { kind: 'member', memberId: 'x' } }),
    ).not.toThrow();
  });
  it('rejects an unknown kind', () => {
    expect(() =>
      RemoveFromTeamInputSchema.parse({ teamId: 't1', ref: { kind: 'robot', memberId: 'x' } }),
    ).toThrow();
  });
});

describe('CreateVisitorInputSchema', () => {
  it('accepts a name-only visitor', () => {
    expect(() => CreateVisitorInputSchema.parse({ displayName: 'Jane Visitor' })).not.toThrow();
  });
  it('rejects an empty displayName', () => {
    expect(() => CreateVisitorInputSchema.parse({ displayName: '' })).toThrow();
  });
  it('rejects an invalid email', () => {
    expect(() => CreateVisitorInputSchema.parse({ displayName: 'Jane', email: 'nope' })).toThrow();
  });
});

describe('BroadcastInputSchema', () => {
  it('accepts a title/body with no weekdays filter', () => {
    expect(() => BroadcastInputSchema.parse({ title: 'Hi', body: 'Hello all' })).not.toThrow();
  });
  it('rejects an unknown weekday', () => {
    expect(() =>
      BroadcastInputSchema.parse({ title: 'Hi', body: 'Hello', weekdays: ['someday'] }),
    ).toThrow();
  });
});

describe('MarkNotificationsReadInputSchema', () => {
  it('accepts a non-empty id list', () => {
    expect(() => MarkNotificationsReadInputSchema.parse({ ids: ['n1', 'n2'] })).not.toThrow();
  });
  it('rejects an empty id list', () => {
    expect(() => MarkNotificationsReadInputSchema.parse({ ids: [] })).toThrow();
  });
});

describe('ImportProgrammeInputSchema', () => {
  it('accepts a well-formed request', () => {
    expect(() =>
      ImportProgrammeInputSchema.parse({
        year: 2027,
        weekdaysCsv: 'a',
        seriesCsv: 'b',
        singlesCsv: 'c',
      }),
    ).not.toThrow();
  });
  it('rejects an out-of-range year', () => {
    expect(() =>
      ImportProgrammeInputSchema.parse({
        year: 1900,
        weekdaysCsv: 'a',
        seriesCsv: 'b',
        singlesCsv: 'c',
      }),
    ).toThrow();
  });
});

describe('SeriesCsvRowSchema', () => {
  it('accepts a row without teamMin/teamMax', () => {
    expect(() =>
      SeriesCsvRowSchema.parse({
        weekday: 'monday',
        name: 'Pairs',
        scoring: 'Scr',
        format: 'Pairs',
        bestOfN: '',
        bestOfM: '',
        allowSubstitute: 'yes',
        eligibilityNote: '',
        note: '',
        dates: '2027-01-12',
      }),
    ).not.toThrow();
  });
  it('accepts a Teams row with teamMin/teamMax', () => {
    expect(() =>
      SeriesCsvRowSchema.parse({
        weekday: 'monday',
        name: 'Teams',
        scoring: 'Scr',
        format: 'Teams',
        bestOfN: '',
        bestOfM: '',
        allowSubstitute: 'yes',
        eligibilityNote: '',
        note: '',
        dates: '2027-09-20',
        teamMin: '4',
        teamMax: '6',
      }),
    ).not.toThrow();
  });
});
