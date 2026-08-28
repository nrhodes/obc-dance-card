import { useAuth } from '../auth/useAuth';

/** Placeholder for "My card" (Phase 3). Deliberately minimal (plan §14.1). */
export function HomeScreen() {
  const { member } = useAuth();

  return (
    <div className="card">
      <h1>Hello{member ? `, ${member.firstName}` : ''}</h1>
      <p>Coming soon: your dance card.</p>
    </div>
  );
}
