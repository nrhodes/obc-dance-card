/**
 * Mirrors the Firebase Auth password policy referenced in plan §8.1: minimum
 * 8 characters, at least one letter and one number. Checked client-side for
 * immediate feedback; Firebase enforces the same policy server-side
 * regardless.
 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[A-Za-z]/.test(password)) {
    return 'Password must include at least one letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must include at least one number.';
  }
  return null;
}
