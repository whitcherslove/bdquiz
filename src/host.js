import QRCode from 'qrcode';
import { sb } from './supabase.js';
import { QUESTIONS, QT, TITLE } from './questions.js';
import { PHOTOS } from './photos.js';
import { ill, questionIll } from './ill.js';
import { esc, badge, isLong, limitMs, pts, score, REACT_PHASES } from './shared.js';

const tv = document.getElementById('tv');
const msg = document.getElementById('msg');
const CONF = ['var(--ice)', 'var(--cloud)', 'var(--berry)', 'var(--moss)'];
const RC = 2 * Math.PI * 38;

let game = null;
let players = [];
let answers = [];
let tick = null;
let startLocal = 0;
let busy = false;
let qrSvg = '';
const seenReact = new Set();
let lastReactTs = '1970-01-01T00:00:00Z';

/* ---------- экран 1280×720, вписанный в любой телевизор ---------- */
function fit() {
  const s = Math.min(innerWidth / 1280, innerHeight / 720);
  tv.style.setProperty('--s', s);
  tv.style.setProperty('--x', `${(innerWidth - 1280 * s) / 2}px`);
  tv.style.setProperty('--y', `${(innerHeight - 720 * s) / 2}px`);
}
addEventListener('resize', fit);
fit();

/* ---------- данные ---------- */
const Q = () => QUESTIONS[game.q_index];
const QN = () => QUESTIONS.slice(0, game.q_index + 1).filter(x => !x.round).length;
const ranked = () => [...players].sort((a, b) => b.score - a.score);
const cur = () => answers.filter(a => a.q_index === game.q_index);
const ansOf = (pid, i) => answers.find(a => a.player_id === pid && a.q_index === i);
const nameOf = id => (players.find(p => p.id === id) || {}).name || '?';
const okCount = p => answers.filter(a => a.player_id === p.id && a.ok).length;
const roundStart = i => { for (let k = i; k >= 0; k--) if (QUESTIONS[k].round) return k; return 0; };
const roundPts = (p, from, to) => answers.filter(a => a.player_id === p.id && a.q_index >= from && a.q_index <= to).reduce((s, a) => s + a.points, 0);
const playUrl = () => `${location.origin}/play.html?g=${game.code}`;

async function loadPlayers() {
  const { data } = await sb.from('players').select().eq('game_id', game.id).order('created_at');
  players = data || [];
}
async function loadAnswers() {
  const { data } = await sb.from('answers').select().eq('game_id', game.id);
  answers = data || [];
}

function showMsg(text, ms) {
  msg.textContent = text;
  msg.hidden = false;
  if (ms) setTimeout(() => { msg.hidden = true; }, ms);
}

async function init() {
  const code = new URLSearchParams(location.search).get('g');
  if (code) {
    const { data } = await sb.from('games').select().eq('code', code).maybeSingle();
    game = data;
  }
  if (!game) {
    const { data, error } = await sb.from('games')
      .insert({ code: String(Math.floor(1000 + Math.random() * 9000)) })
      .select().single();
    if (error) return showMsg(`Не удалось создать игру: ${error.message}. Проверь .env.local и что supabase.sql выполнен.`);
    game = data;
    history.replaceState(null, '', `?g=${game.code}`);
  }
  qrSvg = await QRCode.toString(playUrl(), { type: 'svg', margin: 1, color: { dark: '#151936', light: '#FFFFFF' } });
  Object.values(PHOTOS).forEach(p => { new Image().src = p.src; });
  await Promise.all([loadPlayers(), loadAnswers()]);
  const { data: old } = await sb.from('reactions').select('id,created_at').eq('game_id', game.id).order('created_at');
  (old || []).forEach(r => { seenReact.add(r.id); lastReactTs = r.created_at; });
  subscribe();
  if (game.phase === 'question') startLocal = Date.parse(game.q_started_at);
  render();
  if (game.phase === 'question') runTimer();
}

