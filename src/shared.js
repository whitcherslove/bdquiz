import { TIME } from './questions.js';

export const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И'];
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const badge = i => `<span class="badge b${i % 4}">${LETTERS[i]}</span>`;
export const isLong = o => o.some(x => x.length > 30);
export const limitMs = Q => (Q.time || TIME) * 1000;

const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };
export const pts = n => `${n} ${plural(Math.abs(n), 'очко', 'очка', 'очков')}`;

const norm = v => String(v).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Свободный ответ засчитан, если в нём есть часть слова из accept или слово, похожее на fuzzy (до 2 опечаток)
export function textOk(Q, value) {
  const v = norm(value);
  if (Q.accept.some(a => v.includes(a))) return true;
  return v.split(' ').some(w => w.length >= 4 && (Q.fuzzy || []).some(f => lev(w, f) <= 2));
}

// Очки за ответ. ms — сколько прошло от старта вопроса (по часам сервера)
export function score(Q, value, ms) {
  const lim = limitMs(Q);
  if (ms > lim + 1500) return { points: 0, ok: false };
  const speed = Math.max(0, 1 - ms / lim);
  if (Q.type === 'num') {
    const points = Math.round(1000 * Math.max(0, 1 - Math.abs(Number(value) - Q.answer) / Q.range));
    return { points, ok: points >= 600 };
  }
  const ok = Q.type === 'text' ? textOk(Q, value) : Number(value) === Q.correct;
  return { points: ok ? Math.round(500 + 500 * speed) : 0, ok };
}

export const rightText = Q => Q.type === 'num' ? `${Q.answer} ${Q.unit}` : Q.type === 'text' ? Q.answerText : Q.options[Q.correct];

// Реакции между раундами: эмодзи и слова
export const REACTIONS = ['🔥', '😂', '🤯', '👏', '❤️', '🥂', 'База', 'Имба', 'Жиза', 'Вайб', 'Пушка', 'Душно'];
export const REACT_PHASES = ['intro', 'roundsum', 'podium', 'table', 'awards'];
