// game.js — Zetamac-clone "HEAT" pure logic core.
// Node-requireable + browser global. No DOM/audio/timers. Pure where computable.
// Binds to the BUILD CONTRACT §2/§4/§5-data. See contract for invariants.

'use strict';

var Game = {};

// ---------- small helpers ----------
function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
var MS_CAP = 60000;

// ---------- constants ----------
Game.HEAT_FULL_STREAK = 12;
Game.HEAT_PITCH_CAP = 24;

Game.THEMES = {
  heatwave: { name: 'Heatwave', level: 0 },
  dark:     { name: 'Dark',     level: 0 },
  paper:    { name: 'Paper',    level: 0 },
  contrast: { name: 'Contrast', level: 0 },
  solarized:{ name: 'Solarized',level: 3 },
  crt:      { name: 'CRT',      level: 5, classFlags: ['crt'] },
  seasonal: { name: 'Seasonal', level: 8 }
};

Game.FONTS = {
  speed:    { name: 'Speed',    stack: 'var(--font-body)', tabular: true },
  system:   { name: 'System',   stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', tabular: true },
  serif:    { name: 'Serif',    stack: 'Georgia, "Times New Roman", serif', tabular: true },
  mono:     { name: 'Mono',     stack: 'ui-monospace, "SF Mono", Consolas, monospace', tabular: true },
  rounded:  { name: 'Rounded',  stack: '"Nunito", "Segoe UI", system-ui, sans-serif', tabular: true },
  dyslexic: { name: 'Dyslexic', stack: '"Comic Sans MS", "Segoe UI", system-ui, sans-serif', tabular: true }
};

// ---------- canonical empty state ----------
Game.DEFAULTS = Object.freeze({
  v: 1,
  settings: {
    add: { on: true, a1: 2, a2: 100, b1: 2, b2: 100 },
    sub: { on: true },
    mul: { on: true, a1: 2, a2: 12, b1: 2, b2: 100 },
    div: { on: true },
    duration: 120
  },
  prefs: {
    themeId: 'heatwave',
    fontId: 'speed',
    muted: false,
    drillWeak: false,
    brainrot: { ambient: false, split: false, music: false, videoUrl: '', musicUrl: '' }
  },
  xp: 0,
  history: [],
  daily: {},
  weakness: {},
  streak: { current: 0, best: 0, lastPlayedDate: null, playedDates: [] }
});

// ===================================================================
// RNG & problem generation
// ===================================================================
function makeRng(seed) {
  var a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Game.makeRng = makeRng;

function rngInt(rng, lo, hi) {
  if (lo === hi) return lo;
  if (lo > hi) { var t = lo; lo = hi; hi = t; }
  return lo + Math.floor(rng() * (hi - lo + 1));
}
Game.rngInt = rngInt;

// fnv-1a style uint32 hash of a string. Also used as date->seed.
function hashStr(s) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function dailySeed(dateStr) { return hashStr('zc:' + dateStr); }
Game.dailySeed = dailySeed;

function factKey(op, a, b) {
  var lo = Math.min(a, b), hi = Math.max(a, b);
  return lo + op + hi; // op is '+' or 'x'
}
Game.factKey = factKey;

var OP_ALL = ['add', 'sub', 'mul', 'div'];

function pickOp(enabledOps, rng, weakness) {
  if (!enabledOps || !enabledOps.length) throw new Error('pickOp: enabledOps empty');
  if (enabledOps.length === 1) return enabledOps[0];
  var weights = [], total = 0, i;
  for (i = 0; i < enabledOps.length; i++) {
    var w = 1;
    if (weakness) {
      var agg = weakness[enabledOps[i]] || { correct: 0, wrong: 0 };
      // Laplace: (wrong+1)/(correct+1) — never NaN on fresh 0/0.
      w = (agg.wrong + 1) / (agg.correct + 1);
    }
    weights.push(w); total += w;
  }
  var r = rng() * total;
  for (i = 0; i < enabledOps.length; i++) {
    r -= weights[i];
    if (r < 0) return enabledOps[i];
  }
  return enabledOps[enabledOps.length - 1];
}
Game.pickOp = pickOp;

function enabledOpsOf(settings) {
  var ops = [];
  for (var i = 0; i < OP_ALL.length; i++) {
    var k = OP_ALL[i];
    if (settings[k] && settings[k].on) ops.push(k);
  }
  return ops;
}

function genProblem(settings, rng, weakness) {
  var ops = enabledOpsOf(settings);
  if (!ops.length) throw new Error('genProblem: no ops enabled');
  var op = pickOp(ops, rng, weakness || null);
  var addR = settings.add, mulR = settings.mul;
  var a, b, text, answer, fact;

  if (op === 'add') {
    a = rngInt(rng, addR.a1, addR.a2);
    b = rngInt(rng, addR.b1, addR.b2);
    answer = a + b;
    text = a + ' + ' + b;
    fact = factKey('+', a, b);
  } else if (op === 'sub') {
    // sub = add-in-reverse, non-negative. canonical pair = add-fact.
    var x = rngInt(rng, addR.a1, addR.a2);
    var y = rngInt(rng, addR.b1, addR.b2);
    var sum = x + y;
    a = sum; b = y; answer = x; // a - b = x, all non-negative
    text = a + ' − ' + b;
    fact = factKey('+', b, answer); // the add pair x+y
  } else if (op === 'mul') {
    a = rngInt(rng, mulR.a1, mulR.a2);
    b = rngInt(rng, mulR.b1, mulR.b2);
    answer = a * b;
    text = a + ' × ' + b;
    fact = factKey('x', a, b);
  } else { // div = mul-in-reverse, whole result, guard a===0 -> 1
    var m = rngInt(rng, mulR.a1, mulR.a2);
    var n = rngInt(rng, mulR.b1, mulR.b2);
    if (m === 0) m = 1;
    var prod = m * n;
    a = prod; b = m; answer = n; // a / b = n, whole
    text = a + ' ÷ ' + b;
    fact = factKey('x', b, answer); // the mul pair m*n
  }
  return { op: op, text: text, answer: answer, a: a, b: b, fact: fact };
}
Game.genProblem = genProblem;

function dailyProblems(dateStr, settings, n) {
  n = n || 200;
  var rng = makeRng(dailySeed(dateStr));
  var out = [];
  for (var i = 0; i < n; i++) out.push(genProblem(settings, rng, null));
  return out;
}
Game.dailyProblems = dailyProblems;

// ===================================================================
// XP / level / themes
// ===================================================================
function cumXpForLevel(level) { return 50 * level * (level - 1); }
Game.cumXpForLevel = cumXpForLevel;

function levelForXp(xp) {
  if (!(xp >= 0)) xp = 0;
  var level = 1;
  while (cumXpForLevel(level + 1) <= xp) level++;
  var start = cumXpForLevel(level);
  var span = cumXpForLevel(level + 1) - start;
  var into = xp - start;
  return { level: level, into: into, span: span, need: span - into };
}
Game.levelForXp = levelForXp;
Game.levelFromXp = function (xp) { return levelForXp(xp).level; };

function xpForRun(record) {
  var correct = record.correct || 0, wrong = record.wrong || 0;
  if (correct <= 0) return 0;
  var acc = clamp(correct / Math.max(1, correct + wrong), 0, 1);
  return Math.round(correct * 10 * (0.5 + 0.5 * acc));
}
Game.xpForRun = xpForRun;

function isThemeUnlocked(themeId, xp) {
  var t = Game.THEMES[themeId];
  if (!t) return false;
  return levelForXp(xp).level >= t.level;
}
Game.isThemeUnlocked = isThemeUnlocked;

function resolveTheme(themeId, xp) {
  if (Game.THEMES[themeId] && isThemeUnlocked(themeId, xp)) return themeId;
  return 'heatwave';
}
Game.resolveTheme = resolveTheme;

function resolveFont(fontId) { return Game.FONTS[fontId] ? fontId : 'speed'; }
Game.resolveFont = resolveFont;

function themesForLevel(level) {
  var out = [];
  for (var id in Game.THEMES) {
    if (!Game.THEMES.hasOwnProperty(id)) continue;
    var t = Game.THEMES[id];
    if (t.level <= level) out.push({ id: id, name: t.name, level: t.level });
  }
  out.sort(function (a, b) { return a.level - b.level || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
  return out;
}
Game.themesForLevel = themesForLevel;

// ===================================================================
// Weakness
// ===================================================================
function recordFact(weakness, key, ms, missed) {
  if (!isFinite(ms)) return weakness;
  ms = clamp(ms, 0, MS_CAP);
  var t = weakness[key] || [0, 0, 0];
  weakness[key] = [t[0] + 1, t[1] + ms, t[2] + (missed ? 1 : 0)];
  return weakness;
}
Game.recordFact = recordFact;

function topWeakFacts(weakness, n, minAttempts) {
  n = n || 2; minAttempts = minAttempts == null ? 3 : minAttempts;
  var arr = [];
  for (var key in weakness) {
    if (!weakness.hasOwnProperty(key)) continue;
    var t = weakness[key], cnt = t[0], sumMs = t[1], miss = t[2];
    if (cnt < minAttempts) continue;
    var avgMs = sumMs / cnt;
    var score = avgMs * (1 + miss / cnt * 3);
    arr.push({ key: key, avgMs: avgMs, misses: miss, n: cnt, _score: score });
  }
  arr.sort(function (a, b) { return b._score - a._score; });
  return arr.slice(0, n).map(function (o) { return { key: o.key, avgMs: o.avgMs, misses: o.misses, n: o.n }; });
}
Game.topWeakFacts = topWeakFacts;

function prettyFact(key) { return key.replace('x', '×'); }
Game.prettyFact = prettyFact;

// ===================================================================
// Streak / grid / daily
// ===================================================================
function localDateStr(epochMs) {
  var d = new Date(epochMs);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
Game.localDateStr = localDateStr;
Game.todayStr = function () { return localDateStr(Date.now()); };

// parse "YYYY-MM-DD" into local Date at midnight
function parseDate(s) {
  var p = s.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
function shiftDateStr(s, days) {
  var d = parseDate(s);
  d.setDate(d.getDate() + days); // DST-safe
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function updateStreak(streak, todayStr) {
  var last = streak.lastPlayedDate;
  if (last === todayStr) {
    // idempotent re-play of same day
  } else if (last && shiftDateStr(last, 1) === todayStr) {
    streak.current = streak.current + 1;
  } else {
    streak.current = 1;
  }
  streak.lastPlayedDate = todayStr;
  if (streak.current > streak.best) streak.best = streak.current;
  if (streak.playedDates.indexOf(todayStr) === -1) {
    streak.playedDates.push(todayStr);
    if (streak.playedDates.length > 400) streak.playedDates = streak.playedDates.slice(-400);
  }
  return streak;
}
Game.updateStreak = updateStreak;

function computeStreak(playedDates, todayStr) {
  if (!playedDates || !playedDates.length) return { current: 0, longest: 0, playedToday: false };
  var set = {};
  for (var i = 0; i < playedDates.length; i++) set[playedDates[i]] = true;
  var playedToday = !!set[todayStr];

  // current: run back from today, or from yesterday (grace) if today not played.
  var current = 0;
  var cursor = playedToday ? todayStr : shiftDateStr(todayStr, -1);
  while (set[cursor]) { current++; cursor = shiftDateStr(cursor, -1); }

  // longest: max consecutive run over the sorted set.
  var keys = Object.keys(set).sort();
  var longest = 0, run = 0, prev = null;
  for (i = 0; i < keys.length; i++) {
    if (prev && shiftDateStr(prev, 1) === keys[i]) run++;
    else run = 1;
    if (run > longest) longest = run;
    prev = keys[i];
  }
  return { current: current, longest: longest, playedToday: playedToday };
}
Game.computeStreak = computeStreak;

function streakWarning(current, playedToday) {
  if (playedToday) return '🔥 ' + current + '-day streak — locked in for today.';
  if (current > 0) return "Play today or you'll lose your " + current + '-day streak.';
  return 'Start a streak today.';
}
Game.streakWarning = streakWarning;

function buildGrid(playedDates, todayStr, weeks) {
  weeks = weeks || 26;
  var counts = {};
  for (var i = 0; i < (playedDates || []).length; i++) {
    counts[playedDates[i]] = (counts[playedDates[i]] || 0) + 1;
  }
  // end on today's week (Sat). today's day-of-week:
  var todayDow = parseDate(todayStr).getDay(); // 0 Sun..6 Sat
  var lastCol = shiftDateStr(todayStr, 6 - todayDow); // Saturday of this week
  var start = shiftDateStr(lastCol, -(weeks * 7 - 1)); // first Sunday
  var cells = [], monthLabels = [];
  var cur = start, lastMonth = -1;
  for (var col = 0; col < weeks; col++) {
    for (var row = 0; row < 7; row++) {
      var d = parseDate(cur);
      var m = d.getMonth();
      if (row === 0 && m !== lastMonth) {
        monthLabels.push({ col: col, label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m] });
        lastMonth = m;
      }
      cells.push({ date: cur, count: counts[cur] || 0, col: col, row: row });
      cur = shiftDateStr(cur, 1);
    }
  }
  return { cells: cells, monthLabels: monthLabels };
}
Game.buildGrid = buildGrid;

function calBucket(count) { return count <= 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : 3; }

function buildCalendarSVG(grid) {
  var sz = 11, gap = 2, pad = 4, topPad = 14;
  var weeks = 0, j;
  for (j = 0; j < grid.cells.length; j++) if (grid.cells[j].col + 1 > weeks) weeks = grid.cells[j].col + 1;
  var w = pad * 2 + weeks * (sz + gap);
  var h = topPad + pad + 7 * (sz + gap);
  var parts = ['<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '" xmlns="http://www.w3.org/2000/svg">'];
  for (j = 0; j < grid.monthLabels.length; j++) {
    var ml = grid.monthLabels[j];
    var mx = pad + ml.col * (sz + gap);
    parts.push('<text x="' + mx + '" y="10" font-size="9" fill="var(--muted)">' + ml.label + '</text>');
  }
  for (j = 0; j < grid.cells.length; j++) {
    var c = grid.cells[j];
    var x = pad + c.col * (sz + gap);
    var y = topPad + c.row * (sz + gap);
    parts.push('<rect x="' + x + '" y="' + y + '" width="' + sz + '" height="' + sz +
      '" rx="2" fill="var(--cal-' + calBucket(c.count) + ')"><title>' +
      c.date + ': ' + c.count + (c.count === 1 ? ' run' : ' runs') + '</title></rect>');
  }
  parts.push('</svg>');
  return parts.join('');
}
Game.buildCalendarSVG = buildCalendarSVG;

// ===================================================================
// Pace / run stats / history
// ===================================================================
function settingsHash(cfg) {
  var a = cfg.add || {}, m = cfg.mul || {};
  // ponytail: hash just needs stable+unique per config; letters internal, modeKey owns display.
  var ops = [];
  if (cfg.add && cfg.add.on) ops.push('a');
  if (cfg.sub && cfg.sub.on) ops.push('s');
  if (cfg.mul && cfg.mul.on) ops.push('m');
  if (cfg.div && cfg.div.on) ops.push('v');
  ops.sort();
  return ops.join('') + '|a' + String(a.a1) + '-' + String(a.a2) + '+' + String(a.b1) + '-' + String(a.b2) +
    '|m' + String(m.a1) + '-' + String(m.a2) + 'x' + String(m.b1) + '-' + String(m.b2) +
    '|t' + String(cfg.duration);
}
Game.settingsHash = settingsHash;

function modeKey(ops) {
  // {add,sub,mul,div} booleans -> sorted op letters
  var letters = [];
  if (ops.add) letters.push('a');
  if (ops.div) letters.push('d');
  if (ops.mul) letters.push('m');
  if (ops.sub) letters.push('s');
  letters.sort();
  return letters.join('');
}
Game.modeKey = modeKey;

function modeLabel(ops) {
  var on = [];
  if (ops.add) on.push('add');
  if (ops.sub) on.push('sub');
  if (ops.mul) on.push('mul');
  if (ops.div) on.push('div');
  if (on.length === 4) return 'All Ops';
  var glyph = { add: '+', sub: '−', mul: '×', div: '÷' };
  if (on.length === 1) {
    var word = { add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division' };
    return word[on[0]];
  }
  return on.map(function (k) { return glyph[k]; }).join(' ');
}
Game.modeLabel = modeLabel;

function projectScore(curScore, elapsedSec, durSec) {
  if (elapsedSec <= 0) return 0;
  return Math.round(curScore * durSec / Math.min(elapsedSec, durSec));
}
Game.projectScore = projectScore;

function personalBest(history, hash) {
  var best = null;
  for (var i = 0; i < history.length; i++) {
    if (history[i].hash === hash) {
      if (best === null || history[i].score > best) best = history[i].score;
    }
  }
  return best;
}
Game.personalBest = personalBest;

function round1(x) { return Math.round(x * 10) / 10; }

function runStats(history) {
  var count = history.length;
  if (!count) return { count: 0, avg: 0, pb: null, best: null, ppm: null };
  var sum = 0, best = -Infinity, ppmSum = 0;
  for (var i = 0; i < count; i++) {
    var r = history[i];
    sum += r.score;
    if (r.score > best) best = r.score;
    var mins = (r.durationS || 0) / 60;
    ppmSum += mins > 0 ? r.score / mins : 0;
  }
  return { count: count, avg: round1(sum / count), pb: best, best: best, ppm: round1(ppmSum / count) };
}
Game.runStats = runStats;

function scoreToY(score, maxScore, h, pad) {
  if (maxScore <= 0) return h - pad;
  return pad + (1 - score / maxScore) * (h - 2 * pad);
}
Game.scoreToY = scoreToY;

var SVG_NS = 'http://www.w3.org/2000/svg';

function buildTrendSvg(runs, opts) {
  opts = opts || {};
  var w = opts.w || 280, h = opts.h || 70, pad = opts.pad || 8;
  var doc = (typeof document !== 'undefined') ? document : null;
  if (!doc) { // node fallback — won't run in tests of DOM, but stay safe
    throw new Error('buildTrendSvg requires DOM');
  }
  var svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('width', w); svg.setAttribute('height', h);

  var sorted = runs.slice().sort(function (a, b) { return a.ts - b.ts; });
  if (sorted.length === 0) return svg;

  var max = -Infinity, min = Infinity;
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i].score > max) max = sorted[i].score;
    if (sorted[i].score < min) min = sorted[i].score;
  }
  var flat = (min === max);
  function xAt(idx) {
    if (sorted.length <= 1) return w / 2;
    return pad + idx * (w - 2 * pad) / (sorted.length - 1);
  }
  function yAt(score) {
    if (flat) return h / 2;
    return scoreToY(score, max, h, pad);
  }

  if (opts.pb != null && !flat && max > 0) {
    var pbLine = doc.createElementNS(SVG_NS, 'line');
    var py = scoreToY(opts.pb, max, h, pad);
    pbLine.setAttribute('x1', pad); pbLine.setAttribute('x2', w - pad);
    pbLine.setAttribute('y1', py); pbLine.setAttribute('y2', py);
    pbLine.setAttribute('stroke', 'var(--ahead)');
    pbLine.setAttribute('stroke-dasharray', '3 3');
    pbLine.setAttribute('stroke-width', '1');
    svg.appendChild(pbLine);
  }

  if (sorted.length <= 1) {
    var c0 = doc.createElementNS(SVG_NS, 'circle');
    c0.setAttribute('cx', xAt(0)); c0.setAttribute('cy', yAt(sorted[0].score));
    c0.setAttribute('r', '3'); c0.setAttribute('fill', 'var(--accent)');
    svg.appendChild(c0);
    var lbl = doc.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', w / 2); lbl.setAttribute('y', h - 2);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('font-size', '9'); lbl.setAttribute('fill', 'var(--muted)');
    lbl.textContent = 'one run';
    svg.appendChild(lbl);
    return svg;
  }

  var pts = [];
  for (i = 0; i < sorted.length; i++) pts.push(xAt(i) + ',' + yAt(sorted[i].score));
  var poly = doc.createElementNS(SVG_NS, 'polyline');
  poly.setAttribute('points', pts.join(' '));
  poly.setAttribute('fill', 'none');
  poly.setAttribute('stroke', 'var(--accent)');
  poly.setAttribute('stroke-width', '2');
  svg.appendChild(poly);

  var last = doc.createElementNS(SVG_NS, 'circle');
  last.setAttribute('cx', xAt(sorted.length - 1));
  last.setAttribute('cy', yAt(sorted[sorted.length - 1].score));
  last.setAttribute('r', '3'); last.setAttribute('fill', 'var(--accent-hot)');
  svg.appendChild(last);
  return svg;
}
Game.buildTrendSvg = buildTrendSvg;

// ===================================================================
// Run commit & stats accumulation
// ===================================================================
function newRunStats() {
  return {
    score: 0, correct: 0, wrong: 0,
    perOp: {
      add: { c: 0, w: 0, sumMs: 0 }, sub: { c: 0, w: 0, sumMs: 0 },
      mul: { c: 0, w: 0, sumMs: 0 }, div: { c: 0, w: 0, sumMs: 0 }
    },
    fastestMs: Infinity, slowestMs: 0
  };
}
Game.newRunStats = newRunStats;

function recordAnswer(rs, op, correct, elapsedMs) {
  var ms = isFinite(elapsedMs) ? clamp(elapsedMs, 0, MS_CAP) : 0;
  var po = rs.perOp[op];
  if (correct) { rs.score++; rs.correct++; if (po) po.c++; }
  else { rs.wrong++; if (po) po.w++; }
  if (po) po.sumMs += ms;
  if (ms < rs.fastestMs) rs.fastestMs = ms;
  if (ms > rs.slowestMs) rs.slowestMs = ms;
  return rs;
}
Game.recordAnswer = recordAnswer;

function finalizeRun(state, rs, meta) {
  var now = meta.now;
  var record = {
    ts: now,
    score: rs.score, correct: rs.correct, wrong: rs.wrong,
    durationS: meta.durationS,
    mode: meta.mode,
    hash: meta.hash,
    daily: !!meta.daily,
    seed: meta.seed != null ? meta.seed : null,
    perOp: {
      add: { c: rs.perOp.add.c, w: rs.perOp.add.w, sumMs: rs.perOp.add.sumMs },
      sub: { c: rs.perOp.sub.c, w: rs.perOp.sub.w, sumMs: rs.perOp.sub.sumMs },
      mul: { c: rs.perOp.mul.c, w: rs.perOp.mul.w, sumMs: rs.perOp.mul.sumMs },
      div: { c: rs.perOp.div.c, w: rs.perOp.div.w, sumMs: rs.perOp.div.sumMs }
    },
    fastestMs: isFinite(rs.fastestMs) ? rs.fastestMs : 0,
    slowestMs: rs.slowestMs
  };

  state.history.push(record);
  if (state.history.length > 200) state.history = state.history.slice(-200);

  var before = levelForXp(state.xp).level;
  var xpGained = xpForRun(record);
  state.xp += xpGained;
  var newLevel = levelForXp(state.xp).level;
  var leveledUp = newLevel > before;

  var today = localDateStr(now);
  updateStreak(state.streak, today);

  if (meta.daily && !state.daily[today]) {
    state.daily[today] = {
      seed: meta.seed != null ? meta.seed : null,
      score: rs.score, correct: rs.correct, durationS: meta.durationS, ts: now
    };
  }

  return { state: state, record: record, xpGained: xpGained, leveledUp: leveledUp, newLevel: newLevel };
}
Game.finalizeRun = finalizeRun;

// ===================================================================
// Share string
// ===================================================================
function sparkline(values) {
  if (!values || !values.length) return '';
  var bars = '▁▂▃▄▅▆▇█';
  var v = values.slice(-10);
  var min = Infinity, max = -Infinity;
  for (var i = 0; i < v.length; i++) { if (v[i] < min) min = v[i]; if (v[i] > max) max = v[i]; }
  if (min === max) {
    var mid = bars[Math.floor((bars.length - 1) / 2)];
    return v.map(function () { return mid; }).join('');
  }
  return v.map(function (x) {
    var idx = Math.round((x - min) / (max - min) * (bars.length - 1));
    return bars[idx];
  }).join('');
}
Game.sparkline = sparkline;

function shareString(record, recentScores, level) {
  var total = record.correct + record.wrong;
  var pct = total > 0 ? Math.round(record.correct / total * 100) : 0;
  var ops = {
    add: record.mode.indexOf('a') !== -1,
    sub: record.mode.indexOf('s') !== -1,
    mul: record.mode.indexOf('m') !== -1,
    div: record.mode.indexOf('d') !== -1
  };
  var line1 = 'Arithmetic 🔥 Lv ' + level;
  var line2 = modeLabel(ops) + ' · ' + record.durationS + 's · ' + localDateStr(record.ts);
  var line3 = 'Score: ' + record.score + ' (' + pct + '%)';
  var line4 = sparkline(recentScores);
  return [line1, line2, line3, line4].join('\n');
}
Game.shareString = shareString;

// ===================================================================
// Persistence (impure — only IO)
// ===================================================================
var KEY = 'zc:v1';

function deepMerge(target, src) {
  for (var k in src) {
    if (!src.hasOwnProperty(k)) continue;
    var sv = src[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      deepMerge(target[k], sv);
    } else {
      target[k] = sv;
    }
  }
  return target;
}

function migrate(raw) {
  if (!raw || typeof raw !== 'object') return clone(Game.DEFAULTS);
  if (raw.v === 1) return raw;
  // ponytail: only v1 exists; future bumps add cases here, increment v.
  return clone(Game.DEFAULTS);
}

function load(storage) {
  if (storage === undefined) storage = (typeof localStorage !== 'undefined') ? localStorage : null;
  var base = clone(Game.DEFAULTS);
  if (!storage || typeof storage.getItem !== 'function') return base;
  try {
    var raw = storage.getItem(KEY);
    if (!raw) return base;
    var parsed = JSON.parse(raw);
    parsed = migrate(parsed);
    return deepMerge(base, parsed);
  } catch (e) {
    return base;
  }
}

function save(state, storage) {
  if (storage === undefined) storage = (typeof localStorage !== 'undefined') ? localStorage : null;
  if (!storage || typeof storage.setItem !== 'function') return false;
  try {
    storage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

Game.Store = { KEY: KEY, load: load, save: save, migrate: migrate };

// ---------- export shim ----------
if (typeof module !== 'undefined' && module.exports) module.exports = Game;
else { var g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this); g.Game = Game; }
