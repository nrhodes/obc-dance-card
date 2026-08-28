import { describe, expect, it } from 'vitest';
import { mapActionError } from './actionErrors';

describe('mapActionError', () => {
  it('shows failed-precondition messages verbatim (they are display-safe server text)', () => {
    expect(mapActionError({ code: 'failed-precondition', message: 'Already committed on: 2027-01-11.' })).toBe(
      'Already committed on: 2027-01-11.',
    );
  });

  it('maps resource-exhausted to a fixed message', () => {
    expect(mapActionError({ code: 'resource-exhausted', message: 'internal detail' })).toBe('Too many invites today');
  });

  it('maps permission-denied to a fixed message', () => {
    expect(mapActionError({ code: 'permission-denied', message: 'internal detail' })).toBe("You can't do that.");
  });

  it('falls back to a generic message for anything else', () => {
    expect(mapActionError({ code: 'internal', message: 'stack trace' })).toBe('Something went wrong. Please try again.');
  });
});
