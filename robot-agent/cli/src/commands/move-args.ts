/**
 * @file move-args.ts
 * @description Parses `roboctl move` arguments: one place name, or x and y.
 * @feature cli
 */

/** What `move` sends as its `destination`. */
export type MoveDestination =
  | { place: string; floor?: string }
  | { x: number; y: number; place?: string; floor?: string };

/**
 * `move <place>` or `move <x> <y>`. Two numeric arguments are coordinates;
 * anything else is a place name (several words are joined, so `move Aisle 1`
 * reads as the place "Aisle 1"). Throws a usage message on no arguments.
 */
export function parseMoveArgs(args: readonly string[], options: { place?: string; floor?: string } = {}): MoveDestination {
  const words = args.map((a) => a.trim()).filter((a) => a.length > 0);
  if (words.length === 0) throw new Error('Usage: move <place> | move <x> <y>');

  const numeric = (s: string): boolean => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s);
  let destination: MoveDestination;
  if (words.length === 2 && numeric(words[0]!) && numeric(words[1]!)) {
    destination = { x: parseFloat(words[0]!), y: parseFloat(words[1]!) };
    if (options.place) destination.place = options.place;
  } else {
    destination = { place: words.join(' ') };
  }
  if (options.floor) destination.floor = options.floor;
  return destination;
}

/** How a destination reads in a spinner line. */
export function describeDestination(d: MoveDestination): string {
  return 'x' in d ? `(${d.x}, ${d.y})` : `"${d.place}"`;
}
