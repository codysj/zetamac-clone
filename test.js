// test.js — Node assert suite for game.js. Run: `node test.js`. Exit non-zero on any failure.
// ponytail: hand-rolled runner, no framework — asserts + a pass/fail tally is all this needs.
'use strict';
const assert = require('assert');
const Game = require('./game.js');

let pass = 0, fail = 0;
const fails = [];
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; fails.push(name + '  →  ' + (e && e.message ? e.message : e)); }
}
const close = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

// ---------- RNG / gen ----------
test('makeRng determinism + divergence', () => {
  const r1 = Game.makeRng(42), r2 = Game.makeRng(42), r3 = Game.makeRng(43);
  const a = [r1(), r1(), r1(), r1(), r1()];
  const b = [r2(), r2(), r2(), r2(), r2()];
  assert.deepStrictEqual(a, b, 'same seed must reproduce stream');
  assert.notStrictEqual(a[0], r3(), 'seed 43 should differ from 42');
  a.forEach(x => assert.ok(x >= 0 && x < 1, 'mulberry32 output in [0,1)'));
});

test('rngInt inclusive + degenerate', () => {
  assert.strictEqual(Game.rngInt(Game.makeRng(1), 5, 5), 5);
  const r = Game.makeRng(7);
  for (let i = 0; i < 5000; i++) {
    const v = Game.rngInt(r, 1, 6);
    assert.ok(v >= 1 && v <= 6 && Number.isInteger(v), 'rngInt range [1,6]');
  }
});

test('dailySeed stable + per-date', () => {
  assert.strictEqual(Game.dailySeed('2026-06-25'), Game.dailySeed('2026-06-25'));
  assert.notStrictEqual(Game.dailySeed('2026-06-25'), Game.dailySeed('2026-06-26'));
  assert.ok(Number.isInteger(Game.dailySeed('2026-06-25')) && Game.dailySeed('2026-06-25') >= 0);
});

test('factKey commutative collapse + ASCII', () => {
  assert.strictEqual(Game.factKey('x', 8, 7), '7x8');
  assert.strictEqual(Game.factKey('x', 7, 8), '7x8');
  assert.strictEqual(Game.factKey('+', 9, 2), '2+9');
  assert.ok(!Game.factKey('x', 8, 7).includes('×'), 'must use ASCII x');
});

test('prettyFact display glyphs', () => {
  assert.strictEqual(Game.prettyFact('7x8'), '7×8');
  assert.strictEqual(Game.prettyFact('2+9'), '2+9');
});

const cfgAll = {
  add: { on: true, a1: 2, a2: 100, b1: 2, b2: 100 },
  sub: { on: true },
  mul: { on: true, a1: 2, a2: 12, b1: 2, b2: 100 },
  div: { on: true },
  duration: 120
};

test('genProblem div whole + non-negative', () => {
  const cfg = { add: { on: false }, sub: { on: false }, mul: { on: false },
    div: { on: true, a1: 2, a2: 12, b1: 2, b2: 100 }, duration: 120 };
  // div reuses mul ranges per contract — supply mul ranges too
  const cfg2 = { add: { on: false }, sub: { on: false },
    mul: { on: false, a1: 2, a2: 12, b1: 2, b2: 100 },
    div: { on: true }, duration: 120 };
  const r = Game.makeRng(99);
  for (let i = 0; i < 300; i++) {
    const p = Game.genProblem(cfg2, r);
    assert.strictEqual(p.op, 'div');
    assert.ok(Number.isInteger(p.answer) && p.answer >= 0, 'div answer whole >=0');
    assert.ok(p.text.includes('÷'), 'div text has ÷');
  }
});

test('genProblem sub never negative', () => {
  const cfg = { add: { on: false, a1: 2, a2: 100, b1: 2, b2: 100 }, sub: { on: true },
    mul: { on: false }, div: { on: false }, duration: 120 };
  const r = Game.makeRng(11);
  for (let i = 0; i < 300; i++) {
    const p = Game.genProblem(cfg, r);
    assert.strictEqual(p.op, 'sub');
    assert.ok(p.answer >= 0 && Number.isInteger(p.answer), 'sub answer >=0');
    assert.ok(p.text.includes('−'), 'sub text has minus glyph');
  }
});

