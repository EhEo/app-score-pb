import { clone, createMatch, rally, nextGame, serviceSide, scoreCall, settle, newId } from './engine.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const STORAGE = 'courtside.session.v1', HISTORY = 'courtside.history.v1';
const params = new URLSearchParams(location.search);
const viewer = params.has('watch');
let session = read(STORAGE, null), history = read(HISTORY, []), remote = null;
let online = false, viewerPresent = false, busy = false, speech = false, eventSource, lastBeat = 0, toastTimer, reconnectTimer, viewerClosed = false;
let viewerCode = (params.get('watch') || '').toUpperCase();
let lastSpokenRevision = null, wakeLock;
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('기기에 저장할 공간이 부족합니다. 브라우저 저장 공간을 확인해 주세요.'); return false; } }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function state() { return viewer ? remote?.state : session?.state; }
function packet() { return { revision: session.revision, state: session.state }; }
function persist() { return write(STORAGE, session); }
function archive() {
  if (session.state.phase === 'finished') {
    history = history.filter(s => s.id !== session.state.id); history.unshift(clone(session.state));
  } else history = history.filter(s => s.id !== session.state.id);
  write(HISTORY, history);
}
function commit(newState) {
  const previous = clone(session);
  session.undo.push(clone(session.state)); session.state = newState; session.revision++;
  if (!persist()) { session = previous; return; }
  archive(); render(); sync();
  if (speech && !session.room) speak(newState);
}
function undo() {
  if (!session.undo.length) return;
  const previous = clone(session); session.state = session.undo.pop(); session.revision++;
  if (!persist()) { session = previous; return; }
  archive(); render(); sync();
}
function status() {
  const badge = $('#connection');
  badge.className = 'badge';
  if (viewer) { badge.textContent = online ? '● 실시간 연결' : '연결 끊김'; badge.classList.add(online ? 'good' : 'warn'); }
  else if (!session?.room) badge.textContent = '단독 사용';
  else { badge.textContent = online ? (viewerPresent ? '● 태블릿 연결됨' : '태블릿 연결 대기') : '오프라인 · 기기에 저장 중'; badge.classList.add(online ? 'good' : 'warn'); }
  const note = $('#network-note'); if (note) note.hidden = !((viewer || session?.room) && !online);
}
function render() {
  document.body.classList.toggle('viewer', viewer);
  const s = state();
  document.body.classList.toggle('active-match', Boolean(s));
  if (!s) {
    $('#app').innerHTML = viewer ? `<section class="waiting"><h1>점수판 연결 중</h1><p id="viewer-error">경기 코드를 확인하고 있습니다.</p><a href="/">처음으로 돌아가기</a></section>` : `<section class="welcome"><div><span class="eyebrow">코트에선, 경기에만 집중</span><h1>준비됐나요?<br>한 게임 시작해요.</h1><p>랠리 승리 팀을 터치하면<br>점수와 서브 순서는 알아서.</p></div><div class="court-art" aria-hidden="true"><span>0</span><span>0</span></div></section><div class="intro-actions"><button class="primary start-button" id="new"><span>새 경기 시작</span><span aria-hidden="true">↗</span></button><div class="home-secondary"><button id="join"><span aria-hidden="true">▣</span> 표시용 태블릿 연결 <span aria-hidden="true">›</span></button><button id="history"><span aria-hidden="true">↶</span> 경기 기록 <span aria-hidden="true">›</span></button></div></div><aside class="home-note"><strong>혼자서도, 함께 연결해서도</strong><p>공식 규칙 · 자유 점수 / 단식 · 복식<br>로그인 없이 바로 사용할 수 있어요.</p></aside>`;
    bind('#new', setup); bind('#join', join); bind('#history', showHistory); status(); return;
  }
  const c = s.config, order = s.flipped ? [1, 0] : [0, 1];
  const official = c.mode === 'official';
  const activeName = c.teams[s.serving].players[c.kind === 'doubles' ? s.activePlayer : 0];
  const side = serviceSide(s) === 0 ? '오른쪽' : '왼쪽';
  const winner = s.games.at(-1)?.winner;
  $('#app').innerHTML = `<div id="network-note" class="network-note" hidden>${viewer ? '연결이 끊겼습니다. 마지막 수신 점수입니다. 재연결을 기다리고 있습니다.' : '휴대폰에서 계속 기록할 수 있습니다. 연결되면 태블릿에 최신 상태를 반영합니다.'}</div>
  <section class="match-head"><div><h1>${official ? '공식 규칙' : '자유 점수'} <span>· ${c.kind === 'doubles' ? '복식' : '단식'}</span></h1><div class="match-meta">${c.target}점 · ${c.winByTwo ? '2점 차' : '선취 승리'} · ${Math.min(s.games.length + (s.phase === 'playing' ? 1 : 0), c.bestOf)}${c.bestOf===1?'게임':' / 3게임'}</div></div>${!viewer ? '<button id="pair" class="compact pair-button" aria-label="태블릿 연결">▣ 태블릿 연결</button>' : '<span class="badge">표시 전용</span>'}</section>
  ${s.phase !== 'playing' ? `<section class="result" role="status"><h2>${escape(c.teams[winner].name)} ${s.phase === 'finished' ? '경기 승리!' : '게임 승리'}</h2><p>${s.games.at(-1).scores.join(' : ')} · 게임 승수 ${s.wins.join(' : ')}</p>${!viewer && s.phase === 'between' ? '<button id="next" class="primary">다음 게임 준비 →</button>' : ''}${!viewer && s.phase === 'finished' ? '<button id="new-result" class="primary">새 경기 시작 →</button>' : ''}</section>` : ''}
  <section class="score-grid" aria-label="현재 점수">${order.map(i => `<article class="score-panel ${i === 1 ? 'team-b' : ''}"><div class="team-heading"><h2>${escape(c.teams[i].name)}</h2><span class="team-tag">${official && s.serving === i && s.phase === 'playing' ? '● 서브' : `${s.wins[i]} 게임 승`}</span></div>${!viewer ? `<button class="score-touch" data-rally="${i}" aria-label="${escape(c.teams[i].name)} 랠리 승리" ${s.phase !== 'playing' ? 'disabled' : ''}><span class="score digits-${String(s.scores[i]).length}">${s.scores[i]}</span><span class="tap-action">${!official || s.serving === i ? '<span class="plus-mark">＋</span> 1점 득점' : (c.kind === 'doubles' && s.server === 1 ? '↻ 서버 전환' : '↔ 서브권 이동')}</span><span class="tap-hint">${s.phase === 'playing' ? '이 팀이 이기면 터치' : '게임 종료'}</span></button>` : `<span class="score digits-${String(s.scores[i]).length}" aria-label="${escape(c.teams[i].name)} ${s.scores[i]}점">${s.scores[i]}</span>`}<div class="players">${c.teams[i].players.slice(0, c.kind === 'doubles' ? 2 : 1).map(escape).join(' · ')}</div></article>`).join('')}</section>
  <section class="service" aria-live="polite"><div><strong>${official ? `${escape(activeName)} · ${side} 서브` : '랠리마다 1점'}</strong><p>${official ? `${escape(c.teams[s.serving].name)}${c.kind === 'doubles' ? ` · ${s.server === 1 ? '첫 번째' : '두 번째'} 서버` : ''} · 위치는 선수 기준` : '서브권과 관계없이 승리한 팀에 점수를 더합니다.'}</p></div><span class="score-call">${official ? `${s.scores[s.serving]} − ${s.scores[1-s.serving]}${c.kind === 'doubles' ? ` − ${s.server}` : ''}` : `${s.scores[0]} − ${s.scores[1]}`}</span></section>
  <div class="game-strip">${s.games.map((g, i) => `<span class="game-chip">${i+1}게임 · ${g.scores.join(' : ')}</span>`).join('')}</div>
  ${!viewer ? `<p class="touch-guide">이긴 팀의 숫자를 터치하세요</p><nav class="controls" aria-label="경기 조작"><button id="undo" ${session.undo.length ? '' : 'disabled'}><span aria-hidden="true">↶</span>되돌리기</button><button id="swap" aria-label="좌우 바꾸기"><span aria-hidden="true">⇄</span>좌우 전환</button><button id="correct" aria-label="상태 수정"><span aria-hidden="true">±</span>점수 수정</button><button id="more" aria-label="경기 관리"><span aria-hidden="true">•••</span>더 보기</button></nav>` : `<div class="viewer-tools"><button id="sound">${speech ? '음성 끄기' : '한국어 음성 켜기'}</button><button id="wake">화면 켜짐 유지</button></div><p class="speech-note">표시 전용 · 점수는 휴대폰에서 조작합니다.</p>`}`;
  document.querySelectorAll('[data-rally]').forEach(button => button.onclick = () => { navigator.vibrate?.(15); commit(rally(session.state, Number(button.dataset.rally))); });
  bind('#undo', undo); bind('#swap', () => { const s = clone(session.state); s.flipped = !s.flipped; commit(s); });
  bind('#correct', correction); bind('#pair', pair); bind('#next', prepareNext); bind('#new-result', setup); bind('#more', manage);
  bind('#sound', toggleSound);
  bind('#wake', keepAwake); status();
}
function toggleSound() { if (!('speechSynthesis' in window)) return toast('이 브라우저는 음성 안내를 지원하지 않습니다.'); if (!viewer && session.room) return toast('연동 중에는 태블릿에서 음성을 켜주세요.'); speech = !speech; if ($('#modal').open) close(); render(); if (speech) speak(state()); else speechSynthesis.cancel(); }
function bind(selector, handler) { const element = $(selector); if (element) element.onclick = handler; }
function touchNumbers(form) {
  form.querySelectorAll('input[type="number"]').forEach(input => {
    const label = input.closest('label'), text = label.firstChild.textContent.trim();
    const field = document.createElement('div'); field.className = label.className; field.hidden = label.hidden;
    if (form.id === 'correction') field.classList.add('full');
    if (label.id) { field.id = label.id; label.removeAttribute('id'); } label.hidden = false;
    input.id = `${form.id}-${input.name}`; input.inputMode = 'numeric';
    label.replaceWith(field); label.textContent = text; label.htmlFor = input.id; field.append(label);
    const stepper = document.createElement('div'); stepper.className = 'number-stepper';
    const minus = document.createElement('button'), plus = document.createElement('button');
    minus.type = plus.type = 'button'; minus.textContent = '−'; plus.textContent = '＋';
    minus.setAttribute('aria-label', `${text} 1점 감소`); plus.setAttribute('aria-label', `${text} 1점 증가`);
    stepper.append(minus, input, plus); field.append(stepper);
    const min = Number(input.min || 0), max = Number(input.max || 9999);
    function bounds() { minus.disabled = input.valueAsNumber <= min; plus.disabled = input.valueAsNumber >= max; }
    function step(amount) { input.value = String(Math.max(min, Math.min(max, (Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : min) + amount))); input.dispatchEvent(new Event('input', {bubbles:true})); bounds(); }
    minus.onclick = () => step(-1); plus.onclick = () => step(1); input.addEventListener('input',bounds); bounds();
  });
}
function modal(title, html) { $('#modal-title').textContent = title; $('#modal-body').innerHTML = html; $('#modal-body').scrollTop=0; if (!$('#modal').open) $('#modal').showModal(); }
const close = () => $('#modal').close();
$('#close-modal').onclick = close;
function teamFields(i, c) {
  const team = c?.teams[i] || { name: `${i ? 'B' : 'A'}팀`, players: [`${i ? 'B' : 'A'} 선수 1`, `${i ? 'B' : 'A'} 선수 2`] };
  return `<fieldset class="form-section"><legend>${i ? 'B' : 'A'}팀</legend><div class="form-grid"><label class="full">팀 이름<input name="team${i}" maxlength="40" value="${escape(team.name)}" required></label>${team.players.map((name, p) => `<label class="player-${p}">선수 ${p+1}<input name="player${i}${p}" maxlength="40" value="${escape(name)}" required></label>`).join('')}<label class="first-player full">게임 시작 시 오른쪽 선수<select name="first${i}"><option value="0">선수 1</option><option value="1">선수 2</option></select></label></div></fieldset>`;
}
function setup() {
  modal('새 경기 설정', `<form id="setup"><div class="form-grid"><label>점수 방식<select name="mode"><option value="official">공식 규칙 · 서브 팀만 득점</option><option value="rally">자유 점수 · 랠리마다 득점</option></select></label><label>경기 종류<select name="kind"><option value="doubles">복식</option><option value="singles">단식</option></select></label><label>경기 구성<select name="bestOf"><option value="1">단판</option><option value="3">3판 2선승</option></select></label><label id="official-target">목표 점수<select name="officialTarget"><option>11</option><option>15</option><option>21</option></select></label><label id="rally-target" hidden>목표 점수<input name="rallyTarget" type="number" min="1" max="999" value="11"></label><label class="check-label full"><input name="winByTwo" type="checkbox" checked disabled>2점 차 승리</label><label id="first-team" class="full">최초 서브 팀<select name="firstTeam"><option value="0">A팀</option><option value="1">B팀</option></select></label></div><details class="optional-settings"><summary>팀·선수 이름과 시작 위치 설정</summary>${teamFields(0)}${teamFields(1)}</details><p class="field-help">기본 이름으로 바로 시작할 수 있습니다. 복식 최초 서브는 오른쪽 선수의 두 번째 서버(0−0−2)로 시작합니다.</p>${session?.state.phase === 'playing' ? '<p class="error-box">새 경기를 시작하면 현재 진행 중인 경기는 교체됩니다.</p>' : ''}<div class="form-actions"><button type="button" id="cancel-setup">취소</button><button class="primary">경기 시작 →</button></div></form>`);
  const f = $('#setup'); touchNumbers(f);
  f.onchange = () => {
    const official = f.elements.mode.value === 'official', doubles = f.elements.kind.value === 'doubles';
    $('#official-target').hidden = !official; $('#rally-target').hidden = official; $('#first-team').hidden = !official;
    f.elements.winByTwo.disabled = official; if (official) f.elements.winByTwo.checked = true;
    document.querySelectorAll('.player-1').forEach(e => e.hidden = !doubles);
    document.querySelectorAll('.first-player').forEach(e => e.hidden = !(doubles && official));
  };
  bind('#cancel-setup', close);
  f.onsubmit = e => {
    e.preventDefault(); const d = new FormData(f), official = d.get('mode') === 'official';
    const config = { mode:d.get('mode'), kind:d.get('kind'), bestOf:Number(d.get('bestOf')), target:Number(d.get(official ? 'officialTarget' : 'rallyTarget')), winByTwo:official || f.elements.winByTwo.checked, firstTeam:Number(d.get('firstTeam')), firstPlayers:[Number(d.get('first0')), Number(d.get('first1'))], teams:[0,1].map(i => ({ name:d.get(`team${i}`).trim() || `${i ? 'B':'A'}팀`, players:[0,1].map(p => d.get(`player${i}${p}`).trim() || `선수 ${p+1}`) })) };
    const old = session; session = { state:createMatch(config), undo:[], revision:(session?.revision || 0)+1, room:session?.room || null };
    if (!persist()) { session = old; return; }
    speech = false; close(); render(); sync();
  };
}
function prepareNext() {
  const s = session.state;
  modal('다음 게임 준비', `<form id="next-form"><p>다음 게임은 ${escape(s.config.teams[(s.config.firstTeam+s.games.length)%2].name)} 서브로 시작합니다.</p>${s.config.kind === 'doubles' && s.config.mode === 'official' ? [0,1].map(i => `<label>${escape(s.config.teams[i].name)} · 시작 시 오른쪽 선수<select name="p${i}">${s.config.teams[i].players.map((name,p) => `<option value="${p}">${escape(name)}</option>`).join('')}</select></label>`).join('') : ''}<div class="form-actions"><button class="primary">다음 게임 시작</button></div></form>`);
  $('#next-form').onsubmit = e => { e.preventDefault(); const d = new FormData(e.currentTarget); const players = [0,1].map(i => Number(d.get(`p${i}`) ?? s.config.firstPlayers[i])); close(); commit(nextGame(s, players)); };
}
function correction() {
  const s = session.state;
  if (s.phase !== 'playing') return toast('종료된 게임은 되돌리기로 종료 전 상태로 복구한 뒤 수정해 주세요.');
  modal('현재 상태 수정', `<form id="correction"><p>점수와 선수 위치를 실제 경기 상태에 맞추세요. 수정도 되돌릴 수 있습니다.</p><div class="form-grid">${[0,1].map(i => `<label>${escape(s.config.teams[i].name)} 점수<input name="score${i}" type="number" min="0" max="9999" value="${s.scores[i]}" required></label>`).join('')}${s.config.mode === 'official' ? `<details class="optional-settings full"><summary>서브권·서버·선수 위치 수정</summary><div class="form-grid"><label>서브 팀<select name="serving">${s.config.teams.map((t,i) => `<option value="${i}" ${s.serving === i ? 'selected' : ''}>${escape(t.name)}</option>`).join('')}</select></label>${s.config.kind === 'doubles' ? `<label>서버 번호<select name="server"><option value="1" ${s.server===1?'selected':''}>첫 번째 서버</option><option value="2" ${s.server===2?'selected':''}>두 번째 서버</option></select></label>${[0,1].map(i => `<label>${escape(s.config.teams[i].name)} · 현재 오른쪽 선수<select name="right${i}">${s.config.teams[i].players.map((name,p) => `<option value="${p}" ${s.positions[i][0] === p ? 'selected':''}>${escape(name)}</option>`).join('')}</select></label>`).join('')}<label class="full">현재 서브 선수<select name="active"></select></label>` : ''}</div></details>` : ''}</div><p class="field-help">목표 점수와 승리 조건에 도달한 점수를 입력하면 게임이 종료됩니다.</p><div class="form-actions"><button class="primary">수정 적용</button></div></form>`);
  const f = $('#correction'); touchNumbers(f);
  function updatePlayers() { if (!f.elements.active) return; const team = Number(f.elements.serving.value); f.elements.active.innerHTML = s.config.teams[team].players.map((name,p) => `<option value="${p}" ${s.serving===team && s.activePlayer===p ? 'selected':''}>${escape(name)}</option>`).join(''); }
  if (f.elements.serving) f.elements.serving.onchange = updatePlayers; updatePlayers();
  f.onsubmit = e => { e.preventDefault(); const d = new FormData(f), n = clone(s); n.scores = [Number(d.get('score0')),Number(d.get('score1'))]; if (s.config.mode === 'official') { n.serving=Number(d.get('serving')); if (s.config.kind === 'doubles') { n.server=Number(d.get('server')); n.activePlayer=Number(d.get('active')); n.positions=[0,1].map(i => { const right=Number(d.get(`right${i}`)); return [right,1-right]; }); } } close(); commit(settle(n)); };
}
function showHistory() {
  modal('경기 기록', `<p>이 브라우저에 저장된 완료 경기입니다. 브라우저 데이터를 지우면 함께 삭제됩니다.</p>${history.length ? history.map(s => `<article class="history-row"><strong>${escape(s.config.teams[0].name)} ${s.wins.join(' : ')} ${escape(s.config.teams[1].name)}</strong><p>${new Date(s.finishedAt).toLocaleString('ko-KR')} · ${s.config.mode === 'official' ? '공식 규칙' : '자유 점수'} · ${s.config.kind === 'doubles' ? '복식' : '단식'}</p><p>${s.games.map((g,i) => `${i+1}게임 ${g.scores.join(':')}`).join(' / ')}</p></article>`).join('') : '<div class="empty">아직 완료한 경기가 없습니다.</div>'}`);
}
function manage() {
  modal('경기 관리', `<div class="menu-list"><button id="manage-pair">▣ 태블릿 연결 <span>›</span></button><button id="manage-sound">음성 안내 <span>${speech?'켜짐':'꺼짐'}</span></button><button id="manage-wake">화면 켜짐 유지 <span>›</span></button><button id="manage-new">새 경기 <span>›</span></button><button id="manage-history" aria-label="경기 기록">경기 기록 <span>›</span></button><button id="home" class="danger">현재 경기 닫기 <span>×</span></button></div><p class="help">완료된 경기 기록은 이 기기에 저장됩니다.</p>`);
  bind('#manage-pair', pair);bind('#manage-sound',toggleSound);bind('#manage-wake',keepAwake);
  bind('#manage-new', setup); bind('#manage-history', showHistory);
  bind('#home', () => { modal('현재 경기 닫기', '<p>진행 중인 경기와 되돌리기 기록을 닫을까요? 완료된 경기 기록은 유지됩니다.</p><div class="actions"><button id="keep">계속 진행</button><button id="leave" class="danger">경기 닫기</button></div>'); bind('#keep', close); bind('#leave', async () => { if (session.room) { const s=clone(session.state); s.closed=true; session.state=s; session.revision++; persist(); await sync(); } session=null; localStorage.removeItem(STORAGE); close(); render(); }); });
}
function join() {
  modal('표시용 태블릿 연결', '<form id="join-form"><p>휴대폰의 ‘태블릿 연결’에서 표시된 경기 코드를 입력하세요.</p><label>경기 코드<input name="code" placeholder="예: A1B2C3D4" pattern="[A-Fa-f0-9]{8}" maxlength="8" required autocomplete="off" autocapitalize="characters"></label><div class="form-actions"><button class="primary">점수판 연결</button></div></form>');
  $('#join-form').onsubmit = e => { e.preventDefault(); location.href = `/?watch=${new FormData(e.currentTarget).get('code').toUpperCase()}`; };
}
async function pair() {
  if (!session.room) {
    try { const result = await api('/api/rooms', { method:'POST', body:JSON.stringify(packet()) }); session.room = { code:result.code, token:result.token }; persist(); speech=false; render(); }
    catch (error) { return toast(`연결방을 만들 수 없습니다. ${error.message}`); }
  }
  const code = session.room.code, link = `${location.origin}/?watch=${code}`;
  modal('태블릿을 점수판으로', `<p>태블릿에서 QR 코드를 스캔하거나, 같은 주소에 접속해 아래 경기 코드를 입력하세요.</p><img class="qr" src="/api/qr?url=${encodeURIComponent(link)}" alt="표시용 태블릿 연결 QR 코드"><div class="pair-code">${code}</div><a class="pair-link" href="${escape(link)}" target="_blank" rel="noopener">${escape(link)}</a><hr class="divider"><p class="field-help">휴대폰은 조작용, 태블릿은 표시 전용입니다. 음성 안내는 태블릿에서 켜주세요.</p>${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '<p class="error-box">현재 주소는 이 PC에서만 열립니다. 실제 기기 연결에는 동일한 공개 HTTPS 주소로 접속해 주세요.</p>' : ''}`);
  await sync();
}
async function api(url, options={}) {
  const response = await fetch(url, { ...options, headers:{'Content-Type':'application/json',...options.headers}, signal:AbortSignal.timeout(7000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '서버에 연결할 수 없습니다.'); return data;
}
async function sync() {
  if (viewer || !session?.room || busy) return;
  busy = true;
  const current = session, revision = session.revision;
  try { const data = await api(`/api/rooms/${current.room.code}`, {method:'PUT',headers:{Authorization:`Bearer ${current.room.token}`},body:JSON.stringify(packet())}); if (session===current) {online=true;viewerPresent=data.viewer;} }
  catch { if (session===current) online=false; }
  finally { busy=false;status(); if (session?.room && session.revision !== revision) sync(); }
}
function connectViewer() {
  if (!/^[A-F0-9]{8}$/.test(viewerCode)) { $('#viewer-error').textContent='올바른 8자리 경기 코드가 아닙니다.'; return; }
  let id = sessionStorage.getItem('courtside.viewer'); if (!id) {id=newId();sessionStorage.setItem('courtside.viewer',id);}
  const cached = read(`courtside.watch.${viewerCode}`, null); if (cached) {remote=cached;render();}
  clearTimeout(reconnectTimer);
  const old = eventSource; if (old) {old.onclose=null;old.close();}
  eventSource = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/rooms/${viewerCode}/socket?viewer=${id}`);
  eventSource.onmessage = event => {
    if (event.data === 'pong') { online=true;lastBeat=Date.now();status();return; }
    const next = JSON.parse(event.data);
    const changed = remote && next.revision !== remote.revision;
    remote=next; online=true; lastBeat=Date.now(); write(`courtside.watch.${viewerCode}`,next); render();
    if (remote.state.closed) { viewerClosed=true;eventSource.close(); online=false; $('#app').innerHTML='<section class="waiting"><h1>경기가 닫혔습니다.</h1><a href="/">처음으로 돌아가기</a></section>'; status(); return; }
    if (changed && speech && lastSpokenRevision !== next.revision) speak(next.state);
    lastSpokenRevision=next.revision;
  };
  eventSource.onerror = () => {online=false;status();if (!remote && $('#viewer-error')) $('#viewer-error').textContent='연결 대기 중입니다. 경기 코드, 인터넷 연결 또는 다른 태블릿의 연결 여부를 확인해 주세요.';};
  eventSource.onclose = () => {online=false;status();if(!viewerClosed)reconnectTimer=setTimeout(connectViewer,3000);};
}
function speak(s) {
  if (!speech || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel(); const utterance=new SpeechSynthesisUtterance(s.phase==='playing' ? scoreCall(s) : `${s.config.teams[s.games.at(-1).winner].name}, ${s.phase==='finished'?'경기':'게임'} 승리`);
  utterance.lang='ko-KR'; const voice=speechSynthesis.getVoices().find(v=>v.lang.startsWith('ko'));if(voice)utterance.voice=voice; speechSynthesis.speak(utterance);
}
async function keepAwake() {
  try { if (!navigator.wakeLock) return toast('이 브라우저는 화면 켜짐 유지를 지원하지 않습니다. 기기 화면 꺼짐 설정을 변경해 주세요.'); wakeLock=await navigator.wakeLock.request('screen');toast('화면 켜짐 유지를 요청했습니다.'); } catch {toast('화면 켜짐 유지가 허용되지 않았습니다.');}
}
$('#fullscreen').onclick = async () => { try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {toast('이 기기에서는 홈 화면에 추가한 뒤 전체 화면으로 사용해 주세요.');} };
window.addEventListener('online', () => {if(viewer&&!viewerClosed)connectViewer();else sync();});
window.addEventListener('offline', () => {online=false;status();});
document.addEventListener('visibilitychange', () => { if(!document.hidden) {if(viewer&&!viewerClosed)connectViewer();else sync(); if(wakeLock?.released) keepAwake();} });
setInterval(() => {if(viewer) {if(eventSource?.readyState===1)eventSource.send('ping');if(lastBeat && Date.now()-lastBeat>12000) {online=false;status();eventSource?.close();}} else sync();}, 5000);
render(); if(viewer)connectViewer(); else sync();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
