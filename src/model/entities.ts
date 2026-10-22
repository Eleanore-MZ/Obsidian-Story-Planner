import { compareDates, lineYear, mainCalendar } from "./calendar";
import { newId } from "./defaults";
import { cardsInReadingOrder } from "./search";
import { freeColor } from "./setup";
import { Card, CharacterRole, CustomFieldDef, Id, Membership, Organization, OrgRole, Story, StoryDate } from "./types";

// Organizations, the story's own profile fields, and what a character's or
// organization's profile shows about them: their scenes, counted and listed.
// Pure, like the rest of the model.

// ---------------------------------------------------------------------------
// Organizations

export function addOrganization(story: Story, name: string, parent?: Id): Id {
  const org: Organization = { id: newId("o"), name: name.trim() || "New organization", color: freeColor(story.organizations) };
  if (parent && story.organizations.some((o) => o.id === parent)) org.parent = parent;
  story.organizations.push(org);
  return org.id;
}

/** The organizations an organization contains, directly or further down. */
export function orgDescendants(story: Story, id: Id): Set<Id> {
  const out = new Set<Id>();
  const walk = (parent: Id) => {
    for (const o of story.organizations) {
      if (o.parent === parent && !out.has(o.id)) {
        out.add(o.id);
        walk(o.id);
      }
    }
  };
  walk(id);
  return out;
}

/** Sets an organization's parent; refuses one that would put it inside itself. */
export function setOrgParent(story: Story, id: Id, parent: Id | undefined): boolean {
  const org = story.organizations.find((o) => o.id === id);
  if (!org || org.parent === parent) return false;
  if (parent && (parent === id || orgDescendants(story, id).has(parent) || !story.organizations.some((o) => o.id === parent))) return false;
  if (parent) org.parent = parent;
  else delete org.parent;
  return true;
}

/** Organizations as a tree, parents before the organizations inside them. */
export function orgTree(story: Story): { org: Organization; depth: number }[] {
  const ids = new Set(story.organizations.map((o) => o.id));
  const out: { org: Organization; depth: number }[] = [];
  const walk = (parent: Id | undefined, depth: number) => {
    for (const org of story.organizations) {
      const p = org.parent && ids.has(org.parent) ? org.parent : undefined;
      if (p === parent) {
        out.push({ org, depth });
        walk(org.id, depth + 1);
      }
    }
  };
  walk(undefined, 0);
  return out;
}