test('genProblem fact uses canonical add/mul pair', () => {
  const subCfg = { add: { on: false, a1: 2, a2: 100, b1: 2, b2: 100 }, sub: { on: true },
    mul: { on: false }, div: { on: false }, duration: 120 };
  const p = Game.genProblem(subCfg, Game.makeRng(5));
  assert.ok(/^\d+\+\d+$/.test(p.fact), 'sub fact is an add-key: ' + p.fact);
});

test('dailyProblems deterministic + valid answers', () => {
  const a = Game.dailyProblems('2026-06-25', cfgAll);
  const b = Game.dailyProblems('2026-06-25', cfgAll);
  assert.deepStrictEqual(a, b, 'same date same problem sequence');
  a.forEach(p => assert.ok(Number.isInteger(p.answer) && p.answer >= 0, 'all answers int >=0'));
  const c = Game.dailyProblems('2026-06-26', cfgAll);
  assert.notDeepStrictEqual(a, c, 'different date should differ');
});

test('pickOp uniform / weighted / fresh-no-NaN / empty-throws', () => {
  const r = Game.makeRng(3);
  const counts = { add: 0, mul: 0 };
  for (let i = 0; i < 4000; i++) counts[Game.pickOp(['add', 'mul'], r)]++;
  assert.ok(close(counts.add / 4000, 0.5, 0.06), 'uniform ~50/50: ' + JSON.stringify(counts));

  // weighted: mul has many wrongs → should appear more
  const weak = { mul: { c: 1, w: 50 }, add: { c: 50, w: 1 } };
  const wc = { add: 0, mul: 0 };
  const r2 = Game.makeRng(8);
  for (let i = 0; i < 4000; i++) wc[Game.pickOp(['add', 'mul'], r2, weak)]++;
  assert.ok(wc.mul > wc.add, 'high-wrong op shows more: ' + JSON.stringify(wc));

  // fresh 0/0 weakness — no NaN, stays in set
  const fresh = {};
  const r3 = Game.makeRng(2);
  for (let i = 0; i < 100; i++) {
    const op = Game.pickOp(['add', 'mul'], r3, fresh);
    assert.ok(op === 'add' || op === 'mul', 'fresh weakness stays in set, got ' + op);
  }
  assert.throws(() => Game.pickOp([], Game.makeRng(1)), 'empty ops throws');
});

// ---------- XP / level / themes ----------
test('cumXpForLevel anchors', () => {
  assert.strictEqual(Game.cumXpForLevel(1), 0);
  assert.strictEqual(Game.cumXpForLevel(2), 100);
  assert.strictEqual(Game.cumXpForLevel(3), 300);
  assert.strictEqual(Game.cumXpForLevel(4), 600);
});

test('levelForXp inverse + invariants', () => {
  assert.deepStrictEqual(Game.levelForXp(0), { level: 1, into: 0, span: 100, need: 100 });
  const l99 = Game.levelForXp(99);
  assert.strictEqual(l99.level, 1);
  assert.strictEqual(l99.need, 1);
  const l100 = Game.levelForXp(100);
  assert.strictEqual(l100.level, 2);
  assert.strictEqual(l100.into, 0);
  assert.strictEqual(Game.levelForXp(0).level, 1, 'level starts at 1');

  let prevLevel = 0;
  for (let xp = 0; xp <= 10000; xp += 50) {
    const r = Game.levelForXp(xp);
    assert.ok(r.level >= prevLevel, 'level monotonic non-decreasing');
    prevLevel = r.level;
    assert.ok(r.into >= 0 && r.need > 0 && r.span > 0, 'into>=0, need>0, span>0 (xp=' + xp + ')');
    // Real invariant: xp sits within its level's cumulative bracket. The old
    // `into<need` check is mathematically impossible for the curve 50*L*(L-1).
    assert.ok(Game.cumXpForLevel(r.level) <= xp && xp < Game.cumXpForLevel(r.level + 1),
      'xp within level bracket (xp=' + xp + ')');
    assert.strictEqual(r.into + r.need, r.span, 'into+need===span');
  }
});

