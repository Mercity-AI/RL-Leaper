# Leaper vs a moving Lola: round 1 and round 2 plan (2026-11-06)

This file is complete on its own. Whoever runs it (a person or an AI agent)
should not need to ask the owner anything: every number, rule, file and
decision is here. Part 1 is the plain-language story; Parts 2-12 are the
exact work.

**Owner:** the game designer of Leaper (not a programmer). **Written by:**
Claude, from the owner's decisions of 2026-11-05 and 2026-11-06.

---

## Contents

1. The story in plain words
2. Words, units and numbers used here
3. Hard rules (never break these)
4. Today's scorecard (the baseline), in numbers
5. Every change, in exact numbers
6. Round 1: the runs
7. Exams and the numbers that decide
8. Round 2: what to do with the results
9. Build instructions (code)
10. Running it: machine, order, time
11. What to send back to the owner
12. Getting the code and files

---

## 1. The story in plain words

Leaper is a game: the player is **Lola**, the enemy is the **Leaper**, a
six-legged robot whose movement is driven by a small trained brain
(reinforcement learning). That brain was trained for 7.76 million steps to
find and reach a target that **stands still**. In the game Lola runs and
hides, so the Leaper chases where she *was*, pushes into container walls and
loses her.

On 2026-11-05 two short retrains on a **moving** Lola (run A and run D,
1 million steps each) helped only a little. Reading the training code showed
why. The problem is mostly the **scorecard** (the points the brain earns
while practising), plus a practice world that never asks for the skill:

1. **Going around is punished.** Every step is scored on the straight line
   to her: +0.2 per unit closer, -0.2 per unit further. Getting round a
   container starts with steps away from her, which cost points at once.
   The practice arena almost never needs a detour (0.7% of chases); the real
   yard needs one in 23% (10% need a path more than twice the straight line).
   So it learnt to push into walls.
2. **Wrong finish line.** +25 only for touching her. She is 1.7-2.5x faster
   than it, and in the game the Leaper wins by shooting, not touching.
3. **No reason to search after losing her.** All "look somewhere new" points
   switch off for good the first time it sees her.
4. **Confused critic.** The brain's critic (the half that predicts how a
   round will go; see section 2) cannot see where she really is, but the
   points depend on it. Its predictions got worse (explained 69% -> 49%).
5. **Practice world with no walls.** 6 round rocks in a small square; the
   yard has long containers, cars, corners and dead ends.

**The owner's rule for the fix:** the Leaper must have "a brain of her own".
No route arrow, no "go around this rock" input, nothing in the game that
tells it the way. Every change below either changes the practice scorecard,
changes the practice world, or gives the brain small honest inputs about
what it saw itself.

**The plan:** build the changes (section 9), run 8 experiments twice each at
1 million steps (round 1), compare them with clear rules (section 7), then
follow the round 2 rules (section 8). Nothing replaces the game's brain
until the owner has played against it.

---

## 2. Words, units and numbers used here

