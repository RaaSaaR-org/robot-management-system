/**
 * @file CommandPalette.tsx
 * @description ⌘K over the whole navigation model — every row, every rail stop
 *              and every tab `navDestinations` knows — searchable by
 *              subsequence and one Enter away. It is what makes the cut from 23
 *              sidebar rows to 10 safe (TASK-273): a page that lost its row did
 *              not lose its way in.
 *
 *              Pages first, and with an empty field pages only. Once
 *              something is typed it also finds datasets and robots by name
 *              (TASK-486) — the two lists a person looks for by name, each
 *              small and fetched once per opening by `paletteEntities.ts`.
 *              Everything else stays navigation: a general entity search
 *              would need a server-side index across 83 Prisma models.
 * @feature layout
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import {
  navDestinations,
  useVisibleNavGroups,
  type NavDestination,
  type NavGroup,
} from '@/components/layout/navigation';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import { Input } from '@/shared/components/ui/Input';
import { Modal } from '@/shared/components/ui/Modal';
import { cn } from '@/shared/utils/cn';
import { ENTITY_KIND_LABEL, entityRank, loadPaletteEntities, type PaletteEntity } from './paletteEntities';

// ============================================================================
// TYPES
// ============================================================================

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Where the datasets and robots come from. Injectable so a test needs no server. */
  loadEntities?: () => Promise<PaletteEntity[]>;
}

/** One row of the result list: a page from the navigation model, or a thing found by name. */
export interface PaletteResult {
  label: string;
  path: string;
  icon: PaletteDestination['icon'];
  /** The muted text after the label */
  trail: string;
  /** Set on a dataset or a robot; absent on a page */
  entity?: PaletteEntity['kind'];
}

/**
 * A destination as the palette offers it: the model's, plus the labels of the
 * destinations that were folded into it. An alias is searchable and shown in
 * the trail — never the row's name, always a name the page also answers to.
 */
export interface PaletteDestination extends NavDestination {
  aliases?: string[];
}

// ============================================================================
// DESTINATIONS
// ============================================================================

/**
 * Every destination the palette offers: the model's, minus the URL a row shares
 * with its own first tab. That overlap is the model's convention, not a bug —
 * a page writes its first tab by *deleting* `?tab=`, so `/fleet` is both the
 * Fleet row and its Map tab — but two rows offering one URL would read as a
 * duplicate here. The first wins, which is the row — the name the sidebar uses
 * — and the loser's label survives on it as an alias, so no word the model
 * declares stops being searchable.
 */
export function paletteDestinations(groups: NavGroup[]): PaletteDestination[] {
  const byPath = new Map<string, PaletteDestination>();
  const offered: PaletteDestination[] = [];
  for (const destination of navDestinations(groups)) {
    const kept = byPath.get(destination.path);
    if (kept) {
      // Dropping the duplicate must not drop its *word*: `/patrol` is the
      // Missions row, the Patrol rail stop and its Routes tab all at once, and
      // "patrol" is the name that page has answered to since before the cut.
      if (destination.label !== kept.label && !kept.aliases?.includes(destination.label)) {
        kept.aliases = [...(kept.aliases ?? []), destination.label];
      }
      continue;
    }
    const entry: PaletteDestination = { ...destination };
    byPath.set(destination.path, entry);
    offered.push(entry);
  }
  return offered;
}

/** The muted trail after a label: its row and its group, where they add a word. */
function destinationTrail(destination: PaletteDestination): string {
  return [destination.row, destination.group, ...(destination.aliases ?? [])]
    .filter((part): part is string => Boolean(part) && part !== destination.label)
    .join(' · ');
}

// ============================================================================
// MATCHING
// ============================================================================

/** Every character of `needle`, in order but not necessarily adjacent, in `text`. */
function isSubsequence(needle: string, text: string): boolean {
  let next = 0;
  for (const char of text) {
    if (char === needle[next]) next += 1;
    if (next === needle.length) return true;
  }
  return next === needle.length;
}

/** Where the hit was found. Lower sorts first, so a label beats a trail. */
const PREFIX_HIT = 0;
const ALIAS_PREFIX_HIT = 1;
const LABEL_HIT = 2;
const ALIAS_HIT = 3;
const TRAIL_HIT = 4;

