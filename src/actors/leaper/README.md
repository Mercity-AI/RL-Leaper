# The Leaper's behaviour layer

The frozen 7,757,824-step brain (see `src/brain/junkyard/README.md`) only knows
how to walk and turn toward Lola. Everything else the Leaper does in a fight
lives here, **around** the brain:

- it decides **when** the brain may step (it is only ever paused or resumed),
- it moves the Leaper itself for a turn in place, a leap or a fall, and
  **tells the brain the new pose** through the documented pose sync
  (`JunkyardBrain.syncPose`), never by changing what the brain observes,
  its actions or its per-step physics,
- it adds the stomp, the leap, the stagger, going down, dying and the wreck.

Every number a designer may want to change is in
**`src/config/leaper-behaviour.js`** (distances in world units, the brain's own
units: the Leaper is about 8 units across at every size; times in seconds).
The leg rules (how many lost legs knock it down, how much each lost leg slows
it) are in `src/config/combat.js` (`COMBAT.legs`).

## Files

| File | What it does |
|---|---|
| `LeaperDirector.js` | The decision layer: a state machine with no engine code (Node-testable). |
| `LeaperActor.js` | Carries the decisions out for one Leaper: brain pause/resume/sync, movement, attacks, Lola's collision shape, HUD readout. `Encounter` builds one per Leaper (`leaperBehaviour` option). |
| `SnapshotPlayout.js` | Plays the brain's replies back smoothly (no 10 Hz surge, no stop-go limp). |
| `leapPlanner.js` | Where a pounce lands (clear spot, a few angles off the line, never onto Lola) and the arc of the jump. |
| `LeaperFeedback.js` | Hull hit flash, sparks, the joint-break burst, ground rings, shockwave, death debris. |
| `PlayerKnockback.js` | Shoves Lola when an attack says so, through her own collide-and-slide mover. |
| `leaperEvents.js` | The event names it announces on the game's event bus. |
| `../../ui/LeaperHudView.js` | The Leaper panel: name, state badge, health meter, eye status; with `?debug` a one-line readout of the state machine. |

## States

| State | Movement | Eye bolts | When |
|---|---|---|---|
| Dormant | held still | no | the run is not on, or Lola is down |
| Search | **the brain walks** | no | it has not seen Lola (or forgot her) |
| Chase | **the brain walks** | yes | the brain sees her, or saw her recently |
| Engage | held; turns in place to face her | yes | she is seen, in the eye's line of fire, within `engage.enterDistance` |
| Stomp | held; crouches | no | she stayed inside its reach for `stomp.trigger` s |
| Leap | crouch held, then a scripted jump | no | she is seen `leap.minDistance`-`maxDistance` away and a landing spot is clear |
| Stagger | held; rocks back | no | a joint snapped, or a crit on the eye core |
| Downed | held; on the floor | yes (a vulnerable phase, 1.5x damage) | `COMBAT.legs.maxLost` legs lost |
| Dying | the collapse | no | its health reached 0 |
| Dead | a wreck | no | after the collapse; Lola can walk up to it |

The brain is only stepped in Search and Chase. While held, the panel's brain
badge says why (`HELD · ENGAGING`). After a turn in place (Engage) or a leap,
the brain is told the new pose before it walks again. Turning in place only
happens where the world's conservative test says the whole leg span is clear at
any heading, so the brain always accepts the pose.

**The leap, step by step.** The Leaper crouches and the landing spot is marked
on the ground. Meanwhile the landing pose is sent to the brain (a pose sync),
which checks it with its own collision rules; if it refuses (or does not
answer within `leap.acceptTimeout`), the leap is called off and the brain is
told it never left. Otherwise the Leaper jumps (`leap.flight` s, a ballistic
arc; high up it no longer blocks Lola), lands with a shockwave (damage and a
knockback near the landing), the camera shakes, and the brain gets a second
sync from the landing spot so it looks around from there before it walks on.

**Legs.** Every broken joint is a big hit (a stagger) until `maxLost` legs are
gone: then it goes down. It gets up limping after `downed.recoverTime`, unless
another leg breaks (while down, while getting up, or later): then it stays down
for good. Severed legs no longer block Lola (player contact rules v4).

## Events (on the game's event bus)

`leaperStateChanged`, `leaperAttack` (stomp / leap phases, whether Lola was
hit), `leaperStaggered`, `leaperDowned`, `leaperDied`, `jointBurst`,
`lolaKnockback`. Payloads are listed in `leaperEvents.js`.

## Sound

Optional sound slots (drop a `.wav` into `public/audio/`, see
`public/audio/SOUND-SLOTS.md`): `leaper-charge`, `leaper-lock`,
`leaper-stomp-windup`, `leaper-stomp`, `leaper-leap-windup`, `leaper-land`,
`leaper-stagger`, `leaper-downed`, `leaper-collapse`, `leaper-joint-burst`.

## Tests

- `tests/leaper-director.test.js`: every transition and timing of the state machine.
- `tests/leaper-actor.test.js`: the real rig and animator with a stand-in brain:
  pausing and resuming, the turn in place and its sync, the stomp, the leap and
  its syncs, stagger, downed, the collapse and the wreck's collision.
- `tests/leaper-motion.test.js`: smooth playback at 30/60/144 fps, with late
  replies and lost legs (no surge, no stalls).
- `tests/leaper-leap.test.js`, `tests/leaper-range.test.js`,
  `tests/contact-v4.test.js`, `tests/leaper-leg-damage.test.js`.
- `tests/leaper-behaviour.html` (browser, the real game with the in-browser
  brain): a stomp, a leap with the brain synced to the landing spot, four knees
  to Downed, the kill to a wreck, and Lola's real gun (hit flash, a weak-point
  crit stagger).