test('xpForRun curve', () => {
  assert.strictEqual(Game.xpForRun({ correct: 0, wrong: 0 }), 0);
  assert.strictEqual(Game.xpForRun({ correct: 10, wrong: 0 }), 100);
  assert.strictEqual(Game.xpForRun({ correct: 10, wrong: 10 }), 75);
  assert.ok(Number.isFinite(Game.xpForRun({ correct: 0, wrong: 0 })), 'no NaN on 0/0');
  assert.ok(Game.xpForRun({ correct: 11, wrong: 0 }) > Game.xpForRun({ correct: 10, wrong: 0 }),
    'more correct => strictly more xp');
});

test('isThemeUnlocked / resolveTheme / resolveFont', () => {
  // level-0 themes unlocked at xp 0
  Object.keys(Game.THEMES).forEach(id => {
    if (Game.THEMES[id].level === 0) assert.ok(Game.isThemeUnlocked(id, 0), id + ' lvl0 unlocked at 0');
  });
  assert.ok(!Game.isThemeUnlocked('solarized', 0), 'solarized locked at 0');
  assert.ok(!Game.isThemeUnlocked('crt', 0), 'crt locked at 0');
  assert.ok(!Game.isThemeUnlocked('seasonal', 0), 'seasonal locked at 0');
  // unlocked at xp clearly past their level
  const big = Game.cumXpForLevel(20);
  assert.ok(Game.isThemeUnlocked('solarized', big));
  assert.ok(Game.isThemeUnlocked('crt', big));
  assert.ok(Game.isThemeUnlocked('seasonal', big));
  assert.ok(!Game.isThemeUnlocked('nope', big), 'unknown id => false');

  assert.strictEqual(Game.resolveTheme('nope', big), 'heatwave');
  assert.strictEqual(Game.resolveTheme('crt', 0), 'heatwave', 'locked => heatwave');
  assert.strictEqual(Game.resolveTheme('crt', big), 'crt', 'unlocked => itself');
  assert.strictEqual(Game.resolveFont('speed'), 'speed');
  assert.strictEqual(Game.resolveFont('nope'), 'speed');
});

test('themesForLevel filter/sort/no-dupes', () => {
  const t1 = Game.themesForLevel(1);
  t1.forEach(t => assert.ok(t.level <= 1, 'only level<=1'));
  const ids1 = t1.map(t => t.id);
  assert.strictEqual(new Set(ids1).size, ids1.length, 'no dupes');
  const t10 = Game.themesForLevel(10);
  assert.ok(t10.length >= t1.length, 'higher level >= more themes');
  // sorted by level then name
  for (let i = 1; i < t10.length; i++) {
    const a = t10[i - 1], b = t10[i];
    assert.ok(a.level < b.level || (a.level === b.level && a.name <= b.name), 'sorted level then name');
  }
});

test('THEMES / FONTS integrity', () => {
  Object.keys(Game.THEMES).forEach(id => {
    const t = Game.THEMES[id];
    assert.strictEqual(typeof t.name, 'string', id + '.name string');
    assert.ok(typeof t.level === 'number' && t.level >= 0, id + '.level number>=0');
  });
  assert.strictEqual(Game.THEMES.heatwave.level, 0, 'heatwave is level 0 default');
  Object.keys(Game.FONTS).forEach(id => {
    assert.ok(typeof Game.FONTS[id].stack === 'string' && Game.FONTS[id].stack.length > 0,
      id + '.stack non-empty');
  });
  assert.ok(Game.FONTS.speed, 'speed font exists');
});

// ---------- Weakness ----------
test('recordFact accumulate / clamp / ignore non-finite', () => {
  let w = {};
  w = Game.recordFact(w, '7x8', 500, false);
  assert.deepStrictEqual(w['7x8'], [1, 500, 0]);
  w = Game.recordFact(w, '7x8', 300, true);
  assert.deepStrictEqual(w['7x8'], [2, 800, 1]);
  const before = JSON.stringify(w['7x8']);
  w = Game.recordFact(w, '7x8', NaN, false);
  assert.strictEqual(JSON.stringify(w['7x8']), before, 'non-finite ms ignored');
  w = Game.recordFact(w, '7x8', Infinity, false);
  assert.strictEqual(JSON.stringify(w['7x8']), before, 'Infinity ms ignored');
  // ms 999999 clamped to <=60000
  let w2 = Game.recordFact({}, '2+9', 999999, false);
  assert.ok(w2['2+9'][1] <= 60000, 'ms clamped to MS_CAP');
});

