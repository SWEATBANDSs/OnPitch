// Player tiering. Self-rating is the starting point; organiser ratings left after
// games gradually take over, so tiers become self-policing over time.
export const TIERS = [
  { id: 1, name: 'Social' },
  { id: 2, name: 'Club' },
  { id: 3, name: 'Competitive' },
  { id: 4, name: 'Elite' },
];

export const tierName = (id) => TIERS.find((t) => t.id === id)?.name ?? 'Unknown';

export function selfScore(p) {
  return (p.skill * 2 + p.athleticism) / 3;
}

// Peer ratings carry up to 70% of the weight once a player has 5+ ratings.
export function effectiveScore(p) {
  const self = selfScore(p);
  const ratings = p.peerRatings ?? [];
  if (!ratings.length) return self;
  const peer = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const w = Math.min(ratings.length / 5, 1) * 0.7;
  return self * (1 - w) + peer * w;
}

export function tierFor(p) {
  const s = effectiveScore(p);
  if (s < 4) return 1;
  if (s < 6) return 2;
  if (s < 8) return 3;
  return 4;
}

// Share of confirmed games actually attended; null until there is history.
export function reliability(p) {
  const { attended = 0, noShows = 0 } = p.history ?? {};
  const total = attended + noShows;
  return total ? attended / total : null;
}
