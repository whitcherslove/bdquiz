import { sb } from './supabase.js';
import { QUESTIONS, QT } from './questions.js';
import { esc, badge, isLong, limitMs, pts, rightText, REACTIONS } from './shared.js';

const code = new URLSearchParams(location.search).get('g');
const app = document.getElementById('app');
const KEY = `bdquiz:${code}`;

let game = null;
let me = null;
let mine = {};        // q_index -> мой ответ
let standing = [];    // игроки по очкам
let roundBoard = [];  // игроки по очкам текущего раунда

const store = {
  get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: v => { try { localStorage.setItem(KEY, v); } catch { /* приватный режим */ } },
};
const show = (html, cls = '') => { app.className = `ph ${cls}`; app.innerHTML = html; };
const center = (big, title, text = '', extra = '') =>
  `<div class="center">${big !== '' ? `<div class="big">${big}</div>` : ''}<h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${extra}</div>`;
const Q = () => QUESTIONS[game.q_index];
const QN = () => QUESTIONS.slice(0, game.q_index + 1).filter(x => !x.round).length;
const rank = () => standing.findIndex(p => p.id === me.id) + 1;
const roundStart = i => { for (let k = i; k >= 0; k--) if (QUESTIONS[k].round) return k; return 0; };
const roundNo = () => QUESTIONS[roundStart(game.q_index)].round;
const rRank = () => roundBoard.findIndex(p => p.id === me.id) + 1;
const myRound = () => (roundBoard.find(p => p.id === me.id) || { rp: 0 }).rp;

/* ---------- данные ---------- */
async function init() {
  if (!code) return show(center('', 'Нет кода игры', 'Отсканируй QR-код с большого экрана.'));
  const { data, error } = await sb.from('games').select().eq('code', code).maybeSingle();
  if (error) return show(center('', 'Нет связи', 'Проверь интернет и обнови страницу.'));
  if (!data) return show(center('', 'Игра не найдена', 'Проверь QR-код на экране.'));
  game = data;
  const saved = store.get();
  if (saved) {
    const { data: p } = await sb.from('players').select().eq('id', saved).maybeSingle();
    if (p && p.game_id === game.id) me = p;
  }
  if (me) await refresh();
  subscribe();
  render();
}

async function join(name) {
  const { data, error } = await sb.from('players').insert({ game_id: game.id, name }).select().single();
  if (error) return false;
  me = data;
  store.set(me.id);
  await refresh();
  return true;
}

async function refresh() {
  const [p, list, ans] = await Promise.all([
    sb.from('players').select().eq('id', me.id).maybeSingle(),
    sb.from('players').select('id,name,score').eq('game_id', game.id).order('score', { ascending: false }),
    sb.from('answers').select('q_index,value,points,ok').eq('player_id', me.id),
  ]);
  if (p.data) me = p.data;
  standing = list.data || [];
  const rs = roundStart(game.q_index);
  if (QUESTIONS[rs].round > 1 || game.phase === 'roundsum') {
    const { data: ra } = await sb.from('answers').select('player_id,points').eq('game_id', game.id).gte('q_index', rs).lte('q_index', game.q_index);
    const sum = {};
    (ra || []).forEach(a => { sum[a.player_id] = (sum[a.player_id] || 0) + a.points; });
    roundBoard = standing.map(x => ({ ...x, rp: sum[x.id] || 0 })).sort((a, b) => b.rp - a.rp);
  } else roundBoard = [];
  mine = Object.fromEntries((ans.data || []).map(a => [a.q_index, a]));
}

function subscribe() {
  sb.channel(`play-${game.id}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${game.id}` }, async ({ new: g }) => {
      const changed = g.phase !== game.phase || g.q_index !== game.q_index;
      game = g;
      if (changed) await onChange();
    })
    .subscribe();

  // телефон уснул и проснулся — подтягиваем состояние
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !game) return;
    const { data } = await sb.from('games').select().eq('id', game.id).single();
    if (data) { game = data; await onChange(); }
  });
}

