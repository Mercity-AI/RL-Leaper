# Hypothesis — what are we doing?

A PPO policy should be able to teach the hexapod (Leaper) to cross an
obstacle-laid arena on its own, just from rewards for getting closer to the
target and for reaching it — no scripted spoon-feeding. If it moves far, avoids
getting stuck, and completes the mission, we win.

---

# 1. Setup summary — How did we do it?

## Two connected environments

We prepared two versions of the Leaper environment:

- **JavaScript / Three.js environment:** displayed the hexapod, arena,
  obstacles, target, movement, and saved training replays in the browser.
- **Python / Gymnasium environment:** ran the actual reinforcement-learning
  training. It used a faster, simplified top-down representation of the same task.

The Python environment did not simulate detailed joints, balance, motors, or
realistic leg physics. Instead, it trained the robot as a moving body with
collision points representing its body and legs.

## Training conditions

- Arena: **50 × 50 units** (coordinates run from −25 to +25 on each axis)
- Target: fixed at **(18, 18)**
- Obstacles: **five fixed circular obstacles**
- Starting point: random valid position and direction each attempt
- Attempt length: maximum **400 steps**
- Maximum movement: **0.75 units per step**
- Maximum rotation: **18° per step**
- Success: reaching the target area
- Collision (through PPO_11): movement **and** rotation were both rejected, but
  the attempt continued (this rule is changed in PPO_12)

The final collision model checked:

- One body point
- Three points on each of six legs
- **19 collision points in total**

![Collision model — 19 body and leg points](Screenshot%202026-08-11%20171934.png)

## What the model could control and observe

The robot controlled:

- Forward / reverse movement
- Left / right turning

By PPO_9, it received **ten** pieces of information:

- Its position
- Direction and distance to the target
- Its facing direction
- Whether it had just collided
- Its previous movement and turning commands

At this stage it did **not** have cameras, obstacle-distance sensors, a map, or
detailed leg-joint information. (Forward-looking obstacle sensors are added later,
in PPO_11 — see the outcomes below.)

## Reward system

The final reward design gave:

- A small reward for moving closer to the target
- A penalty for moving farther away
- **−0.01** per step
- **−0.18** per collision
- **+25** for reaching the target

## Training stack

- Algorithm: **PPO reinforcement learning**
- Eight environments trained in parallel
- **8,192 experiences** collected before each learning update
- Ten learning passes per update
- Seed: **7** (fixed through PPO_11; from PPO_12 onward each run uses a fresh
  natural random seed, recorded in `training_config.json`)
- Checkpoint evaluation every **10,000 steps**
- Training: Python, Gymnasium, Stable-Baselines3 and PyTorch
- Training ran on the CPU
- TensorBoard and Matplotlib recorded the learning curves
- Three.js replayed the results in the browser

---

# Outcomes — what did we find?

## PPO_1–2: proving the basic task was learnable

- **PPO_1** was a short 24,576-step technical test. It confirmed that the
  training pipeline, reward logging, and model saving worked.
- **PPO_2** used the same basic setup for 303,104 steps. It reached about
  **60% success at its best archived checkpoint** and **57% success in the final
  100-attempt evaluation**.

PPO_2 was the strongest-performing early run, but it had an important limitation:
only the robot's central body could collide. Its legs could pass through
obstacles. It proved that PPO could learn navigation in the simplified arena, but
not that it could control the more realistic collision-aware hexapod.

## PPO_3–4: realistic leg collisions changed the problem

- **PPO_3** introduced 18 leg collision checks, bringing the total to 19
  collision points. Its last recorded checkpoint reached only **4% success**
  before the run was stopped at 229,376 steps.
- **PPO_4** trained the full collision model for 303,104 steps. Its final
  evaluation reached **7% success** with a mean reward of **−46.23** (only 4% at
  the 300k checkpoint).

This was the first dramatic result. Adding the legs reduced performance from
PPO_2's 57% final success to single digits. PPO_4 also showed that simply
extending training to 300,000 steps was not enough to recover the lost
performance.

The realistic collision system introduced a new difficulty: when any body or leg
point collided, both movement and turning were rejected. This could leave the
robot repeatedly attempting the same blocked action.

## PPO_5–8: reward changes improved scores, but not reliable behavior

- **PPO_5** collected 106,496 steps, but its exact reward change and final
  evaluation were not preserved. It should be treated as an exploratory run, not
  used for a formal conclusion.
- **PPO_6** tested a time-decaying goal reward over 303,104 steps. It finished
  with **0% success** and a mean reward of **−17.57**.
- **PPO_7** was interrupted at 147,456 steps and its reward experiment was later
  withdrawn.
