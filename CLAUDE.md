# Claude handoff — Leaper

Read `AGENTS.md`, `TRAINING.md`, and `RL_SPEC.md` before editing. The owner is a
game designer, not a programmer; explain results in plain language.

## Paste-ready task

Continue the Leaper RL project in `E:\Leaper`. Do not change the target sensor,
arena, vision, movement speeds, or seeker reward unless required below.

PPO_28 is complete in `rl_artifacts/ppo_28_slow_seeker_500k/`. Its final
100-episode deterministic result was 71% success, but 56.73% of deterministic
steps had zero throttle. Diagnosis showed that every stopped action had a
negative raw Gaussian throttle which the asymmetric `[0,1]` action space clipped
to zero. About 89.8% of stopped steps happened before first target sight.

Implement the next run as follows:

1. Change the policy throttle action range from `[0,1]` to normalized `[-1,1]`.
2. Keep movement forward-only. Convert the policy command internally with
   `physical_throttle = (action[0] + 1) / 2`. Thus `-1=stop`, `0=half speed`, and
   `1=full speed`; negative values must never mean reverse.
3. Keep turning action at `[-1,1]` and physical turn speed at 9 degrees/step.
4. Keep physical movement speed at 0.375 units/step and `MAX_STEPS=1000`.
5. Add a non-collision freeze rule: 60 consecutive steps with no physical
   translation ends the episode as a true terminal failure with a one-time `-10`
   penalty. Any real translation resets the counter. Turning in place counts as
   no translation; 60 steps still allows three 180-degree scans at 9 degrees/step.
6. Preserve the existing 40-step collision-stuck rule unless tests reveal a
   conflict. Report the new freeze penalty separately in diagnostics if practical.
7. Warm-transfer PPO_28's policy/value weights into a newly constructed PPO model
   with the normalized action space. Do not use `PPO.load(..., env=new_env)` if
   Stable-Baselines3 rejects the changed bounds. Build the new model, selectively
   load compatible policy weights, and reset optimizer state. Observation shape
   remains 26.
8. Update Python tests for the normalized mapping, no reverse, freeze counter
   reset, terminal failure at step 60, and compatibility of transferred weights.
9. Keep browser replays deterministic-only. Preserve the target status display:
   `NOT DISCOVERED`, `VISIBLE`, and `REMEMBERED / CURRENTLY HIDDEN`.
10. Update `RL_SPEC.md`, `TRAINING.md`, and the current handoff in `AGENTS.md`.
11. Run validation and a separate 20k smoke test first. Only start an isolated
    500k run if the smoke is healthy. Do not run PPO_28 unchanged for 800k.
12. Whenever training starts, show the owner the live replay viewer and
    TensorBoard links, attach a completion watcher/heartbeat, and automatically
    report final deterministic results without waiting for the owner to ask.

Use a new run name and artifact directory (suggested:
`PPO_29_NORMALIZED_THROTTLE` and `rl_artifacts/ppo_29_normalized_throttle_500k/`).
Never overwrite PPO_27 or PPO_28 artifacts. Generated RL artifacts stay ignored.

## Current facts

- PPO_27 seeker: `rl_artifacts/ppo_27_seeker_500k/`, 64% deterministic success.
- PPO_28 slow seeker: `rl_artifacts/ppo_28_slow_seeker_500k/`, natural seed
  742698, 507,904 transitions, 71% deterministic success, 29% timeout, 1.90%
  collision steps.
- Current seeker: randomized tagged target, target coordinates hidden until
  unobstructed sight, 120-step age channel with remembered position, 16 obstacle
  rays over 270 degrees at range 28, world limit 31.25, six random obstacles.
- PPO_28 reward: first-ever sight `+0.5`; exploration only before discovery;
  post-sight symmetric distance progress; time `-0.002`; idle `-0.04`; collision
  `-0.18`; collision-stuck `-10`; goal `+25`.
- Local viewer: `http://127.0.0.1:5173/?training=1` when Vite is running.
- TensorBoard: `http://127.0.0.1:6006/` when launched against `rl_artifacts`.
- The current code does **not yet** contain the normalized throttle or 60-step
  general freeze rule. Those are the next implementation task.
