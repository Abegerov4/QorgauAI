import type { Transition } from "motion/react";

// Apple's defaults translated to Motion springs: critically damped (bounce 0)
// for everything that simply appears; a little bounce only where a gesture
// carried momentum (sheet released after a drag).
export const spring: Transition = { type: "spring", bounce: 0, visualDuration: 0.35 };
export const springSnappy: Transition = { type: "spring", bounce: 0, visualDuration: 0.25 };
export const springSheet: Transition = { type: "spring", bounce: 0.15, visualDuration: 0.3 };

// Momentum projection from Designing Fluid Interfaces (WWDC 2018):
// where a flick would come to rest under scroll-like deceleration.
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}
