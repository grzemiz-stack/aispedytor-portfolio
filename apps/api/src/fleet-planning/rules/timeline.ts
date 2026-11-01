/**
 * Timeline: what the driver does, as consecutive segments. The planner
 * produces one; the dispatcher may also approve one by hand — the validator
 * checks both the same way.
 */
export type SegmentType = 'DRIVE' | 'WORK' | 'AVAILABILITY' | 'REST';

export type RestPlace = 'HOME' | 'AWAY';

export interface Segment {
  type: SegmentType;
  /** Epoch ms, UTC. */
  start: number;
  end: number;
  /** REST: minutes of this rest taken as compensation for a reduced weekly rest (en bloc). */
  compensationMinutes?: number;
  /** REST: at the driver's home or the operational centre, or elsewhere. Default AWAY. */
  place?: RestPlace;
  /** REST: outside the Member State of establishment. */
  abroad?: boolean;
  /** REST: in the vehicle's cab. */
  inCab?: boolean;
  /** DRIVE / WORK / AVAILABILITY produced from a planner task: its index in the input. */
  taskIndex?: number;
  /** REST inserted by the planner: why. */
  reason?: 'BREAK' | 'DAILY_REST' | 'WEEKLY_REST' | 'WAIT';
}

export class TimelineError extends Error {
  constructor(readonly reason: 'NOT_SORTED' | 'OVERLAP' | 'EMPTY_SEGMENT' | 'BEFORE_ORIGIN', readonly index: number) {
    super(`Invalid timeline: ${reason} at segment ${index}`);
    this.name = 'TimelineError';
  }
}

/**
 * Checks the order, fills gaps with REST (no activity = rest, as a
 * tachograph counts it) and merges adjacent RESTs into one.
 */
export function normalizeTimeline(segments: readonly Segment[], origin: number): Segment[] {
  const out: Segment[] = [];
  let cursor = origin;
  segments.forEach((s, i) => {
    if (!(s.end > s.start)) throw new TimelineError('EMPTY_SEGMENT', i);
    if (s.start < origin) throw new TimelineError('BEFORE_ORIGIN', i);
    if (i > 0 && s.start < segments[i - 1].start) throw new TimelineError('NOT_SORTED', i);
    if (s.start < cursor) throw new TimelineError('OVERLAP', i);
    if (s.start > cursor) push(out, { type: 'REST', start: cursor, end: s.start });
    push(out, { ...s });
    cursor = s.end;
  });
  return out;
}

function push(out: Segment[], s: Segment): void {
  const prev = out[out.length - 1];
  if (prev && prev.type === 'REST' && s.type === 'REST' && prev.end === s.start) {
    prev.end = s.end;
    const c = (prev.compensationMinutes ?? 0) + (s.compensationMinutes ?? 0);
    if (c > 0) prev.compensationMinutes = c;
    // One merged rest is at home only if all of it is; in the cab or abroad if any of it is.
    prev.place = prev.place === 'HOME' && s.place === 'HOME' ? 'HOME' : 'AWAY';
    prev.inCab = Boolean(prev.inCab || s.inCab) || undefined;
    prev.abroad = Boolean(prev.abroad || s.abroad) || undefined;
    if (prev.place === 'AWAY') delete prev.place;
    if (!prev.inCab) delete prev.inCab;
    if (!prev.abroad) delete prev.abroad;
    return;
  }
  out.push(s);
}