| Word | Meaning |
|---|---|
| Brain | The Leaper's trained network. The game uses the 7,757,824-step brain ("today's brain"), files `model_7757824/` and `model_7757824.zip`. |
| Actor (policy) | The half of the brain that picks moves. The only half exported to the game (`actor.onnx`). |
| Critic (value function) | The half that, during practice only, predicts how many points the round will end with. Moves that end better than predicted are reinforced. Thrown away after training. |
| Step | One brain decision = 0.1 s of game time. 1 million steps is about 28 hours of practice play. |
| Scorecard / reward | Points earned or lost each practice step. |
| Input | One of the numbers the actor reads each step (34 today: memory of where it last saw her and how long ago, which way it faces, 16 wall-distance rays, a 5-number "unexplored area" note, its last move, its own motion). |
| Unit | Practice-world ("brain") length. **1 unit = 0.689 map units; 1 map unit = 1.451 units.** 14 map units = 20.3 units; 50 map units = 72.6 units. |
| Map unit | Game-world length. The yard is about 78 x 73 map units. |
| Speeds | Leaper walks 0.375 units a step. Lola runs 0.638 and sprints 0.929 (Lola's real game speeds, measured 2026-11-05). |
| Leaper size | Body radius 0.75 units; legs reach 3.24 units, so it spans about 6.5 units (4.5 map units). |
| Firing | In the game the Leaper's eye shoots whenever it sees Lola with a clear line, out to about 50 map units (gun range 52). |
| Clear shot | Its eye sees her within 14 map units (20.3 units), where the game makes it stand and shoot (`engage.enterDistance` in `src/config/leaper-behaviour.js`). Stricter than "can fire". |
| Touch / catch | Its body reaches her (centre distance 2.15 units = target radius 1.4 + body 0.75). |
| Stuck | Pushing into something without moving for 40 steps (4 s). Ends the round. |
| Frozen | Not moving at all for 60 steps (6 s). Ends the round. |
| Wanderer / hider | Lola's two practice behaviours: wanderer (2 rounds in 3) runs between random spots, often behind cover, with 1-3 s pauses; hider (1 round in 3) runs to cover when spotted and stays 30-60 s, then slips away. Already built (`rl/moving_target.py`). |
| Copy | A run that starts from today's brain (weights and optimizer). |
| Fresh | A run that starts from random weights. |
| Try | One training run with its own random seed. Every run is done twice. |
| Points (in results) | Percentage points: 75% -> 80% is +5 points. |
| k / M | Thousand / million steps (250k = 250,000). |
| Run A | 2026-11-05: copy of today's brain, moving Lola, plain arena, old scorecard, 1,007,616 steps, 1 try. The baseline. Files: `rl_artifacts/moving_target_20261105/run_A/` (checkpoints `model_253952.zip`, `model_507904.zip`, `model_753664.zip`, `model_1007616.zip`). |

---

## 3. Hard rules (never break these)

1. **Never edit, retrain or overwrite today's brain**: `model_7757824/`,
   `model_7757824.zip`, `rl/frozen_7757824/`, `public/brains/leaper_7757824/`.
   Read them only. Every run writes to its own new folder.
2. **Never change the game** (`src/`) except the training viewer's drawing
   of box obstacles (section 9, item 11). The game keeps today's brain.
3. **Do not edit `rl_environment.py`, `rl/seeker_env.py`,
   `rl/junkyard_env.py`, `rl/junkyard_sight.py`**: subclass them. Their
   tests (`tests/test_frozen_recipe.py` and others) must still pass.
4. **Never overwrite anything in `rl_artifacts/`.** New runs go in
   `rl_artifacts/moving_target_round1_<YYYYMMDD>/`.
5. **No route arrow or route input to the actor**, ever, in any run. Routes
   may be used only inside the practice scorecard in runs F4 and F9 (R4).
6. **Exams always use run A's rules** for how a round ends (touch, stuck,
   frozen, 100 s), whatever scorecard the run trained with, so numbers are
   comparable.
7. **Do not commit or push** to the owner's repository unless the owner
   says so. Never commit photos, videos, PDFs or anything in `previews/`.
8. **Ask the owner before** going beyond the round 2 rules, changing any
   number in this file, or putting any brain into the game.

---

## 4. Today's scorecard (the baseline), in numbers

Run A trained with exactly this. Every new run starts from it and changes
only what section 5 says. (Code: `rl_environment.py` `step()`,
`rl/moving_target_env.py`.)

| What happens | Points |
|---|---|
| Touches Lola | **+25**, round ends |
| After first seeing her: straight-line distance to her real position gets shorter / longer | **+0.2** per unit closer, **-0.2** per unit further (capped at ±0.375 units a step, so ±0.075 points) |
| Before first seeing her: new closest distance | +0.1 per unit |
| First time it sees her (once a round) | +0.5 |
| Before first seeing her: new ground | +0.01 per new 3 x 3-unit square, +0.002 per new view, +0.01 per new heading |
| Each step before first seeing her | -0.002 |
| Each step after first seeing her | **-0.01** |
| Each step touching a wall or prop | -0.18 |
| Standing still looking at nothing new, after 15 steps | -0.04 a step |
| Stuck (40 steps pushing, no movement) | -10, round ends |
| Frozen (60 steps no movement) | -10, round ends |
| Round length | at most 1,000 steps (100 s) |

Recipe (must stay): signed throttle (negative = reverse), gamma 0.995, GAE
lambda 0.95, 16 environments x 512 steps per update, batch 256, 10 epochs,
clip 0.2, entropy 0.01, value coefficient 0.5, max grad norm 0.5, learning
rate continuing today's brain's line (0.00015 -> 0.00003 linearly over
10,002,432 steps, counted from 7,757,824). All in `rl/moving_target_brain.py`.

