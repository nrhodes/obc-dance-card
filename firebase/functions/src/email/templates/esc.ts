/**
 * HTML-escape a string before interpolating it into an email template (plan
 * §8.1 "HTML injection via names"). Every template must run every
 * user-supplied value through this before it lands in the `html` body.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
