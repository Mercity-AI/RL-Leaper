# Leaper RL Report

## Run progress: PPO_10 → PPO_12

### Starting point — PPO_10 (short recap)

PPO_10 was the first run where the robot actually moved. Earlier runs had learned
to freeze in place, because standing still was the safest way to avoid the
collision penalty. PPO_10 fixed that by letting the throttle go negative
(reverse), so freezing was no longer the only safe option.

It worked, but the robot was still blind to obstacles:

- Deterministic success: **5%**
- Collision rate: **38.87%** of steps (worst streak 399 of 400)
- Average episode length: **381.9** of 400 steps — it almost always ran out of
  time instead of reaching the goal

The robot had no way to see an obstacle coming; its only obstacle signal was a
single bit that turned on *after* it had already hit something. So it ground into
obstacles and kept grinding. That single weakness — no forward vision — is what
PPO_11 set out to fix.

---

### PPO_11 — obstacle vision (eight rangefinder rays)

**Hypothesis — what are we doing?**
If we give the robot forward-looking sight of obstacles, it should learn to steer
around them before contact instead of grinding into them, so success should rise
and collisions should fall. We change only the sensors so that any change in
behavior can be attributed to sight and nothing else.

**Setup — what changed:**

- Added **eight rangefinder rays** to the observation; nothing else changed.
- Observation grew from **10 values to 18**. The rays fan out from the body, one
  every 45° (the first straight ahead), each reporting how far is clear before an
  obstacle or wall.
- We do not tell the robot to avoid obstacles — it only gets the readings. The
  unchanged −0.18 collision penalty supplies the incentive, and PPO must learn the
  avoidance itself.
- Everything else identical to PPO_10: reward, physics, action space, target,
  obstacles, PPO settings, 106,496 collected steps. Confirmed across 3 seeds.

**Outcomes:**

| Metric (deterministic exam) | PPO_10 (blind) | PPO_11 (rays) |
|---|---:|---:|
| Success rate | 5% | **69%** |
| Collision rate | 38.87% | 24.50% |
| Mean longest collision streak | 49.44 | 31.54 |
| Average episode length | 381.9 | 163.6 |

This was the biggest single jump in the project — **69% success, the best Leaper
has produced**, and higher than the older body-only run (60%) that never had legs
to catch on obstacles. Episodes became about twice as short because the robot now
reaches the goal and finishes rather than wandering into things until time runs
out. Re-running with two more seeds gave 69% / 54% / 39%: every seed towered over
blind PPO_10's 5%, confirming the gain came from the sensor, not a lucky seed.

One problem remained: once the robot was already stuck *touching* an obstacle, it
still couldn't reliably work its way free (the two harder seeds spent ~43% of
steps in collision). That leftover weakness is what PPO_12 set out to fix.

---

### PPO_12 — collision recovery (let a stuck robot turn or back out)

**Hypothesis — what are we doing?**
The rays let the robot avoid obstacles, but once it is pinned against one it stays
stuck until the episode times out, because a blocked move cancels *both* the turn
and the step. If we let the turn and the step resolve independently, a pinned
robot should be able to rotate or reverse out of contact, so jams should get
shorter and success should hold or rise. We change only the collision physics.

**Setup — what changed:**

- Changed the collision **response** only; nothing the robot senses or is rewarded
  for changed. Before PPO_12, if the next move (turn and step combined) would hit
  something, the whole move was cancelled and a deterministic policy re-issued the
  same blocked move until the 400-step timeout.
- The fix retries the two halves **separately**: first turn in place if that alone
  is clear, then step from the new facing if that alone is clear.
- Everything else identical to PPO_11: the 18-value observation with rays, reward,
  action space, target, obstacles, PPO settings, 106,496 collected steps.

**Outcomes:**

