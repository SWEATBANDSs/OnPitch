// Player tiering.
export const TIERS = [
  { id: 1, name: 'Social' },
  { id: 2, name: 'Club' },
  { id: 3, name: 'Competitive' },
  { id: 4, name: 'Elite' },
];

export const tierName = (id) => TIERS.find((t) => t.id === id)?.name ?? 'Unknown';

// Tiers are purely self-declared: it's not our place to rank grassroots footballers' ability.
export function tierFor(p) {
  const s = (p.skill * 2 + p.athleticism) / 3;
  if (s < 4) return 1;
  if (s < 6) return 2;
  if (s < 8) return 3;
  return 4;
}