Practice world (run A): the plain arena, 62.5 x 62.5 units, 6 round rocks
(radius 2.5-3.6 units); rocks, Leaper and Lola placed at random every round.

---

## 5. Every change, in exact numbers

Each change has a code. Runs in section 6 are made of these codes.

### Scorecard changes

**R1 - Shot is the goal.** A round is **won** when Lola has been in the
Leaper's sight and within **20.3 units (14 map units)** for **10 steps in a
row (1 s)**: **+25**, round ends. Touching her still wins: **+25**, round
ends. "In sight" = the same sight test that drives input 1 (flat sight in
arenas, eye-level sight in the yard).

**R2 - Hidden time costs double.** After first seeing her: **-0.02** each
step she is out of sight, **-0.01** each step she is in sight (today -0.01
always). Before first seeing her: -0.002 as today.

**R3 - Points for searching ("places she could be").** From the step she
leaves its sight, the scorer keeps a map of 1 x 1-unit squares she could be
in: every open square whose walking distance (around obstacles, for her body
radius 0.8) from her last-seen spot is at most **0.638 x steps since she
vanished** (her run speed). Each step, every such square that the Leaper
can see (its sight test, from where it stands, within its view and range)
is **crossed off** and pays **+0.002**. Crossed-off squares stay crossed off
until she is seen again; then the map is cleared. At most **+3 a round**
from R3. The scorer never uses where she really is.

**R4 - Walking-distance scoring.** Replaces the straight line in the
"closer / further" points: **+0.2** per unit the *walking distance* to her
gets shorter, **-0.2** per unit longer (capped at ±0.375 units a step).
Walking distance = shortest path on a 1-unit grid around obstacles, for a
body of radius **2.5 units** (if no path, fall back to radius 1.5, then to
the straight line). Like today, it is measured after her move, so only the
Leaper's own move is paid. Applies whether she is seen or hidden. **Practice
scorecard only: nothing is added to the actor's inputs and nothing reaches
the game.**

**R5 - No distance points while she is hidden.** While she is out of sight:
**0** "closer / further" points. In sight: as today (straight line). On the
first step she is back in sight, pay 0 for that step (reset the previous
distance to the current one), so hidden movement is never paid later.

R4 and R5 are rivals and never used together (R4 matters most exactly when
she is hidden, which is when R5 turns distance points off). F7 and F9 test
which one wins.

### Practice world changes

**W1 - Big obstacle arena** (owner, 2026-11-06). A yard-sized arena,
**112 x 112 units** (about 77 x 77 map units, about 3x the floor of today's
arena), new and random every round, with **25-30 obstacles at random places
and angles**:

| Obstacle (preview name) | How many | Shape for the brain | Size in units (map units) |
|---|---|---|---|
| Straight wall ("toffee bar") | 12-16 | box | 6-17 long (4.1-11.7), 2.5-3.5 wide (1.7-2.4) |
| Car-sized box ("toffee packet") | 5-8 | box | 7 x 3.5 (4.8 x 2.4) |
| Round ("peppermint" or rock) | 4-6 | circle | radius 2.5-3.6 (1.7-2.5) |
| Lollipop | 1-2 | circle + thin box | head radius 2.5; stick 5.5 long, 0.8 wide, touching the head |

Rules: no planned L or U shapes (corners happen only where walls land near
each other); obstacles at least **1.5 units** apart and at least **3 units**
from the arena edge; Leaper and Lola start **32-61 units apart** (the game's
22-42 map units), the Leaper with 3.5 units of open floor around it. Every
arena is checked (section 9, item 5) so the Leaper can reach Lola's start
and every spot she will wander or hide in; otherwise it is redrawn. The
brain sees no colours: names like "toffee" are for us; only shapes matter.

**W2 - Real yard rounds.** Some practice rounds take place in the real
junkyard exactly as in the game exam (`rl/moving_target_game_exam.py`
`GameExamEnv`: the yard's real obstacles, eye-level sight to 50 map units,
the game's start rule, a new random start each round). Each round also picks
one of **8 versions** of the yard: as is or flipped left-right, turned 0,
90, 180 or 270 degrees, so it cannot learn one layout by heart. Nothing
inside the yard is moved. (If flipping/turning cannot be made exact within
half a day, see section 9, item 6.)

**World mix for runs with W1 + W2:** of the 16 practice environments,
**5 are yard** (31%), **4 are today's plain arena** (25%; it keeps what it
knows) and **7 are the big obstacle arena** (44%). Fixed per environment.