async function onChange() {
  if (me) await refresh();
  render();
}

async function answer(value) {
  const idx = game.q_index;
  if (game.phase !== 'question' || mine[idx]) return;
  mine[idx] = { value: String(value) };
  render();
  const { error } = await sb.from('answers').insert({ game_id: game.id, player_id: me.id, q_index: idx, value: String(value) });
  if (error && error.code !== '23505') {
    delete mine[idx];
    render();
    alert('Ответ не отправился, попробуй ещё раз');
  }
}

/* ---------- реакции ---------- */
let lastReact = 0;
const reactPanel = () => `<div class="react"><p>Отправь реакцию на большой экран</p>
  <div class="rgrid">${REACTIONS.slice(0, 6).map(k => `<button class="rbtn e" data-r="${k}">${k}</button>`).join('')}</div>
  <div class="rgrid words">${REACTIONS.slice(6).map(k => `<button class="rbtn" data-r="${k}">${k}</button>`).join('')}</div>
  <div class="rsent" id="rsent"></div></div>`;
async function react(kind) {
  if (Date.now() - lastReact < 1200) return;
  lastReact = Date.now();
  const el = document.getElementById('rsent');
  if (el) el.textContent = `Улетело на экран: ${kind}`;
  await sb.from('reactions').insert({ game_id: game.id, player_id: me.id, kind });
}

