/**
 * Matches the exact wording `importMembers` uses for its mass-deactivation
 * guard (plan §9.2) — split out from `MembersImportScreen.tsx` so that file
 * exports only the screen component (react-refresh needs a component-only
 * module).
 */
const MASS_DEACTIVATION_MARKER = /allowMassDeactivation/i;

export function isMassDeactivationWarning(warning: string): boolean {
  return MASS_DEACTIVATION_MARKER.test(warning);
}
