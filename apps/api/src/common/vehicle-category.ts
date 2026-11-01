/**
 * Vehicle categories and the attachment rule — ONE source for the whole system.
 *
 * Used by: the vehicle DTO (`@IsIn`), the attachment check in the service,
 * the combination axle class (`axle-class.ts`), the "what can I attach to"
 * list filter for the front end, and the PL/EN labels in the front end (a test
 * reads the list directly from this file). The database `CHECK` has the same
 * list — a test compares it with the migration so they cannot drift apart.
 *
 * Code = English meaning (docs/decisions.md §7): SEMI_TRAILER = semi-trailer
 * (naczepa), TRAILER = drawbar trailer (przyczepa).
 */
import { msg, type PlanMessage } from './plan-messages';

export const VEHICLE_CATEGORIES = ['TRUCK', 'RIGID', 'SEMI_TRAILER', 'TRAILER', 'VAN'] as const;
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number];

/** A vehicle without a category is a tractor unit (the database default). */
export const DEFAULT_VEHICLE_CATEGORY: VehicleCategory = 'TRUCK';

/** Tractor unit — without a semi-trailer it carries no load. */
export const TRACTOR_CATEGORY: VehicleCategory = 'TRUCK';

/**
 * What a towed record may be attached to:
 *  - a semi-trailer (SEMI_TRAILER) rests on the fifth wheel — only under a tractor;
 *  - a drawbar trailer (TRAILER) has a drawbar — only under a rigid or a van.
 */
export const ALLOWED_PARENTS = {
  SEMI_TRAILER: ['TRUCK'],
  TRAILER: ['RIGID', 'VAN'],
} as const satisfies Record<string, readonly VehicleCategory[]>;

export type TowedCategory = keyof typeof ALLOWED_PARENTS;
export const TOWED_CATEGORIES = Object.keys(ALLOWED_PARENTS) as TowedCategory[];

export const isTowedCategory = (c: string | null | undefined): c is TowedCategory =>
  c != null && (TOWED_CATEGORIES as string[]).includes(c);

/** Categories that something can be attached to (tractor, rigid, van). */
export function canHaveAttachments(category: string | null | undefined): boolean {
  return Object.values(ALLOWED_PARENTS).some(parents => (parents as readonly string[]).includes(category ?? ''));
}

/**
 * Whether a record of category `child` may be attached under a record of category `parent`.
 * `null` = allowed; otherwise a message with a code — the server builds no sentence.
 */
export function attachmentProblem(child: string, parent: string): PlanMessage | null {
  if (!isTowedCategory(child)) {
    return msg('VEHICLE_ATTACH_NOT_TOWED', { childCategory: child });
  }
  const allowed: readonly string[] = ALLOWED_PARENTS[child];
  if (!allowed.includes(parent)) {
    return msg('VEHICLE_ATTACH_WRONG_PARENT', {
      childCategory: child,
      parentCategory: parent,
      allowedParents: allowed.join(', '),
    });
  }
  return null;
}
