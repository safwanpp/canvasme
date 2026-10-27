import { type Element, FORMAT_VERSION } from "./model";
import { makeGroup, syncGroupBounds } from "./tree";

export const CURRENT_VERSION = FORMAT_VERSION;

type RawEl = Record<string, unknown> & { id?: unknown; type?: unknown; groupId?: unknown };

/**
 * Version 2 → 3: a flat group was just elements sharing a `groupId`. Each such id becomes a group
 * element sitting directly above its members, which are gathered (in their order) at the
 * topmost member's place. A "group" of one element is dissolved.
 */
function addGroupElements(elements: RawEl[]): RawEl[] {
  const ids = new Set(elements.map((e) => e.id));
  const groupEls = new Set(elements.filter((e) => e.type === "group").map((e) => e.id));
  const members = new Map<string, RawEl[]>();
  for (const e of elements) {
    if (typeof e.groupId !== "string" || e.type === "group") continue;
    members.set(e.groupId, [...(members.get(e.groupId) ?? []), e]);
  }
  const groups = new Map<string, RawEl[]>();
  // A flat group id that is also a non-group element's id (only a corrupt file has that) is not made a
  // group: below, its members just lose the groupId, i.e. the group quietly dissolves. Accepted.
  for (const [gid, list] of members) if (list.length > 1 && !ids.has(gid)) groups.set(gid, list);
  const out: RawEl[] = [];
  for (const e of elements) {
    const gid = typeof e.groupId === "string" ? e.groupId : null;
    const list = gid ? groups.get(gid) : undefined;
    if (!list) {
      // Already a real group (a file from a newer build stamped older), or a group of one: dissolved.
      const keep = e.groupId === null || e.groupId === undefined || groupEls.has(e.groupId as string);
      out.push(keep ? e : { ...e, groupId: null });
      continue;
    }
    if (e !== list[list.length - 1]) continue;
    out.push(...list, makeGroup(gid!, null) as unknown as RawEl);
  }
  return syncGroupBounds(out as unknown as Element[]) as unknown as RawEl[];
}

/**
 * Bring a stored or imported design up to the current format. Idempotent, and returns a
 * new object rather than changing its input. Runs before any zod parse, so it takes and
 * returns unknown; anything that isn't a design object passes through untouched.
 *
 * Version 1 → 2: effects, blendMode and fillOpacity are optional and read as "off" when
 * missing, so only the version stamp changes. 2 → 3: see addGroupElements.
 */
export function migrateDesign(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const d = raw as { version?: unknown; pages?: unknown };
  const version = typeof d.version === "number" ? d.version : 1;
  if (version >= CURRENT_VERSION) return raw;
  const pages = Array.isArray(d.pages)
    ? d.pages.map((p) =>
        p && typeof p === "object" && Array.isArray((p as { elements?: unknown }).elements)
          ? { ...p, elements: addGroupElements((p as { elements: RawEl[] }).elements.filter((e) => e && typeof e === "object")) }
          : p,
      )
    : d.pages;
  return { ...d, pages, version: CURRENT_VERSION };
}
