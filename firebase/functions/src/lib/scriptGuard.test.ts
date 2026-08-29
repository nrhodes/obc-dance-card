import { describe, expect, it } from 'vitest';
import { checkRealProject } from './scriptGuard.js';

describe('checkRealProject (ops-script guard, plan §19)', () => {
  it('throws when no project id is resolved', () => {
    expect(() => checkRealProject(undefined)).toThrow(/No project id/);
  });

  it('throws for a demo-* project id by default', () => {
    expect(() => checkRealProject('demo-obc')).toThrow(/demo-obc/);
  });

  it('accepts a demo-* project id with allowDemo: true', () => {
    expect(checkRealProject('demo-obc', { allowDemo: true })).toBe('demo-obc');
  });

  it('accepts a real project id without any flag', () => {
    expect(checkRealProject('obc-dance-card')).toBe('obc-dance-card');
  });
});
