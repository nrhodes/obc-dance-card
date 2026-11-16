/**
 * Screens whose content is a table: they get a wider column on large
 * screens (`.main-wide` in styles.css). Everything else — forms, the dance
 * card, a session page — stays at the phone-first 640px reading width.
 */
export function isWideRoute(pathname: string): boolean {
  return pathname === '/members' || pathname === '/admin' || pathname.startsWith('/admin/');
}
