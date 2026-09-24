/**
 * Address & name normalization for property resolution.
 *
 * "629 Alger Avenue" and "629 Alger Ave" must resolve to the SAME existing
 * RentID property — ownership verification never creates a duplicate property
 * because a records source formats an address differently.
 */
import type { Property } from "@/lib/types";

const STREET_TYPES: Record<string, string> = {
  avenue: "ave",
  av: "ave",
  street: "st",
  str: "st",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  circle: "cir",
  place: "pl",
  terrace: "ter",
  parkway: "pkwy",
  highway: "hwy",
  trail: "trl",
  square: "sq",
  suite: "ste",
  apartment: "apt",
  unit: "unit",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Secondary-unit designators. These are DROPPED, not abbreviated: a county
 * record saying "#5", a lease saying "Unit 5" and a landlord typing "Apt 5"
 * are one physical unit and must produce one key.
 */
const UNIT_DESIGNATORS = new Set([
  "apt",
  "apartment",
  "unit",
  "ste",
  "suite",
  "no",
  "num",
  "number",
  "rm",
  "room",
  "fl",
  "flr",
  "floor",
  "bldg",
  "building",
  "lot",
  "trlr",
  "space",
  "spc",
]);

/** Trailing business-entity words, used to tell "Acme, LLC" from "Smith, John". */
const ENTITY_SUFFIX_TOKENS = new Set([
  "llc",
  "inc",
  "corp",
  "co",
  "ltd",
  "lp",
  "llp",
  "plc",
  "pc",
  "trust",
  "foundation",
]);

/**
 * Collapse dotted/spaced entity abbreviations ("L.L.C.", "L L C") to one
 * token — but only in TRAILING position, where an entity suffix actually
 * lives. Mid-string, "L P Hartley" and "P C Wren" are a person's initials,
 * and collapsing those would stop "HARTLEY, L P" from being recognised as
 * surname-first.
 */
function collapseEntityAbbreviations(value: string): string {
  return value
    .replace(/\bl\s*\.?\s*l\s*\.?\s*c\b\.?\s*$/i, "llc")
    .replace(/\bl\s*\.?\s*l\s*\.?\s*p\b\.?\s*$/i, "llp")
    .replace(/\bp\s*\.?\s*c\b\.?\s*$/i, "pc")
    .replace(/\bl\s*\.?\s*p\b\.?\s*$/i, "lp");
}

const ENTITY_TOKENS: Record<string, string> = {
  incorporated: "inc",
  corporation: "corp",
  company: "co",
  limited: "ltd",
  "l.l.c": "llc",
  llc: "llc",
};

function squash(value: string) {
  return value.toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
}

/** A unit identifier: contains a digit, or is a lone letter ("B" in "Bldg B"). */
function looksLikeUnitIdentifier(token: string | undefined): boolean {
  if (!token) return false;
  return /\d/.test(token) || token.length === 1;
}

/**
 * Drop secondary-unit designator words, but ONLY where one is immediately
 * followed by something that looks like a unit identifier — so "Apt 5",
 * "Bldg B" and "#5" lose the word while "300 Building Ave" and
 * "100 Lot Line Rd" keep their street NAME.
 *
 * Erring the other way would be worse than the duplicate records this exists
 * to prevent: collapsing two real addresses onto one key makes
 * `findDuplicateProperty` hand an ownership claim the wrong property.
 */
function dropUnitDesignators(tokens: string[]): string[] {
  return tokens.filter((token, i) => {
    if (!UNIT_DESIGNATORS.has(token)) return true;
    return !looksLikeUnitIdentifier(tokens[i + 1]);
  });
}

/**
 * Canonical street line: lowercase, punctuation-free, abbreviated street
 * types, and a trailing secondary-unit designator dropped — so
 * "817 Isham St Apt 5" and "817 Isham St #5" agree, and either agrees with a
 * separate unit field of "Unit 5".
 */
export function normalizeStreet(street: string): string {
  const tokens = squash(street).split(" ").filter(Boolean);
  return dropUnitDesignators(tokens)
    .map((token) => STREET_TYPES[token] ?? token)
    .join(" ");
}

/** Canonical full address key used for duplicate detection. */
export function normalizeAddress(input: {
  street_address: string;
  unit_label?: string | null;
  city: string;
  state: string;
  zip: string;
}): string {
  const parts = [
    normalizeStreet(input.street_address),
    input.unit_label ? normalizeUnitLabel(input.unit_label) : "",
    squash(input.city),
    squash(input.state),
    squash(input.zip).slice(0, 5),
  ].filter(Boolean);
  return parts.join(" ");
}

/**
 * Canonical secondary-unit key. "Apt 5", "Unit 5", "Ste 5", "#5" and "5" all
 * reduce to "5" — the designator word carries no information about WHICH unit
 * it is, and records sources disagree about which word to use.
 */
export function normalizeUnitLabel(label: string): string {
  const tokens = squash(label).split(" ").filter(Boolean);
  // In a dedicated unit field a lone designator word carries no identifier, so
  // drop it there too ("Apt" alone is noise); otherwise the same rule as the
  // street line applies.
  const stripped = tokens.filter((token, i) => {
    if (!UNIT_DESIGNATORS.has(token)) return true;
    return tokens.length > 1 && !looksLikeUnitIdentifier(tokens[i + 1]) && i !== 0;
  });
  return stripped.join(" ");
}

export function normalizePropertyAddress(property: Property): string {
  return normalizeAddress({
    street_address: property.street_address,
    unit_label: property.unit_label,
    city: property.city,
    state: property.state,
    zip: property.zip,
  });
}

/**
 * Existing property matching the given address, if any. Callers use this
 * before creating a property so records lookups reuse the canonical record.
 */
type AddressLike = Pick<Property, "street_address" | "city" | "state" | "zip"> & {
  unit_label?: string | null;
  normalized_address?: string | null;
};

export function findDuplicateProperty<T extends AddressLike>(
  properties: T[],
  input: {
    street_address: string;
    unit_label?: string | null;
    city: string;
    state: string;
    zip: string;
  },
): T | null {
  const key = normalizeAddress(input);
  return properties.find((p) => (p.normalized_address ?? normalizeAddress(p)) === key) ?? null;
}

/**
 * Canonical person/entity name. Middle names, initials, punctuation and
 * suffix formatting are normalized away; materially different names are not.
 */
export function normalizeOwnerName(name: string): string {
  // County assessor and recorder exports overwhelmingly use "Last, First M".
  // Flip that to natural order BEFORE squashing, because `squash` throws the
  // comma away and the ordering information with it. Without this, a genuine
  // owner whose deed reads "SMITH, JOHN A" never matches "John A. Smith" and
  // gets pushed into manual review.
  // Reorder on the RAW name, then collapse: pre-collapsing would turn
  // "Hartley, L P" into "Hartley, lp" and make the initials look like an
  // entity suffix, defeating the reorder this exists to perform.
  const reordered = collapseEntityAbbreviations(reorderSurnameFirst(name));

  const tokens = squash(reordered)
    .split(" ")
    .map((token) => ENTITY_TOKENS[token] ?? token)
    .filter((token) => token.length > 0);

  // Only a TRAILING suffix is a suffix. "John V Smith" has a middle initial,
  // not a regnal number, and "Jr Realty LLC" is a company — stripping either
  // would manufacture a false exact match on an ownership claim.
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1] as string)) {
    tokens.pop();
  }
  return tokens.join(" ");
}