### Brain and input changes

**B1 - Critic sees the truth (practice only).** The critic gets **4** extra
numbers the actor never sees: Lola's real direction from the Leaper in the
world frame (2: x and z of the unit vector), her real distance divided by
the same maximum distance input 5 uses (1), and the share of R3's "could be
here" map not yet crossed off (1; 0 when R3 is off or she is in sight). The
actor reads exactly what it reads without B1. Only the actor is exported or
played. (Known as an "asymmetric actor-critic" or "privileged critic".)

**I1 - Her heading.** **3** new actor inputs, as in run D: the direction she
was moving (2 numbers, -1 to 1) and her speed as a share of her sprint
(1 number, 0 to 1), from her last two sightings in a row; frozen while she is
out of sight; 0 before the first. Already built (`new_inputs` in
`rl/moving_target_env.py`).

**I2 - "She's not there".** **1** new actor input: **1** when the spot
where it last saw her is inside its sight right now (its sight test aimed at
that spot) and she is not within 4 units of that spot; otherwise **0**.

New actor inputs (I1, I2) start with **zero weights** in copies (as run D:
`_widen` in `rl/moving_target_brain.py`), so on step 1 a copy plays exactly
like today's brain. Actor input count: 34, +3 with I1, +1 with I2 (38 with
both). The critic reads the actor's inputs + 4 with B1.

---

## 6. Round 1: the runs

