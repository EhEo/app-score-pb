const pair = value => Array.isArray(value) && value.length === 2;
const bit = value => value === 0 || value === 1;
const score = value => Number.isInteger(value) && value >= 0 && value <= 9999;
const name = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 40;
export function validPacket(p) {
  const s = p?.state, c = s?.config;
  return Number.isSafeInteger(p?.revision) && p.revision >= 0 &&
    typeof s?.id === 'string' && s.id.length <= 80 && c &&
    ['official', 'rally'].includes(c.mode) && ['singles', 'doubles'].includes(c.kind) &&
    [1, 3].includes(c.bestOf) && Number.isInteger(c.target) && c.target > 0 && c.target <= 999 &&
    typeof c.winByTwo === 'boolean' && (c.mode !== 'official' || (c.winByTwo && [11,15,21].includes(c.target))) &&
    bit(c.firstTeam) && pair(c.firstPlayers) && c.firstPlayers.every(bit) &&
    pair(c.teams) && c.teams.every(t => name(t?.name) && pair(t.players) && t.players.every(name)) &&
    pair(s.scores) && s.scores.every(score) && pair(s.wins) && s.wins.every(n => Number.isInteger(n) && n >= 0 && n <= 2) &&
    bit(s.serving) && bit(s.activePlayer) && [1,2].includes(s.server) &&
    pair(s.positions) && s.positions.every(p => pair(p) && p.every(bit) && p[0] !== p[1]) &&
    ['playing','between','finished'].includes(s.phase) && typeof s.flipped === 'boolean' &&
    Array.isArray(s.games) && s.games.length <= c.bestOf && s.games.every(g => pair(g.scores) && g.scores.every(score) && bit(g.winner)) &&
    (s.phase === 'playing' || s.games.length > 0) &&
    typeof s.startedAt === 'string' && s.startedAt.length <= 40 &&
    (s.finishedAt === undefined || (typeof s.finishedAt === 'string' && s.finishedAt.length <= 40)) &&
    (s.closed === undefined || typeof s.closed === 'boolean');
}