| Metric (deterministic exam) | PPO_11 (3 seeds) | PPO_12 |
|---|---|---:|
| Success rate | 69% / 54% / 39% | **65%** |
| Mean reward | +12.96 / -1.70 / -10.48 | +6.09 |
| Collision rate | 24.5% / 42.9% / 42.1% | 40.47% |
| Mean longest collision streak | 31.5 / 92.7 / 112.0 | 62.8 |
| Average episode length | 163.6 / 219.0 / 270.8 | 174.5 |

The escape mechanic is proven — unit tests show a wedged robot now rotates or
reverses out instead of freezing. Success (65%) landed at the strong end of
PPO_11's range and above its three-seed average (~54%), with short episodes (174
steps) meaning the robot reaches the goal and stops. Typical jams got shorter too:
mean longest collision streak fell to 62.8, well below PPO_11's worse seeds (92.7,
112.0).

The one thing that did not improve was the collision *rate* (40.47%). Part of that
is a measurement quirk — the collision flag counts any blocked intended move even
when the robot then successfully slides or reverses, so grinding along an obstacle
edge while still making progress logs a collision every step.

---

## 1. Sensors

The robot does not carry separate physical sensors mounted on its head or legs. In
the RL environment every "sense" is one number in an 18-value list the brain reads
each step. Most are facts the robot knows about itself; the obstacle vision is
eight rangefinders, and **all eight originate from the single body center** and
fan outward. (A separate set of 19 points across the body and legs exists only as
collision *test* points for the physics — see Environment design — not as sensors
the brain reads.)

**Sampling rate / data format (applies to every sensor below):** all values are
sampled once per environment step — the simulation is discrete-time, so there is
no Hz rate; one full 18-value reading is produced each step, right before the
robot chooses its action. Every value is a `float32`. Navigation and memory values
are normalized to roughly `[-1, 1]`; ray values are normalized to `[0, 1]`. On
`reset()` the memory values (last collision, previous throttle, previous turn)
start at 0.

**A — Self / navigation sensors (7 values, origin: body).** Proprioception, not
obstacle sensing.

| # | Sensor | Type | What it measures | Output |
|---:|---|---|---|---|
| 0 | position x | localization | body's east/west position ÷ 25 | float ~[-0.84, 0.84] |
| 1 | position z | localization | body's north/south position ÷ 25 | float ~[-0.84, 0.84] |
| 2 | target direction x | goal bearing | unit vector to goal, left/right part | float [-1, 1] |
| 3 | target direction z | goal bearing | unit vector to goal, forward/back part | float [-1, 1] |
| 4 | distance to goal | range-to-goal | straight-line distance, scaled 0–1 | float [0, 1] |
| 5 | facing (sin) | heading | which way the body points, part 1 | float [-1, 1] |
| 6 | facing (cos) | heading | which way the body points, part 2 | float [-1, 1] |