test('topWeakFacts filter/order/limit', () => {
  const w = {
    '7x8': [10, 50000, 5],  // avg 5000, missRate .5 -> score 5000*(1+1.5)=12500
    '6x6': [10, 60000, 0],  // avg 6000, score 6000
    '2+9': [2, 20000, 2],   // n<3 excluded
    '3x3': [5, 5000, 0]     // avg 1000, score 1000
  };
  const top = Game.topWeakFacts(w, 2, 3);
  assert.strictEqual(top.length, 2, 'top 2');
  assert.strictEqual(top[0].key, '7x8', 'highest score first (missRate boosts it)');
  assert.ok(!top.some(t => t.key === '2+9'), 'n<minAttempts excluded');
  top.forEach(t => assert.ok(t.avgMs > 0 && Number.isFinite(t.avgMs)));
  assert.deepStrictEqual(Game.topWeakFacts({}, 2, 3), [], 'empty => []');
  // <=n returned
  const small = Game.topWeakFacts({ '1x1': [5, 5000, 0] }, 5, 3);
  assert.ok(small.length <= 5 && small.length === 1);
});

// ---------- Streak / grid / dates ----------
function dayMs(y, m, d) { return new Date(y, m - 1, d, 12, 0, 0).getTime(); }

test('localDateStr local Y-M-D', () => {
  const s = Game.localDateStr(dayMs(2026, 6, 25));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(s), 'format: ' + s);
  assert.strictEqual(s, '2026-06-25');
});

test('computeStreak runs', () => {
  const ds = (off) => Game.localDateStr(dayMs(2026, 6, 25) + off * 86400000);
  const today = ds(0);
  // today, -1, -2 => current 3
  let r = Game.computeStreak([ds(-2), ds(-1), ds(0)], today);
  assert.strictEqual(r.current, 3, 'current 3');
  assert.strictEqual(r.playedToday, true);
  // gap then today => 1
  r = Game.computeStreak([ds(-5), ds(0)], today);
  assert.strictEqual(r.current, 1, 'gap then today => 1');
  // today missing but yesterday,-2 => current 2 grace, playedToday false
  r = Game.computeStreak([ds(-2), ds(-1)], today);
  assert.strictEqual(r.current, 2, 'grace from yesterday => 2');
  assert.strictEqual(r.playedToday, false);
  // empty
  assert.deepStrictEqual(Game.computeStreak([], today), { current: 0, longest: 0, playedToday: false });
  // longest historical
  r = Game.computeStreak([ds(-10), ds(-9), ds(-8), ds(-7), ds(-1), ds(0)], today);
  assert.strictEqual(r.longest, 4, 'longest run is the 4 in -10..-7');
});

test('updateStreak transitions', () => {
  const ds = (off) => Game.localDateStr(dayMs(2026, 6, 25) + off * 86400000);
  let s = { current: 3, best: 3, lastPlayedDate: ds(-1), playedDates: [ds(-3), ds(-2), ds(-1)] };
  s = Game.updateStreak(s, ds(0));
  assert.strictEqual(s.current, 4, 'yesterday-last => ++');
  assert.strictEqual(s.best, 4, 'best raised');
  // idempotent same day
  const snap = JSON.stringify(s);
  s = Game.updateStreak(s, ds(0));
  assert.strictEqual(s.current, 4, 'today===last idempotent');
  assert.strictEqual(JSON.stringify(s), snap, 'no-op replay');
  // gap => reset to 1, best preserved
  s = Game.updateStreak(s, ds(5));
  assert.strictEqual(s.current, 1, 'gap => 1');
  assert.strictEqual(s.best, 4, 'best never decreases');
});

test('streakWarning copy', () => {
  const w = Game.streakWarning(3, false);
  assert.ok(/lose/i.test(w) && /3/.test(w), 'unplayed warns lose+N: ' + w);
  const wp = Game.streakWarning(3, true);
  assert.ok(!/lose/i.test(wp), 'played today not a loss warning: ' + wp);
  assert.strictEqual(Game.streakWarning(0, false), 'Start a streak today.');
});

