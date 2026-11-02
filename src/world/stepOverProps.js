// The low junk the Leaper walks over (owner, 2026-11-02: tires, poles, scrap and flat
// boards "should not affect the Leaper at all"; each one approved from a marked
// picture of the yard). It is taken out of its walking map only, the brain's and the
// route finder's: the frozen brain is unchanged and simply sees open floor there.
// Everything else keeps these props: Lola's grid, and every sight line and bullet,
// so they still hide her and still stop shots. Skips and containers stay solid.
// [minX, maxX, minZ, maxZ, top] in map units, measured from the exported yard; re-measure
// if the owner sends a new yard (a stale box removes nothing).
export const STEP_OVER_PROPS = Object.freeze([
  Object.freeze([-13.36, -6.64, 26.38, 33.69, 0.51]), // fallen signboard simple
  Object.freeze([-3.07, 3.47, 8.25, 13.55, 0.11]), // Yellow container - torn off long side lying on ground
  Object.freeze([-11.61, -10.39, 6.89, 8.11, 0.3]), // Split discarded tire 00
  Object.freeze([-10.73, -9.47, 7.54, 8.73, 0.3]), // Split discarded tire 01
  Object.freeze([-9.44, -8.16, 8.39, 9.64, 0.3]), // Split discarded tire 02
  Object.freeze([-7.55, -6.45, 9.96, 11.05, 0.3]), // Split discarded tire 03
  Object.freeze([-1.54, -0.52, 5.46, 6.54, 0.3]), // Split discarded tire 04
  Object.freeze([-2.59, -1.41, 4.41, 5.59, 0.3]), // Split discarded tire 05
  Object.freeze([-2.63, -1.36, -11.64, -10.37, 0.3]), // Split discarded tire 06
  Object.freeze([-26.72, -25.28, -6.72, -5.35, 0.3]), // Split discarded tire 07
  Object.freeze([25.35, 26.65, -15.65, -14.35, 0.3]), // Split discarded tire 08
  Object.freeze([24.36, 25.64, -16.55, -15.36, 0.3]), // Split discarded tire 09
  Object.freeze([-10.1, -8.7, 6.81, 8.11, 0.23]), // Broken hollow pole 00
  Object.freeze([-9.06, -6.74, 8.18, 9.14, 0.26]), // Broken hollow pole 01
  Object.freeze([-7.58, -5.72, 9.09, 10.15, 0.29]), // Broken hollow pole 02
  Object.freeze([-4.09, -2.63, 3.89, 5.11, 0.23]), // Broken hollow pole 03
  Object.freeze([-3.05, -0.96, 4.26, 4.98, 0.25]), // Broken hollow pole 04
  Object.freeze([-2.08, 0.25, -11.15, -9.94, 0.3]), // Broken hollow pole 05
  Object.freeze([-26.09, -23.9, -8.74, -6.9, 0.22]), // Broken hollow pole 06
  Object.freeze([24.93, 27.39, -16.09, -14.86, 0.26]), // Broken hollow pole 07
  Object.freeze([-2.06, -0.09, 19.32, 20.15, 0.28]), // Broken hollow pole 08
  Object.freeze([1.93, 4.12, 18.88, 20.03, 0.22]), // Broken hollow pole 09
  Object.freeze([-9.19, -8.21, 11.37, 12.43, 0.49]), // Skip loose scrap pile 0
  Object.freeze([-10.06, -8.27, 11.87, 12.65, 0.23]), // Skip spill bent pole 0
  Object.freeze([14.81, 15.79, -16.63, -15.57, 0.49]), // Skip loose scrap pile 1
  Object.freeze([13.94, 15.73, -16.13, -15.35, 0.23]), // Skip spill bent pole 1
  Object.freeze([-4.52, -3.48, 5.43, 6.57, 0.52]), // Container spill - recognizable salvage 0
  Object.freeze([-1.02, 0.02, -10.57, -9.43, 0.52]), // Container spill - recognizable salvage 1
  Object.freeze([-4.52, -3.48, 12.43, 13.57, 0.52]), // Container spill - recognizable salvage 2
  Object.freeze([3.48, 4.52, 17.43, 18.57, 0.52]), // Container spill - recognizable salvage 3
  Object.freeze([-21.52, -20.48, -7.57, -6.43, 0.52]), // Container spill - recognizable salvage 4
  Object.freeze([24.48, 25.52, -15.57, -14.43, 0.52]), // Container spill - recognizable salvage 5
  Object.freeze([-32.45, -31.52, 25.23, 26.84, 0.23]), // Added fallen pole 0
  Object.freeze([-31.28, -30.74, 25.79, 27.48, 0.23]), // Added fallen pole 1
  Object.freeze([29.2, 30.87, -7.33, -6.65, 0.23]), // Added fallen pole 2
  Object.freeze([30.19, 31.88, -8.28, -7.74, 0.23]), // Added fallen pole 3
]);

// Is this collision triangle ([x, z] x 3, bottom, top) part of one of those props?
export function steppedOver(t, props = STEP_OVER_PROPS) {
  return props.some(([minX, maxX, minZ, maxZ, top]) => t[7] <= top
    && t[0] >= minX && t[0] <= maxX && t[2] >= minX && t[2] <= maxX && t[4] >= minX && t[4] <= maxX
    && t[1] >= minZ && t[1] <= maxZ && t[3] >= minZ && t[3] <= maxZ && t[5] >= minZ && t[5] <= maxZ);
}
