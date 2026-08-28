import { describe, expect, it } from 'vitest';
import type { Member } from '@obc/shared';
import { filterPickableMembers } from './memberPicker';

function member(overrides: Partial<Member>): Member {
  return {
    id: 'm',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: '',
    grade: 'Open',
    role: 'member',
    active: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const members: Member[] = [
  member({ id: 'member-a', firstName: 'Jane', lastName: 'Doe' }),
  member({ id: 'member-b', firstName: 'John', lastName: 'Smith' }),
  member({ id: 'member-c', firstName: 'Amy', lastName: 'Lee' }),
];

describe('filterPickableMembers', () => {
  it('excludes self', () => {
    const result = filterPickableMembers(members, { selfId: 'member-a', excludeMemberIds: [], query: '' });
    expect(result.map((m) => m.id)).toEqual(['member-c', 'member-b']);
  });

  it('excludes members already confirmed on the session', () => {
    const result = filterPickableMembers(members, { selfId: 'member-a', excludeMemberIds: ['member-b'], query: '' });
    expect(result.map((m) => m.id)).toEqual(['member-c']);
  });

  it('filters by a case-insensitive name query', () => {
    const result = filterPickableMembers(members, { selfId: 'member-a', excludeMemberIds: [], query: 'smith' });
    expect(result.map((m) => m.id)).toEqual(['member-b']);
  });

  it('sorts alphabetically by full name', () => {
    const result = filterPickableMembers(members, { selfId: '', excludeMemberIds: [], query: '' });
    // Amy Lee < Jane Doe < John Smith
    expect(result.map((m) => m.id)).toEqual(['member-c', 'member-a', 'member-b']);
  });
});