function rankOf(destination: PaletteDestination, needle: string): number | null {
  const label = destination.label.toLowerCase();
  const aliases = destination.aliases?.map((alias) => alias.toLowerCase()) ?? [];
  if (label.startsWith(needle)) return PREFIX_HIT;
  // An alias is a name of this page too, so it is ranked the way the label is:
  // typing a page's whole name must beat another page's scattered letters —
  // "map" is the Fleet map before it is the m-a-p buried in Marketplace.
  if (aliases.some((alias) => alias.startsWith(needle))) return ALIAS_PREFIX_HIT;
  if (isSubsequence(needle, label)) return LABEL_HIT;
  if (aliases.some((alias) => isSubsequence(needle, alias))) return ALIAS_HIT;
  // The row and the group are searchable too, so "automate" reaches every page
  // in that group and "guide" reaches the Visits tab hanging under Guide.
  const trail = `${label} ${destination.row} ${destination.group ?? ''}`.toLowerCase();
  return isSubsequence(needle, trail) ? TRAIL_HIT : null;
}

/**
 * The destinations matching `query`, best first. Case-insensitive subsequence,
 * so "dpmt" finds Deployments; an exact prefix on the label outranks a
 * subsequence, which outranks a hit on an alias, which outranks a hit found
 * only in the row or the group. A prefix beats a subsequence at both levels,
 * so a page's full name always wins over another page's scattered letters.
 * Inside
 * one rank the model's own order survives — hence the explicit index tiebreak
 * rather than a sort that trusts its own stability.
 *
 * An empty query is not a filter: it lists everything, untouched.
 */
export function matchDestinations(
  destinations: PaletteDestination[],
  query: string,
): PaletteDestination[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...destinations];

  const hits: { destination: PaletteDestination; order: number; rank: number }[] = [];
  destinations.forEach((destination, order) => {
    const rank = rankOf(destination, needle);
    if (rank !== null) hits.push({ destination, order, rank });
  });
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return hits.map((hit) => hit.destination);
}

/**
 * Pages and named things matching `query`, best first. An empty query lists
 * the pages and nothing else: the palette opens as a map of the product, not
 * as a dump of every dataset.
 *
 * A dataset or robot whose name (or a word in it) starts with the query ranks
 * with a page whose label does, after it; one that merely contains the query
 * ranks ahead of a page matched by scattered letters. So "apple" leads with
 * "Apple to Plate", and "data" still leads with the Datasets page.
 */