/* ---------- экраны ---------- */
function renderJoin() {
  show(`<h3 style="margin-top:16px">Привет! Как тебя зовут?</h3><p>Имя появится на большом экране.</p>
    <label for="nm">Имя</label><input id="nm" maxlength="20" autocomplete="off" placeholder="Например, Маша">
    <p class="err" id="err" hidden>Не получилось войти, попробуй ещё раз</p>
    <button class="pbtn" id="go" disabled>Войти в игру</button>`);
  const inp = document.getElementById('nm'), btn = document.getElementById('go'), err = document.getElementById('err');
  const go = async () => {
    const v = inp.value.trim();
    if (!v || btn.dataset.busy) return;
    btn.dataset.busy = '1'; btn.disabled = true;
    if (await join(v)) render();
    else { err.hidden = false; delete btn.dataset.busy; btn.disabled = false; }
  };
  inp.addEventListener('input', () => { btn.disabled = !inp.value.trim(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  btn.addEventListener('click', go);
}

function inputScreen(q, kind) {
  const meta = `<div class="ph-meta"><span>${esc(q.label)}</span><span>${QN()} из ${QT}</span></div>`;
  const input = kind === 'num'
    ? `<input id="val" type="number" inputmode="numeric" min="0" placeholder="0" aria-label="Твой ответ">`
    : `<input id="val" class="txt" type="text" maxlength="60" autocomplete="off" placeholder="Твой вариант" aria-label="Твой ответ">`;
  show(`${meta}<p class="ph-q">${esc(q.text)}</p><div class="ptimer"><i style="animation-duration:${limitMs(q) / 1000}s"></i></div>
    <div class="numin">${input}<button class="pbtn" id="send" disabled>Отправить</button></div>`);
  const inp = document.getElementById('val'), btn = document.getElementById('send');
  const send = () => {
    const v = inp.value.trim();
    if (!v) return;
    answer(kind === 'num' ? Math.max(0, Math.round(Number(v))) : v);
  };
  inp.addEventListener('input', () => { btn.disabled = !inp.value.trim(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  btn.addEventListener('click', send);
}

function renderQuestion(q) {
  const a = mine[game.q_index];
  if (!a) {
    if (q.type === 'num' || q.type === 'text') return inputScreen(q, q.type);
    const meta = `<div class="ph-meta"><span>${esc(q.label)}</span><span>${QN()} из ${QT}</span></div>`;
    return show(`${meta}<p class="ph-q">${esc(q.text)}</p><div class="ptimer"><i style="animation-duration:${limitMs(q) / 1000}s"></i></div>
      <div class="pgrid n${q.options.length} ${isLong(q.options) ? 'long' : ''}">${q.options.map((o, i) => `<button class="pans" data-i="${i}">${badge(i)}<span>${esc(o)}</span></button>`).join('')}</div>`);
  }
  if (q.type === 'num') return show(center(esc(a.value), 'Ответ принят', 'Ждём остальных…'));
  if (q.type === 'text') return show(center('', 'Ответ принят', `«${esc(a.value)}»`));
  show(`<div class="center">${badge(Number(a.value))}<h3>Ответ принят</h3><p>Ждём остальных…</p></div>`);
}

function renderReveal(q) {
  const a = mine[game.q_index];
  const place = roundNo() > 1 ? `<p>В раунде ты на ${rRank()} месте</p>` : `<p>Ты на ${rank()} месте</p>`;
  const right = esc(rightText(q));
  if (!a) return show(center('0', 'Время вышло', `Правильно: ${right}`, place));
  if (q.type === 'num') {
    return show(center(`+${a.points}`, a.points >= 800 ? 'Почти в точку!' : a.points > 0 ? 'Тепло' : 'Холодно', `Ты: ${esc(a.value)}. Правильно: ${right}`, place), a.points > 0 ? 'res-good' : 'res-bad');
  }
  if (a.ok) return show(center(`+${a.points}`, q.type === 'text' ? 'Засчитано!' : 'Верно!', q.type === 'text' ? `Правильно: ${right}` : '', place), 'res-good');
  show(center('0', 'Мимо', `Правильно: ${right}`, place), 'res-bad');
}

function render() {
  if (!game) return;
  if (!me) return renderJoin();
  const q = Q();
  switch (game.phase) {
    case 'lobby': return show(center('', `Ты в игре, ${esc(me.name)}!`, 'Смотри на большой экран, скоро начнём.'));
    case 'intro': return show(center(`${q.round}`, esc(q.title), 'Смотри на большой экран.') + reactPanel());
    case 'question': return renderQuestion(q);
    case 'reveal': return renderReveal(q);
    case 'board': {
      if (roundNo() > 1) {
        const k = rRank(), prev = roundBoard[k - 2];
        const gap = !prev ? 'Ты лидируешь в раунде!' : prev.rp === myRound() ? 'Плотная борьба: делишь место с соседом' : `${esc(prev.name)} впереди на ${pts(prev.rp - myRound())}`;
        return show(center(`${k}`, 'место в раунде', `${pts(myRound())} за раунд. ${gap}`));
      }
      const k = rank();
      const pr = standing[k - 2];
      const gap = !(k > 1 && pr) ? 'Ты лидируешь!' : pr.score === me.score ? 'Плотная борьба: делишь место с соседом' : `${esc(pr.name)} впереди на ${pts(pr.score - me.score)}`;
      return show(center(`${k}`, 'место', `${pts(me.score)}. ${gap}`));
    }
    case 'roundsum':
      return show(center(`${rRank()}`, 'место в раунде', `${pts(myRound())} за раунд`, `<p>В общем зачёте: ${rank()} место, ${pts(me.score)}</p>`) + reactPanel());
    default:
      return show(center(`${rank()}`, 'место в итоге', `${pts(me.score)}. Спасибо, что празднуешь с нами!`) + reactPanel());
  }
}

app.addEventListener('click', e => {
  const b = e.target.closest('.pans');
  if (b) answer(Number(b.dataset.i));
  const r = e.target.closest('.rbtn');
  if (r) react(r.dataset.r);
});

// Подстраховка: если realtime-соединение рвётся, раз в 2,5 секунды проверяем фазу игры сами
setInterval(async () => {
  if (!game) return;
  const { data } = await sb.from('games').select().eq('id', game.id).maybeSingle();
  if (data && (data.phase !== game.phase || data.q_index !== game.q_index)) {
    game = data;
    await onChange();
  }
}, 2500);

init();
