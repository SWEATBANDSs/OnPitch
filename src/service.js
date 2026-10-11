import { randomBytes, randomUUID } from 'node:crypto';
import { tierFor, tierName, record, TIERS } from './tiers.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (s, m) => { throw new HttpError(s, m); };

const int = (v, name, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${name} must be an integer ${min}-${max}`);
  return n;
};
const str = (v, name, max = 200, required = true) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (required && !s) fail(400, `${name} is required`);
  if (s.length > max) fail(400, `${name} is too long`);
  return s;
};
const phone = (v) => {
  const s = str(v, 'phone', 20).replace(/[\s-]/g, '');
  if (!/^\+?\d{7,15}$/.test(s)) fail(400, 'phone must be 7-15 digits');
  return s;
};
const when = (v) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(400, 'startsAt must be a valid date/time');
  return d.toISOString();
};
const wa = (p) => `https://wa.me/${p.replace(/^\+/, '').replace(/^0/, '44')}`;

// notifier(playerId, notification) is the delivery hook (push/SMS). The in-app inbox
// is always written; the notifier is where SMS/push providers plug in.
export class Service {
  constructor(store, { notifier = () => {}, slotFeePence = 0, now = () => new Date() } = {}) {
    this.s = store;
    this.notifier = notifier;
    this.slotFeePence = slotFeePence; // monetisation undecided: 0 = free, 100 = ~£1 per claim
    this.now = now;
  }

  // ---- players ----
  publicPlayer(p) {
    return {
      id: p.id, name: p.name, age: p.age, bio: p.bio, area: p.area,
      skill: p.skill, athleticism: p.athleticism,
      tier: tierFor(p), tierName: tierName(tierFor(p)),
      ...record(p),
    };
  }

  auth(token) {
    const p = token && this.s.data.players.find((x) => x.token === token);
    if (!p) fail(401, 'Not signed in');
    return p;
  }

  register(b) {
    const ph = phone(b.phone);
    if (this.s.data.players.some((p) => p.phone === ph)) fail(409, 'That number is already registered');
    const p = {
      id: randomUUID(), token: randomBytes(24).toString('hex'),
      name: str(b.name, 'name', 80), phone: ph,
      age: int(b.age, 'age', 16, 80), bio: str(b.bio, 'bio', 500, false),
      area: str(b.area, 'area', 80, false) || 'Thanet',
      skill: int(b.skill, 'skill', 1, 10), athleticism: int(b.athleticism, 'athleticism', 1, 10),
      history: { attended: 0, noShows: 0, badgeYes: 0, badgeNo: 0, backYes: 0, backNo: 0 }, createdAt: this.now().toISOString(),
    };
    this.s.data.players.push(p);
    this.s.save();
    return { player: { ...this.publicPlayer(p), phone: p.phone }, token: p.token };
  }

  me(p) { return { ...this.publicPlayer(p), phone: p.phone }; }

  updateMe(p, b) {
    if (b.name !== undefined) p.name = str(b.name, 'name', 80);
    if (b.bio !== undefined) p.bio = str(b.bio, 'bio', 500, false);
    if (b.area !== undefined) p.area = str(b.area, 'area', 80, false);
    if (b.age !== undefined) p.age = int(b.age, 'age', 16, 80);
    if (b.skill !== undefined) p.skill = int(b.skill, 'skill', 1, 10);
    if (b.athleticism !== undefined) p.athleticism = int(b.athleticism, 'athleticism', 1, 10);
    this.s.save();
    return this.me(p);
  }

  // ---- calls ----
  player(id) { return this.s.data.players.find((x) => x.id === id); }
  call(id) { return this.s.data.calls.find((c) => c.id === id) ?? fail(404, 'Call not found'); }

  createCall(org, b) {
    const startsAt = when(b.startsAt);
    if (new Date(startsAt) <= this.now()) fail(400, 'startsAt must be in the future');
    const call = {
      id: randomUUID(), organiserId: org.id,
      team: str(b.team, 'team', 80), venue: str(b.venue, 'venue', 120), startsAt,
      slots: int(b.slots, 'slots', 1, 6), minTier: int(b.minTier ?? 1, 'minTier', 1, TIERS.length),
      notes: str(b.notes, 'notes', 300, false),
      status: 'open', claims: [], createdAt: this.now().toISOString(),
    };
    this.s.data.calls.push(call);
    const eligible = this.s.data.players.filter((p) => p.id !== org.id && tierFor(p) >= call.minTier);
    for (const p of eligible) {
      this.notify(p.id, 'call', call.id,
        `${call.team} need ${call.slots} player${call.slots > 1 ? 's' : ''} at ${call.venue}, ${this.fmt(call.startsAt)}`);
    }
    this.s.save();
    return { call: this.view(call, org), notified: eligible.length };
  }

  fmt(iso) { return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }); }

  confirmed(call) { return call.claims.filter((c) => c.status === 'accepted'); }

  // Contacts are only revealed after a claim is accepted: that's the WhatsApp handoff point.
  view(call, viewer) {
    const org = this.player(call.organiserId);
    const isOrg = viewer?.id === call.organiserId;
    const mine = call.claims.find((c) => c.playerId === viewer?.id);
    const out = {
      id: call.id, team: call.team, venue: call.venue, startsAt: call.startsAt, slots: call.slots,
      minTier: call.minTier, minTierName: tierName(call.minTier), notes: call.notes, status: call.status,
      filled: this.confirmed(call).length, organiser: { id: org.id, name: org.name },
      isOrganiser: isOrg, slotFeePence: this.slotFeePence,
    };
    if (mine) {
      out.myClaim = { status: mine.status };
      if (mine.status === 'accepted') out.organiser = { ...out.organiser, phone: org.phone, whatsapp: wa(org.phone) };
    }
    if (isOrg) {
      out.claims = call.claims.map((c) => {
        const p = this.player(c.playerId);
        const row = { ...this.publicPlayer(p), status: c.status, claimedAt: c.claimedAt, attended: c.attended ?? null };
        if (c.status === 'accepted') Object.assign(row, { phone: p.phone, whatsapp: wa(p.phone) });
        return row;
      });
    }
    return out;
  }

  listCalls(viewer, { mine = false } = {}) {
    const now = this.now();
    const rows = this.s.data.calls.filter((c) => {
      if (mine) return c.organiserId === viewer.id || c.claims.some((x) => x.playerId === viewer.id);
      return c.status === 'open' && new Date(c.startsAt) > now && c.organiserId !== viewer.id && tierFor(viewer) >= c.minTier;
    });
    return rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map((c) => this.view(c, viewer));
  }

  getCall(viewer, id) { return this.view(this.call(id), viewer); }

  own(call, org) { if (call.organiserId !== org.id) fail(403, 'Only the organiser can do that'); }

  editCall(org, id, b) {
    const call = this.call(id);
    this.own(call, org);
    if (call.status === 'cancelled') fail(409, 'Call is cancelled');
    const changes = [];
    if (b.venue !== undefined && str(b.venue, 'venue', 120) !== call.venue) { call.venue = str(b.venue, 'venue', 120); changes.push(`venue now ${call.venue}`); }
    if (b.startsAt !== undefined && when(b.startsAt) !== call.startsAt) {
      call.startsAt = when(b.startsAt);
      if (new Date(call.startsAt) <= this.now()) fail(400, 'startsAt must be in the future');
      changes.push(`time now ${this.fmt(call.startsAt)}`);
    }
    if (b.notes !== undefined) call.notes = str(b.notes, 'notes', 300, false);
    if (changes.length) {
      for (const c of call.claims.filter((x) => x.status === 'accepted' || x.status === 'pending')) {
        this.notify(c.playerId, 'change', call.id, `Fixture change – ${call.team}: ${changes.join(', ')}`);
      }
    }
    this.s.save();
    return this.view(call, org);
  }

  cancelCall(org, id) {
    const call = this.call(id);
    this.own(call, org);
    if (call.status === 'cancelled') return this.view(call, org);
    call.status = 'cancelled';
    for (const c of call.claims.filter((x) => x.status !== 'declined' && x.status !== 'withdrawn')) {
      this.notify(c.playerId, 'cancel', call.id, `Cancelled – ${call.team} at ${call.venue}, ${this.fmt(call.startsAt)}`);
    }
    this.s.save();
    return this.view(call, org);
  }

  // ---- claims ----
  claim(p, id) {
    const call = this.call(id);
    if (call.organiserId === p.id) fail(400, 'You organised this call');
    if (call.status !== 'open' || new Date(call.startsAt) <= this.now()) fail(409, 'This call is no longer open');
    if (tierFor(p) < call.minTier) fail(403, `Needs ${tierName(call.minTier)} tier or above`);
    const existing = call.claims.find((c) => c.playerId === p.id);
    if (existing && existing.status !== 'withdrawn') fail(409, 'You have already claimed a slot');
    if (existing) { existing.status = 'pending'; existing.claimedAt = this.now().toISOString(); }
    else call.claims.push({ playerId: p.id, status: 'pending', claimedAt: this.now().toISOString(), feePence: this.slotFeePence });
    this.notify(call.organiserId, 'claim', call.id, `${p.name} (${tierName(tierFor(p))}) wants a slot for ${call.team}`);
    this.s.save();
    return this.view(call, p);
  }

  withdraw(p, id) {
    const call = this.call(id);
    const c = call.claims.find((x) => x.playerId === p.id && (x.status === 'pending' || x.status === 'accepted'));
    if (!c) fail(404, 'No active claim');
    const wasAccepted = c.status === 'accepted';
    c.status = 'withdrawn';
    if (wasAccepted) {
      call.status = 'open';
      this.notify(call.organiserId, 'withdraw', call.id, `${p.name} has dropped out of ${call.team}'s game – slot reopened`);
    }
    this.s.save();
    return this.view(call, p);
  }

  decide(org, id, playerId, accept) {
    const call = this.call(id);
    this.own(call, org);
    const c = call.claims.find((x) => x.playerId === playerId && x.status === 'pending');
    if (!c) fail(404, 'No pending claim from that player');
    if (accept) {
      if (this.confirmed(call).length >= call.slots) fail(409, 'All slots are filled');
      c.status = 'accepted';
      this.notify(playerId, 'accepted', call.id, `You're in! ${call.team}, ${call.venue}, ${this.fmt(call.startsAt)}. Contact details are now visible.`);
      if (this.confirmed(call).length >= call.slots) call.status = 'filled';
    } else {
      c.status = 'declined';
      this.notify(playerId, 'declined', call.id, `${call.team} couldn't offer you a slot this time`);
    }
    this.s.save();
    return this.view(call, org);
  }

  // After the game the organiser records three yes/no facts: showed up, played for the badge,
  // would have them back. The last two are optional and only apply if the player showed up.
  attendance(org, id, playerId, { attended, playedForBadge, wouldHaveBack } = {}) {
    const call = this.call(id);
    this.own(call, org);
    if (new Date(call.startsAt) > this.now()) fail(409, 'The game has not happened yet');
    const c = call.claims.find((x) => x.playerId === playerId && x.status === 'accepted');
    if (!c) fail(404, 'Player was not confirmed for this game');
    if (c.attended !== undefined && c.attended !== null) fail(409, 'Attendance already recorded');
    const bool = (v, name) => { if (v !== undefined && v !== null && typeof v !== 'boolean') fail(400, `${name} must be true or false`); return v; };
    if (typeof attended !== 'boolean') fail(400, 'attended must be true or false');
    bool(playedForBadge, 'playedForBadge'); bool(wouldHaveBack, 'wouldHaveBack');
    const h = this.player(playerId).history;
    c.attended = attended;
    h[attended ? 'attended' : 'noShows']++;
    if (attended) {
      if (typeof playedForBadge === 'boolean') { c.playedForBadge = playedForBadge; h[playedForBadge ? 'badgeYes' : 'badgeNo']++; }
      if (typeof wouldHaveBack === 'boolean') { c.wouldHaveBack = wouldHaveBack; h[wouldHaveBack ? 'backYes' : 'backNo']++; }
    }
    this.s.save();
    return this.view(call, org);
  }

  // ---- notifications ----
  notify(playerId, type, callId, message) {
    const n = { id: randomUUID(), playerId, type, callId, message, createdAt: this.now().toISOString(), read: false };
    this.s.data.notifications.push(n);
    try { this.notifier(playerId, n); } catch { /* delivery failure must not break the action */ }
  }

  inbox(p) {
    return this.s.data.notifications.filter((n) => n.playerId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markRead(p) {
    this.s.data.notifications.forEach((n) => { if (n.playerId === p.id) n.read = true; });
    this.s.save();
  }

  // ---- QR-plaque lead capture (name + number, contacted afterwards) ----
  addLead(b) {
    const ph = phone(b.phone);
    if (this.s.data.leads.some((l) => l.phone === ph)) return { ok: true };
    this.s.data.leads.push({ name: str(b.name, 'name', 80), phone: ph, source: str(b.source, 'source', 40, false) || 'plaque', createdAt: this.now().toISOString() });
    this.s.save();
    return { ok: true };
  }
  leads() { return this.s.data.leads; }
}