- **PPO_8** introduced the final documented reward system based on target
  progress, time, collisions, and goal completion. It completed 303,104 steps but
  still finished with **0% deterministic success**.

PPO_8's average training reward improved from roughly **−59.53 during its first
100 attempts** to about **−25.94 during its last 100**. However, every
deterministic checkpoint still reported 0% success.

This distinction is important: the training score improved while exploratory
randomness was active, but the final policy did not produce useful movement when
evaluated without randomness.

## PPO_8's major finding: the robot learned to freeze

Detailed evaluation revealed that PPO_8:

- Timed out in **100%** of deterministic attempts.
- Used zero throttle on approximately **99%** of steps.
- Made effectively **zero progress** toward the target.
- Usually remained stationary rather than risking a collision.
- Occasionally entered a collision loop lasting until the 400-step timeout.

The robot had learned that standing still was comparatively safe. Moving could
cause a collision penalty, while stopping only produced the smaller time penalty.

The target itself was reachable: a typical starting position required
approximately **39–43 full-speed steps**, compared with the 400-step limit.
Therefore, the main problem was not insufficient time or an unreachable target.
It was the strategy encouraged by the available controls and collision
consequences.

## PPO_9: collision memory helped exploration, not final deployment

PPO_9 added three new observations:

- Whether the previous action collided.
- The previous movement command.
- The previous turning command.

This gave the model more context for understanding why it had failed to move.

Near the end of training:

- Exploratory training success reached approximately **10%**.
- Mean target progress during training improved to about **6.65 units**.
- The model remained active while exploratory randomness was present.

However, the final deterministic evaluation produced:

- **0% success**
- **100% stopped steps**
- **Zero mean target progress**
- Mean reward of **−6.03**

The new collision memory improved exploratory behavior, but it did not change the
model's preferred final action. PPO_9 therefore isolated the one-sided forward
control as the next likely cause of the freeze.

## PPO_10: reverse movement finally broke the freeze

PPO_10 made one controlled change: movement became a signed control.

- Negative values moved backward.
- Zero stopped the robot.
- Positive values moved forward.

This produced the clearest behavioral improvement so far:

| Metric | PPO_8 | PPO_9 | PPO_10 |
| --- | --- | --- | --- |
| Deterministic success | 0% | 0% | **5%** |
| Timeout rate | 100% | 100% | **95%** |
| Mean target progress | ~0 | 0 | **6.29 units** |
| Stopped steps | ~100% | 100% | **0%** |
| Forward steps | ~0% | 0% | **54.64%** |
| Reverse steps | 0% | 0% | **45.36%** |

![PPO_10 movement — the freeze is broken](Codex%20Image%20Aug%2013,%202026,%2005_46_20%20PM.png)

The latest 100 exploratory training attempts also reached:

- **34% success**
- **16.14 units of mean target progress**
- Mean reward of approximately **−0.48**

These exploratory results show that the robot learned useful movement patterns,
but they must remain separate from the stricter 5% deterministic result. PPO_10
began moving and approaching the target — but it still could not reliably escape
obstacles, because it had no way to sense them before contact.

## PPO_11: giving the robot sight — the breakthrough

PPO_11 made one controlled change: it added **eight obstacle-clearance
rangefinder "rays."** These fan out every 45° around the robot's facing (one
straight ahead) and report the clear distance to the nearest obstacle or wall.
The observation grew from **10 to 18** values. We did not tell the robot to avoid
obstacles — it only gained the sensor readings and had to learn avoidance from
the same unchanged −0.18 collision penalty.

This was the decisive result of the whole project:

| Metric | PPO_10 (blind) | PPO_11 (rays) |
| --- | --- | --- |
| Deterministic success | 5% | **69%** |
| Timeout rate | 95% | **31%** |
| Mean reward | −28.04 | **+12.96** |
| Mean target progress | 6.29 | **22.79 units** |
| Collision rate | 38.87% | **24.50%** |
| Average episode length | 381.92 | **163.64 steps** |

**69% deterministic success is the best in the project's history** — higher even
than the body-only PPO_2 (57–60%) in the much harder 19-point collision arena.
The robot now reaches the target and *ends* the attempt rather than timing out.
Two honest caveats: the policy settled on a mostly-**reverse** gait (backing
toward the target scores just as well, so PPO committed to it — cosmetic, since
net progress is strongly positive), and 31% of attempts still time out, with one
attempt still stuck in a full 400-step collision streak.

### PPO_11 seed replication — is it the sensor, or luck?

To prove 69% was the sensor and not seed-7 luck, we re-ran the exact same setup
on two more seeds. Two findings, both important:

