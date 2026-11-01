/**
 * A vehicle's ADR classes in the form (decisions §7).
 *
 * The same list as the API (`api/src/common/adr.ts`, `ADR_CLASSES`) — the test
 * reads it from the API source. Matching (LTL and vehicles) needs the ADR
 * certificate (`hasAdr`) and compares the offer's classes with the vehicle's
 * `adrClasses`; an empty list with the certificate = "classes unknown"
 * (OFFER_ADR_CLASSES_UNKNOWN), an ADR offer with a class will not pass.
 */
export const ADR_CLASSES = ['1', '2', '3', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7', '8', '9'] as const;

/** Tick or untick a class; the list order is kept, entries from outside the list stay. */
export function toggleAdrClass(current: string[], cls: string, on: boolean): string[] {
  const rest = current.filter((c) => c !== cls);
  const next = on ? [...rest, cls] : rest;
  const order = (c: string) => {
    const i = (ADR_CLASSES as readonly string[]).indexOf(c);
    return i === -1 ? ADR_CLASSES.length : i;
  };
  return [...next].sort((a, b) => order(a) - order(b));
}

/** Entries saved earlier through the API that are not on the list (e.g. "Klasa 3") — shown, not lost. */
export function otherAdrEntries(current: string[]): string[] {
  return current.filter((c) => !(ADR_CLASSES as readonly string[]).includes(c));
}
