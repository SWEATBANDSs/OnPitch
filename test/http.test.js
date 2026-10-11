import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Service } from '../src/service.js';
import { createApp } from '../src/app.js';

const server = createApp(new Service(new Store(null)), { adminToken: 'secret' });
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
after(() => server.close());
const req = (path, method = 'GET', body, token) => fetch(base + path, {
  method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});

test('end to end over HTTP', async () => {
  const p = { name: 'A', phone: '07700900001', age: 30, skill: 8, athleticism: 8 };
  const org = await (await req('/api/players', 'POST', p)).json();
  const pl = await (await req('/api/players', 'POST', { ...p, name: 'B', phone: '07700900002' })).json();
  assert.equal((await req('/api/me')).status, 401);
  const startsAt = new Date(Date.now() + 864e5).toISOString();
  const made = await (await req('/api/calls', 'POST', { team: 'T', venue: 'V', startsAt, slots: 1, minTier: 3 }, org.token)).json();
  assert.equal(made.notified, 1);
  const list = await (await req('/api/calls', 'GET', null, pl.token)).json();
  assert.equal(list.length, 1);
  assert.equal((await req(`/api/calls/${made.call.id}/claims`, 'POST', {}, pl.token)).status, 200);
  assert.equal((await req(`/api/calls/${made.call.id}/claims`, 'POST', {}, pl.token)).status, 409);
  const inbox = await (await req('/api/notifications', 'GET', null, org.token)).json();
  assert.match(inbox[0].message, /wants a slot/);
});

test('leads are public to write, admin-only to read; static pages served', async () => {
  assert.equal((await req('/api/leads', 'POST', { name: 'S', phone: '07700900099' })).status, 200);
  assert.equal((await req('/api/leads')).status, 401);
  assert.equal((await req('/api/leads', 'GET', null, 'secret')).status, 200);
  assert.equal((await fetch(base + '/join')).status, 200);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
});
