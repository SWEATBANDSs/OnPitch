# OnPitch

Player recruitment for **competitive** 6-a-side football. A team short of players posts a call; players at or above the required skill tier are notified and claim a slot; the organiser confirms, and only then are contact details (and a WhatsApp link) exchanged. Conversation moves off-app after that.

Stage 1 only: a matching layer on top of games teams already organise. No pitch booking, no venue relationships.

## Run

```
npm start            # http://localhost:3000   (Node >= 20, zero dependencies)
npm test
```

| Env var | Purpose |
|---|---|
| `PORT` | default 3000 |
| `DATA_FILE` | JSON store path, default `data/db.json` |
| `SLOT_FEE_PENCE` | per-claim fee shown to players (e.g. `100` for ~£1). `0` = free. Display only; **no payment processing yet** |
| `ADMIN_TOKEN` | bearer token for `GET /api/leads` |

## What's built (MVP)

| Brief feature | Where |
|---|---|
| Self-rated profiles (bio, age, skill, athleticism) | `POST /api/players`, `src/service.js` |
| Tiering: Social / Club / Competitive / Elite | `src/tiers.js` |
| Call-and-response matching, tier-gated | `POST /api/calls`, `POST /api/calls/:id/claims`, accept/decline |
| App owns roster; contacts revealed only once confirmed (WhatsApp handoff) | `Service.view()` |
| League link: optional platform (Leisure Leagues / Powerleague / other) + fixture URL on each call. Shown to players as an unverified link; no league API integration | `Service.createCall()` |
| Organiser track record (games run, squads) shown on every call so strangers can judge a ringer request | `Service.organiserStats()` |
| Fixture-change / cancel / drop-out notifications | `PATCH /api/calls/:id`, in-app inbox + `notifier` hook |
| QR-plaque lead capture (name + number, no app sign-up) | `/join`, `POST /api/leads` |
| Monetisation toggle | `SLOT_FEE_PENCE` (undecided: per-slot vs tiered access) |

### Decisions on the open questions
- **Tier policing:** none, deliberately. Ranking grassroots footballers' ability isn't our place, so the tier is whatever the player declares. Profiles instead show things that are counted, not judged: **matches played** (automatic: a confirmed player has played once kick-off passes, unless the organiser flags a no-show) and **squads** (how many organisers have added them). Squad members get first call on that organiser's games regardless of tier. Goals/assists are deliberately not tracked: nobody keeps them up in 6-a-side.
- **Chat:** fully off-app; `wa.me` links appear after confirmation.
- **Platform:** web-first, mobile-friendly, vanilla JS (no build step).

## Not done / next
- **Real delivery of SMS/push.** `notifier` in `src/server.js` currently just logs; plug in Twilio/web-push there. The in-app inbox is always written.
- **Auth is a bearer token created at signup** (stored in browser localStorage). Fine for seeding; add phone-number OTP before any wider launch, since there is no account recovery.
- JSON-file store: swap for SQLite/Postgres before real scale.
- Payments, an admin view for leads, and distance/area filtering are out of V1 scope.

Product brief: [docs/BRIEF.md](docs/BRIEF.md).
