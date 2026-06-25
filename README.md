# Arithmetic — HEAT

A fast-paced mental-arithmetic speed drill. Two minutes (or 30s–10m), as many
problems as you can. A Zetamac-style trainer rebuilt around **HEAT**: a single
scalar that rises with your streak, warming the accent color, the glow, the
background, and the pitch of the correct-answer blip — then snaps cold the
instant a run ends.

No build. No dependencies. No framework. No CDN. Open the file and play.

---

## Run it

It is a static site. Pick whichever is least effort:

- **Just open it** — double-click `index.html`, or drag it into a browser. Works
  from `file://`. (One caveat: a few browsers throttle `localStorage` on
  `file://` in private windows; if scores don't persist, use a server.)
- **Any static server**, from this directory:

  ```sh
  python -m http.server 8000      # then open http://localhost:8000
  # or
  npx serve .                     # if you happen to have node around
  ```

There is nothing to install, compile, or bundle. The "no deps" claim is literal:
zero `node_modules`, zero `package.json` runtime deps, zero `<link>`/`<script>`
to any external origin. Vanilla ES + plain CSS. The only Node usage anywhere is
running the test suite (below), and that uses Node's built-in `assert` only.

---

## How to play

1. On the **settings** screen, toggle the operations you want (Addition,
   Subtraction, Multiplication, Division) and set their number ranges.
   Subtraction reuses the addition ranges (it's addition in reverse, never
   negative); division reuses the multiplication ranges (always whole).
2. Pick a duration (30 / 60 / 120 / 300 / 600 seconds).
3. Press **Start**. Type each answer — it's accepted the moment it's correct,
   no Enter needed.
4. Build a streak to crank the HEAT. When the timer hits zero you get a results
   screen with your score, trend, weakest facts, XP, and a share card.

Press the **Arithmetic** title (top-left) any time to bail back to settings. A
bailed run is **not** recorded — only a run that reaches 0:00 counts.

---

## Features

### HEAT
The signature. A streak warms a single `--heat` value (0→1, full at a streak of
12). That one value drives the accent shifting magenta→amber, a growing glow on
the problem and input, a warming background, and the rising pitch of the correct
blip. Miss a problem and it snaps cold.

### Sound
All generated with the Web Audio API — no audio files. A soft tick on keystrokes,
a pitched blip on correct (pitch climbs with your streak, capped), a low buzz on
a wrong commit, a ticking countdown in the final 10 seconds, and a short fanfare
when the timer runs out naturally. Mute with the **🔊/🔇** button in the header;
the choice persists.

### Daily challenge
**Daily** runs a fixed, seeded problem set that's identical for everyone on a
given date — comparable scores. Your **first** attempt of the day locks in as
that day's result; replays don't overwrite it. The button disables once you've
played today.

### Weak-fact drilling
Every fact you attempt is tracked (attempts, cumulative time, misses). The
results screen calls out your slowest facts. Turn on **Drill weak facts** in
settings to bias problem generation toward the ones you're slow or wrong on.

### Streaks & calendar
Play on consecutive days to build a day-streak (a one-day grace before it
breaks). The settings screen shows your current streak, a loss-aversion nudge,
and an inline SVG contribution-style calendar of days played.

### Pace, stats & trend
During a run, a pace indicator projects your final score and shows your personal
best for the current config. Results show average / best / per-minute / run-count
(filtered to comparable configs) plus an inline SVG score-trend chart.

### XP, levels & theme unlocks
Correct answers earn XP (scaled by accuracy). XP drives a level, and levels
unlock themes (table below). Level is always derived from XP, never stored.

### Share card
The **Copy** button on results puts a plain-text card on your clipboard — level,
mode, duration, date, score, accuracy, and a sparkline of recent scores. Clean
text, paste anywhere.

### Themes & fonts
Pick a **Theme** and **Font** in settings. The default theme is **heatwave**
(deep ink-navy, hot magenta→amber heat accent, condensed display numerals). Some
themes are locked behind levels.

### Brainrot media slot (bring your own)
Optional stimulation panels — an ambient blurred background, a sharp split-screen
side panel, and a music loop. **No media ships with this app**, by design: no
copyrighted video or music is bundled, fetched, or referenced. You supply it.

---

## Adding your own brainrot video / music

In settings, under the brainrot controls:

- **Ambient background** — blurred video (or the gradient fallback) behind the game.
- **Brainrot split-screen** — a sharp video in a right-side panel (auto-hidden on
  narrow screens so it never covers the answer box).
- **Background music** — a looping audio track.

Two ways to provide media for each:

1. **Pick a file** — the `video/*` or `audio/*` file input. Stays local to your
   browser; nothing is uploaded. Because file picks use in-memory object URLs
   that can't be safely persisted, a **file-sourced session resets to the
   fallback after a reload** (expected — re-pick the file).
2. **Paste a URL** — a direct link to a video/audio file. Pasted URLs **are**
   saved (in `localStorage`) and reload with you.

**Zero-asset fallback:** with a panel enabled but no media supplied, you get an
animated CSS-gradient background — no files, no network, works offline. So the
feature is fully functional with nothing provided.

> Only ever use media you have the rights to. The app deliberately ships none.

---

## localStorage schema

One key. One version. Single source of truth.

- **Key:** `zc:v1`
- **Shape (v1):**

  ```js
  {
    v: 1,                       // schema version

    settings: {                 // last-used game config
      add: { on, a1, a2, b1, b2 },
      sub: { on },              // reuses add ranges
      mul: { on, a1, a2, b1, b2 },
      div: { on },              // reuses mul ranges
      duration                  // 30|60|120|300|600
    },

    prefs: {
      themeId, fontId, muted, drillWeak,
      brainrot: { ambient, split, music, videoUrl, musicUrl }
    },

    xp,                         // cumulative lifetime XP (level is derived, not stored)

    history: [ /* Run[], newest-last, capped at 200 */ ],
    // Run = { ts, score, correct, wrong, durationS, mode, hash, daily, seed,
    //         perOp:{add,sub,mul,div}, fastestMs, slowestMs }

    daily: { "YYYY-MM-DD": { seed, score, correct, durationS, ts } },

    weakness: { "7x8": [attempts, sumMs, misses], "2+9": [...] },

    streak: { current, best, lastPlayedDate, playedDates: [] }
  }
  ```

Notes:
- **Object URLs are never persisted** — only pasted media URLs are.
- **Weakness keys are commutative** — `8×7` and `7×8` collapse to one key (`7x8`);
  subtraction keys to its addition pair, division to its multiplication pair.
- Loading deep-merges saved data over the frozen `Game.DEFAULTS`, so a partial or
  older blob self-fills missing keys. Corrupt/missing data falls back to defaults
  and never throws.

### Bumping the version

The schema is versioned so future changes don't wipe saves:

1. Increment `v` in `Game.DEFAULTS`.
2. Add a `case` to `Game.Store.migrate(raw)` that upgrades the previous shape to
   the new one (`migrate` switches on `raw.v`).
3. Unknown / corrupt / future-version data falls back to a fresh `DEFAULTS` clone.

Until a new version exists, `migrate` is the identity for `v === 1`.

**To wipe your data:** clear site data for this page, or run
`localStorage.removeItem('zc:v1')` in the console.

---

## Theme unlock table

Themes unlock by **level** (derived from XP). Level-0 themes are available
immediately. XP per run ≈ `round(correct × 10 × (0.5 + 0.5 × accuracy))`; the
level curve is `cumXpForLevel(level) = 50 × level × (level − 1)` (L1=0, L2=100,
L3=300, L4=600, …).

| Theme | Unlocks at level | Notes |
|---|---|---|
| `heatwave` | 0 (default) | Ink-navy + magenta→amber heat |
| `dark` | 0 | |
| `paper` | 0 | |
| `contrast` | 0 | High-contrast |
| `solarized` | 3 | |
| `crt` | 5 | Scanline + glow effect |
| `seasonal` | 8 | |

A locked theme can't be selected; tampered/locked ids fall back to `heatwave`.

**Fonts** (no unlocks — all available): `speed` (default), `system`, `serif`,
`mono`, `rounded`, `dyslexic`.

---

## Accessibility

- **Visible keyboard focus** — a high-contrast `:focus-visible` ring on every
  interactive control.
- **Reduced motion** — `prefers-reduced-motion: reduce` disables heat easing
  (it snaps instead of animating), particle bursts, score-pop / flash / thump,
  the gradient animation, the CRT scanline, and haptics. **Theme colors stay** —
  motion off is not theme off.
- **ARIA** — `aria-label` on icon controls, `aria-pressed` on the mute toggle,
  `aria-live` on pace / streak / share / weak-facts / level-up regions, and
  `role="img"` + label on the SVG calendar and trend chart.
- **Stable digits** — `font-variant-numeric: tabular-nums lining-nums` everywhere
  numbers change live, so the score, timer, and pace don't reflow when they
  update or pop.

---

## Architecture / file map

Six files, one responsibility each. Load order in `index.html` is `game.js`
then `ui.js` (UI depends on `window.Game`).

| File | Responsibility |
|---|---|
| **`game.js`** | Pure logic core — RNG, problem gen, weakness, streak/grid, XP/level, pace/stats, share string, themes/fonts data, load/save/migrate. No DOM, no audio, no timers. Node-requireable **and** a browser global (`window.Game`). |
| **`index.html`** | Structure: every DOM id, the load order, and a tiny inline `<head>` script that sets `data-theme` / `data-font` before first paint (no flash of wrong theme). No game logic, no styling beyond that script. |
| **`styles.css`** | All styling — design tokens, theme & font blocks, keyframes, the `--heat`-driven coupling, reduced-motion rules. No JS, no hardcoded color that should be a token. |
| **`ui.js`** | The integrator — binds DOM ids, calls `game.js`, owns the timer + the single `requestAnimationFrame` heat/particle loop, Web Audio, clipboard, and all rendering. Re-implements no pure function (imports them from `Game`). |
| **`test.js`** | Node `assert` suite for `game.js`. No framework. |
| **`README.md`** | This file. |

**How "a run" flows** (all in `ui.js`): `start(daily)` snapshots the settings,
unlocks audio on the click gesture, and starts the heat loop. Each `onInput()`
commits correct/wrong answers, records the fact, and fires juice + sound. Only
the timer-expiry branch finalizes the run (`Game.finalizeRun` → `Game.Store.save`)
and renders results. Bailing via the title or **Play again** never finalizes.

The HEAT loop writes one CSS variable per frame —
`document.documentElement.style.setProperty('--heat', value)` — and CSS derives
the accent, glow, and background warmth from it. No JS color math.

---

## Running the tests

```sh
node test.js
```

Pure `assert` calls against `game.js` — no framework, no install. Exits non-zero
on any failure. Covers RNG determinism, problem generation, fact keys, the
XP/level curve, theme unlocks, weakness aggregation, streaks, the calendar grid,
pace/stats, persistence round-trips & migration, run finalization (history cap,
daily lock, level-up), and the share string / sparkline.

> The CSS theme/font block check is manual — every `Game.THEMES` / `Game.FONTS`
> id should have a matching `[data-theme=…]` / `[data-font=…]` block in
> `styles.css`, and vice-versa (no orphans). DOM and audio are side-effectful and
> intentionally untested.