/**
 * "Smith, John A" → "John A Smith". Names without a comma are unchanged, and
 * so is a comma that merely separates an entity or generational suffix —
 * "Acme Properties, LLC" and "Smith, Jr" are NOT surname-first.
 */
function reorderSurnameFirst(name: string): string {
  const segments = name
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 2) return name;

  const isSuffixOnly = (segment: string, headTokenCount: number) => {
    const collapsed = squash(collapseEntityAbbreviations(segment));
    const tokens = collapsed.split(" ").filter(Boolean);
    if (tokens.length === 0) return false;
    const everySuffix = tokens.every(
      (t) => NAME_SUFFIXES.has(t) || t in ENTITY_TOKENS || ENTITY_SUFFIX_TOKENS.has(t),
    );
    if (!everySuffix) return false;
    // "Hartley, L P" is a person whose initials happen to spell an entity
    // abbreviation. Dotted forms ("L.L.C.", "P.C.") are unambiguously an
    // entity suffix after any head; bare spaced initials are ambiguous, so
    // trust those only after a multi-word business name.
    const isAmbiguousInitials = collapsed !== squash(segment) && !segment.includes(".");
    return isAmbiguousInitials ? headTokenCount >= 2 : true;
  };

  // "Smith, John, Jr" — peel trailing suffix segments off first so the given
  // name, not the suffix, is what moves to the front.
  const headTokenCount = squash(segments[0] as string)
    .split(" ")
    .filter(Boolean).length;
  const trailingSuffixes: string[] = [];
  while (
    segments.length > 1 &&
    isSuffixOnly(segments[segments.length - 1] as string, headTokenCount)
  ) {
    trailingSuffixes.unshift(segments.pop() as string);
  }

  // "Acme Properties, LLC" — the only segments left are a name and its entity
  // suffix, which is not surname-first at all.
  if (segments.length < 2) return [...segments, ...trailingSuffixes].join(" ");

  const [surname, ...given] = segments;
  return [...given, surname, ...trailingSuffixes].join(" ");
}

export type NameMatch = { match: "exact" | "strong" | "candidate" | "none"; reason: string };

/**
 * Name comparison used to CORROBORATE a claim. A fuzzy hit is a candidate for
 * review — it never by itself manufactures ownership proof.
 */
export function compareOwnerName(claimed: string, recorded: string): NameMatch {
  const a = normalizeOwnerName(claimed);
  const b = normalizeOwnerName(recorded);
  if (!a || !b) return { match: "none", reason: "A name was missing." };
  if (a === b) return { match: "exact", reason: "Names match exactly after normalization." };

  const at = a.split(" ").filter(Boolean);
  const bt = b.split(" ").filter(Boolean);
  const setB = new Set(bt);
  const shared = at.filter((t) => setB.has(t));

  // First + last present on both sides, differing only by middle name/initial.
  const firstLastA = [at[0], at[at.length - 1]].join(" ");
  const firstLastB = [bt[0], bt[bt.length - 1]].join(" ");
  if (firstLastA === firstLastB && shared.length >= 2) {
    return {
      match: "strong",
      reason: "First and last name agree; middle name formatting differs.",
    };
  }
  if (shared.length >= 2) {
    return { match: "candidate", reason: "Some name parts agree — needs review." };
  }
  return { match: "none", reason: "Recorded owner name is materially different." };
}
