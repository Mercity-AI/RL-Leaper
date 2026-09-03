# PPO_19 — Giving Leaper a Memory

**Run date:** 2026-08-25 · **Status:** complete · **Result: 71% success (champion PPO_18 stays at 75%)**

We gave Leaper a **memory** — an LSTM "notepad" that carries a running summary of
where she's been, so she can stop re-entering dead-ends she already explored. It's the
first time she's had any recollection at all between steps. On the same 100-maze exam we
score every run on, she landed at **71%** — a genuinely strong, decisive brain, but
**just under** our 75% champion. PPO_18 keeps the crown; PPO_19 taught us the memory
idea works and just needs a gentler hand.

| | Champion (PPO_18) | **This run (PPO_19)** |
|---|---|---:|
| **Success on the 100-maze exam** | **75%** | 71% |
| Brain | plain 64×64 | **memory brain (LSTM notepad, size 256)** |
| Movement | forward-only | forward-only (unchanged) |
| Vision | 270° cone, 28 units | 270° cone, 28 units (unchanged) |
| Wall-scraping | 17.7% | **11.9%** ✅ |
| Steps per maze | 210 | **103** ✅ |

---

## Where we started, and what we changed

**PPO_18 (champion, 75%):** human 270° forward vision, forward-only movement. Her one
weakness: **timeouts — 25% of mazes she just got lost.** The reason: she had **no
memory** — every step started from a blank mind, so she'd wander back into the same
dead-ends.

**The one change:** we installed the memory library (`sb3-contrib`) and swapped her
plain brain for a **recurrent LSTM brain** (`MlpLstmPolicy`) — a small "notepad" that
learns what's worth remembering and what to forget. Everything else was kept **identical**
to PPO_18 so the memory got all the credit or blame. Run at 500k steps, natural seed
736031, saved to `rl_artifacts/ppo_19_memory_500k/`.

---

## What happened during training

She learned **fast** — hitting **72%** by 150k, then bouncing up as high as **84–92%**
on the mid-run spot-checks through the back half. But those checks only sample **25**
mazes; the numbers were real but flattering. She also **jittered** — 72% → 48% → 92% →
76% — the tell-tale sign of a learning rate slightly too high: she found her best level
but couldn't hold still on it.

---

## The honest result

On the full, unforgiving **100-maze exam**, the deterministic success rate settled at
**71%** (29% timeouts, 0% reverse, worst jam 44 steps). She's **more decisive** than
PPO_18 (near-full throttle, half the steps) and **scrapes walls less** — but she still
gets lost a touch more, which cost her the 4 points.

**Verdict:** the memory brain is promising but under-tuned. Next: re-run gentler
(learning rate 3e-4 → 1e-4) so she settles onto her 80s instead of bouncing past them.
PPO_18 remains champion at 75%.
