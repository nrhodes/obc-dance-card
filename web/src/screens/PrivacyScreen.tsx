/**
 * `/privacy` (plan §8.1 "Privacy law (NZ Privacy Act 2020)", Phase 7b task
 * deliverable H). Public — reachable signed out (linked from the sign-in
 * screen's footer) as well as from Profile, so a prospective or departing
 * member can read it without an account. Deliberately plain language, no
 * legalese, kept under 400 words: mirrors what's actually stored (plan §5),
 * who can see what (plan §2 Visibility), and retention/erasure
 * (`docs/ops-runbook.md` "Member erasure").
 */
export function PrivacyScreen() {
  return (
    <div className="card">
      <h1>Privacy</h1>
      <p>
        This app is run by Orewa Bridge Club to organise dance-card partners for club sessions. This
        page explains, in plain language, what we store and who can see it.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          Your name, phone number, and playing grade — the same as the printed member booklet.
        </li>
        <li>Your email address, used only to sign you in and to send you notifications.</li>
        <li>Your dance card: who you&apos;re playing with, and any note you add to an invite.</li>
        <li>
          Any visitor (a non-member partner) you add — their name, and their email or phone if you
          choose to give them.
        </li>
      </ul>

      <h2>Who can see what</h2>
      <ul>
        <li>
          Other active members can see your name, grade, and phone number, and who is playing in
          each session.
        </li>
        <li>
          Your email address and the devices you&apos;ve registered for notifications are private to
          you and to club admins.
        </li>
        <li>
          A visitor&apos;s email or phone is visible only to you (the member who added them) and to
          admins.
        </li>
        <li>
          Club admins can see everything, to help run the club and troubleshoot problems; every
          action an admin takes on your behalf is logged and you&apos;re notified of it.
        </li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        We keep your details while you&apos;re an active member. If you leave the club, your account
        is deactivated (not deleted) so your past dance-card history stays consistent for other
        members&apos; records; after a waiting period an admin can permanently erase your personal
        details on request. Visitor details are removed automatically if unused for 18 months. A
        record of admin actions is kept for 2 years for accountability.
      </p>

      <h2>Your choices</h2>
      <p>
        You can update your phone number and notification preferences any time in Profile. To have
        your personal details erased, or if you have any question about this page, contact the club.
      </p>
    </div>
  );
}
