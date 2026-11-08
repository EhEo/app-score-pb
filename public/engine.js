export const clone = value => structuredClone(value);
export function createMatch(config, id = newId()) {
  const first = config.firstTeam ?? 0;
  return { id, config, scores: [0, 0], wins: [0, 0], games: [], serving: first,
    server: config.kind === 'doubles' ? 2 : 1, positions: config.firstPlayers.map(p => [p, 1 - p]),
    activePlayer: config.firstPlayers[first], flipped: false, phase: 'playing', startedAt: new Date().toISOString() };
}
export function newId() { return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join(''); }
export function serviceSide(state) {
  return state.config.kind === 'singles' ? state.scores[state.serving] % 2 : state.positions[state.serving].indexOf(state.activePlayer);
}
export function settle(state) {
  const winner = state.scores.findIndex((score, i) => score >= state.config.target && score - state.scores[1 - i] >= (state.config.winByTwo ? 2 : 1));
  if (winner < 0) return state;
  state.wins[winner]++;
  state.games.push({ scores: [...state.scores], winner });
  state.phase = state.wins[winner] >= state.config.bestOf / 2 ? 'finished' : 'between';
  if (state.phase === 'finished') state.finishedAt = new Date().toISOString();
  return state;
}
export function rally(previous, winner) {
  const s = clone(previous);
  if (s.phase !== 'playing') return s;
  if (s.config.mode === 'rally' || winner === s.serving) {
    s.scores[winner]++;
    if (s.config.mode === 'official' && s.config.kind === 'doubles') s.positions[winner].reverse();
  } else if (s.config.kind === 'doubles' && s.server === 1) {
    s.server = 2;
    s.activePlayer = 1 - s.activePlayer;
  } else {
    s.serving = 1 - s.serving;
    s.server = 1;
    s.activePlayer = s.config.kind === 'doubles' ? s.positions[s.serving][0] : 0;
  }
  return settle(s);
}
export function nextGame(previous, firstPlayers = previous.config.firstPlayers) {
  const s = clone(previous);
  if (s.phase !== 'between') return s;
  s.scores = [0, 0]; s.phase = 'playing';
  s.serving = (s.config.firstTeam + s.games.length) % 2;
  s.positions = firstPlayers.map(p => [p, 1 - p]);
  s.server = s.config.kind === 'doubles' ? 2 : 1;
  s.activePlayer = firstPlayers[s.serving];
  return s;
}
export function scoreCall(s) {
  if (s.config.mode === 'rally') return `${s.scores[0]} 대 ${s.scores[1]}`;
  return `${s.scores[s.serving]} 대 ${s.scores[1 - s.serving]}${s.config.kind === 'doubles' ? `, ${s.server}번 서버` : ''}`;
}
