/**
 * The validator: any timeline (planned or approved by hand) → every rule it
 * breaks. Nothing is blocked (SPEC §2): the result shows the violations.
 *
 * violations — 561/2006 and 2002/15 broken;
 * warnings   — the company's obligations at risk (return home, art. 8(8a));
 * notices    — what the dispatcher should know (accommodation needed, an
 *              exception applied or not verifiable, assumed values).
 */
import type { PlanMessage } from '../../common/plan-messages';
import type { EngineStart } from './driver-state';
import { normalizeTimeline, type Segment } from './timeline';
import { RulesTracker } from './tracker';

export interface CheckResult {
  violations: PlanMessage[];
  warnings: PlanMessage[];
  notices: PlanMessage[];
  /** The ledger after the last segment (for availability and the planner). */
  tracker: RulesTracker;
}

export function checkTimeline(start: EngineStart, segments: readonly Segment[]): CheckResult {
  const tracker = new RulesTracker(start);
  for (const s of normalizeTimeline(segments, start.origin)) tracker.apply(s);
  return {
    violations: tracker.violations,
    warnings: tracker.warnings,
    notices: [...start.messages, ...tracker.notices],
    tracker,
  };
}