export function matchPalette(
  destinations: PaletteDestination[],
  entities: PaletteEntity[],
  query: string,
): PaletteResult[] {
  const pages = (list: PaletteDestination[]): PaletteResult[] =>
    list.map((d) => ({ label: d.label, path: d.path, icon: d.icon, trail: destinationTrail(d) }));
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return pages(destinations);

  const hits: { result: PaletteResult; order: number; rank: number }[] = [];
  let order = 0;
  for (const destination of destinations) {
    const rank = rankOf(destination, needle);
    if (rank !== null) hits.push({ result: pages([destination])[0], order: order++, rank });
  }
  const seen = new Set(hits.map((hit) => hit.result.path));
  for (const entity of entities) {
    const how = entityRank(entity, needle);
    if (how === null || seen.has(entity.path)) continue;
    seen.add(entity.path);
    hits.push({
      result: {
        label: entity.label,
        path: entity.path,
        icon: entity.icon,
        trail: [ENTITY_KIND_LABEL[entity.kind], entity.detail].filter(Boolean).join(' · '),
        entity: entity.kind,
      },
      order: order++,
      // Between the page ranks: after a page prefix, ahead of a page subsequence.
      rank: how === 'prefix' ? PREFIX_HIT + 0.5 : ALIAS_PREFIX_HIT + 0.5,
    });
  }
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return hits.map((hit) => hit.result);
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * The dialog is `Modal` (portal, focus trap, Esc, focus back to the opener);
 * the listbox semantics and the arrow keys are this component's, because the
 * kit has no combobox primitive.
 *
 * @example
 * ```tsx
 * <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
 * ```
 */
export function CommandPalette({ open, onClose, loadEntities = loadPaletteEntities }: CommandPaletteProps): ReactElement {
  // The same gated groups the sidebar reads — never a second gate of its own.
  const groups = useVisibleNavGroups();
  const navigate = useNavigate();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);

  const [entities, setEntities] = useState<PaletteEntity[]>([]);

  const destinations = useMemo(() => paletteDestinations(groups), [groups]);
  const results = useMemo(() => matchPalette(destinations, entities, query), [destinations, entities, query]);

  // Datasets and robots, fresh on every opening: one imported a minute ago has
  // to be findable. A failure leaves the pages, which need no server.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    loadEntities()
      .then((found) => { if (!cancelled) setEntities(found); })
      .catch(() => { if (!cancelled) setEntities([]); });
    return () => { cancelled = true; };
  }, [open, loadEntities]);
  const optionId = (index: number) => `${listId}-option-${index}`;

  // The dialog outlives its own closing (Modal renders nothing while closed,
  // this component stays mounted), so every opening starts from a blank query.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
  }, [open]);

  // Keyboard selection has to stay visible while the list scrolls under it.
  useEffect(() => {
    if (!open) return;
    const option = listRef.current?.children.item(selected);
    // jsdom implements no scrollIntoView, and this is cosmetic — hence guarded.
    if (option instanceof HTMLElement && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [open, selected, results]);

  const move = (delta: number) => {
    if (results.length === 0) return;
    setSelected((current) => (current + delta + results.length) % results.length);
  };

  const go = (destination: PaletteResult | undefined) => {
    if (!destination) return;
    // The `?tab=` a tab carries needs nothing else: every tabbed page reads the
    // param off the URL.
    navigate(destination.path);
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        setSelected(0);
        break;
      case 'End':
        event.preventDefault();
        setSelected(Math.max(0, results.length - 1));
        break;
      case 'Enter':
        event.preventDefault();
        go(results[selected]);
        break;
      default:
        // Esc deliberately unhandled: Modal closes the dialog and hands focus
        // back to whatever opened it.
        break;
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      size="lg"
      // No title bar — the field is the header, and it names itself. The close
      // button would only crowd it; Esc and the backdrop already close it.
      showCloseButton={false}
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
      testId="command-palette"
    >
      <div className="shrink-0 border-b border-line-subtle p-3">
        <Input
          data-autofocus
          fullWidth
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search pages, datasets and robots…"
          aria-label="Search pages, datasets and robots"
          role="combobox"
          // The listbox is the dialog: it is expanded whenever there is one to
          // point at, and nothing is pointed at while the query matches nothing.
          aria-expanded={results.length > 0}
          aria-controls={results.length > 0 ? listId : undefined}
          aria-activedescendant={results.length > 0 ? optionId(selected) : undefined}
          autoComplete="off"
          leftIcon={<Search strokeWidth={1.75} />}
        />
      </div>

      {results.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Search strokeWidth={1.75} />}
          title="Nothing matches"
          description={`No page, dataset or robot matches “${query.trim()}”.`}
        />
      ) : (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {results.map((destination, index) => {
            const Icon = destination.icon;
            const active = index === selected;
            const trail = destination.trail;
            return (
              <li
                // Deduped on path above, so the URL is the identity here.
                key={destination.path}
                id={optionId(index)}
                role="option"
                data-entity={destination.entity}
                aria-selected={active}
                onClick={() => go(destination)}
                // mousemove, not mouseenter: arrowing through the list scrolls
                // rows under a resting cursor, and that must not steal the
                // selection from the keyboard.
                onMouseMove={() => setSelected(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-control px-3 py-2 text-sm',
                  'transition-colors duration-150 ease-[var(--ease-instrument)]',
                  active ? 'bg-primary/10 text-primary' : 'text-ink-secondary',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate font-medium">{destination.label}</span>
                {/* A tab reads like any other page: the user does not care that
                    it is one. The trail is only there to tell two "Runs" apart. */}
                {trail && <span className="truncate text-[13px] text-ink-tertiary">{` · ${trail}`}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
