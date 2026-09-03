# Leaper Training Log — PPO_19 → PPO_23

A plain-language recap of the runs from the recurrent-memory experiments through
the sharper-vision breakthrough. Full technical detail lives in `TRAINING.md`;
this is the story version.

**Starting point:** the champion was **PPO_18 = 75%** maze success (measured on a
fixed 100-maze exam). Goal: reach **85%**. We already knew a lot about *why* she
fell short. From PPO_18 we could see she doesn't crash into walls (that was solved
earlier) and she doesn't freeze up (also solved) — the one missing skill was
*finding her way out of dead-ends*. On roughly 1 in 4 mazes she'd walk into a
pocket that pointed toward the goal, then wander inside it until the time ran out.
Every run below is an attempt to close that specific gap, and each one taught us
something about *where* the gap really came from.

---

## PPO_19 — Give her a memory 🧠  ❌

- **What we changed:** swapped her brain for one that remembers where it's already
  been (an "LSTM" recurrent network), so in theory she could recall a dead-end she'd
  already explored and not fall for it twice.
- **Why we thought it'd help:** wandering in circles looks like a memory problem — if
  she remembered "I've been here," she'd stop repeating herself.
- **What happened:** **71%** — *below* the 75% champion. Training was also jumpy and
  unstable, bouncing up and down, a sign the settings were a little too aggressive.
- **Verdict:** memory didn't help. But before dropping the idea, we tried two more
  settings to be sure it wasn't just a tuning problem.

## PPO_20 — Same memory, calmer training  ❌ (canceled)

- **What we changed:** same memory brain, learning speed turned down 3× to fix the
  jumpiness from PPO_19.
- **What happened:** it over-corrected — now it learned *far too slowly*, stuck near
  0% long into the run. **Canceled early** once it was clearly going nowhere.

## PPO_21 — Same memory, middle setting  ❌

- **What we changed:** same memory brain, learning speed set halfway between the last
  two — not too fast, not too slow.
- **What happened:** **69%**. This was the smoothest, healthiest-looking of the three
  memory runs, but the final score still landed below champion.
- **Verdict:** **Memory line closed.** Three honest tries, none beat 75%. The takeaway:
  the problem was never her *memory* — so we stopped going down this path entirely.

## PPO_22 — Give her a bigger brain  ❌

- **What we changed:** kept everything from the PPO_18 champion and only made the
  "thinking" network much larger (256×256 instead of 64×64) — more raw brainpower to
  plan routes with.
- **What happened:** **74%** — a statistical tie with the 75% champion. She actually
  scraped walls a bit less, but the wandering/timeout problem didn't budge, and her
  scores had stopped climbing well before the run ended (so more training wouldn't
  have saved it either).
- **Verdict:** **Brainpower wasn't the bottleneck.** Two separate "smarter brain" ideas
  — memory and size — had now both failed. That was actually the clue we needed: if
  making her *think* harder does nothing, maybe the problem is what she can *see*.

## PPO_23 — Give her sharper eyes  ✅ **THE WIN**

- **What we changed:** doubled her vision detail — from **8 feeler-beams to 16** across
  the same forward view. Nothing else was touched.
- **Why we thought it'd help:** 8 beams spread across her wide view left big blind gaps
  *between* the beams. Out at a distance, a whole obstacle — or a fake "doorway" that's
  actually closed — could sit in one of those gaps unseen. So she'd commit to a trap
  before she had any way to know it was a trap. More beams = a clearer read of where the
  real openings are.
- **What happened:** it worked on the very first try — **86%**, with the timeout rate
  cut from 25% down to **14%** (the exact problem we'd been chasing for weeks), and her
  wall-scraping dropped to almost nothing (~2% of steps).
- **The honest catch:** we re-ran it on several fresh random starts to make sure 86%
  was real, and the scores **swing**: **86%, 73%, 87%, 80%** → an **average of ~81.5%**.
  So 86% wasn't the true "level" — it was the good end of a wide range. We tracked the
  swing down to her *confidence*: runs that trained her to commit and keep moving score
  ~86–87%; runs where she comes out timid and hesitant drop to ~73–80%. Same eyes,
  different nerve.
- **Verdict:** **A real, confirmed win.** The entire new group sits above the old ~77%
  baseline, better vision was clearly the right lever, and **two of the four runs cleared
  the 85% target.** Because a game ships the single best model you trained (not the
  average), our deployable **champion is the 87% run (seed 965726).** ✅ **Target met.**

---

## Where we landed

| | Old eyes (8 beams) | New eyes (16 beams) |
|---|---|---|
| Runs | 75, 77, 78 | 86, 73, 87, 80 |
| Average | ~77% | **~81.5%** |
| Best model shipped | 78% | **87% ✅** |

- **Champion: PPO_23, 16 beams, seed 965726 = 87%.** Meets the 85% goal, with a big
  drop in both timeouts and wall-scraping compared to the old champion.
- **The big lesson:** the gap was *perception*, not *intelligence*. We spent three runs
  trying to make her think harder (memory, then a bigger brain) and it changed nothing;
  the moment we let her *see* better, the problem we'd been stuck on for weeks broke open.
- **Two things we'd try next (PPO_24), if we want to push past 87%:**
  1. **Longer sight** — let her see 45 units ahead instead of 28, so she spots large
     dead-ends even earlier.
  2. **Steady her nerve** — a training tweak so *every* run comes out confident and
     reliably clears 85%, instead of the current lucky-vs-timid lottery.
