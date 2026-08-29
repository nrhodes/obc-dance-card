import { describe, expect, it } from 'vitest';
import { browserDeviceLabel } from './deviceLabel';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const FIREFOX_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

describe('browserDeviceLabel', () => {
  it('labels Chrome on Windows', () => {
    expect(browserDeviceLabel(CHROME_WINDOWS)).toBe('Chrome on Windows');
  });

  it('labels Safari on iPhone', () => {
    expect(browserDeviceLabel(SAFARI_IPHONE)).toBe('Safari on iPhone');
  });

  it('labels Firefox on Mac', () => {
    expect(browserDeviceLabel(FIREFOX_MAC)).toBe('Firefox on Mac');
  });

  it('prefers Edge over Chrome when both tokens are present', () => {
    expect(browserDeviceLabel(EDGE_WINDOWS)).toBe('Edge on Windows');
  });

  it('labels Chrome on Android', () => {
    expect(browserDeviceLabel(CHROME_ANDROID)).toBe('Chrome on Android');
  });

  it('falls back gracefully for an unrecognised UA', () => {
    expect(browserDeviceLabel('some-unknown-agent')).toBe('Browser on this device');
  });
});