/** Deletes an organization: cards and characters no longer name it, and the organizations inside it move up a level. */
export function deleteOrganization(story: Story, id: Id, now = new Date().toISOString()): boolean {
  const org = story.organizations.find((o) => o.id === id);
  if (!org) return false;
  story.organizations = story.organizations.filter((o) => o.id !== id);
  for (const o of story.organizations) {
    if (o.parent === id) {
      if (org.parent) o.parent = org.parent;
      else delete o.parent;
    }
  }
  for (const c of story.characters) {
    if (c.orgs?.some((m) => m.id === id)) {
      c.orgs = c.orgs.filter((m) => m.id !== id);
      if (c.orgs.length === 0) delete c.orgs;
    }
  }
  for (const card of Object.values(story.cards)) {
    if (card.orgs?.some((o) => o.id === id)) {
      card.orgs = card.orgs.filter((o) => o.id !== id);
      if (card.orgs.length === 0) delete card.orgs;
      card.modified = now;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Organizations on cards

/** Puts an organization in a scene (involved by default), changes its role there, or takes it out with null. */
export function setCardOrg(story: Story, cardId: Id, orgId: Id, role: OrgRole | null, now = new Date().toISOString()): boolean {
  const card = story.cards[cardId];
  if (!card || !story.organizations.some((o) => o.id === orgId)) return false;
  const list = card.orgs ?? [];
  const entry = list.find((o) => o.id === orgId);
  if (role === null) {
    if (!entry) return false;
    card.orgs = list.filter((o) => o.id !== orgId);
    if (card.orgs.length === 0) delete card.orgs;
  } else if (entry) {
    if (entry.role === role) return false;
    entry.role = role;
  } else {
    card.orgs = [...list, { id: orgId, role }];
  }
  card.modified = now;
  return true;
}

/** Adds an organization to a card by name, making a new one if no organization has that name. */
export function addOrgByName(story: Story, cardId: Id, name: string, now = new Date().toISOString()): boolean {
  const trimmed = name.trim();
  if (!trimmed || !story.cards[cardId]) return false;
  let org = story.organizations.find((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  if (!org) {
    addOrganization(story, trimmed);
    org = story.organizations[story.organizations.length - 1]!;
  }
  return setCardOrg(story, cardId, org.id, story.cards[cardId]!.orgs?.find((o) => o.id === org!.id)?.role ?? "involved", now);
}

export function nextOrgRole(role: OrgRole | "mixed"): OrgRole {
  return role === "involved" ? "mentioned" : "involved";
}

/** Every organization on any of the cards, with its role there, or "mixed" when the cards differ. */
export function orgRoles(story: Story, cards: Card[]): { id: Id; role: OrgRole | "mixed"; onAll: boolean }[] {
  return story.organizations
    .map((o) => {
      const entries = cards.map((c) => c.orgs?.find((e) => e.id === o.id)).filter((e): e is NonNullable<typeof e> => !!e);
      if (entries.length === 0) return null;
      const role = entries.every((e) => e.role === entries[0]!.role) ? entries[0]!.role : "mixed";
      return { id: o.id, role, onAll: entries.length === cards.length };
    })
    .filter((x): x is { id: Id; role: OrgRole | "mixed"; onAll: boolean } => x !== null);
}

// ---------------------------------------------------------------------------
// Memberships

export function setMembership(story: Story, characterId: Id, orgId: Id, fields: Partial<Omit<Membership, "id">> | null): boolean {
  const character = story.characters.find((c) => c.id === characterId);
  if (!character || !story.organizations.some((o) => o.id === orgId)) return false;
  const list = character.orgs ?? [];
  const at = list.findIndex((m) => m.id === orgId);
  if (fields === null) {
    if (at === -1) return false;
    character.orgs = list.filter((m) => m.id !== orgId);
    if (character.orgs.length === 0) delete character.orgs;
    return true;
  }
  const entry: Membership = at === -1 ? { id: orgId } : { ...list[at]! };
  for (const [key, value] of Object.entries(fields) as [keyof Omit<Membership, "id">, unknown][]) {
    if (value === undefined || value === "") delete entry[key];
    else (entry as unknown as Record<string, unknown>)[key] = value;
  }
  const next = [...list];
  if (at === -1) next.push(entry);
  else next[at] = entry;
  if (JSON.stringify(next) === JSON.stringify(list)) return false;
  character.orgs = next;
  return true;
}

/** An organization's members: every character with a membership in it. */
export function orgMembers(story: Story, orgId: Id): { characterId: Id; membership: Membership }[] {
  return story.characters
    .map((c) => ({ characterId: c.id, membership: c.orgs?.find((m) => m.id === orgId) }))
    .filter((x): x is { characterId: Id; membership: Membership } => !!x.membership);
}

/** Cards where an organization takes part, or (with `members`) where any of its members do. */
export function cardsWithOrg(story: Story, orgId: Id, members = false): Card[] {
  const people = members ? new Set(orgMembers(story, orgId).map((m) => m.characterId)) : new Set<Id>();
  return cardsInReadingOrder(story).filter(
    (c) => c.orgs?.some((o) => o.id === orgId) || (members && c.characters.some((e) => people.has(e.id))),
  );
}

// ---------------------------------------------------------------------------
// The story's own profile fields

export function addCustomField(story: Story, name: string, type: CustomFieldDef["type"], appliesTo: CustomFieldDef["appliesTo"]): Id {
  const field: CustomFieldDef = { id: newId("f"), name: name.trim() || "New field", type, appliesTo };
  if (type === "choice") field.options = [];
  story.customFields.push(field);
  return field.id;
}

/** Deletes a field and every value given for it. */
export function deleteCustomField(story: Story, id: Id): boolean {
  if (!story.customFields.some((f) => f.id === id)) return false;
  story.customFields = story.customFields.filter((f) => f.id !== id);
  for (const e of [...story.characters, ...story.organizations]) {
    if (e.fields && id in e.fields) {
      delete e.fields[id];
      if (Object.keys(e.fields).length === 0) delete e.fields;
    }
  }
  return true;
}

export function fieldsFor(story: Story, kind: "character" | "organization"): CustomFieldDef[] {
  return story.customFields.filter((f) => f.appliesTo === kind || f.appliesTo === "both");
}

// ---------------------------------------------------------------------------
// Profiles: what the scenes say about a character or an organization

export interface Appearances {
  /** Their scenes in reading order. */
  cards: Card[];
  first?: Card;
  last?: Card;
  /** For a character: how many scenes in each role. For an organization: involved and mentioned. */
  roles: Record<string, number>;
  /** The plot lines their scenes are in, most scenes first. */
  plotLines: { id: Id; count: number }[];
}

function appearances(cards: Card[], role: (card: Card) => string | undefined): Appearances {
  const roles: Record<string, number> = {};
  const lines = new Map<Id, number>();
  for (const card of cards) {
    const r = role(card);
    if (r) roles[r] = (roles[r] ?? 0) + 1;
    lines.set(card.plotLine, (lines.get(card.plotLine) ?? 0) + 1);
  }
  return {
    cards,
    first: cards[0],
    last: cards[cards.length - 1],
    roles,
    plotLines: [...lines.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
  };
}

export function characterAppearances(story: Story, characterId: Id): Appearances {
  const cards = cardsInReadingOrder(story).filter((c) => c.characters.some((e) => e.id === characterId));
  return appearances(cards, (c) => c.characters.find((e) => e.id === characterId)?.role satisfies CharacterRole | undefined);
}

export function orgAppearances(story: Story, orgId: Id): Appearances {
  const cards = cardsInReadingOrder(story).filter((c) => c.orgs?.some((o) => o.id === orgId));
  return appearances(cards, (c) => c.orgs?.find((o) => o.id === orgId)?.role);
}

/**
 * How old someone born on `born` is on `at`, in whole years of the story's
 * calendar; undefined when either date lacks a year or `at` comes first.
 */
export function ageAt(story: Story, born: StoryDate | undefined, at: StoryDate | undefined): number | undefined {
  if (!born || !at || compareDates(story, at, born) < 0) return undefined;
  const calendar = mainCalendar(story);
  const from = lineYear(calendar, born.era, born.year);
  const to = lineYear(calendar, at.era, at.year);
  let years = to - from;
  // Not yet had the birthday this year: a year less.
  if (born.month !== undefined && at.month !== undefined) {
    if (at.month < born.month || (at.month === born.month && (at.day ?? 1) < (born.day ?? 1))) years--;
  }
  return years;
}
