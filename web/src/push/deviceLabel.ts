/**
 * A short, human-readable "this device" label sent with `registerDevice`
 * (plan §5.2 `RegisteredDevice.label`) so a member's Profile can eventually
 * list e.g. "Chrome on Windows" rather than a bare token. Best-effort only —
 * `navigator.userAgent` parsing is inherently heuristic; unknown patterns
 * fall back to a generic label rather than guessing wrong.
 */
export function browserDeviceLabel(userAgent: string): string {
  const ua = userAgent;

  let os = 'this device';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Mac OS X/.test(ua)) os = 'Mac';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'Chromebook';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  return `${browser} on ${os}`;
}