function subscribe() {
  sb.channel(`host-${game.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `game_id=eq.${game.id}` }, ({ new: p }) => {
      if (!players.some(x => x.id === p.id)) players.push(p);
      if (game.phase === 'lobby') updateLobby();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers', filter: `game_id=eq.${game.id}` }, ({ new: a }) => {
      if (!answers.some(x => x.id === a.id)) answers.push(a);
      if (game.phase === 'question') updateCount();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions', filter: `game_id=eq.${game.id}` }, ({ new: r }) => spawn(r))
    .subscribe(status => { if (status === 'CHANNEL_ERROR') showMsg('Нет связи с сервером. Проверь интернет', 4000); });
}

/* ---------- ход игры ---------- */
async function act(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); }
  catch (e) { console.error(e); showMsg(`Ошибка: ${e.message}`, 4000); }
  finally { busy = false; }
}

async function setState(phase, q_index = game.q_index) {
  const { error } = await sb.from('games').update({ phase, q_index }).eq('id', game.id);
  if (error) throw error;
  game.phase = phase;
  game.q_index = q_index;
  render();
}

async function goTo(i) {
  if (QUESTIONS[i].round) return setState('intro', i);
  const { data, error } = await sb.rpc('start_question', { p_game: game.id, p_idx: i });
  if (error) throw error;
  game.phase = 'question';
  game.q_index = i;
  game.q_started_at = data;
  startLocal = Date.now();
  render();
  runTimer();
}

function runTimer() {
  clearInterval(tick);
  tick = setInterval(() => {
    const lim = limitMs(Q());
    const left = Math.max(0, lim - (Date.now() - startLocal));
    const t = document.getElementById('timer');
    const fg = document.getElementById('ringfg');
    if (t) t.textContent = Math.ceil(left / 1000);
    if (fg) fg.style.strokeDashoffset = RC * (1 - left / lim);
    if (left <= 0) reveal();
  }, 100);
}

function updateCount() {
  const n = cur().length;
  const el = document.getElementById('ans');
  if (el) el.textContent = n;
  if (players.length && n >= players.length) reveal();
}

function reveal() {
  if (game.phase !== 'question') return;
  if (busy) { setTimeout(reveal, 300); return; }
  clearInterval(tick);
  act(async () => {
    const q = Q();
    const { data, error } = await sb.from('answers').select().eq('game_id', game.id).eq('q_index', game.q_index);
    if (error) throw error;
    const t0 = Date.parse(game.q_started_at);
    const results = data.map(a => {
      const ms = Math.max(0, Date.parse(a.created_at) - t0);
      return { id: a.id, ms, ...score(q, a.value, ms) };
    });
    const r = await sb.rpc('apply_results', { p_game: game.id, p_results: results });
    if (r.error) throw r.error;
    game.phase = 'reveal';
    await Promise.all([loadPlayers(), loadAnswers()]);
    render();
  });
}

function next() {
  act(async () => {
    const i = game.q_index;
    const atEnd = i >= QUESTIONS.length - 1;
    switch (game.phase) {
      case 'lobby': return goTo(0);
      case 'intro': return goTo(i + 1);
      case 'reveal': return setState('board');
      case 'board': return atEnd || QUESTIONS[i + 1].round ? setState('roundsum') : goTo(i + 1);
      case 'roundsum': return atEnd ? setState('podium') : goTo(i + 1);
      case 'podium': return setState('table');
      case 'table': return setState('awards');
    }
  });
}

async function clearFrom(i) {
  const { error } = await sb.rpc('clear_from', { p_game: game.id, p_idx: i });
  if (error) throw error;
  await Promise.all([loadPlayers(), loadAnswers()]);
}

function back() {
  act(async () => {
    clearInterval(tick);
    const i = game.q_index;
    switch (game.phase) {
      case 'intro': return i === 0 ? setState('lobby', 0) : setState('roundsum', i - 1);
      case 'question':
        await clearFrom(i);
        return QUESTIONS[i - 1].round ? setState('intro', i - 1) : setState('board', i - 1);
      case 'reveal':
        await clearFrom(i);
        return goTo(i);
      default: {
        const prev = { board: 'reveal', roundsum: 'board', podium: 'roundsum', table: 'podium', awards: 'table' }[game.phase];
        if (prev) return setState(prev);
      }
    }
  });
}

/* ---------- номинации ---------- */
function awards() {
  const r = ranked();
  if (!r.length) return [];
  const okBy = (p, f) => answers.filter(a => a.player_id === p.id && a.ok && QUESTIONS[a.q_index] && f(QUESTIONS[a.q_index])).length;
  const total = f => QUESTIONS.filter(x => !x.round && f(x)).length;
  const best = f => {
    const w = [...players].sort((a, b) => okBy(b, f) - okBy(a, f) || b.score - a.score)[0];
    return { who: w.name, stat: `${okBy(w, f)} из ${total(f)} верно` };
  };
  const list = [
    { feat: true, t: 'Знает нас лучше всех', who: r[0].name, stat: pts(r[0].score) },
    { t: 'Лучше всех знает Славу', ...best(q => q.cat === 'slava') },
    { t: 'Лучше всех знает Юлю', ...best(q => q.cat === 'yulia') },
    { t: 'Знаток Архангельска', ...best(q => q.cat === 'arh') },
    { t: 'Знаток Вологды', ...best(q => q.cat === 'vol') },
    { t: 'Детектор выдумок', ...best(q => q.cat === 'r3' && q.correct === 2) },
  ];
  const fast = players.map(p => {
    const ms = answers.filter(a => a.player_id === p.id && a.ok && a.ms != null && QUESTIONS[a.q_index]?.type !== 'num').map(a => a.ms);
    return { p, n: ms.length, avg: ms.length ? ms.reduce((s, x) => s + x, 0) / ms.length : Infinity };
  }).filter(x => x.n >= 3).sort((a, b) => a.avg - b.avg)[0];
  if (fast) list.push({ t: 'Самые быстрые пальцы', who: fast.p.name, stat: `${(fast.avg / 1000).toFixed(1)} с на верный ответ` });
  return list;
}

/* ---------- реакции и головы ---------- */
function spawn(r) {
  if (r.created_at > lastReactTs) lastReactTs = r.created_at;
  if (seenReact.has(r.id)) return;
  seenReact.add(r.id);
  const fx = document.getElementById('fx');
  if (!fx || !REACT_PHASES.includes(game.phase) || fx.childElementCount > 30) return;
  const el = document.createElement('div');
  el.className = 'fxb';
  el.style.left = `${4 + Math.random() * 86}%`;
  const word = /^[А-Яа-яЁё]/.test(r.kind);
  el.innerHTML = (word
    ? `<span class="w" style="background:${CONF[Math.floor(Math.random() * 4)]};transform:rotate(${(Math.random() * 16 - 8).toFixed(1)}deg)">${esc(r.kind)}</span>`
    : `<span class="e">${esc(r.kind)}</span>`) + `<span class="n">${esc(nameOf(r.player_id))}</span>`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

const HEADS = { s: '/photos/head-slava.png', y: '/photos/head-yulia.png' };
const POLAROIDS = ['masks', 'pool', 'glasses', 'car', 'bar'];
const headImg = (who, cls) => `<img class="head ${cls}" src="${HEADS[who]}" alt="">`;
function heads() {
  switch (game.phase) {
    case 'intro': {
      const r = Q().round;
      return r === 1 ? headImg('s', 'peek-br') : r === 2 ? headImg('y', 'peek-br') : headImg('s', 'peek-br') + headImg('y', 'peek-br2');
    }
    case 'board': {
      // вместо голов — ваши фото, по очереди, на каждой третьей таблице
      const n = QN();
      if (n % 3) return '';
      const key = POLAROIDS[(n / 3 - 1) % POLAROIDS.length];
      return `<div class="polaroid ${n % 2 ? 'l' : 'r'}"><img src="${PHOTOS[key].src}" alt=""></div>`;
    }
    case 'roundsum': return headImg('s', 'peek-c1') + headImg('y', 'peek-c2');
    case 'podium': return headImg('s', 'hype l') + headImg('y', 'hype r');
    case 'table': return headImg('y', 'top');
    case 'awards': return headImg('s', 'corner a') + headImg('y', 'corner b');
    default: return '';
  }
}

/* ---------- экраны ---------- */
const head = q => `<div class="qhead"><span class="tag ${q.cat}"><i></i>${esc(q.label)}</span><span class="count">${QN()} из ${QT}</span></div>`;
const ringHtml = () => `<div class="ring"><svg viewBox="0 0 88 88"><circle class="bg" cx="44" cy="44" r="38"/><circle class="fg" id="ringfg" cx="44" cy="44" r="38" stroke-dasharray="${RC}" stroke-dashoffset="0"/></svg><b id="timer">${Math.round(limitMs(Q()) / 1000)}</b></div>`;
const answeredHtml = () => `<div class="answered"><b id="ans">${cur().length}</b>из ${players.length} ответили</div>`;
const rowsHtml = (list, val, off = 0) => `<ol class="rows">${list.map((p, i) => `<li><span class="pl">${i + 1 + off}</span><span>${esc(p.name)}</span><span class="d">${val(p).d || ''}</span><span class="sc">${val(p).s}</span></li>`).join('')}</ol>`;
const confetti = () => `<div class="confetti" aria-hidden="true">${Array.from({ length: 60 }, (_, i) => `<span style="left:${Math.random() * 100}%;background:${CONF[i % 4]};animation-delay:${(Math.random() * 1.4 + .5).toFixed(2)}s"></span>`).join('')}</div>`;

function optsHtml(q, rev) {
  const counts = q.options.map((_, i) => cur().filter(a => a.value === String(i)).length);
  return `<div class="opts n${q.options.length} ${isLong(q.options) ? 'long' : ''} ${rev ? 'rev' : ''}">${q.options.map((o, i) =>
    `<div class="opt ${rev ? (i === q.correct ? 'right' : 'wrong') : ''}">${badge(i)}<span>${esc(o)}</span>${rev ? `<span class="cnt">${counts[i]}</span>` : ''}</div>`).join('')}</div>`;
}
function frame(q, full) {
  const im = PHOTOS[full && q.imgA ? q.imgA : q.img];
  return `<div class="pframe ${im.ar > 1 ? 'land' : ''}" style="--ar:${im.ar};--ox:${q.ox};--oy:${q.oy};--z:${q.z};--t:${limitMs(q) / 1000}s"><img src="${im.src}" alt="" class="${full ? 'full' : (q.anim || '')}"></div>`;
}
function pcard(key, maxW = 380, maxH = 330) {
  const im = PHOTOS[key];
  const w = Math.min(maxW, maxH * im.ar);
  return `<div class="photocard" style="width:${Math.round(w)}px;height:${Math.round(w / im.ar)}px"><img src="${im.src}" alt=""></div>`;
}
const noteHtml = q => q.note ? `<p class="note">${esc(q.note)}</p>` : '';
const foot = (label, ghost = false, actName = 'next') => `<div class="foot"><button class="btn ${ghost ? 'ghost' : ''}" data-act="${actName}">${label}</button></div>`;

function viewQuestion(q) {
  const showAnswer = foot('Показать ответ', true, 'reveal');
  if (q.type === 'photo') {
    return `<div class="view">${head(q)}<div class="pbody">${frame(q, false)}<div class="pside"><h2 class="qtext">${esc(q.text)}</h2><div class="meta">${ringHtml()}${answeredHtml()}</div>${optsHtml(q, false)}</div></div>${showAnswer}</div>`;
  }
  if (q.type === 'text') {
    return `<div class="view">${head(q)}<div class="pbody">${frame(q, true)}<div class="pside"><h2 class="qtext">${esc(q.text)}</h2><div class="meta">${ringHtml()}${answeredHtml()}</div><div class="numbox"><b>Аа</b>Пишите ответ на телефоне</div></div></div>${showAnswer}</div>`;
  }
  if (q.type === 'num') {
    return `<div class="view">${head(q)}<div class="qrow"><div class="qleft"><h2 class="qtext">${esc(q.text)}</h2><div class="meta">${ringHtml()}${answeredHtml()}</div></div><div class="illcard">${questionIll(q)}</div></div>
      <div class="numbox"><b>123</b>Вводите число на телефоне. Чем ближе к правде, тем больше очков</div>${showAnswer}</div>`;
  }
  return `<div class="view">${head(q)}<div class="qrow${q.imgQ ? ' wide' : ''}"><div class="qleft"><h2 class="qtext ${q.text.length > 70 ? 'long' : ''}">${esc(q.text)}</h2><div class="meta">${ringHtml()}${answeredHtml()}</div></div>${q.imgQ ? pcard(q.imgQ) : `<div class="illcard">${questionIll(q)}</div>`}</div>
    ${optsHtml(q, false)}${showAnswer}</div>`;
}

function viewReveal(q) {
  const toBoard = foot('Таблица лидеров');
  if (q.type === 'photo') {
    return `<div class="view">${head(q)}<div class="pbody">${frame(q, true)}<div class="pside"><h2 class="qtext small">${esc(q.text)}</h2>${noteHtml(q)}${optsHtml(q, true)}</div></div>${toBoard}</div>`;
  }
  if (q.type === 'text') {
    return `<div class="view">${head(q)}<div class="pbody">${frame(q, true)}<div class="pside"><h2 class="qtext small">${esc(q.text)}</h2><div class="txtans">${esc(q.answerText)}</div>${noteHtml(q)}
      <ul class="wall">${cur().map(a => `<li class="${a.ok ? 'ok' : ''}"><b>${esc(nameOf(a.player_id))}:</b> ${esc(a.value)}</li>`).join('')}</ul></div></div>${toBoard}</div>`;
  }
  if (q.type === 'num') {
    const gs = cur().map(a => ({ name: nameOf(a.player_id), v: Number(a.value) })).filter(x => !Number.isNaN(x.v));
    const vals = gs.map(x => x.v).concat(q.answer);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = (hi - lo) * .06 || 5; lo -= pad; hi += pad;
    const pos = v => `${((v - lo) / (hi - lo) * 100).toFixed(2)}%`;
    const best = [...gs].sort((a, b) => Math.abs(a.v - q.answer) - Math.abs(b.v - q.answer)).slice(0, 3);
    return `<div class="view">${head(q)}<h2 class="qtext small" style="margin-top:18px">${esc(q.text)}</h2>
      <div class="numrow"><div class="numans"><b>${q.answer}</b><span>${esc(q.unit)}</span></div>${q.imgA ? pcard(q.imgA, 330, 170) : ''}</div>
      <div class="ruler"><div class="ln"></div><div class="truth" style="left:${pos(q.answer)}"></div>
        ${gs.map(x => `<div class="dot ${best.includes(x) ? 'top' : ''}" style="left:${pos(x.v)}"></div>`).join('')}
        ${best[0] ? `<div class="nm" style="left:${pos(best[0].v)}">${esc(best[0].name)}</div>` : ''}</div>
      <p class="closest">Ближе всех: ${best.map(x => `<b>${esc(x.name)}</b> (${x.v})`).join(', ') || 'никто не ответил'}</p>
      ${noteHtml(q)}<div class="foot" style="margin-top:auto"><button class="btn" data-act="next">Таблица лидеров</button></div></div>`;
  }
  return `<div class="view reveal">${head(q)}<div class="qrow${q.imgA ? ' wide' : ''}"><div class="qleft" style="justify-content:flex-start"><h2 class="qtext small">${esc(q.text)}</h2>${noteHtml(q)}</div>${q.imgA ? pcard(q.imgA) : `<div class="illcard">${ill(q.ill)}</div>`}</div>
    ${optsHtml(q, true)}${toBoard}</div>`;
}

function render() {
  const q = Q();
  const i = game.q_index;
  let html = '';
  switch (game.phase) {
    case 'lobby':
      html = `<div class="view"><div class="lobby">
          <div><div class="qr">${qrSvg}</div><p class="join">Наведите камеру телефона или откройте <b>${esc(location.host)}</b> и введите код <b class="code">${game.code}</b></p></div>
          <div><h2>${esc(TITLE)}</h2><p class="sub"><span id="pcount">0</span> в игре</p><ul class="chips" id="chips"></ul></div>
        </div>${foot('Начать игру')}</div>`;
      break;
    case 'intro':
      html = `<div class="view rcard"><div class="rnum" aria-hidden="true">${q.round}</div><div class="rlabel">Раунд ${q.round} из 3</div><h2 class="rtitle">${esc(q.title)}</h2><p class="rsub">${esc(q.sub)}</p>${foot('Начать раунд')}</div>`;
      break;
    case 'question': html = viewQuestion(q); break;
    case 'reveal': html = viewReveal(q); break;
    case 'board': {
      const roundOver = i >= QUESTIONS.length - 1 || QUESTIONS[i + 1].round;
      html = `<div class="view">${head(q)}<h2 class="htitle">Таблица лидеров</h2>
        <div class="board">${rowsHtml(ranked().slice(0, 5), p => { const a = ansOf(p.id, i); return { d: a && a.points ? `+${a.points}` : '', s: p.score }; })}</div>
        <div class="foot" style="margin-top:auto"><button class="btn" data-act="next">${roundOver ? 'Итоги раунда' : 'Следующий вопрос'}</button></div></div>`;
      break;
    }
    case 'roundsum': {
      const rs = roundStart(i), R = QUESTIONS[rs];
      const byRound = [...players].sort((a, b) => roundPts(b, rs, i) - roundPts(a, rs, i));
      const top = byRound[0];
      const last = i >= QUESTIONS.length - 1;
      html = `<div class="view"><div class="qhead"><span class="tag"><i></i>Раунд ${R.round} из 3</span><span class="count">${QN()} из ${QT}</span></div>
        <h2 class="htitle">Итоги раунда «${esc(R.title)}»</h2>
        <div class="sumgrid">
          <div><p class="colh">Лучший в раунде</p>
            ${top ? `<div class="hero"><b>${esc(top.name)}</b><span>${pts(roundPts(top, rs, i))} за раунд</span></div>` : ''}
            ${rowsHtml(byRound.slice(1, 4), p => ({ s: `+${roundPts(p, rs, i)}` }), 1)}</div>
          <div><p class="colh">Общий зачёт</p>${rowsHtml(ranked().slice(0, 5), p => ({ s: p.score }))}</div>
        </div>${foot(last ? 'Объявить победителей' : `Раунд ${R.round + 1}`)}</div>`;
      break;
    }
    case 'podium': {
      const r = ranked();
      html = `<div class="view"><h2 class="htitle">Победители</h2>
        <div class="pod">${[1, 0, 2].map(k => r[k] ? `<div class="step s${k + 1}"><div class="who">${esc(r[k].name)}</div><div class="pts">${pts(r[k].score)}</div><div class="blk">${k + 1}</div></div>` : '').join('')}</div>
        ${foot('Общая таблица')}</div>${confetti()}`;
      break;
    }
    case 'table':
      html = `<div class="view"><h2 class="htitle">Общая таблица</h2>
        <ol class="table">${ranked().map((p, k) => `<li><span class="pl">${k + 1}</span><span>${esc(p.name)}</span><span class="ok">${okCount(p)} из ${QT} верно</span><span class="sc">${p.score}</span></li>`).join('')}</ol>
        ${foot('Номинации')}</div>`;
      break;
    case 'awards':
      html = `<div class="view"><h2 class="htitle">Номинации</h2>
        <div class="awards">${awards().map((a, k) => `<div class="award ${a.feat ? 'feat' : ''}" style="animation-delay:${k * .15}s"><div class="t">${esc(a.t)}</div><div><div class="w">${esc(a.who)}</div><div class="s">${esc(a.stat)}</div></div></div>`).join('')}</div>
        <div class="foot"></div></div>`;
      break;
  }
  if (game.phase !== 'lobby') html = html.replace(/(<div class="foot"[^>]*>)/, '$1<button class="btn back" data-act="back">Назад</button>');
  tv.innerHTML = `<div class="lace top"></div>${html}${heads()}<div class="fx" id="fx"></div><div class="lace bottom"></div>`;
  if (game.phase === 'lobby') updateLobby();
}

function updateLobby() {
  const chips = document.getElementById('chips');
  if (!chips) return;
  chips.innerHTML = players.map(p => `<li>${esc(p.name)}</li>`).join('');
  document.getElementById('pcount').textContent = players.length;
}

/* ---------- управление ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || !game) return;
  if (b.dataset.act === 'next') next();
  if (b.dataset.act === 'reveal') reveal();
  if (b.dataset.act === 'back') back();
});
document.addEventListener('keydown', e => {
  if (!game) return;
  const k = e.key.toLowerCase();
  if (k === 'f' || k === 'а') document.documentElement.requestFullscreen?.();
  if (k === 'arrowleft' && game.phase !== 'lobby') back();
  if (k === 'arrowright' || k === ' ') { e.preventDefault(); game.phase === 'question' ? reveal() : game.phase !== 'awards' && next(); }
});

// Подстраховка: если realtime-соединение рвётся (VPN, фильтры), раз в 2 секунды сверяемся с базой сами
setInterval(async () => {
  if (!game || busy) return;
  if (game.phase === 'lobby') { await loadPlayers(); updateLobby(); return; }
  if (REACT_PHASES.includes(game.phase)) {
    const { data: rs } = await sb.from('reactions').select().eq('game_id', game.id).gt('created_at', lastReactTs).order('created_at');
    (rs || []).forEach(spawn);
    return;
  }
  if (game.phase !== 'question') return;
  const [, { data }] = await Promise.all([
    loadPlayers(),
    sb.from('answers').select().eq('game_id', game.id).eq('q_index', game.q_index),
  ]);
  (data || []).forEach(a => { if (!answers.some(x => x.id === a.id)) answers.push(a); });
  updateCount();
}, 2000);

init();
