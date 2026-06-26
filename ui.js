/* ui.js — DOM glue, audio, juice, render, game loop.
   Binds the §3 ids, calls window.Game (§4), owns the §6 heat/sound/juice contract.
   No pure logic lives here — anything testable is in game.js. */
(function () {
  'use strict';

  var Game = window.Game;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---- heat/loop tuning ----
  var HEAT_EASE = 6;        // ease factor toward target per second
  var IDLE_MS = 2500;       // after this idle, heat target drifts down
  var IDLE_COOL = 0.4;      // target multiplier applied while idle

  // ---- audio tuning ----
  var BASE_FREQ = 330;

  // ====================================================================
  // DOM lookups (§3)
  // ====================================================================
  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;

  var el = {
    settings: $('settings'), game: $('game'), results: $('results'),
    home: $('home'), mute: $('mute'),
    flash: $('flash'), fx: $('fx'),
    bgVideo: $('bgVideo'), bgFallback: $('bgFallback'), bgMusic: $('bgMusic'),
    brainrotPanel: $('brainrotPanel'), brainrotVideo: $('brainrotVideo'),

    add_on: $('add_on'), sub_on: $('sub_on'), mul_on: $('mul_on'), div_on: $('div_on'),
    add_a1: $('add_a1'), add_a2: $('add_a2'), add_b1: $('add_b1'), add_b2: $('add_b2'),
    mul_a1: $('mul_a1'), mul_a2: $('mul_a2'), mul_b1: $('mul_b1'), mul_b2: $('mul_b2'),
    duration: $('duration'),
    start: $('start'), dailybtn: $('dailybtn'),
    drill_weak: $('drill_weak'),
    themeSelect: $('theme-select'), fontSelect: $('font-select'), themeHint: $('theme-hint'),
    streakbox: $('streakbox'), streakcount: $('streakcount'), streakwarn: $('streakwarn'),
    calendar: $('calendar'),
    ambient_on: $('ambient_on'), split_on: $('split_on'), music_on: $('music_on'),
    video_file: $('video_file'), video_url: $('video_url'),
    music_file: $('music_file'), music_url: $('music_url'),

    timeleft: $('timeleft'), score: $('score'), pace: $('pace'),
    question: $('question'), answer: $('answer'),

    finalscore: $('finalscore'), resultmode: $('resultmode'), stats: $('stats'),
    trend: $('trend'), weak_facts: $('weak_facts'),
    xpbar: $('xpbar'), level: $('level'), xpfill: $('xpfill'), xpremain: $('xpremain'),
    levelup: $('levelup'),
    share: $('share'), sharestatus: $('sharestatus'), sharetext: $('sharetext'),
    restart: $('restart'), again: $('again')
  };

  // ====================================================================
  // State
  // ====================================================================
  var state = Game.Store.load();

  var reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  // per-run mutable game state
  var run = null; // null when no run active
  // run = { cfg, hash, mode, pb, runStats, daily, seed, problems, ptr,
  //         answer, op, fact, score, streak, attempts, missed,
  //         left, durationS, lastRecord, lastFinalize, timer, problemShownAt }

  window.Heat = { value: 0 }; // ponytail: readers poll it, no event bus.

  // ====================================================================
  // Web Audio (lazy, single context)
  // ====================================================================
  var ctx = null;
  var ctxFailed = false;

  function getCtx() {
    if (ctx || ctxFailed) { if (ctx && ctx.state === 'suspended') ctx.resume(); return ctx; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { ctxFailed = true; return null; }
    try { ctx = new AC(); if (ctx.state === 'suspended') ctx.resume(); }
    catch (e) { ctxFailed = true; ctx = null; }
    return ctx;
  }

  function blip(freq, durMs, type, gain) {
    if (state.prefs.muted) return;
    var c = getCtx();
    if (!c) return;
    var now = c.currentTime;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    var peak = gain == null ? 0.18 : gain;
    var dur = durMs / 1000;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.008);          // attack
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);          // exp release
    osc.connect(g); g.connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  function sfxCorrect(streak) {
    var s = Math.min(streak, Game.HEAT_PITCH_CAP);
    var freq = BASE_FREQ * Math.pow(2, s / 12);
    blip(freq, 110, 'triangle', 0.2);
  }
  function sfxKey() { blip(180, 28, 'sine', 0.05); }
  function sfxWrong() { blip(90, 200, 'sawtooth', 0.16); haptic(40); }
  function sfxTick() { blip(880, 40, 'square', 0.08); }
  function sfxFanfare() {
    // ponytail: 4-note arp scheduled by simple timeouts, good enough for a toy.
    var notes = [523, 659, 784, 1046];
    notes.forEach(function (f, i) { setTimeout(function () { blip(f, 160, 'triangle', 0.2); }, i * 90); });
  }

  function haptic(ms) {
    if (state.prefs.muted) return;
    if (reducedMotion.matches) return;            // vibration is motion
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  // ====================================================================
  // Heat loop (single rAF, only while a run is active)
  // ====================================================================
  var heatValue = 0;
  var heatTarget = 0;
  var rafId = null;
  var lastFrameTs = 0;
  var lastCorrectTs = 0;
  var particles = []; // { node, x, y, vx, vy, life }

  function setStreak(n) {
    if (run) run.streak = n;
    heatTarget = Math.min(1, n / Game.HEAT_FULL_STREAK);
  }

  function startHeat() {
    if (rafId != null) cancelAnimationFrame(rafId); // idempotent (§e)
    lastFrameTs = 0;
    lastCorrectTs = performance.now();
    rafId = requestAnimationFrame(heatTick);
  }

  function stopHeat() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    setStreak(0);
    heatValue = 0; heatTarget = 0;
    root.style.setProperty('--heat', '0');
    window.Heat.value = 0;
    for (var i = 0; i < particles.length; i++) {
      if (particles[i].node && particles[i].node.parentNode) particles[i].node.parentNode.removeChild(particles[i].node);
    }
    particles.length = 0;
  }

  function heatTick(ts) {
    if (!lastFrameTs) lastFrameTs = ts;
    var dt = Math.min(Math.max((ts - lastFrameTs) / 1000, 0), 0.05);
    lastFrameTs = ts;

    // idle cooldown nudges target down
    var localTarget = heatTarget;
    if (ts - lastCorrectTs > IDLE_MS) localTarget = heatTarget * IDLE_COOL;

    if (reducedMotion.matches) {
      heatValue = localTarget; // instant, no animation
    } else {
      heatValue += (localTarget - heatValue) * Math.min(1, dt * HEAT_EASE);
    }

    root.style.setProperty('--heat', heatValue.toFixed(4));
    window.Heat.value = heatValue;

    stepParticles(dt);
    rafId = requestAnimationFrame(heatTick);
  }

  // ====================================================================
  // Particles (juice)
  // ====================================================================
  function spawnBurst(cx, cy, count) {
    if (reducedMotion.matches) return; // no-op under reduced motion
    for (var i = 0; i < count; i++) {
      var p = document.createElement('div');
      p.className = 'particle';
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      el.fx.appendChild(p);
      var ang = Math.random() * Math.PI * 2;
      var spd = 60 + Math.random() * 180;
      particles.push({ node: p, x: cx, y: cy, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 60, life: 1 });
    }
  }

  function stepParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt * 1.6;
      if (p.life <= 0) {
        if (p.node && p.node.parentNode) p.node.parentNode.removeChild(p.node);
        particles.splice(i, 1);
        continue;
      }
      p.vy += 360 * dt; // gravity
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.node.style.transform = 'translate(' + (p.x - parseFloat(p.node.style.left)) + 'px,' + (p.y - parseFloat(p.node.style.top)) + 'px)';
      p.node.style.opacity = Math.max(0, p.life);
    }
  }

  // ====================================================================
  // Visual juice helpers
  // ====================================================================
  var flashTimer = null, thumpTimer = null, popTimer = null;

  function flash() {
    if (reducedMotion.matches) return;
    el.flash.classList.remove('flash-on');
    void el.flash.offsetWidth; // reflow to restart
    el.flash.classList.add('flash-on');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.flash.classList.remove('flash-on'); }, 200);
  }
  function thump() {
    if (reducedMotion.matches) return;
    el.game.classList.remove('thump');
    void el.game.offsetWidth;
    el.game.classList.add('thump');
    clearTimeout(thumpTimer);
    thumpTimer = setTimeout(function () { el.game.classList.remove('thump'); }, 160);
  }
  function pop(node) {
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
    clearTimeout(popTimer);
    popTimer = setTimeout(function () { node.classList.remove('pop'); }, 200);
  }

  // ====================================================================
  // Settings form <-> cfg
  // ====================================================================
  function readSettingsForm() {
    return {
      add: {
        on: el.add_on.checked,
        a1: el.add_a1.value, a2: el.add_a2.value, b1: el.add_b1.value, b2: el.add_b2.value
      },
      sub: { on: el.sub_on.checked },
      mul: {
        on: el.mul_on.checked,
        a1: el.mul_a1.value, a2: el.mul_a2.value, b1: el.mul_b1.value, b2: el.mul_b2.value
      },
      div: { on: el.div_on.checked },
      duration: parseInt(el.duration.value, 10) || 120
    };
  }

  // build a settings object with parsed ints for genProblem (game.js expects numbers in ranges)
  function parsedCfg(cfg) {
    var n = function (v, d) { var x = parseInt(v, 10); return isFinite(x) ? x : d; };
    return {
      add: { on: cfg.add.on, a1: n(cfg.add.a1, 2), a2: n(cfg.add.a2, 100), b1: n(cfg.add.b1, 2), b2: n(cfg.add.b2, 100) },
      sub: { on: cfg.sub.on },
      mul: { on: cfg.mul.on, a1: n(cfg.mul.a1, 2), a2: n(cfg.mul.a2, 12), b1: n(cfg.mul.b1, 2), b2: n(cfg.mul.b2, 100) },
      div: { on: cfg.div.on },
      duration: cfg.duration
    };
  }

  function writeSettingsForm(s) {
    el.add_on.checked = s.add.on; el.sub_on.checked = s.sub.on;
    el.mul_on.checked = s.mul.on; el.div_on.checked = s.div.on;
    el.add_a1.value = s.add.a1; el.add_a2.value = s.add.a2; el.add_b1.value = s.add.b1; el.add_b2.value = s.add.b2;
    el.mul_a1.value = s.mul.a1; el.mul_a2.value = s.mul.a2; el.mul_b1.value = s.mul.b1; el.mul_b2.value = s.mul.b2;
    el.duration.value = String(s.duration);
    el.drill_weak.checked = state.prefs.drillWeak;
    el.ambient_on.checked = state.prefs.brainrot.ambient;
    el.split_on.checked = state.prefs.brainrot.split;
    el.music_on.checked = state.prefs.brainrot.music;
    el.video_url.value = state.prefs.brainrot.videoUrl || '';
    el.music_url.value = state.prefs.brainrot.musicUrl || '';
  }

  function opsObj(cfg) {
    return { add: cfg.add.on, sub: cfg.sub.on, mul: cfg.mul.on, div: cfg.div.on };
  }
  function enabledOps(cfg) {
    var out = [];
    if (cfg.add.on) out.push('add');
    if (cfg.sub.on) out.push('sub');
    if (cfg.mul.on) out.push('mul');
    if (cfg.div.on) out.push('div');
    return out;
  }

  // ====================================================================
  // Appearance: theme / font / presets
  // ====================================================================
  function applyTheme(themeId) {
    var resolved = Game.resolveTheme(themeId, state.xp);
    root.setAttribute('data-theme', resolved);
    return resolved;
  }
  function applyFont(fontId) {
    var resolved = Game.resolveFont(fontId);
    root.setAttribute('data-font', resolved);
    return resolved;
  }

  function renderThemeOptions() {
    if (!el.themeSelect) return;
    var lvl = Game.levelForXp(state.xp).level;
    var unlocked = Game.themesForLevel(lvl);
    var unlockedIds = {};
    unlocked.forEach(function (t) { unlockedIds[t.id] = true; });

    // list every theme; lock ones above level with hint text
    var ids = Object.keys(Game.THEMES);
    el.themeSelect.innerHTML = '';
    ids.sort(function (a, b) {
      var la = Game.THEMES[a].level, lb = Game.THEMES[b].level;
      return la - lb || Game.THEMES[a].name.localeCompare(Game.THEMES[b].name);
    });
    ids.forEach(function (id) {
      var t = Game.THEMES[id];
      var o = document.createElement('option');
      o.value = id;
      var locked = !unlockedIds[id];
      o.textContent = t.name + (locked ? ' (Lv ' + t.level + ')' : '');
      o.disabled = locked;
      el.themeSelect.appendChild(o);
    });
    el.themeSelect.value = Game.resolveTheme(state.prefs.themeId, state.xp);

    // font select (all fonts always available)
    if (el.fontSelect && !el.fontSelect.options.length) {
      Object.keys(Game.FONTS).forEach(function (id) {
        var o = document.createElement('option');
        o.value = id; o.textContent = Game.FONTS[id].name;
        el.fontSelect.appendChild(o);
      });
    }
    if (el.fontSelect) el.fontSelect.value = Game.resolveFont(state.prefs.fontId);

    // hint for the next locked theme
    if (el.themeHint) {
      var nextLocked = ids.map(function (id) { return Game.THEMES[id]; })
        .filter(function (t) { return t.level > lvl; })
        .sort(function (a, b) { return a.level - b.level; })[0];
      el.themeHint.textContent = nextLocked ? ('Reach level ' + nextLocked.level + ' to unlock ' + nextLocked.name) : '';
    }
  }

  function initAppearance() {
    applyTheme(state.prefs.themeId);
    applyFont(state.prefs.fontId);
    renderThemeOptions();

    if (el.themeSelect) el.themeSelect.addEventListener('change', function () {
      var resolved = applyTheme(el.themeSelect.value);
      state.prefs.themeId = resolved;
      el.themeSelect.value = resolved;
      Game.Store.save(state);
    });
    if (el.fontSelect) el.fontSelect.addEventListener('change', function () {
      var resolved = applyFont(el.fontSelect.value);
      state.prefs.fontId = resolved;
      Game.Store.save(state);
    });
  }

  // URL-param presets: ?theme=&font=&dur=&ops=adms&daily=1
  function applyUrlPresets() {
    var q;
    try { q = new URLSearchParams(window.location.search); } catch (e) { return; }
    if (q.get('theme')) { var rt = applyTheme(q.get('theme')); state.prefs.themeId = rt; }
    if (q.get('font')) { var rf = applyFont(q.get('font')); state.prefs.fontId = rf; }
    if (q.get('dur')) { var d = parseInt(q.get('dur'), 10); if ([30, 60, 120, 300, 600].indexOf(d) >= 0) el.duration.value = String(d); }
    if (q.get('ops')) {
      var s = q.get('ops');
      el.add_on.checked = /a/.test(s); el.sub_on.checked = /s/.test(s);
      el.mul_on.checked = /m/.test(s); el.div_on.checked = /d/.test(s);
    }
  }

  // ====================================================================
  // Brainrot media (user-supplied + CSS fallback) (§j, §k)
  // ====================================================================
  var objUrls = { video: null, music: null }; // session-only object URLs, never persisted

  function setFileSrc(file, kind) {
    if (objUrls[kind]) { URL.revokeObjectURL(objUrls[kind]); objUrls[kind] = null; }
    if (!file) return null;
    var url = URL.createObjectURL(file);
    objUrls[kind] = url;
    return url;
  }

  function applyBrainrot() {
    var br = state.prefs.brainrot;
    var videoSrc = objUrls.video || br.videoUrl || '';
    var musicSrc = objUrls.music || br.musicUrl || '';

    // ambient bg: video if available, else the CSS gradient fallback (#bgFallback)
    var ambientVideo = br.ambient && !!videoSrc;
    el.bgVideo.style.display = ambientVideo ? 'block' : 'none';
    if (ambientVideo && el.bgVideo.getAttribute('src') !== videoSrc) {
      el.bgVideo.src = videoSrc;
    }
    if (ambientVideo) { el.bgVideo.play().catch(function () {}); }
    else { el.bgVideo.pause && el.bgVideo.pause(); }

    // fallback gradient layer shows whenever ambient on (under or instead of video)
    el.bgFallback.style.display = br.ambient ? 'block' : 'none';

    // split panel: sharp video on the right
    var split = br.split && !!videoSrc;
    el.brainrotPanel.hidden = !split;
    if (split && el.brainrotVideo.getAttribute('src') !== videoSrc) {
      el.brainrotVideo.src = videoSrc;
    }
    if (split) { el.brainrotVideo.play().catch(function () {}); }
    else { el.brainrotVideo.pause && el.brainrotVideo.pause(); }

    // music: user loop, starts on the start() gesture
    if (br.music && musicSrc) {
      if (el.bgMusic.getAttribute('src') !== musicSrc) el.bgMusic.src = musicSrc;
      el.bgMusic.loop = true;
      el.bgMusic.play().catch(function () {});
    } else {
      el.bgMusic.pause && el.bgMusic.pause();
    }
  }

  function stopBrainrotMusic() { el.bgMusic.pause && el.bgMusic.pause(); }

  function wireBrainrot() {
    var br = state.prefs.brainrot;
    el.ambient_on.addEventListener('change', function () { br.ambient = el.ambient_on.checked; Game.Store.save(state); applyBrainrot(); });
    el.split_on.addEventListener('change', function () { br.split = el.split_on.checked; Game.Store.save(state); applyBrainrot(); });
    el.music_on.addEventListener('change', function () { br.music = el.music_on.checked; Game.Store.save(state); applyBrainrot(); });
    el.video_url.addEventListener('change', function () { br.videoUrl = el.video_url.value.trim(); Game.Store.save(state); applyBrainrot(); });
    el.music_url.addEventListener('change', function () { br.musicUrl = el.music_url.value.trim(); Game.Store.save(state); applyBrainrot(); });
    el.video_file.addEventListener('change', function () { setFileSrc(el.video_file.files[0], 'video'); applyBrainrot(); });
    el.music_file.addEventListener('change', function () { setFileSrc(el.music_file.files[0], 'music'); applyBrainrot(); });
  }

  // ====================================================================
  // Screen switching
  // ====================================================================
  function show(screen) {
    el.settings.style.display = screen === 'settings' ? 'block' : 'none';
    el.game.style.display = screen === 'game' ? 'block' : 'none';
    el.results.style.display = screen === 'results' ? 'block' : 'none';
  }

  // ====================================================================
  // Streak / calendar render
  // ====================================================================
  function renderStreakUI() {
    var today = Game.localDateStr(Date.now());
    var cs = Game.computeStreak(state.streak.playedDates, today);
    if (el.streakcount) el.streakcount.textContent = String(cs.current);
    if (el.streakwarn) el.streakwarn.textContent = Game.streakWarning(cs.current, cs.playedToday);
    if (el.calendar) {
      var grid = Game.buildGrid(state.streak.playedDates, today);
      el.calendar.innerHTML = Game.buildCalendarSVG(grid);
    }
  }

  // ====================================================================
  // Pace
  // ====================================================================
  function renderPace() {
    if (!run || !el.pace) return;
    var elapsed = run.durationS - run.left;
    var proj = Game.projectScore(run.score, elapsed, run.durationS);
    var pbTxt = run.pb == null ? '—' : run.pb;
    el.pace.textContent = 'on pace for ' + proj + ' · PB ' + pbTxt;
  }

  // ====================================================================
  // Game loop hooks (§8)
  // ====================================================================
  function start(daily) {
    var cfg = readSettingsForm();
    var pcfg = parsedCfg(cfg);
    var ops = enabledOps(cfg);
    if (ops.length === 0) { alert('Select at least one operation.'); return; }

    // persist last-used settings + mark a run active (so a mid-game refresh respawns it)
    state.settings = cfg;
    state.activeRun = { daily: !!daily };
    Game.Store.save(state);

    getCtx(); // unlock audio on this gesture

    var today = Game.localDateStr(Date.now());
    var problems = null, seed = null, ptr = 0;
    if (daily) {
      seed = Game.dailySeed(today);
      problems = Game.dailyProblems(today, pcfg);
    }

    run = {
      cfg: cfg, pcfg: pcfg,
      hash: Game.settingsHash(cfg),
      mode: Game.modeKey(opsObj(cfg)),
      pb: Game.personalBest(state.history, Game.settingsHash(cfg)),
      runStats: Game.newRunStats(),
      daily: !!daily, seed: seed, problems: problems, ptr: ptr,
      ops: ops,
      answer: null, op: null, fact: null,
      score: 0, streak: 0, attempts: 0, missed: false,
      durationS: cfg.duration, left: cfg.duration,
      timer: null, problemShownAt: 0
    };

    el.score.textContent = '0';
    el.timeleft.textContent = String(run.left);
    if (el.pace) el.pace.textContent = '';

    applyBrainrot();
    show('game');
    el.answer.value = '';
    el.answer.focus();
    startHeat();
    nextProblem();
    renderPace();

    run.timer = setInterval(tick, 1000);
  }

  function nextProblem() {
    var p;
    if (run.daily) {
      p = run.problems[run.ptr % run.problems.length];
      run.ptr++;
    } else {
      var weak = state.prefs.drillWeak ? state.weakness : null;
      p = Game.genProblem(run.pcfg, Math.random, weak);
    }
    // genProblem signature: (settings, rng, weakness). rng is a ()=>number; pass Math.random for free runs.
    run.answer = p.answer;
    run.op = p.op;
    run.fact = p.fact;
    run.missed = false;
    el.question.textContent = p.text + ' =';
    el.answer.value = '';
    run.problemShownAt = performance.now();
  }

  function onInput() {
    if (!run) return;
    var v = el.answer.value.trim();
    if (v === '') return;

    var ms = performance.now() - run.problemShownAt;

    // correct branch — preserve baseline equality EXACTLY
    if (parseInt(v, 10) === run.answer && v === String(run.answer)) {
      Game.recordAnswer(run.runStats, run.op, true, ms);
      Game.recordFact(state.weakness, run.fact, ms, run.missed);
      run.attempts++;
      run.score++;
      onCorrect();
      nextProblem();
      renderPace();
      return;
    }

    // committed-wrong: digits, long enough, not equal — latch once
    if (!run.missed && /^\d+$/.test(v) && v.length >= String(run.answer).length && parseInt(v, 10) !== run.answer) {
      run.missed = true;
      Game.recordAnswer(run.runStats, run.op, false, ms);
      sfxWrong();
      setStreak(0);
      return;
    }

    sfxKey();
  }

  function onCorrect() {
    lastCorrectTs = performance.now();
    setStreak(run.streak + 1);
    el.score.textContent = String(run.score);
    pop(el.score);
    flash();
    thump();
    var r = el.answer.getBoundingClientRect();
    spawnBurst(r.left + r.width / 2, r.top + r.height / 2, 8 + Math.floor(heatValue * 8));
    sfxCorrect(run.streak);
    haptic(15);
  }

  function tick() {
    run.left--;
    el.timeleft.textContent = String(run.left);
    if (run.left > 0 && run.left <= 10) sfxTick();
    renderPace();
    if (run.left <= 0) {
      clearInterval(run.timer);
      endRun();
    }
  }

  function endRun() {
    sfxFanfare();

    var meta = {
      now: Date.now(),
      durationS: run.durationS,
      mode: run.mode,
      hash: run.hash,
      daily: run.daily,
      seed: run.seed,
      settingsCfg: run.cfg
    };
    var res = Game.finalizeRun(state, run.runStats, meta);
    state = res.state;
    state.activeRun = null; // run finished — don't respawn on next load
    Game.Store.save(state);

    var record = res.record;
    var xpGained = res.xpGained;
    var leveledUp = res.leveledUp;
    var newLevel = res.newLevel;

    stopHeat();
    stopBrainrotMusic();

    renderResults(record, xpGained, leveledUp, newLevel);
    show('results');
    run = null;
  }

  // ====================================================================
  // Results render
  // ====================================================================
  function renderResults(record, xpGained, leveledUp, newLevel) {
    el.finalscore.textContent = String(record.score);
    if (el.resultmode) el.resultmode.textContent = record.daily ? 'Daily Challenge' : 'Free play';

    // stats filtered by this run's hash
    var sameHash = state.history.filter(function (r) { return r.hash === record.hash; });
    var st = Game.runStats(sameHash);
    if (el.stats) {
      el.stats.textContent = 'Avg ' + st.avg + ' · Best ' + (st.best == null ? '—' : st.best) +
        ' · ' + (st.ppm == null ? '—' : st.ppm) + '/min · ' + st.count + ' runs';
    }

    // trend
    if (el.trend) {
      el.trend.innerHTML = '';
      var svg = Game.buildTrendSvg(sameHash, { w: 320, h: 90, pad: 12 });
      if (svg) el.trend.appendChild(svg);
    }

    // weakness
    if (el.weak_facts) {
      var weak = Game.topWeakFacts(state.weakness, 2, 3);
      if (weak.length) {
        el.weak_facts.textContent = 'Your slowest: ' + weak.map(function (w) { return Game.prettyFact(w.key); }).join(', ');
      } else {
        el.weak_facts.textContent = '';
      }
    }

    // xp / level
    var lv = Game.levelForXp(state.xp);
    if (el.level) el.level.textContent = String(lv.level);
    if (el.xpfill) {
      var pct = lv.span > 0 ? Math.round((lv.into / lv.span) * 100) : 100;
      el.xpfill.style.width = pct + '%';
    }
    if (el.xpremain) el.xpremain.textContent = lv.need + ' XP to level ' + (lv.level + 1);

    if (el.levelup) {
      if (leveledUp) {
        var unlocks = Game.themesForLevel(newLevel).filter(function (t) { return t.level === newLevel; });
        var msg = 'Level up! Now level ' + newLevel + '.';
        if (unlocks.length) msg += ' Unlocked: ' + unlocks.map(function (t) { return t.name; }).join(', ');
        el.levelup.textContent = msg;
      } else {
        el.levelup.textContent = '';
      }
    }

    // xp changed → theme options + streak
    renderThemeOptions();
    renderStreakUI();

    // share wiring (rebind each result with fresh record)
    if (el.share) {
      el.share.onclick = function () {
        var recent = state.history.map(function (r) { return r.score; });
        copyShare(Game.shareString(record, recent, newLevel));
      };
    }
    if (el.dailybtn) el.dailybtn.disabled = !!state.daily[Game.localDateStr(Date.now())];
  }

  // ====================================================================
  // Share / clipboard
  // ====================================================================
  function copyShare(text) {
    function ok() { if (el.sharestatus) el.sharestatus.textContent = 'Copied!'; }
    function fail() {
      if (el.sharestatus) el.sharestatus.textContent = 'Copy failed';
      if (el.sharetext) { el.sharetext.hidden = false; el.sharetext.value = text; el.sharetext.focus(); el.sharetext.select(); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { legacyCopy(text, ok, fail); });
    } else {
      legacyCopy(text, ok, fail);
    }
  }

  function legacyCopy(text, ok, fail) {
    if (!el.sharetext) { fail(); return; }
    el.sharetext.hidden = false;
    el.sharetext.value = text;
    el.sharetext.focus();
    el.sharetext.select();
    try {
      var done = document.execCommand('copy');
      if (done) { ok(); } else { fail(); return; }
      el.sharetext.hidden = true;
    } catch (e) { fail(); }
  }

  // ====================================================================
  // Abandon-run handlers (#home / #again) — never finalize (§c)
  // ====================================================================
  function abandon() {
    if (run && run.timer) clearInterval(run.timer);
    stopHeat();
    stopBrainrotMusic();
    state.activeRun = null;        // leaving the run — don't respawn on next load
    if (run) { run = null; }        // flush accumulated weakness (§c)
    Game.Store.save(state);
  }

  // ====================================================================
  // Wiring
  // ====================================================================
  function init() {
    writeSettingsForm(state.settings);
    initAppearance();
    applyUrlPresets();
    wireBrainrot();
    renderStreakUI();
    show('settings');

    // Mid-game refresh: respawn a fresh run with the same config instead of the menu.
    // Wired below init body so handlers exist; start() reads the just-restored form.
    var resume = state.activeRun;

    // mute button
    if (el.mute) {
      var syncMute = function () {
        el.mute.setAttribute('aria-pressed', String(state.prefs.muted));
        el.mute.textContent = state.prefs.muted ? '🔇' : '🔊';
      };
      syncMute();
      el.mute.addEventListener('click', function () {
        state.prefs.muted = !state.prefs.muted;
        Game.Store.save(state);
        syncMute();
        if (state.prefs.muted) stopBrainrotMusic();
        else if (run) applyBrainrot();
      });
    }

    el.answer.addEventListener('input', onInput);
    el.start.addEventListener('click', function () { start(false); });
    if (el.dailybtn) {
      el.dailybtn.disabled = !!state.daily[Game.localDateStr(Date.now())];
      el.dailybtn.addEventListener('click', function () { if (!el.dailybtn.disabled) start(true); });
    }
    if (el.drill_weak) el.drill_weak.addEventListener('change', function () {
      state.prefs.drillWeak = el.drill_weak.checked; Game.Store.save(state);
    });

    // restart: jump straight into a fresh run with the same config (tab+enter friendly)
    if (el.restart) el.restart.addEventListener('click', function () {
      abandon();
      start(false);
    });
    el.again.addEventListener('click', function () {
      abandon();
      writeSettingsForm(state.settings);
      renderThemeOptions();
      renderStreakUI();
      show('settings');
    });
    el.home.addEventListener('click', function (e) {
      e.preventDefault();
      abandon();
      writeSettingsForm(state.settings);
      renderThemeOptions();
      renderStreakUI();
      show('settings');
    });

    // reduced-motion live changes
    if (reducedMotion.addEventListener) {
      reducedMotion.addEventListener('change', function () {
        if (reducedMotion.matches) { heatValue = heatTarget; }
      });
    }

    // respawn a run if the page was refreshed mid-game (see `resume` above).
    // ponytail: a daily can't restart if already completed today — fall back to free play.
    if (resume) {
      var dailyDone = resume.daily && !!state.daily[Game.localDateStr(Date.now())];
      start(resume.daily && !dailyDone);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
