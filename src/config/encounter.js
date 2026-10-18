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
});