test('buildGrid dedupe + size + today in last col', () => {
  const ds = (off) => Game.localDateStr(dayMs(2026, 6, 25) + off * 86400000);
  const today = ds(0);
  const grid = Game.buildGrid([ds(0), ds(0), ds(-1)], today, 26);
  assert.strictEqual(grid.cells.length, 26 * 7, 'weeks*7 cells');
  const todayCell = grid.cells.filter(c => c.date === today);
  assert.strictEqual(todayCell.length, 1, 'today appears once (deduped)');
  const maxCol = Math.max(...grid.cells.map(c => c.col));
  assert.strictEqual(todayCell[0].col, maxCol, 'today in last column');
});

// ---------- Pace / run stats / history ----------
test('projectScore math', () => {
  assert.strictEqual(Game.projectScore(10, 30, 120), 40);
  assert.strictEqual(Game.projectScore(10, 0, 120), 0);
  assert.strictEqual(Game.projectScore(5, 200, 120), Game.projectScore(5, 120, 120), 'caps elapsed at dur');
  assert.strictEqual(Game.projectScore(0, 60, 120), 0);
  assert.ok(Number.isFinite(Game.projectScore(10, 30, 120)));
});

test('personalBest per-hash', () => {
  assert.strictEqual(Game.personalBest([], 'h'), null);
  const hist = [
    { score: 40, hash: 'a' }, { score: 70, hash: 'a' }, { score: 99, hash: 'b' }
  ];
  assert.strictEqual(Game.personalBest(hist, 'a'), 70, 'max within hash a');
  assert.strictEqual(Game.personalBest(hist, 'b'), 99);
  assert.strictEqual(Game.personalBest(hist, 'z'), null, 'no match => null');
});

test('runStats aggregate', () => {
  assert.deepStrictEqual(Game.runStats([]), { count: 0, avg: 0, pb: null, best: null, ppm: null });
  const r = Game.runStats([
    { score: 60, durationS: 120 }, { score: 30, durationS: 60 }
  ]);
  assert.strictEqual(r.count, 2);
  assert.ok(close(r.avg, 45), 'avg 45');
  assert.strictEqual(r.best, 60);
  assert.strictEqual(r.pb, 60);
  // ppm = mean of score/(dur/60) = mean(30,30)=30
  assert.ok(close(r.ppm, 30), 'ppm 30: ' + r.ppm);
});

test('settingsHash equality + sensitivity', () => {
  const h = Game.settingsHash(cfgAll);
  assert.strictEqual(h, Game.settingsHash(cfgAll), 'same cfg same hash');
  const c2 = JSON.parse(JSON.stringify(cfgAll)); c2.duration = 60;
  assert.notStrictEqual(h, Game.settingsHash(c2), 'duration change differs');
  const c3 = JSON.parse(JSON.stringify(cfgAll)); c3.add.a2 = 50;
  assert.notStrictEqual(h, Game.settingsHash(c3), 'range change differs');
  const c4 = JSON.parse(JSON.stringify(cfgAll)); c4.mul.on = false;
  assert.notStrictEqual(h, Game.settingsHash(c4), 'op toggle differs');
});

test('modeKey / modeLabel', () => {
  assert.strictEqual(Game.modeKey({ add: true, mul: true }), 'am');
  assert.strictEqual(Game.modeLabel({ add: true, sub: true, mul: true, div: true }), 'All Ops');
});

test('scoreToY inversion + no /0', () => {
  const H = 100, P = 10, max = 80;
  assert.strictEqual(Game.scoreToY(max, max, H, P), P, 'maxScore => pad');
  assert.strictEqual(Game.scoreToY(0, max, H, P), H - P, '0 => h-pad');
  const flat = Game.scoreToY(50, 0, H, P);
  assert.ok(Number.isFinite(flat) && flat === H - P, 'maxScore=0 baseline no NaN');
});