All runs: **copy of today's brain, 1,007,616 steps (123 updates, like
run A), 2 tries.** Try 1 seed **145032261** (run A's), try 2 seed
**145032262**. Lola as in run A (wanderer 2 in 3, hider 1 in 3).

### Why most runs practise in the new worlds

An idea about walls cannot show up in a world with no walls (walking
distance, for example, changes nothing where nothing needs a detour). So
F3 changes only the worlds, and every scorecard idea runs **in the same new
worlds as F3** and is compared with F3. F3 itself is compared with run A.

| Run | Practises in | What changes, in numbers | Compared with |
|---|---|---|---|
| **A** (done) | Plain arena | Nothing: today's scorecard (section 4), moving Lola. 1 try. | - |
| **F3** | 5 yard + 4 plain + 7 big obstacle arenas | Worlds only (W1 + W2); scorecard exactly as section 4. | A |
| **F1** | as F3 | **R1 + R2**: win = in sight within 20.3 units for 10 steps in a row (+25), touch also +25; out-of-sight steps cost -0.02, in-sight steps -0.01. | F3 |
| **F2** | as F3 | **R3**: +0.002 per "could be here" square crossed off after losing her, at most +3 a round. | F3 |
| **F4** | as F3 | **R4**: closer/further points on walking distance (+0.2 / -0.2 per unit, body radius 2.5) instead of the straight line. | F3 |
| **F5** | as F3 | **R3 + R5**: F2's search points, and 0 closer/further points while she is hidden. | F3, F2 |
| **F6** | as F3 | **B1**: critic gets 4 extra numbers (her real direction 2, distance 1, R3 map share left 1, here always 0). Scorecard as section 4. | F3 |
| **F7** | as F3 | **R1 + R2 + R3 + R5 + B1 + I1 + I2**: everything except walking distance. Actor reads 38 inputs, critic 42. | F3 and the best single run |
| **F9** | as F3 | **R1 + R2 + R3 + R4 + B1 + I1 + I2**: as F7 but walking distance instead of "no distance points while hidden". | F7 |

> **The codes in one line each**
>
> - **R1** Win = she is in sight within 20.3 units (14 map units) for 1 s: +25 (touch also +25).
> - **R2** After first seeing her, each step she is out of sight costs -0.02 instead of -0.01.
> - **R3** After losing her, +0.002 for each place she could be that it checks and finds empty, max +3 a round.
> - **R4** Closer/further points on the walk around walls, not the straight line (practice only).
> - **R5** While she is hidden, 0 points for getting closer or further.
> - **W1** Big random arena, 112 x 112 units, 25-30 walls, boxes, rounds and lollipops.
> - **W2** Rounds in the real yard, in 8 flipped/turned versions.
> - **B1** The critic (practice only) sees where she really is: 4 extra numbers.
> - **I1** 3 new inputs: which way and how fast she was moving when last seen.
> - **I2** 1 new input: "I can see where she was, and she is not there".

**8 runs x 2 tries = 16 training runs.** If machine time is short: F3, F1,
F2, F4, F7 first (10).

The fresh brain (F8 = the winning recipe from random weights) is **not** in
round 1: at 1M steps a fresh brain would lose to every copy and teach
nothing. It is a round 2 option (section 8).

---

## 7. Exams and the numbers that decide

### Step 0: re-measure the baseline with the new exam code

Before round 1 starts, run the yard exam (below) on **today's brain** and on
**run A's four checkpoints** (253,952 / 507,904 / 753,664 / 1,007,616), so
every comparison uses the same code and the same 100 rounds. The numbers in
the tables below are from 2026-11-05 and are replaced by these.

### The exams

| Exam | When | Rounds | World | Seeds |
|---|---|---|---|---|
| **Yard exam** | 250k, 500k, 750k, 1M | 100 | Real yard as in the game: eye-level sight to 50 map units, moving Lola, run A's round rules, **un-flipped yard** | 70000-70099 (same for every run) |
| **Practice exam** | every 50k | 200 | Today's **plain** arena, moving Lola, run A's round rules | 30000-30199 |
| **Forgetting check** | every 50k | 200 | Today's plain arena, **Lola standing still** | 30000-30199 |

The practice exam and forgetting check always use the plain arena, never
the run's own worlds, so all runs are measured the same way. Exam rounds are
played with the actor in deterministic mode (no random noise).

### The headline numbers (yard exam)

| # | Number | How it is counted | Run A at 1M (2026-11-05) | "Better" means |
|---|---|---|---|---|
| **H1** | Clear shot | share of the 100 rounds where its eye sees her within 14 map units at least once | **75%** | **+5 points or more** |
| **H2** | Time to first clear shot | median over rounds with a clear shot, in seconds | **15.1 s** | **5% faster or more** |
| **H3** | Stuck or frozen | share of rounds ending stuck or frozen | **11%** | **-5 points or more** (fewer) |
| **H4** | Checks her hiding spot | share of hider "she hid while watched" moments where it gets within 4 units of the spot within 10 s | **4%** | **+5 points or more** |
| **H5** | Touch | share of rounds where it touches her | **19%** | **+5 points or more** |

Today's game brain for reference: H1 77%, H2 15.5 s, H3 28%, H4 4%, H5 15%.

### Also recorded (do not decide on their own)

| Number | Run A at 1M |
|---|---|
| After losing her for 1 s: moves her way, not back to where she was (over the next 3 s) | 41% |
| After losing her for 1 s: sees her again within 12 s | 91% |
| Share of all steps with a clear shot | 19% |
| Practice exam: touches moving Lola | 65% |
| Forgetting check: touches still Lola | 97% |

### The guard (a must)

Forgetting check below **93%** at any exam = the run is **stopped** (save
its model, mark it **harmful**). Today's brain scores 96.5%, run A 97%.

### Reading a run: four boxes

Use both tries. "Reference" = the run named in the "Compared with" column
of section 6 (run A for F3).

| Box | Rule |
|---|---|
| **Better** | At 1M, **both tries** beat the reference on at least one of H1-H5 by its margin, **no** headline number is worse than the reference by more than 5 points (5% for H2) in both tries, and the guard held. |
| **Promising** | Not better yet, but **still climbing** (below) and not harmful. |
| **No help** | Neither better nor still climbing. |
| **Harmful** | Guard broken, or a headline number worse than the reference by more than 5 points (5% for H2) in both tries. |

When the reference has two tries (F3, F7), compare with the average of its
two tries. Run A has one try; that is why the margins are 5 points (two
tries of the same run differed by 2-4 points on 2026-11-05).

**Still climbing**, in both tries: H1 at 1M is **3 points or more above**
the same try's H1 at 500k, **or** the practice exam's moving-Lola touch rate
rose **3 points or more** over the last 250k steps (average of the last 5
practice exams vs the 5 before them).

---

## 8. Round 2: what to do with the results

Go down this list in order; more than one line can apply. Runs are never
longer than **2,000,000 steps** (owner's limit for now; use 2,015,232 =
246 updates).

1. **Extend the climbers.** Every run that is "better" or "promising" **and
   still climbing** continues from its own 1M checkpoint to 2M (both tries,
   same seed, learning rate continuing the same line from 8.77M). Same
   exams at 1.25M, 1.5M, 1.75M, 2M. Judged with the same boxes.
2. **F3 (worlds) result.** If F3 is better than run A: the new worlds are
   kept in every round 2 run. If F3 is no help or harmful: add **C0 = F7's
   scorecard in today's plain arena only** (1M, 2 tries) to see whether the
   scorecard works without the new worlds.
3. **Combination wins.** If F7 or F9 is better than F3 **and** its H1 is at
   least as high as the best single run's: that combination is the recipe.
   Extend it to 2M (if not already by line 1) and add **F8 = the same recipe
   from a fresh brain, 2M, 2 tries.**
4. **Some single runs win, the combination does not.** Something in the mix
   hurts. Add **C1 = only the parts whose single runs were better** (keep
   I1/I2 only if F7 beat F3), 1M, 2 tries. Any part that was harmful on its
   own is dropped from every later run.
5. **R4 vs R5.** Compare F9 with F7 (and F4 with F5): keep the one better on
   H1 and H3, drop the other. **If they are within 5 points on both, keep
   R5** (it works without the scorer using routes; owner's preference).
6. **B1 alone (F6).** If F6 is harmful, drop B1 from every later run. If it
   is no help but F7/F9 are better, keep it (it is meant to help the other
   changes learn, not to help alone).
7. **Nothing is better and nothing is climbing.** Stop. Do not start new
   runs. Send the owner the report (section 11) with the yard replays of the
   best try of each run; the next step is the owner's decision.

### When a brain is ready for the owner

A brain goes to the owner to try in the game only when, in the yard exam,
it beats **both** run A and today's game brain on **H1 by 5 points or more**
and on **H3** (fewer stuck), with the guard holding in every exam. Then:
watch it in the training viewer (`?training=1&run=<name>`), then the owner
plays the real fight. It never replaces today's brain in place: it gets its
own folders (`model_<steps>/`, `rl/frozen_<steps>/`), and the switch is the
owner's call.

---

## 9. Build instructions (code)

Everything lives in new files under `rl/` (suggested names below) plus small
additions to the existing moving-target files. Python packages are in `.venv`
(torch 2.13 CPU, stable-baselines3 2.9, sb3-contrib 2.9); system Python
lacks torch. Existing code to build on:

- `rl/moving_target.py`: `MovingTarget` (Lola's wander/hide), `ArenaWorld`,
  `JunkyardWorld`, `Grid` (1-unit A* grid), speeds, `MAP_TO_BRAIN`.
- `rl/moving_target_env.py`: `MovingTargetMixin` (moving Lola, urgency cost,
  I1 = `new_inputs`, re-find bonus, lost-her metrics), `MovingTargetEnv`
  (plain arena), `LostHerMetrics`, `summarize_lost_her`.
- `rl/moving_target_brain.py`: `make_copy` (copy of today's brain, widening
  for new inputs), `HYPER`, `SEED`, `ContinuedRate`.
- `rl/moving_target_train.py`: trainer with `--run`, `--steps`, `--tag`;
  checkpoints every 50k; spawns `rl/moving_target_job.py` for exams.
- `rl/moving_target_exam.py`: `run_exam`. `rl/moving_target_game_exam.py`:
  `GameExamEnv` (yard, eye-level sight; one instance per round, seeded).
- `rl/moving_target_shot_probe.py`: the clear-shot counter (its logic
  moves into the exam, item 9).
- Base worlds: `rl_environment.py` `LeaperReachEnv` (circles only: uses
  `self.obstacles` as `(x, z, radius)` in `_collision_for_pose`,
  `_ray_distances`, `_target_sensor`, `_points_visible`, `_generate_obstacles`,
  `_target_reachable`, `reset`), `rl/seeker_env.py` `SeekerEnv` (34 inputs),
  `rl/junkyard_env.py` `JunkyardEnv`.

### Items

1. **Switches (R1, R2, R5, I2)** in `MovingTargetMixin`: flags
   `shot_goal`, `hidden_cost`, `no_hidden_distance`, `not_there_input`.
   Exam environments always run with all scorecard flags off (rule 6) but
   with the run's input flags (I1, I2) on.
2. **R3 "could be here" scorer** (`rl/moving_target_search.py`): on the
   step she leaves sight, compute walking distances from her last-seen cell
   on a 1-unit grid (her radius 0.8) once; each step the candidate set is
   open cells with distance <= 0.638 x steps since; cross off candidates the
   Leaper's sight can see (flat sight in arenas; in the yard use the flat
   raster `JunkyardWorld.hidden_from` plus the 50 map-unit range and 270
   degree view, a cheap stand-in for eye sight that is fine for scoring);
   pay 0.002 per newly crossed-off candidate, cap 3 a round; clear on
   re-sighting. Expose "share left" for B1.
3. **R4 walking distance** (`rl/moving_target_route.py`): Leaper-size grid
   (radius 2.5, fallback 1.5, then straight line), distance from the Leaper
   to her current position each step; recompute only when either moves to
   a new cell. Budget: must not make a run more than 1.5x slower; if it
   does, recompute every 3 steps and keep the last value in between.
4. **Box obstacles** (`rl/candy_arena.py`, subclass of `MovingTargetEnv`):
   obstacles as circles `(x, z, r)` **and** oriented boxes
   `(x, z, length, width, angle)`. Override, for both kinds: leg/body
   collision (`_collision_for_pose`), the 16 rays (`_ray_distances`, range
   28, ray/oriented-rectangle intersection), sight (`_target_sensor`,
   `_points_visible`), and the `ArenaWorld` equivalents `blocked_many` and
   `hidden_from` used by Lola. Test: an arena of only circles gives exactly
   the same observations, rewards and Lola routes as `MovingTargetEnv`
   (seeds 30000-30019, 300 steps each, max difference 0).
5. **W1 generator** in the same file: `WORLD_LIMIT = 56` set per instance
   **before** the base `__init__` (the coverage grid and frontier note are
   sized from it, as `JunkyardEnv` already does). Draw obstacles with the
   counts and sizes of section 5 by rejection sampling (400 tries per
   obstacle; a missing one is fine if the total stays 25-30). Reachability:
   flood fill on a 1-unit grid with the Leaper's clearance (2.5); Lola's
   start and every cell Lola may target (`MovingTarget` wander and hide
   spots) must lie in the flooded region: restrict Lola's grid to it. Redraw
   the arena if under 60% of open floor is reachable. Starts: 32-61 units
   apart, Leaper clearance 3.5. Tests: 1,000 seeded arenas, all valid, no
   start inside an obstacle, generation under 50 ms each.
6. **W2 yard environment** (`rl/moving_target_yard_train.py`): a gymnasium
   env that builds a fresh `GameExamEnv` (with the run's switches) on each
   reset with a new seed, and one of 8 flips/turns. Flip/turn by
   transforming the yard geometry once per version (the flat raster from
   `rl/junkyard_geometry.py` and the eye-sight triangles from
   `rl/junkyard_sight.py`), cached, 8 versions in memory. Test: for random
   poses, the rays and sight in a flipped yard equal the original yard's
   at the mirrored pose. **If this cannot be made exact within half a day,
   train on the un-flipped yard only and say so in the report.** The yard
   exam always uses the un-flipped yard.
7. **World mix**: the trainer builds 16 environments: 5 yard (item 6),
   4 plain arena (`MovingTargetEnv`), 7 big arena (item 5), for every round 1
   run. Use `SubprocVecEnv` if the machine has spare cores (one process per
   environment), otherwise `DummyVecEnv` as today.
8. **B1 critic** (`rl/moving_target_critic.py`): a policy class based on
   `ResidualLstmPolicy` (`rl/seeker_recurrent_policy.py`) whose environment
   observation is actor inputs + 4 privileged numbers at the end. The actor
   path (its LSTM, residual layer, MLP and action head) reads only the
   first N numbers; the critic path (its LSTM, residual layer, MLP, value
   head) reads all N + 4. Copy from today's brain: the critic's input
   weights get 4 zero columns (like `_widen`). Tests: (a) the action is
   identical when the 4 numbers are zero or random; (b) no gradient from
   the 4 numbers reaches any actor weight; (c) the exported actor
   (ONNX, like `public/brains/leaper_7757824/actor.onnx`) takes N inputs.
9. **Exams**: add the clear-shot numbers (H1, H2, share of steps with a
   clear shot) to `GameExamEnv`'s per-round row and summary (from
   `rl/moving_target_shot_probe.py`: clear shot = `target_visible` and distance
   <= 14 x 1.451 units). Extend `rl/moving_target_job.py` so every 50k
   checkpoint runs the practice exam **and** the forgetting check on the
   plain arena (never the run's own worlds), and checkpoints 250k, 500k,
   750k, 1M (and 1.25M ... 2M when extended) also run the yard exam
   (100 rounds, seeds 70000-70099) in its own process. If the forgetting
   check is below 93%, write `status.json` "stopped: forgetting" and stop
   the trainer after the current update.
10. **Trainer**: `python -m rl.moving_target_train --run F1 --try 1`
    (seeds: try 1 = 145032261, try 2 = 145032262), runs F1-F9 defined by
    their codes exactly as in section 6; `--resume <model.zip> --steps
    2015232` continues a run to 2M with the learning-rate line continued
    from where it stopped; output in
    `rl_artifacts/moving_target_round1_<YYYYMMDD>/run_<F>_try<n>/`;
    `config.json` lists every switch and number. Refuses to overwrite an
    existing folder.
11. **Training viewer**: `src/simulation/TrainingVisualizer.js` draws box
    obstacles as plain boxes, each wall in its own bright colour (owner:
    "colourful walls"); no candy details. Circles as today. Nothing else in
    `src/` changes.
12. **Smoke test before the real runs**: every run for 20,480 steps: no
    crash, rewards appear in `rollouts.jsonl`, no NaN, one practice exam
    completes, steps per second recorded. Then `pnpm test` and the `.venv`
    `pytest tests/` still pass as before (one known failure:
    `tests/brain-parity.test.js` free-run lockstep; see `CLAUDE.md`).

### Build time

Roughly 1.5-2 days of work for an AI coding agent, most of it items 4-6
(boxes, big arena, yard versions) and 8 (critic), including the tests.

---

## 10. Running it: machine, order, time

- **Machine: many CPU cores, not a GPU.** The brain is tiny (two layers of
  64 and a 64-slot memory); the time is spent in the Python simulation. A
  GPU sits idle. **32 cores** run all 16 training runs plus their exams at
  once; 16 cores work with exams queued.
- Speeds measured on 2026-11-05 (one core): about 600 steps/s in the plain
  arena, about 71 steps/s in the yard. With 5 of 16 environments in the
  yard, a run does about 180 steps/s on one core: **1M steps in about
  1.5 hours** (the big arena and R3/R4 add some; measure in the smoke test).
- Yard exam: about 25 minutes per 100 rounds on one core, 4 per run.
- **Round 1 on 32 cores: about 2.5-3 hours.** Round 2 extensions to 2M:
  about the same again.
- Order: (1) build and test (section 9); (2) step 0 baseline exams;
  (3) smoke test all runs; (4) start all 16; (5) read results with
  section 7; (6) round 2 by section 8; (7) report (section 11).

---

## 11. What to send back to the owner

1. A results table: every run and try, H1-H5 at 250k / 500k / 750k / 1M
   (and 2M if extended), the forgetting check, the practice exam, and its
   box (better / promising / no help / harmful) with the reason in one line.
2. The baseline numbers from step 0 (today's brain and run A, same exam).
3. What round 2 did and why, quoting the line of section 8 that applied.
4. A plain-language summary (no jargon; explain every short form and unit)
   of what the Leaper learnt, for a game designer.
5. The folders `rl_artifacts/moving_target_round1_<date>/` (models,
   exams, replays, `config.json`, logs) and the code changes as a branch or
   patch, not pushed to the owner's repository unless the owner says so.
6. Anything that did not go to plan (e.g. the yard could not be flipped,
   a run crashed, a number had to change), stated plainly.

---

## 12. Getting the code and files

Everything needed is in the repository `https://github.com/Mercity-AI/RL-Leaper`,
branch `claude/zen-davinci-ku9f5z`, plus one zip from the owner
(`leaper-retrain-handoff-2026-11-06.zip`) holding the brain files git does
not store: `model_7757824.zip` and run A's saved brains in
`rl_artifacts/moving_target_20261105/run_A/`. Setup steps are in
`docs/MOVING_TARGET_HANDOFF_2026-11-06.md`.
