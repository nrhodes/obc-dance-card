import { describe, expect, it } from 'vitest';
import { validatePasswordStrength } from './passwordStrength';

describe('validatePasswordStrength', () => {
  it('rejects passwords shorter than 8 characters', () => {
    expect(validatePasswordStrength('a1234')).toMatch(/at least 8 characters/);
  });

  it('rejects passwords with no letter', () => {
    expect(validatePasswordStrength('12345678')).toMatch(/at least one letter/);
  });

  it('rejects passwords with no number', () => {
    expect(validatePasswordStrength('abcdefgh')).toMatch(/at least one number/);
  });

  it('accepts a password with 8+ chars, a letter, and a number', () => {
    expect(validatePasswordStrength('abcd1234')).toBeNull();
  });

  it('accepts longer, mixed passwords', () => {
    expect(validatePasswordStrength('Correct1Horse')).toBeNull();
  });
});
