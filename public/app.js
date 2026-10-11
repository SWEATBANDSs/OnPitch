const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let token = localStorage.getItem('token');
let me = null, tab = 'find', error = '';

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
const when = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const pct = (v) => Math.round(v * 100) + '%';
// Counted automatically: matches played, and how many organisers have added them to a squad.
const recordText = (p, bare) => {
  const bits = [p.matches > 0 && `${p.matches} match${p.matches === 1 ? '' : 'es'}`, p.squads > 0 && `in ${p.squads} squad${p.squads === 1 ? '' : 's'}`,
    p.noShows > 0 && p.reliability != null && `${pct(p.reliability)} showed up`].filter(Boolean);
  return bits.join(' · ') || (bare ? '' : 'new');
};
const form = (el) => Object.fromEntries(new FormData(el));
const act = (fn) => async (...a) => { try { error = ''; await fn(...a); } catch (e) { error = e.message; } render(); };

function signupView() {
  app.innerHTML = `<h1>OnPitch</h1><p class="muted">Competitive 6-a-side. Tell us your level honestly – it's your call, and it decides which games you're called for.</p>
  <form id="f" class="card">
    <label>Name<input name="name" required></label>
    <label>Mobile<input name="phone" type="tel" required></label>
    <div class="row"><label>Age<input name="age" type="number" min="16" max="80" required></label>
    <label>Area<input name="area" value="Thanet"></label></div>
    <div class="row"><label>Skill (1-10)<input name="skill" type="number" min="1" max="10" required></label>
    <label>Athleticism (1-10)<input name="athleticism" type="number" min="1" max="10" required></label></div>
    <label>Bio<textarea name="bio" rows="2" placeholder="Position, league experience…"></textarea></label>
    <button>Create profile</button><p class="err">${esc(error)}</p></form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/players', 'POST', form(e.target)); token = r.token; localStorage.setItem('token', token); error = ''; await render(); }
    catch (x) { error = x.message; signupView(); }
  };
}

const callCard = (c, extra = '') => `<div class="card"><strong>${esc(c.team)}</strong>
  <span class="tag">${esc(c.minTierName)}+</span><span class="tag">${c.filled}/${c.slots} filled</span>
  ${c.status !== 'open' ? `<span class="tag">${esc(c.status)}</span>` : ''}
  <div>${esc(c.venue)} · ${when(c.startsAt)}</div><div class="muted">${esc(c.notes)}</div>${extra}</div>`;

async function findView() {
  const calls = await api('/calls');
  return `<h2>Games needing players</h2>` + (calls.map((c) => callCard(c, c.myClaim
    ? `<p class="muted">Your claim: ${c.myClaim.status}</p>${c.myClaim.status === 'accepted' ? `<a href="${esc(c.organiser.whatsapp)}">WhatsApp ${esc(c.organiser.name)}</a>` : ''}
       <button class="sec" data-withdraw="${c.id}">Withdraw</button>`
    : `<button data-claim="${c.id}">Claim a slot${c.slotFeePence ? ` (£${(c.slotFeePence / 100).toFixed(2)})` : ''}</button>`)).join('')
    || '<p class="muted">Nothing open at your level right now. You\'ll get a notification when a team calls.</p>');
}

async function myView() {
  const calls = await api('/calls?mine=1');
  return `<h2>My games</h2>` + (calls.map((c) => {
    if (!c.isOrganiser) return callCard(c, `<p class="muted">Your claim: ${c.myClaim?.status}</p>${c.myClaim?.status === 'accepted' ? `<a href="${esc(c.organiser.whatsapp)}">WhatsApp ${esc(c.organiser.name)}</a>` : ''}`);
    const past = new Date(c.startsAt) < new Date();
    const claims = c.claims.map((p) => `<div class="muted">${esc(p.name)} · ${esc(p.tierName)} · skill ${p.skill}/ath ${p.athleticism} · ${recordText(p)} — ${p.status}
      ${p.status === 'pending' ? `<button data-accept="${c.id}|${p.id}">Accept</button><button class="sec" data-decline="${c.id}|${p.id}">Decline</button>` : ''}
      ${p.status === 'accepted' ? `<a href="${esc(p.whatsapp)}">WhatsApp</a>` : ''}
      ${p.status === 'accepted' ? `<button class="sec" data-squad="${p.id}|${p.inSquad ? 'rm' : 'add'}">${p.inSquad ? 'In my squad ✓' : 'Add to squad'}</button>` : ''}
      ${p.status === 'accepted' && past ? `<button class="${p.noShow ? '' : 'bad'}" data-noshow="${c.id}|${p.id}|${p.noShow ? 0 : 1}">${p.noShow ? 'Undo no-show' : 'No-show'}</button>` : ''}</div>`).join('');
    return callCard(c, `${claims}${c.status !== 'cancelled' ? `<button class="sec" data-edit="${c.id}">Change time/venue</button><button class="bad" data-cancel="${c.id}">Cancel</button>` : ''}`);
  }).join('') || '<p class="muted">No games yet.</p>');
}

function postView() {
  const d = new Date(Date.now() + 864e5); d.setMinutes(0); const v = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  return `<h2>Call for players</h2><form id="post" class="card">
    <label>Team<input name="team" required></label><label>Venue<input name="venue" required></label>
    <label>Kick-off<input name="startsAt" type="datetime-local" value="${v}" required></label>
    <div class="row"><label>Players needed<input name="slots" type="number" min="1" max="6" value="1"></label>
    <label>Minimum tier<select name="minTier"><option value="1">Social</option><option value="2">Club</option><option value="3" selected>Competitive</option><option value="4">Elite</option></select></label></div>
    <label>Notes<input name="notes" placeholder="Bibs, level, subs…"></label><button>Send call</button></form>`;
}

async function inboxView() {
  const n = await api('/notifications'); api('/notifications/read', 'POST');
  return `<h2>Notifications</h2>` + (n.map((x) => `<div class="card">${esc(x.message)}<div class="muted">${when(x.createdAt)}</div></div>`).join('') || '<p class="muted">Nothing yet.</p>');
}

async function render() {
  if (!token) return signupView();
  try { me = await api('/me'); } catch { token = null; localStorage.removeItem('token'); return signupView(); }
  const views = { find: findView, mine: myView, post: async () => postView(), inbox: inboxView };
  const tabs = [['find', 'Find a game'], ['post', 'Post a call'], ['mine', 'My games'], ['inbox', 'Alerts']];
  let html = '';
  try { html = await views[tab](); } catch (e) { error = e.message; }
  app.innerHTML = `<h1>OnPitch</h1><div class="muted">${esc(me.name)} · <span class="tag">${esc(me.tierName)}</span>
    ${recordText(me, true)} <a href="#" id="out">sign out</a></div>
    <nav>${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : 'sec'}" data-tab="${k}">${l}</button>`).join('')}</nav>
    <p class="err">${esc(error)}</p>${html}`;
  $('#out').onclick = () => { localStorage.removeItem('token'); token = null; render(); };
  app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; error = ''; render(); }));
  const on = (attr, fn) => app.querySelectorAll(`[data-${attr}]`).forEach((b) => (b.onclick = act(() => fn(b.dataset[attr].split('|'), b))));
  on('claim', ([id]) => api(`/calls/${id}/claims`, 'POST'));
  on('withdraw', ([id]) => api(`/calls/${id}/claims/me`, 'DELETE'));
  on('accept', ([id, p]) => api(`/calls/${id}/claims/${p}/accept`, 'POST'));
  on('decline', ([id, p]) => api(`/calls/${id}/claims/${p}/decline`, 'POST'));
  on('cancel', ([id]) => confirm('Cancel this call and notify everyone?') && api(`/calls/${id}/cancel`, 'POST'));
  on('noshow', ([id, p, v]) => api(`/calls/${id}/no-show/${p}`, 'POST', { noShow: v === '1' }));
  on('squad', ([p, how]) => api(`/squad/${p}`, how === 'add' ? 'POST' : 'DELETE'));
  on('edit', async ([id]) => {
    const venue = prompt('New venue (leave blank to keep)'); const t = prompt('New kick-off, e.g. 2026-10-20T19:30 (blank to keep)');
    const body = {}; if (venue) body.venue = venue; if (t) body.startsAt = t;
    if (Object.keys(body).length) await api(`/calls/${id}`, 'PATCH', body);
  });
  $('#post')?.addEventListener('submit', act(async (e) => {
    e.preventDefault();
    const b = form(e.target); b.startsAt = new Date(b.startsAt).toISOString();
    const r = await api('/calls', 'POST', b); tab = 'mine'; alert(`Call sent to ${r.notified} eligible players`);
  }));
}
render();
