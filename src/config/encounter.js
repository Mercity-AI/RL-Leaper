// Artist-facing encounter proportions and damage reaction.
export const ENCOUNTER = Object.freeze({
  leaperSize: 1.2,
  // Leaper size the junkyard starts at (the OPTIONS size slider, in units) when
  // none has been applied in this browser. 5.5 = the big Leaper the owner chose.
  startWidth: 5.5,
  lolaHeight: 0.9,
  hitRecoilDuration: 0.6,
  // Bigger angle + earlier peak = a sharper, more readable flinch.
  hitRecoilAngle: 0.45,
  hitRecoilPeak: 0.18,
  // Soft episode restart (review fix 5.12). The brain was only ever trained on
  // episodes that end: at a catch, after 60 steps without moving, or at 1,000
  // steps. In the game its episode never ends, so its memory drifts beyond
  // anything it saw in training (after a few minutes its search map says the
  // whole yard is searched) and it can freeze. The brain starts a fresh episode
  // in place (same pose, so nothing visibly jumps) when one of these happens;
  // its memory, search map and sightings start over as at the start of a
  // training episode. The brain itself is unchanged.
  // Measured 2026-10-19 on the old yard (src/brain/junkyard/README.md "Soft
  // restart experiment"): ended the long freezes and re-acquired a hidden Lola
  // more often, but the "still" trigger made some fights stop and start. ON
  // since 2026-10-20 at the owner's choice, with only the 900-step and catch
  // triggers. ?softRestart=0 switches it off for a playtest.
  brainSoftRestart: Object.freeze({
    enabled: true,
    // Fresh episode once this many brain steps have run (training ended at 1,000).
    afterSteps: 900,
    // Fresh episode right after the Leaper reaches Lola (a catch ended training episodes).
    afterCatch: true,
    // Fresh episode after this many brain steps in a row without moving
    // (training's 60-step freeze rule); null switches this trigger off. Off:
    // it made the Leaper stop and start in a third of the measured fights.
    afterStillSteps: null,
  }),
});
