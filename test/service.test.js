import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Service, HttpError } from '../src/service.js';
import { tierFor } from '../src/tiers.js';

let clock;
function setup(opts = {}) {
  clock = new Date('2026-10-01T12:00:00Z');
  const sent = [];
  const svc = new Service(new Store(null), { now: () => clock, notifier: (id, n) => sent.push([id, n]), ...opts });
  let i = 0;
  const reg = (name, skill, ath = skill) => {
    const r = svc.register({ name, phone: `0777000${String(++i).padStart(4, '0')}`, age: 28, skill, athleticism: ath });
    return svc.auth(r.token);
  };
  return { svc, sent, reg };
}
const call = (extra = {}) => ({ team: 'Thanet FC', venue: 'Jackie Baker', startsAt: '2026-10-08T19:00:00Z', slots: 1, minTier: 3, ...extra });
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof HttpError, e.stack); return e.status; } assert.fail('expected HttpError'); };

test('tiers derive from self-rating', () => {
  assert.equal(tierFor({ skill: 2, athleticism: 3 }), 1);
  assert.equal(tierFor({ skill: 5, athleticism: 5 }), 2);
  assert.equal(tierFor({ skill: 7, athleticism: 7 }), 3);
  assert.equal(tierFor({ skill: 9, athleticism: 9 }), 4);
});

test('registration validates and rejects duplicate numbers', () => {
  const { svc } = setup();
  assert.equal(code(() => svc.register({ name: 'x', phone: 'abc', age: 30, skill: 5, athleticism: 5 })), 400);
  assert.equal(code(() => svc.register({ name: 'x', phone: '07770001111', age: 30, skill: 11, athleticism: 5 })), 400);
  svc.register({ name: 'x', phone: '07770001111', age: 30, skill: 5, athleticism: 5 });
  assert.equal(code(() => svc.register({ name: 'y', phone: '07770001111', age: 30, skill: 5, athleticism: 5 })), 409);
});

test('call notifies only eligible tiers and hides contacts until accepted', () => {
  const { svc, sent, reg } = setup();
  const org = reg('Org', 7); const good = reg('Good', 8); const casual = reg('Casual', 2);
  const r = svc.createCall(org, call());
  assert.equal(r.notified, 1);
  assert.deepEqual(sent.map(([id]) => id), [good.id]);
  assert.equal(svc.listCalls(casual).length, 0);
  assert.equal(code(() => svc.claim(casual, r.call.id)), 403);

  let v = svc.claim(good, r.call.id);
  assert.equal(v.myClaim.status, 'pending');
  assert.equal(v.organiser.phone, undefined);
  assert.equal(svc.getCall(org, r.call.id).claims[0].phone, undefined);

  svc.decide(org, r.call.id, good.id, true);
  v = svc.getCall(good, r.call.id);
  assert.equal(v.organiser.phone, org.phone);
  assert.match(v.organiser.whatsapp, /^https:\/\/wa\.me\/447/);
  assert.equal(v.status, 'filled');
  assert.equal(code(() => svc.claim(reg('Late', 8), r.call.id)), 409);
});

test('claims: no duplicates, organiser cannot claim, only organiser decides', () => {
  const { svc, reg } = setup();
  const org = reg('Org', 7); const a = reg('A', 7); const b = reg('B', 7);
  const { call: c } = svc.createCall(org, call({ slots: 2 }));
  assert.equal(code(() => svc.claim(org, c.id)), 400);
  svc.claim(a, c.id);
  assert.equal(code(() => svc.claim(a, c.id)), 409);
  assert.equal(code(() => svc.decide(b, c.id, a.id, true)), 403);
  svc.withdraw(a, c.id);
  svc.claim(a, c.id); // can re-claim after withdrawing
});

test('fixture changes notify accepted and pending players', () => {
  const { svc, sent, reg } = setup();
  const org = reg('Org', 7); const a = reg('A', 7); const b = reg('B', 7); const c3 = reg('C', 7);
  const { call: c } = svc.createCall(org, call({ slots: 2 }));
  svc.claim(a, c.id); svc.claim(b, c.id); svc.claim(c3, c.id);
  svc.decide(org, c.id, a.id, true); svc.decide(org, c.id, c3.id, false);
  sent.length = 0;
  svc.editCall(org, c.id, { venue: 'Margate 3G', startsAt: '2026-10-08T20:00:00Z' });
  const to = sent.filter(([, n]) => n.type === 'change').map(([id]) => id).sort();
  assert.deepEqual(to, [a.id, b.id].sort());
  assert.match(sent.at(-1)[1].message, /venue now Margate 3G/);
  assert.equal(code(() => svc.editCall(a, c.id, { venue: 'x' })), 403);
});

test('withdrawal of a confirmed player reopens the slot', () => {
  const { svc, reg } = setup();
  const org = reg('Org', 7); const a = reg('A', 7);
  const { call: c } = svc.createCall(org, call());
  svc.claim(a, c.id); svc.decide(org, c.id, a.id, true);
  assert.equal(svc.getCall(org, c.id).status, 'filled');
  svc.withdraw(a, c.id);
  assert.equal(svc.getCall(org, c.id).status, 'open');
});

