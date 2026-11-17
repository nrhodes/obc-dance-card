import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyCallableResponse, classifyVersionResponse, parseArgs } from './post-deploy-smoke.mjs';

test('the functions version check passes only when the live build matches the deployed commit', () => {
  const sha = 'a'.repeat(40);
  assert.equal(classifyVersionResponse(200, JSON.stringify({ commit: sha, builtAt: 'x' }), sha).ok, true);
  assert.equal(classifyVersionResponse(200, JSON.stringify({ commit: 'b'.repeat(40), builtAt: 'x' }), sha).ok, false);
  assert.equal(classifyVersionResponse(200, JSON.stringify({ commit: 'unknown' }), sha).ok, false);
  assert.equal(classifyVersionResponse(200, JSON.stringify({ commit: sha }), undefined).ok, true);
  assert.equal(classifyVersionResponse(404, 'Not Found', sha).ok, false);
  assert.equal(classifyVersionResponse(200, '<html>', sha).ok, false);
});

test('an App Check rejection proves the function is loaded', () => {
  const r = classifyCallableResponse(401, JSON.stringify({ error: { message: 'Unauthenticated', status: 'UNAUTHENTICATED' } }));
  assert.equal(r.ok, true);
});

test('a callable result or a validation error also counts as loaded', () => {
  assert.equal(classifyCallableResponse(200, JSON.stringify({ result: { ok: true } })).ok, true);
  assert.equal(classifyCallableResponse(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT' } })).ok, true);
});

test('a missing or crashing function fails', () => {
  assert.equal(classifyCallableResponse(404, '<html>Not Found</html>').ok, false);
  assert.equal(classifyCallableResponse(404, JSON.stringify({ error: { status: 'NOT_FOUND' } })).ok, false);
  assert.equal(classifyCallableResponse(500, JSON.stringify({ error: { status: 'INTERNAL' } })).ok, false);
  assert.equal(classifyCallableResponse(503, 'Service Unavailable').ok, false);
  assert.equal(classifyCallableResponse(403, JSON.stringify({ error: { status: 'PERMISSION_DENIED' } })).ok, false);
});

test('parseArgs defaults the base URL from the project and rejects bad input', () => {
  const args = parseArgs(['--project', 'demo-obc', '--expect-sha', 'abc']);
  assert.equal(args.baseUrl, 'https://demo-obc.web.app');
  assert.equal(args.callable, 'requestLoginCode');
  assert.equal(parseArgs(['--project', 'p', '--base-url', 'https://x.example/']).baseUrl, 'https://x.example');
  assert.throws(() => parseArgs([]), /--project is required/);
  assert.throws(() => parseArgs(['--project', 'p', '--nope', '1']), /Unknown argument/);
});
