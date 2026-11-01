/**
 * Builds a timeline for fleet planning tests:
 *   from('2026-10-05T06:00:00Z').drive(270).rest(45).drive(180).segments
 * Durations in minutes; each step starts where the previous one ended.
 */
import type { Segment } from '../../src/fleet-planning/rules/timeline';

type RestOptions = Pick<Segment, 'compensationMinutes' | 'place' | 'abroad' | 'inCab'>;

export class TimelineBuilder {
  readonly segments: Segment[] = [];
  constructor(public cursor: number) {}

  private add(type: Segment['type'], minutes: number, extra: Partial<Segment> = {}): this {
    const end = this.cursor + minutes * 60_000;
    this.segments.push({ type, start: this.cursor, end, ...extra });
    this.cursor = end;
    return this;
  }

  drive(minutes: number) { return this.add('DRIVE', minutes); }
  work(minutes: number) { return this.add('WORK', minutes); }
  available(minutes: number) { return this.add('AVAILABILITY', minutes); }
  rest(minutes: number, options: RestOptions = {}) { return this.add('REST', minutes, options); }
  /** A day of driving with legal breaks: 4.5 h, 45 min, the rest. */
  day(drivingMinutes: number) {
    const first = Math.min(drivingMinutes, 270);
    this.drive(first);
    if (drivingMinutes > first) this.rest(45).drive(drivingMinutes - first);
    return this;
  }
}

export const from = (iso: string) => new TimelineBuilder(new Date(iso).getTime());
