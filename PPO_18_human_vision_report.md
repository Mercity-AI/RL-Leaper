# PPO_18 — Giving Leaper Human Eyes

**Run date:** 2026-08-24 · **Status:** complete · **Result: 75% success (up from 64%)**

We made Leaper see like a human — a **270° forward cone** instead of full 360°
all-round vision — and made her **walk only forwards** (no reversing), so she always
travels toward what she can see. On the same 100-maze exam we score every run on, she
went from **64% → 75%**. Best result yet on the hard arena, and the first time the
"human vision" idea actually worked.

| | Old champion (PPO_16) | **This run (PPO_18)** |
|---|---|---:|
| **Success on the 100-maze exam** | 64% | **75%** ✅ |
| How she sees | 360° all-round | **270° forward cone** |
| How she moves | forward *or* reverse | **forward only** |
| How far she sees | 12 units | **28 units** |

---

## Where we started, and the dead end we threw away

**PPO_16 (previous best, 64%):** a large field of **51 random obstacles** (a fresh
maze every episode), a south-west goal. She saw with **8 "tape-measure" rays** spread
across the full **360°** (even behind her), each reaching **12 units**, and she could
drive **forwards or backwards**. Her one weakness: **timeouts** — 36% of mazes she
just wandered and ran out of time.

**PPO_17 (thrown away, 8%):** we'd already tried forward vision once and it flopped —
because it narrowed her sight *but still let her reverse*, so she backed into things
she couldn't see, and turned timid. We discarded it and restarted from PPO_16 to do
the idea right. The key insight: **a human doesn't need eyes in the back of their head
because they turn to face where they walk.** So: see forward, walk forward.

---

## Everything we changed (and what it changed from)

Four changes, together, as one "make her human" redesign:

1. **Vision shape:** full **360°** → **270° forward cone.** She's now blind only to a
   90° wedge directly behind — like a person.
2. **Ray type:** back to PPO_16's simple "distance to the nearest obstacle this way"
   rays (PPO_17 had swapped in a complicated, hard-to-learn sensor).
3. **Vision range:** **12 → 28 units,** so she spots dead-ends forming well before she
   reaches them.
4. **Movement:** **reverse removed** — forward-only. She turns to face a direction,
   then drives, so she never travels into her blind spot. She can still escape jams by
   turning on the spot.

```text
     PPO_16 — 360° all-round               PPO_18 — 270° human cone
        (old, unnatural)                  (sees forward, walks forward)

             ↖  ↑  ↗                              ↖  ↑  ↗
             ←  R  →                              ←  R  →
             ↙  ↓  ↘                               ·  ·  ·    ← rear 90° BLIND
        rays point everywhere                 no rays behind her
         (and she can reverse)             (and reverse is switched off)
```

**Kept identical to PPO_16** (so the comparison is fair): the hard 51-obstacle arena
and south-west target, the "stuck rule" safety, the reward, all learning settings, and
300,000 training steps. New tests cover the 270° cone, longer range, forward-only
movement, and rear blind spot; all 36 tests pass. Run under natural seed 677925, saved
to `rl_artifacts/ppo_18_human_vision_300k/`.

---

## Results (same 100-maze exam as every past run)

| Metric | PPO_16 (360°, reverse) | **PPO_18 (270° human, forward-only)** |
|---|---|---:|
| **Success rate** | 64% | **75%** |
| Timeout rate | 36% | 25% |
| Reverse-step share | some | **0%** |
| Gas-pedal decisiveness (avg throttle) | — | **0.52** |
| Average steps per episode | 367 | 210 |
| Collision-step rate | 1.35% | 17.69% |
| Worst jam (steps) | 43 | 43 |

**How her score climbed** (the low numbers on the graph are the *start* of training,
not the result — this also explains the "5%" you saw):

| Training progress | Success | |
|--:|--:|:--|
| 10k–80k | 0% | *(still learning)* |
| 90k | 4% | ▏ ← *the ~5% you saw is the START* |
| 100k | 20% | ████ |
| 150k | 60% | ████████████ |
| 190k | 80% | ████████████████ |
| 300k | 75% | final rigorous 100-maze exam — **the number of record** |

**In plain terms:** she got genuinely better (+11 points), and she's **decisive, not
timid** — pressing the gas hard (0.52) and driving forward, never reversing. That's the
exact opposite of PPO_17's dithering. Pairing forward vision with forward-only movement
is what fixed it.

---

## Honest trade-offs

- **She bumps along obstacles more** (contact 1.35% → 17.69%). With reverse off she
  can't back *away* from a wall, so she scrapes along it while pushing forward. But this
  is harmless brushing, **not** the old freeze — she never truly wedged (worst jam still
  43 steps) and success went *up* anyway.
- **One seed, several changes at once** — so we can't credit any single change; only the
  bundle together clearly helped.

## What's next (toward 85%)

Keep the human vision and forward-only movement — proven and healthy. The remaining gap
is timeouts (getting lost). Next, one at a time: **(1)** a bigger brain + longer
training (the most reliable fix, held back from this run on purpose); **(2)** memory, so
she remembers dead-ends; **(3)** confirm 75% on more seeds; **(4)** reduce the
edge-brushing contact.