test('matches played are counted automatically; organiser only flags no-shows', () => {
  const { svc, reg } = setup();
  const org = reg('Org', 7); const a = reg('A', 8);
  const tierBefore = svc.me(a).tier;
  assert.deepEqual([svc.me(a).matches, svc.me(a).squads, svc.me(a).reliability], [0, 0, null]);
  const play = (start) => {
    clock = new Date('2026-10-01T12:00:00Z');
    const { call: c } = svc.createCall(org, call({ startsAt: start, minTier: 1 }));
    svc.claim(a, c.id); svc.decide(org, c.id, a.id, true);
    return c;
  };
  const c1 = play('2026-10-02T19:00:00Z');
  const c2 = play('2026-10-09T19:00:00Z');
  assert.equal(svc.me(a).matches, 0); // nothing has kicked off yet
  assert.equal(code(() => svc.setNoShow(org, c1.id, a.id, true)), 409);

  clock = new Date('2026-10-03T00:00:00Z');
  assert.equal(svc.me(a).matches, 1); // c1 counted with zero data entry
  clock = new Date('2026-10-10T00:00:00Z');
  assert.equal(svc.me(a).matches, 2);
  assert.equal(svc.me(a).reliability, 1);

  svc.setNoShow(org, c2.id, a.id, true);
  assert.equal(svc.me(a).matches, 1);
  assert.equal(svc.me(a).noShows, 1);
  assert.equal(svc.me(a).reliability, 0.5);
  svc.setNoShow(org, c2.id, a.id, false); // undo
  assert.equal(svc.me(a).matches, 2);
  assert.equal(svc.me(a).tier, tierBefore); // stats never move the tier
  assert.equal(code(() => svc.setNoShow(a, c2.id, a.id, true)), 403);
  assert.equal(code(() => svc.setNoShow(org, c2.id, a.id, 'yes')), 400);
});

test('cancelled games and unconfirmed claims do not count as played', () => {
  const { svc, reg } = setup();
  const org = reg('Org', 7); const a = reg('A', 7); const b = reg('B', 7);
  const { call: c } = svc.createCall(org, call({ slots: 2, startsAt: '2026-10-02T19:00:00Z' }));
  svc.claim(a, c.id); svc.claim(b, c.id); svc.decide(org, c.id, a.id, true);
  clock = new Date('2026-10-03T00:00:00Z');
  assert.equal(svc.me(a).matches, 1);
  assert.equal(svc.me(b).matches, 0); // never confirmed
  svc.cancelCall(org, c.id);
  assert.equal(svc.me(a).matches, 0);
});

test('squads: counted per organiser, idempotent, and give first call regardless of tier', () => {
  const { svc, sent, reg } = setup();
  const org = reg('Org', 7); const org2 = reg('Org2', 7); const mate = reg('Mate', 2);
  assert.equal(code(() => svc.addToSquad(org, org.id)), 400);
  assert.equal(code(() => svc.addToSquad(org, 'nope')), 404);
  svc.addToSquad(org, mate.id); svc.addToSquad(org, mate.id);
  svc.addToSquad(org2, mate.id);
  assert.equal(svc.me(mate).squads, 2);
  assert.equal(svc.me(mate).tier, 1); // still self-declared

  const r = svc.createCall(org, call({ minTier: 3 }));
  assert.equal(r.notified, 2); // org2 qualifies on tier; Mate is below tier but in the squad
  assert.ok(sent.some(([id]) => id === mate.id));
  assert.equal(svc.listCalls(mate).length, 1);
  svc.claim(mate, r.call.id); // not blocked by tier

  const r2 = svc.createCall(org2, call({ minTier: 4 }));
  assert.equal(r2.call.minTier, 4);
  svc.removeFromSquad(org, mate.id);
  assert.equal(svc.me(mate).squads, 1);
  assert.equal(code(() => svc.claim(reg('Rando', 2), r.call.id)), 403);
});

test('cancel notifies claimants; past calls rejected', () => {
  const { svc, sent, reg } = setup();
  const org = reg('Org', 7); const a = reg('A', 7);
  assert.equal(code(() => svc.createCall(org, call({ startsAt: '2026-09-01T10:00:00Z' }))), 400);
  const { call: c } = svc.createCall(org, call());
  svc.claim(a, c.id);
  sent.length = 0;
  svc.cancelCall(org, c.id);
  assert.equal(sent[0][1].type, 'cancel');
  assert.equal(code(() => svc.claim(reg('B', 7), c.id)), 409);
});

test('slot fee is surfaced on calls (monetisation toggle)', () => {
  const { svc, reg } = setup({ slotFeePence: 100 });
  const org = reg('Org', 7);
  assert.equal(svc.createCall(org, call()).call.slotFeePence, 100);
});

test('leads dedupe by number', () => {
  const { svc } = setup();
  svc.addLead({ name: 'Sam', phone: '07700900123' }); svc.addLead({ name: 'Sam', phone: '07700900123' });
  assert.equal(svc.leads().length, 1);
});