// ---------- Persistence / commit / share ----------
function makeStubStore(initial) {
  const map = new Map(initial || []);
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { map.delete(k); },
    _map: map
  };
}
function throwingStore() {
  return { getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota'); } };
}

test('Store.load defaults on garbage/null/missing', () => {
  const garbage = makeStubStore([['zc:v1', '}{not json']]);
  assert.deepStrictEqual(Game.Store.load(garbage), Game.DEFAULTS, 'corrupt => DEFAULTS');
  assert.deepStrictEqual(Game.Store.load(null), Game.DEFAULTS, 'null storage => DEFAULTS clone');
  assert.deepStrictEqual(Game.Store.load(makeStubStore()), Game.DEFAULTS, 'missing => DEFAULTS');
  // returns a clone, not the frozen original — mutating result must not affect DEFAULTS
  const loaded = Game.Store.load(null);
  loaded.xp = 999;
  assert.strictEqual(Game.DEFAULTS.xp, 0, 'DEFAULTS not mutated by caller');
});

test('Store.save false on throw, never throws', () => {
  let res;
  assert.doesNotThrow(() => { res = Game.Store.save(Game.DEFAULTS, throwingStore()); });
  assert.strictEqual(res, false, 'quota/throw => false');
  assert.strictEqual(Game.Store.save(Game.DEFAULTS, makeStubStore()), true, 'ok => true');
});

test('Store save->load round-trip deep equality', () => {
  const store = makeStubStore();
  const state = Game.Store.load(null);
  state.xp = 1234;
  state.history.push({ ts: 1, score: 7, correct: 7, wrong: 0, durationS: 60,
    mode: 'a', hash: 'h', daily: false, seed: null,
    perOp: { add: { c: 7, w: 0, sumMs: 1000 }, sub: { c: 0, w: 0, sumMs: 0 },
      mul: { c: 0, w: 0, sumMs: 0 }, div: { c: 0, w: 0, sumMs: 0 } },
    fastestMs: 100, slowestMs: 300 });
  state.weakness['7x8'] = [3, 1500, 1];
  state.streak.current = 2; state.streak.best = 5;
  assert.strictEqual(Game.Store.save(state, store), true);
  const back = Game.Store.load(store);
  assert.deepStrictEqual(back, state, 'round-trips to deep equality');
});

test('Store.load deep-merges missing nested keys', () => {
  // partial blob missing nested prefs.brainrot etc — should self-fill from DEFAULTS
  const partial = { v: 1, xp: 42, prefs: { themeId: 'dark' } };
  const store = makeStubStore([['zc:v1', JSON.stringify(partial)]]);
  const s = Game.Store.load(store);
  assert.strictEqual(s.xp, 42, 'kept stored xp');
  assert.strictEqual(s.prefs.themeId, 'dark', 'kept stored themeId');
  assert.strictEqual(s.prefs.fontId, Game.DEFAULTS.prefs.fontId, 'filled missing fontId');
  assert.deepStrictEqual(s.prefs.brainrot, Game.DEFAULTS.prefs.brainrot, 'filled missing brainrot');
  assert.ok(Array.isArray(s.history), 'filled history array');
});

test('migrate identity v1 / defaults otherwise', () => {
  assert.strictEqual(Game.Store.migrate({}).v, 1, 'empty => v1 defaults');
  assert.strictEqual(Game.Store.migrate(Game.DEFAULTS).v, 1);
  const v1 = JSON.parse(JSON.stringify(Game.DEFAULTS)); v1.xp = 5;
  const m = Game.Store.migrate(v1);
  assert.strictEqual(m.v, 1);
  assert.strictEqual(m.xp, 5, 'v1 identity keeps data');
  // unknown future version => defaults
  assert.deepStrictEqual(Game.Store.migrate({ v: 99 }), Game.DEFAULTS, 'unknown v => DEFAULTS');
});

test('finalizeRun history cap + xp + leveledUp', () => {
  let state = Game.Store.load(null);
  // prime 200 runs
  for (let i = 0; i < 200; i++) {
    state.history.push({ ts: i, score: i, correct: i, wrong: 0, durationS: 60,
      mode: 'a', hash: 'h', daily: false, seed: null,
      perOp: { add: { c: 0, w: 0, sumMs: 0 }, sub: { c: 0, w: 0, sumMs: 0 },
        mul: { c: 0, w: 0, sumMs: 0 }, div: { c: 0, w: 0, sumMs: 0 } },
      fastestMs: 0, slowestMs: 0 });
  }
  const rs = Game.newRunStats();
  rs.score = 12; rs.correct = 12; rs.wrong = 1;
  rs.perOp.add.c = 12; rs.perOp.add.w = 1; rs.perOp.add.sumMs = 6000;
  const xpBefore = state.xp;
  const meta = { now: dayMs(2026, 6, 25), durationS: 60, mode: 'a', hash: 'h',
    daily: false, seed: null, settingsCfg: cfgAll };
  const out = Game.finalizeRun(state, rs, meta);
  assert.strictEqual(out.state.history.length, 200, 'capped at 200');
  assert.strictEqual(out.state.history[199].score, 12, 'newest kept (last)');
  assert.strictEqual(out.state.history[0].score, 1, 'oldest (score 0) dropped, score1 now first');
  assert.strictEqual(out.xpGained, Game.xpForRun(out.record), 'xpGained == xpForRun(record)');
  assert.strictEqual(out.state.xp, xpBefore + out.xpGained, 'xp accumulated');
  assert.strictEqual(typeof out.leveledUp, 'boolean');
});

test('finalizeRun daily locks first attempt only', () => {
  let state = Game.Store.load(null);
  const now = dayMs(2026, 6, 25);
  const dateKey = Game.localDateStr(now);
  const rs = Game.newRunStats(); rs.score = 30; rs.correct = 30; rs.wrong = 0;
  const meta = { now, durationS: 120, mode: 'am', hash: 'h', daily: true,
    seed: 777, settingsCfg: cfgAll };
  let out = Game.finalizeRun(state, rs, meta);
  assert.ok(out.state.daily[dateKey], 'daily entry set');
  assert.strictEqual(out.state.daily[dateKey].score, 30);
  const firstSnapshot = JSON.stringify(out.state.daily[dateKey]);
  // second attempt same day — must NOT overwrite
  const rs2 = Game.newRunStats(); rs2.score = 99; rs2.correct = 99; rs2.wrong = 0;
  const out2 = Game.finalizeRun(out.state, rs2, meta);
  assert.strictEqual(JSON.stringify(out2.state.daily[dateKey]), firstSnapshot,
    'first attempt locks the day, no overwrite');
});

test('finalizeRun leveledUp true on crossing', () => {
  let state = Game.Store.load(null);
  state.xp = 90; // level 1, 10 from level 2
  const rs = Game.newRunStats(); rs.score = 10; rs.correct = 10; rs.wrong = 0; // 100 xp
  const meta = { now: dayMs(2026, 6, 25), durationS: 60, mode: 'a', hash: 'h',
    daily: false, seed: null, settingsCfg: cfgAll };
  const out = Game.finalizeRun(state, rs, meta);
  assert.strictEqual(out.leveledUp, true, 'crossed into a new level');
  assert.ok(out.newLevel > 1, 'newLevel advanced');
});

test('sparkline buckets', () => {
  assert.strictEqual(Game.sparkline([]), '');
  const mid = Game.sparkline([5, 5, 5]);
  assert.strictEqual(mid.length, 3, 'len 3');
  assert.strictEqual(new Set(mid.split('')).size, 1, 'all-equal => single char');
  const two = Game.sparkline([1, 8]);
  assert.strictEqual(two[0], '▁', 'min => lowest block');
  assert.strictEqual(two[two.length - 1], '█', 'max => full block');
  const long = Game.sparkline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.strictEqual([...long].length, 10, 'last 10 only');
});

test('shareString format', () => {
  const record = { ts: dayMs(2026, 6, 25), score: 47, correct: 47, wrong: 3,
    durationS: 120, mode: 'am', daily: false };
  const s = Game.shareString(record, [10, 20, 30, 47], 5);
  assert.ok(s.includes('47'), 'has score');
  assert.ok(/\d{4}-\d{2}-\d{2}/.test(s), 'has date');
  assert.ok(/Lv\s*5/.test(s), 'has level');
  assert.ok(!s.endsWith('\n'), 'no trailing newline');
  const lines = s.split('\n');
  assert.ok(lines.length >= 4, '>=4 lines');
  // mode label present (am => contains glyph(s), not raw "am")
  assert.ok(s.includes(Game.modeLabel({ add: true, mul: true })), 'has mode label');
  // sparkline line present
  assert.ok(/[▁▂▃▄▅▆▇█]/.test(s), 'has sparkline');
  // deterministic
  assert.strictEqual(s, Game.shareString(record, [10, 20, 30, 47], 5), 'deterministic');
});

// ---------- summary ----------
console.log('');
fails.forEach(f => console.log('  FAIL  ' + f));
console.log('');
console.log(`${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail === 0 ? 0 : 1);
