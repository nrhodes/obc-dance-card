/**
 * Self-contained "push notifications on this device" section for the
 * Profile screen (plan §16 Phase 5b / task brief B). Mounted from
 * `ProfileScreen.tsx` with a single `<PushSettings />`.
 *
 * This is deliberately per-device (not a `notificationPrefs` toggle — that's
 * `NotificationPrefsForm`'s `push` checkbox, which controls whether the
 * *server* ever tries to push to any of the member's devices at all): a
 * member might want push on their phone but not on a shared clubroom
 * laptop, so each browser/device turns itself on or off here.
 */
import { useAuth } from '../auth/useAuth';
import { mapGenericError } from '../auth/errors';
import { usePush } from './usePush';

export function PushSettings() {
  const { memberPrivate } = useAuth();
  const { state, busy, isIos, error, enable, disable } = usePush();
  const prefsAllowPush = memberPrivate?.notificationPrefs.push ?? true;

  return (
    <div>
      <h2>Push notifications on this device</h2>

      {state === 'unsupported' && (
        <p className="muted">
          {isIos
            ? 'On iPhone, add this site to your Home Screen (Share → Add to Home Screen) to receive notifications.'
            : "This browser doesn't support push notifications. Try a recent version of Chrome, Edge, or Firefox."}
        </p>
      )}

      {state === 'denied' && (
        <p className="muted">
          Notifications are blocked for this site in your browser. Allow them in your browser&apos;s
          site settings, then reload this page.
        </p>
      )}

      {(state === 'prompt' || state === 'enabled' || state === 'error') && !prefsAllowPush && (
        <p className="muted">
          Push notifications are turned off in your preferences above. Turn &quot;Push
          notifications&quot; on there first.
        </p>
      )}

      {state === 'prompt' && (
        <>
          <p className="muted">
            Get a notification on this device when a partner responds, cancels, or invites you.
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !prefsAllowPush}
            onClick={() => void enable()}
          >
            Turn on notifications on this device
          </button>
        </>
      )}

      {state === 'enabled' && (
        <>
          <p>Notifications are on for this device.</p>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void disable()}
          >
            Turn off on this device
          </button>
        </>
      )}

      {state === 'error' && (
        <div className="alert alert-error" role="alert">
          {mapGenericError(error ?? { code: 'unknown', message: '' })}
        </div>
      )}
    </div>
  );
}