| Metric | Seed 7 | Seed 11 | Seed 23 |
| --- | --- | --- | --- |
| Deterministic success | 69% | 54% | 39% |
| Collision rate | 24.50% | 42.92% | 42.08% |
| Mean longest collision streak | 31.5 | 92.7 | 112.0 |
| Stochastic training success | 83% | 88% | 93% |

1. **The rays are confirmed, decisively.** All three seeds tower over the blind
   PPO_10 baseline (5%). Stochastic training success is high and tight (83–93%).
   The jump is the sensor, not luck.
2. **But getting *unstuck* is still not solved, and it is seed-sensitive.**
   Deterministic success spans 39–69% (mean about 54%), and seeds 11 and 23 spend
   ~43% of steps colliding. Seed 7 was simply the luckiest on collisions, which
   flattered the first result. Every seed still has attempts that reach a ~400-step
   collision streak.

The mechanism is the old collision rule: a blocked step rejected *both* turning
and moving, so a deterministic policy facing an obstacle re-issued the same
rejected action and looped until timeout, while exploratory randomness escaped.

## PPO_12: letting a stuck robot wriggle free

PPO_12 kept the rays and changed only the collision response. Previously, when a
combined turn-and-move was blocked, the robot froze in place. Now the two are
resolved **independently**: the robot rotates in place if the turned pose alone is
clear, then moves along the resolved facing if that alone is clear. A touching
robot can finally turn or reverse out of contact. (Reward semantics are
unchanged — the penalty still reflects the full intended move.) This is also the
first run to use a fresh natural random seed (53054) instead of the fixed seed 7.

| Metric | PPO_11 (seeds 7 / 11 / 23) | PPO_12 (natural seed) |
| --- | --- | --- |
| Deterministic success | 69% / 54% / 39% | **65%** |
| Mean reward | +12.96 / −1.70 / −10.48 | **+6.09** |
| Collision rate | 24.5% / 42.9% / 42.1% | 40.47% |
| Mean longest collision streak | 31.5 / 92.7 / 112.0 | **62.8** |
| Average episode length | 163.6 / 219.0 / 270.8 | **174.5 steps** |

A modest, real improvement rather than a knockout:

- **What worked:** the escape mechanic is proven — unit tests confirm a wedged
  robot now rotates or reverses out of contact instead of freezing. Deterministic
  success (65%) sits at the strong end of PPO_11's spread and clearly above its
  seed average (~54%), and typical jams are much shorter (mean longest streak 62.8
  vs PPO_11's worse seeds at 92.7 and 112.0).
- **What did not:** the deterministic collision *rate* did not fall (40.47%), and
  one attempt still reached a full 400-step streak. Part of the high number is a
  measurement artifact — the collision flag marks any blocked intended move even
  when the robot then successfully wriggles out, so sliding along an obstacle edge
  registers a collision every step.

The lesson: **avoiding contact is a different skill from escaping it.** PPO_12
gave the robot more ways out, but the unchanged −0.18 penalty still leaves it
willing to grind past obstacles. Caveat: this is a single natural-seed run against
PPO_11's three seeds, so the trustworthy evidence for the fix is the shorter jam
length and the unit-tested escape behavior, not the headline success percentage.

## Overall findings

The experiment identified five major lessons:

1. **The simplified task was learnable.** PPO_2 performed well, but its body-only
   collision system was not sufficiently realistic.
2. **Leg collisions became the primary difficulty.** Performance dropped sharply
   (57% → single digits) once the six legs were included.
3. **Reverse movement solved the freeze, but not navigation.** PPO_10 began moving
   and approaching the target, but could not reliably escape obstacles.
4. **Giving the robot sight was the breakthrough.** Eight obstacle-sensing rays
   took deterministic success from 5% to 69% — the best in project history —
   confirmed across three seeds.
5. **Escaping contact is a separate, still-open skill.** Decoupling the collision
   response (PPO_12) lets a stuck robot wriggle free and shortens jams, but did
   not lower the collision rate on its own.

The training curves support the same story: for several runs, exploratory reward
improved without corresponding deterministic success. PPO_10 was the first run
where better training behavior also produced active deterministic movement, and
PPO_11 was the run where deterministic performance finally jumped.

## Where we stand and what's next

The rays and the decoupled collision response are permanent keepers. The remaining
problem is **contact avoidance**, not escape. The next single controlled
experiment (**PPO_13**) is to attack it directly: raise the collision penalty
above −0.18 so grinding along an obstacle costs the robot more reward, keeping the
rays, the decoupled physics, and all PPO settings unchanged. An alternative single
change is denser or longer-range rays so the robot can see narrow gaps. As always,
we test only one thing at a time.
