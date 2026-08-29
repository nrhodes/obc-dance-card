/**
 * `/help` — "Getting started" for members (Phase 7b task deliverable H).
 * Linked from the main nav. Plain language, short sections, no jargon.
 */
import { Link } from 'react-router-dom';

export function HelpScreen() {
  return (
    <div className="stack">
      <div className="card">
        <h1>Getting started</h1>
        <p>A few things that help this app work well for you.</p>
      </div>

      <div className="card">
        <h2>Add it to your phone or tablet</h2>
        <p>
          <strong>iPhone or iPad:</strong> open this site in Safari, tap the <strong>Share</strong>{' '}
          button, then &quot;Add to Home Screen&quot;. An icon appears on your home screen like any
          other app.
        </p>
        <p>
          <strong>Android:</strong> open this site in Chrome. You should see a banner offering to
          &quot;Install app&quot; or &quot;Add to Home screen&quot; — tap it. If you don&apos;t see
          the banner, open the browser menu (three dots) and choose &quot;Install app&quot;.
        </p>
      </div>

      <div className="card">
        <h2>Turning on notifications</h2>
        <p>
          Go to <Link to="/profile">Profile</Link> and find &quot;Push notifications on this
          device&quot;. Tap &quot;Turn on notifications on this device&quot; and allow it when your
          browser asks. You&apos;ll then be told on this device when a partner responds, cancels, or
          invites you — as well as by email.
        </p>
      </div>

      <div className="card">
        <h2>&quot;Looking for a partner&quot; vs &quot;Available&quot;</h2>
        <p>
          On a session&apos;s page you can list yourself one of two ways if you don&apos;t already
          have a partner:
        </p>
        <ul>
          <li>
            <strong>Looking for a partner</strong> — the first person who claims your listing is
            paired with you straight away. Use this when you definitely want to play and are happy
            with whoever claims first.
          </li>
          <li>
            <strong>Available</strong> — a softer listing. Someone who wants to play with you sends
            you an invite, which you can accept or decline. Use this when you&apos;d like to choose.
          </li>
        </ul>
      </div>

      <div className="card">
        <h2>Cancelling</h2>
        <p>
          Open the session from <Link to="/programme">Programme</Link> or{' '}
          <Link to="/">My card</Link> and use &quot;Cancel&quot; on your entry. If you have a
          partner, they&apos;ll be told and automatically listed as looking for a partner again, so
          please cancel as early as you can.
        </p>
      </div>

      <div className="card">
        <h2>Who to phone</h2>
        <p>
          Each weekday has a Partner Steward who can help you find a partner by phone. Open{' '}
          <Link to="/programme">Programme</Link>, choose the weekday, and their name is shown at the
          top — look up their phone number in the members list or ask at the club.
        </p>
      </div>
    </div>
  );
}