**B — Short-term memory sensors (3 values, origin: body's own last step).**

| # | Sensor | Type | What it measures | Output |
|---:|---|---|---|---|
| 7 | last collision | contact memory | 1 if it hit something last step, else 0 | float {0, 1} |
| 8 | previous throttle | action memory | how hard it drove last step | float [-1, 1] |
| 9 | previous turn | action memory | how hard it turned last step | float [-1, 1] |

**C — Obstacle vision: eight rangefinder rays (8 values, origin: body center).**
Added in PPO_11 — the sensor that took success from 5% to 69%. The rays fan out
every 45° around the current facing (ray 0 straight ahead). Each measures the
clear distance to the nearest obstacle or wall along its line, divided by
`RAY_MAX_RANGE = 12.0` and clipped to `[0, 1]`: **1.0 = clear (nothing within 12
units), 0.0 = touching.** The measurement is analytic ray-vs-circle geometry
against the five obstacles plus ray-vs-wall against the boundary, keeping the
nearest hit.

| # | Ray direction (relative to facing) | Output |
|---:|---|---|
| 10 | 0° (straight ahead) | float [0, 1] |
| 11 | 45° | float [0, 1] |
| 12 | 90° | float [0, 1] |
| 13 | 135° | float [0, 1] |
| 14 | 180° (straight back) | float [0, 1] |
| 15 | 225° | float [0, 1] |
| 16 | 270° | float [0, 1] |
| 17 | 315° | float [0, 1] |

Full sensor suite: **7 navigation + 3 memory + 8 vision = 18 values**, all read
from the body. No head- or leg-mounted sensors exist in the RL model.

## 2. Capabilities / Action space

Each step the brain outputs exactly **two continuous numbers**, each in `[-1, 1]`
and clipped to that range. Everything the Leaper can do comes from these two
controls — there is **no jump, strafe, or per-leg action in the RL action space**;
the articulated legs are visual only and are not independently commanded.

| # | Control | Range | Effect and constraint |
|---:|---|---|---|
| 0 | throttle | [-1, 1] | Signed drive. Distance this step = throttle × `MOVE_SPEED (0.75)` units. +1 = full forward, 0 = stop, −1 = full reverse. |
| 1 | turn | [-1, 1] | Rotation this step = turn × `TURN_SPEED (18°)`. +1 = full turn one way, −1 = the other. |

Concrete behaviors these two controls produce:

- **Move forward** — positive throttle, near-zero turn (up to 0.75 units/step).
- **Move backward** — negative throttle (reverse; added in PPO_10, which is what
  cured the freezing).
- **Turn left / turn right** — nonzero turn, up to 18° per step.
- **Arc / curve while moving** — throttle and turn together (drive and rotate in
  the same step).
- **Stop** — throttle at 0.

**Constraints on every action:**

- Speed is capped at 0.75 units per step and turn at 18° per step; the throttle
  and turn values only scale within those caps.
- A step whose combined move would collide is blocked. Since PPO_12 the turn and
  the step are resolved independently, so a touching robot can still rotate or
  reverse out of contact, but it cannot pass through an obstacle or the wall.
- Actions are continuous (variable intensity), not discrete buttons.

## 3. Underlying AI model

**Type.** A Stable-Baselines3 **PPO** agent using the default **MlpPolicy** (an
actor-critic network). It is not a vision/CNN model — the input is a short list of
18 numbers, not an image, so a small fully-connected (MLP) network is the correct
choice. It runs on **CPU**.

**Shape.** Two separate small networks that share no layers:

- **Actor** ("policy") — chooses the action.
- **Critic** ("value") — estimates how good the situation is (used only during
  training).

Both share the same shape: input 18 → hidden 64 → hidden 64, with `tanh`
activations between layers.

```
ACTOR   18 → Linear(18→64) → tanh → Linear(64→64) → tanh → Linear(64→2)  → 2 action means
                                                          + log_std (2)     (exploration spread)
CRITIC  18 → Linear(18→64) → tanh → Linear(64→64) → tanh → Linear(64→1)  → 1 value estimate
```

The `log_std` is 2 learned numbers controlling how much random exploration the
actor adds during training; at evaluation the robot uses the actor's mean output
(no randomness).

**Layers.** Each network is 2 hidden layers of 64 units plus an output layer:
actor 18→64→64→2, critic 18→64→64→1.

**Parameter count (exact, verified from the trained PPO_12 model):**

| Part | Parameters |
|---|---:|
| Actor hidden layers (18→64→64) | 5,376 |
| Actor action output (64→2) | 130 |
| Exploration spread (log_std) | 2 |
| **Actor total** | **5,508** |
| Critic hidden layers (18→64→64) | 5,376 |
| Critic value output (64→1) | 65 |
| **Critic total** | **5,441** |
| **Whole model (all trainable)** | **10,949** |

The entire brain is about 11,000 numbers — a genuinely tiny network, which is why
it trains quickly on CPU.

## 4. Environment & experiment design

### Observation space

`Box(-1.0, 1.0, shape=(18,))` — the 18-value list detailed in section 1 (7
navigation + 3 memory + 8 rays), all `float32`.

### Action space

`Box(-1.0, 1.0, shape=(2,))` — the throttle + turn controls detailed in section 2.

### Reward structure

Each step the score changes by adding four pieces; this is the whole formula, with
no hidden terms (no upright, energy, or balance terms):

```
reward = progress + time + collision + goal
```

| Piece | Exact value | When | Purpose |
|---|---|---|---|
| Progress | 0.2 × (distance closed this step) | every step | Pays for getting closer to the goal — the main incentive. Symmetric, so moving away costs the same, and dithering nets zero. |
| Time penalty | −0.01 | every step | A small "hurry up" tax. |
| Collision penalty | −0.18 | only on steps it hit something | Discourages bumping obstacles or walls. |
| Goal reward | +25.0 | once, on reaching the goal | The payoff for success. |

Code constants: `DISTANCE_REWARD_SCALE = 0.2`, `STEP_PENALTY = 0.01`,
`COLLISION_PENALTY = 0.18`, `GOAL_REWARD = 25.0`. "Reaching the goal" means getting
within **2.15 units** of the target center (target radius 1.4 + body radius 0.75).

### Termination conditions

- **Success** — the robot reaches within 2.15 units of the target.
- **Timeout** — the episode hits `MAX_STEPS = 400`.
- Collisions never end an episode; they only apply the penalty and block the move.

### World and collision setup

- Arena: a `[-25, 25]` square (`WORLD_LIMIT = 25`).
- Target: fixed at `(18, 18)`, radius 1.4.
- Obstacles: five fixed circles — `(-10,-5) r3.2`, `(1,4) r3.0`, `(10,11) r2.8`,
  `(-7,13) r2.6`, `(12,-8) r3.4`.
- Collision test shape: 19 points — the body center (radius 0.75) plus 3 points
  along each of the 6 legs at distances 1.2 / 2.2 / 3.24 from the body (radius
  0.24 each). A pose collides if any of the 19 overlaps an obstacle or crosses the
  wall.
- Spawn: each episode starts at a random collision-free position and facing, not
  too close to the target.

### Training configuration and hyperparameters (unchanged PPO_8 → PPO_12)

| Setting | Value | Meaning |
|---|---|---|
| policy | MlpPolicy | actor-critic MLP |
| parallel environments | 8 | 8 robots practice at once |
| learning rate | 0.0003 | size of each learning step |
| n_steps | 1,024 per env | experience gathered before each update |
| rollout size | 8,192 | 1,024 × 8 experiences per update |
| batch size | 256 | mini-batch per gradient step |
| epochs | 10 | reuses of each batch |
| gamma | 0.995 | weight on future reward |
| GAE lambda | 0.95 | value-estimate smoothing |
| entropy coefficient | 0.01 | nudge to keep exploring |
| seed | random per run (fixed 7 through PPO_11) | randomness source |

A requested 100,000-step run actually collects **106,496** steps, because PPO
finishes whole 8,192-step rollouts.

### Learning rate / learning schedule

The learning rate is the size of the step the network takes each time it adjusts
itself toward better behavior — small enough to be stable, large enough to still
make progress. Leaper uses a learning rate of **0.0003** (also written `3e-4`).

This rate is held **constant for the entire run** — there is no decay or annealing
schedule, so the robot learns at the same 0.0003 rate on its first update and its
last. (Stable-Baselines3 supports a schedule that shrinks the rate over time, but
we deliberately keep it flat so that when we change one thing between runs, the
learning rate is never a hidden second variable.) The same 0.0003 was used
unchanged across PPO_8 through PPO_12.

### Evaluation setup

- **Deterministic exam:** 100 episodes on fixed seeds 10,000–10,099, with the
  robot always taking its best (mean) action — no randomness. This exam is
  identical for every run, so PPO_10 vs PPO_11 vs PPO_12 is a fair comparison.
  Every success-rate headline above comes from this exam.
- **Stochastic summary:** the last 100 training episodes, reported separately.
  These run higher than the exam and are never treated as the real deployment
  result.
- Checkpoints and a short evaluation run every 10,000 steps during training.
