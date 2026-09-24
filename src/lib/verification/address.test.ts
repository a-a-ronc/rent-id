import { describe, expect, it } from "vitest";

import type { Property } from "@/lib/types";
import {
  compareOwnerName,
  findDuplicateProperty,
  normalizeAddress,
  normalizeOwnerName,
  normalizePropertyAddress,
  normalizeStreet,
  normalizeUnitLabel,
} from "@/lib/verification/address";

/* -------------------------------------------------------------------------- */
/*  fixtures                                                                  */
/* -------------------------------------------------------------------------- */

type AddressInput = Parameters<typeof normalizeAddress>[0];

const address = (over: Partial<AddressInput> = {}): AddressInput => ({
  street_address: "817 Isham St",
  unit_label: null,
  city: "Salt Lake City",
  state: "UT",
  zip: "84103",
  ...over,
});

/** A full Property so a renamed column breaks this file, not just production. */
const property = (over: Partial<Property> = {}): Property => ({
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  name: "Isham House",
  property_type: "single_family",
  management_category: "standard_residential",
  street_address: "817 Isham St",
  unit_label: null,
  city: "Salt Lake City",
  state: "UT",
  zip: "84103",
  year_built: 1924,
  notes: null,
  normalized_address: null,
  county: "Salt Lake",
  parcel_number: null,
  recording_jurisdiction: null,
  legal_description: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  ...over,
});

/* -------------------------------------------------------------------------- */
/*  normalizeStreet                                                           */
/* -------------------------------------------------------------------------- */

describe("normalizeStreet", () => {
  it.each([
    ["Street → st", "817 Isham Street", "817 isham st"],
    ["already abbreviated", "817 Isham St", "817 isham st"],
    ["Avenue → ave", "629 Alger Avenue", "629 alger ave"],
    ["Av → ave", "629 Alger Av", "629 alger ave"],
    ["Road → rd", "12 Mill Road", "12 mill rd"],
    ["Drive → dr", "12 Mill Drive", "12 mill dr"],
    ["Boulevard → blvd", "1 Foothill Boulevard", "1 foothill blvd"],
    ["Lane → ln", "1 Quail Lane", "1 quail ln"],
    ["Court → ct", "1 Quail Court", "1 quail ct"],
    ["Circle → cir", "1 Quail Circle", "1 quail cir"],
    ["Place → pl", "1 Quail Place", "1 quail pl"],
    ["Terrace → ter", "1 Quail Terrace", "1 quail ter"],
    ["Parkway → pkwy", "1 Foothill Parkway", "1 foothill pkwy"],
    ["Highway → hwy", "1 Old Highway", "1 old hwy"],
    ["Trail → trl", "1 Bonneville Trail", "1 bonneville trl"],
    ["Square → sq", "1 Pioneer Square", "1 pioneer sq"],
    ["North → n", "817 North Temple", "817 n temple"],
    ["Southwest → sw", "817 Southwest Temple", "817 sw temple"],
    ["trailing period", "817 Isham St.", "817 isham st"],
    ["commas", "817, Isham, Street", "817 isham st"],
    ["hash", "817 Isham St #4", "817 isham st 4"],
    ["collapses runs of whitespace", "  817   ISHAM \t Street  ", "817 isham st"],
  ])("%s", (_label, input, expected) => {
    expect(normalizeStreet(input)).toBe(expected);
  });

  it("is idempotent", () => {
    const once = normalizeStreet("817 North Isham Street.");
    expect(normalizeStreet(once)).toBe(once);
  });

  it("does not mangle a street whose name happens to be a direction", () => {
    // "North Temple" is a real Salt Lake City street; abbreviating it is fine as
    // long as BOTH spellings land in the same place.
    expect(normalizeStreet("N Temple")).toBe(normalizeStreet("North Temple"));
  });

  it.each([
    ["a digit identifier", "817 Isham St Apt 5", "817 isham st 5"],
    ["Unit", "817 Isham St Unit 5", "817 isham st 5"],
    ["Ste", "817 Isham St Ste 5", "817 isham st 5"],
    ["a hash", "817 Isham St #5", "817 isham st 5"],
    ["a lone-letter identifier", "817 Isham St Bldg B", "817 isham st b"],
    ["a designator mid-line", "1 Unit A", "1 a"],
    ["an alphanumeric identifier", "817 Isham St Apt 5B", "817 isham st 5b"],
  ])("drops a unit designator followed by an identifier — %s", (_label, input, expected) => {
    expect(normalizeStreet(input)).toBe(expected);
  });

  /**
   * The designator is dropped ONLY when what follows looks like a unit
   * identifier (contains a digit, or is a lone letter). Dropping it on a bare
   * token match would delete the street NAME of "300 Building Ave" and collapse
   * it onto "300 Lot Ave" — a duplicate-detection FALSE POSITIVE, which is the
   * direction that matters, because `findDuplicateProperty` would then hand an
   * ownership claim the wrong property.
   */
  it.each([
    ["300 Building Ave", "300 building ave"],
    ["300 Lot Ave", "300 lot ave"],
    ["300 Space Ave", "300 space ave"],
    ["300 Room Ave", "300 room ave"],
    ["100 Lot Line Rd", "100 lot line rd"],
    ["400 Floor St", "400 floor st"],
    ["500 No Name Rd", "500 no name rd"],
    ["200 Space Park Dr", "200 space park dr"],
  ])("keeps a street NAME spelled like a designator: %s", (input, expected) => {
    expect(normalizeStreet(input)).toBe(expected);
  });

  it("keeps distinct designator-named streets distinct", () => {
    const streets = ["300 Building Ave", "300 Lot Ave", "300 Space Ave", "300 Room Ave"];
    const keys = streets.map((s) => normalizeStreet(s));
    expect(new Set(keys).size).toBe(streets.length);
  });

  it("keeps a trailing designator with nothing after it", () => {
    // Nothing follows, so it cannot be a designator for anything — treat it as
    // part of the street name rather than deleting it.
    expect(normalizeStreet("100 Main St Apt")).toBe("100 main st apt");
    expect(normalizeStreet("100 Main St Apt")).not.toBe(normalizeStreet("100 Main St"));
  });

  it("handles a designator-named street that ALSO carries a unit", () => {
    // "Lot" is the street name here and "Apt 4" is the real unit; only the
    // second one goes.
    expect(normalizeStreet("100 Lot Line Rd Apt 4")).toBe("100 lot line rd 4");
    expect(normalizeStreet("100 Lot Line Rd #4")).toBe("100 lot line rd 4");
  });
});

/* -------------------------------------------------------------------------- */
/*  normalizeAddress                                                          */
/* -------------------------------------------------------------------------- */

describe("normalizeAddress", () => {
  it("abbreviates the street type — '817 Isham St' ≡ '817 Isham Street'", () => {
    expect(normalizeAddress(address({ street_address: "817 Isham St" }))).toBe(
      normalizeAddress(address({ street_address: "817 Isham Street" })),
    );
  });

  it("produces the documented canonical key", () => {
    expect(normalizeAddress(address())).toBe("817 isham st salt lake city ut 84103");
  });

  it("is insensitive to case, punctuation and whitespace across every field", () => {
    const messy = address({
      street_address: "  817   ISHAM Street. ",
      city: "  SALT LAKE   CITY ",
      state: " Ut ",
      zip: " 84103 ",
    });
    expect(normalizeAddress(messy)).toBe(normalizeAddress(address()));
  });

  it.each([
    ["hyphenated ZIP+4", "84103-1234"],
    ["unhyphenated ZIP+4", "841031234"],
    ["ZIP+4 with spaces", "84103 1234"],
    ["plain ZIP", "84103"],
  ])("truncates a %s to five digits", (_label, zip) => {
    expect(normalizeAddress(address({ zip }))).toBe(normalizeAddress(address({ zip: "84103" })));
  });

  it("keeps genuinely different addresses apart", () => {
    const key = normalizeAddress(address());
    const different: Array<Partial<AddressInput>> = [
      { street_address: "818 Isham St" }, // different house number
      { street_address: "817 Isham Ave" }, // different street type
      { street_address: "817 Ingham St" }, // one letter off
      { city: "Ogden" },
      { state: "ID" },
      { zip: "84104" },
      { unit_label: "Apt 2" },
    ];
    for (const over of different) {
      expect(normalizeAddress(address(over))).not.toBe(key);
    }
    // ...and they are all distinct from each other, not merely from the base.
    const keys = different.map((over) => normalizeAddress(address(over)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  describe("unit labels", () => {
    it("appends the unit identifier to the key, designator dropped", () => {
      expect(
        normalizeAddress(address({ street_address: "100 Main St", unit_label: "Apt 5" })),
      ).toBe("100 main st 5 salt lake city ut 84103");
    });

    it("drops an empty or null unit label rather than leaving a gap", () => {
      const noUnit = normalizeAddress(address({ street_address: "100 Main St", unit_label: null }));
      expect(normalizeAddress(address({ street_address: "100 Main St", unit_label: "" }))).toBe(
        noUnit,
      );
      expect(normalizeAddress(address({ street_address: "100 Main St", unit_label: "   " }))).toBe(
        noUnit,
      );
    });

    it("merges a unit written into the street line with the same unit in its own field", () => {
      // A records source that returns one address line still resolves to the
      // same property as a form that splits the unit out — and the two sides
      // may even disagree about which designator word to use.
      const oneLine = normalizeAddress(
        address({ street_address: "100 Main St Apt 5", unit_label: null }),
      );
      expect(oneLine).toBe(
        normalizeAddress(address({ street_address: "100 Main St", unit_label: "Apt 5" })),
      );
      expect(oneLine).toBe(
        normalizeAddress(address({ street_address: "100 Main St", unit_label: "Unit 5" })),
      );
      expect(oneLine).toBe(
        normalizeAddress(address({ street_address: "100 Main St #5", unit_label: null })),
      );
    });

    /**
     * The point of the module: "ownership verification never creates a duplicate
     * property because a records source formats an address differently". The
     * designator word says nothing about WHICH unit it is, and sources disagree
     * about which word to use, so it is dropped entirely — a county record
     * saying "#5", a lease saying "Unit 5" and a landlord typing "Apt 5" are one
     * property.
     */
    it("unifies Apt 5 / Unit 5 / Ste 5 / Suite 5 / Apartment 5 / #5 / 5", () => {
      const spellings = ["Apt 5", "Unit 5", "Ste 5", "Suite 5", "Apartment 5", "#5", "5", "No. 5"];
      const keys = spellings.map((unit_label) => normalizeAddress(address({ unit_label })));
      expect(new Set(keys).size).toBe(1);
      expect(keys[0]).toBe("817 isham st 5 salt lake city ut 84103");
    });

    it("still tells different units apart", () => {
      const five = normalizeAddress(address({ unit_label: "Apt 5" }));
      expect(normalizeAddress(address({ unit_label: "Apt 6" }))).not.toBe(five);
      expect(normalizeAddress(address({ unit_label: "Apt 5B" }))).not.toBe(five);
      expect(normalizeAddress(address({ unit_label: "B" }))).not.toBe(five);
      // ...and a unit is never the same property as the building with no unit.
      expect(normalizeAddress(address({ unit_label: null }))).not.toBe(five);
    });

    it("keeps a multi-token unit identifier intact", () => {
      // "#5 A" and "Apt 5 A" are the same unit; the designator goes, "5 a" stays.
      expect(normalizeAddress(address({ unit_label: "#5 A" }))).toBe(
        normalizeAddress(address({ unit_label: "Apt 5 A" })),
      );
      expect(normalizeAddress(address({ unit_label: "#5 A" }))).toBe(
        "817 isham st 5 a salt lake city ut 84103",
      );
      // A hyphenated identifier is left alone (it is not tokenised on "-").
      expect(normalizeAddress(address({ unit_label: "Apt 5-A" }))).toBe(
        "817 isham st 5-a salt lake city ut 84103",
      );
    });

    it("treats a bare designator in the UNIT FIELD as no unit at all", () => {
      // A dedicated unit field holding only "Apt" carries no identifier, so it
      // is noise and the property is the same one as with no unit.
      const noUnit = normalizeAddress(address({ street_address: "100 Main St", unit_label: null }));
      expect(normalizeAddress(address({ street_address: "100 Main St", unit_label: "Apt" }))).toBe(
        noUnit,
      );
      expect(
        normalizeAddress(address({ street_address: "100 Main St", unit_label: "Building" })),
      ).toBe(noUnit);
    });

    it("keeps a bare designator in the STREET LINE, where it may be the street name", () => {
      // The two fields are deliberately asymmetric: a trailing "Apt" on the
      // street line has nothing after it to designate, so deleting it could
      // merge two real addresses.
      expect(
        normalizeAddress(address({ street_address: "100 Main St Apt", unit_label: null })),
      ).not.toBe(normalizeAddress(address({ street_address: "100 Main St", unit_label: null })));
    });

    it("resolves a designator-named street with a real unit to one key either way", () => {
      expect(
        normalizeAddress(address({ street_address: "100 Lot Line Rd", unit_label: "Apt 4" })),
      ).toBe(
        normalizeAddress(address({ street_address: "100 Lot Line Rd Apt 4", unit_label: null })),
      );
      // ...and that is still a different property from the un-unitted building.
      expect(
        normalizeAddress(address({ street_address: "100 Lot Line Rd", unit_label: "Apt 4" })),
      ).not.toBe(
        normalizeAddress(address({ street_address: "100 Lot Line Rd", unit_label: null })),
      );
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  normalizeUnitLabel                                                        */
/* -------------------------------------------------------------------------- */

describe("normalizeUnitLabel", () => {
  it.each([
    ["Apt 5", "5"],
    ["Apartment 5", "5"],
    ["Unit 5", "5"],
    ["Ste 5", "5"],
    ["Suite 5", "5"],
    ["#5", "5"],
    ["5", "5"],
    ["No. 5", "5"],
    ["Number 5", "5"],
    ["Rm 5", "5"],
    ["Room 5", "5"],
    ["Fl 3", "3"],
    ["Floor 3", "3"],
    ["Bldg B", "b"],
    ["Building B", "b"],
    ["Lot 12", "12"],
    ["Space 7", "7"],
    ["Spc 7", "7"],
    ["UNIT B", "b"],
    ["  Apt   5  ", "5"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeUnitLabel(input)).toBe(expected);
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a bare designator with no identifier", "Apt"],
    ["a bare multi-syllable designator", "Building"],
    ["punctuation only", "#"],
  ])("returns an empty string for %s", (_label, input) => {
    expect(normalizeUnitLabel(input)).toBe("");
  });

  it("drops a LEADING designator even when what follows is a word", () => {
    // Asymmetric with normalizeStreet on purpose: the first token of a
    // dedicated unit field is a designator, never a street name.
    expect(normalizeUnitLabel("Lot Line")).toBe("line");
    expect(normalizeStreet("100 Lot Line Rd")).toBe("100 lot line rd");
  });

  it("keeps a designator that is not leading and designates nothing", () => {
    expect(normalizeUnitLabel("5 Apt")).toBe("5 apt");
  });

  it("is idempotent", () => {
    for (const label of ["Apt 5", "#5 A", "Bldg B", "5"]) {
      expect(normalizeUnitLabel(normalizeUnitLabel(label))).toBe(normalizeUnitLabel(label));
    }
  });

  it("does not merge genuinely different units", () => {
    const keys = ["Apt 5", "Apt 6", "Apt 5A", "Apt 5 A", "B"].map(normalizeUnitLabel);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/* -------------------------------------------------------------------------- */
/*  normalizePropertyAddress                                                  */
/* -------------------------------------------------------------------------- */

describe("normalizePropertyAddress", () => {
  it("reads the address fields off a Property row", () => {
    expect(normalizePropertyAddress(property())).toBe("817 isham st salt lake city ut 84103");
  });

  it("matches normalizeAddress on the same values", () => {
    const p = property({
      street_address: "629 Alger Avenue",
      unit_label: "Apt 2",
      zip: "84105-0001",
    });
    expect(normalizePropertyAddress(p)).toBe(
      normalizeAddress({
        street_address: p.street_address,
        unit_label: p.unit_label,
        city: p.city,
        state: p.state,
        zip: p.zip,
      }),
    );
  });

  it("ignores the stored normalized_address column (it recomputes)", () => {
    expect(normalizePropertyAddress(property({ normalized_address: "totally different" }))).toBe(
      "817 isham st salt lake city ut 84103",
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  findDuplicateProperty                                                     */
/* -------------------------------------------------------------------------- */

describe("findDuplicateProperty", () => {
  it("matches a differently-formatted spelling of a stored address", () => {
    const stored = [property({ id: "match", street_address: "629 Alger Avenue", zip: "84105" })];
    const hit = findDuplicateProperty(stored, {
      street_address: "  629 alger ave. ",
      unit_label: null,
      city: "SALT LAKE CITY",
      state: "ut",
      zip: "84105-9999",
    });
    expect(hit?.id).toBe("match");
  });

  it("returns null when nothing matches", () => {
    expect(
      findDuplicateProperty([property()], {
        street_address: "1 Nowhere Rd",
        unit_label: null,
        city: "Provo",
        state: "UT",
        zip: "84601",
      }),
    ).toBeNull();
  });

  it("returns null for an empty portfolio", () => {
    expect(findDuplicateProperty([], address())).toBeNull();
  });

  it("prefers a stored normalized_address over recomputing from the columns", () => {
    // The columns say Ogden; the stored key says the Alger Ave property. The
    // stored key is what a records-backed canonicalisation wrote, so it wins.
    const stored = [
      property({
        id: "stored-key",
        street_address: "1 Stale Rd",
        city: "Ogden",
        zip: "84401",
        normalized_address: "629 alger ave salt lake city ut 84105",
      }),
    ];
    const hit = findDuplicateProperty(stored, {
      street_address: "629 Alger Avenue",
      unit_label: null,
      city: "Salt Lake City",
      state: "UT",
      zip: "84105",
    });
    expect(hit?.id).toBe("stored-key");

    // ...and the now-stale columns do NOT match on their own.
    expect(
      findDuplicateProperty(stored, {
        street_address: "1 Stale Rd",
        unit_label: null,
        city: "Ogden",
        state: "UT",
        zip: "84401",
      }),
    ).toBeNull();
  });

  it("falls back to recomputing when normalized_address is null", () => {
    const stored = [property({ id: "derived", normalized_address: null })];
    expect(findDuplicateProperty(stored, address({ street_address: "817 Isham Street" }))?.id).toBe(
      "derived",
    );
  });

  it("returns the first match when a portfolio already holds duplicates", () => {
    const stored = [
      property({ id: "first" }),
      property({ id: "second", street_address: "817 Isham Street" }),
    ];
    expect(findDuplicateProperty(stored, address())?.id).toBe("first");
  });

  it("works on any row carrying the address columns, not just a full Property", () => {
    const lean = [
      {
        id: "lean",
        street_address: "817 Isham St",
        city: "Salt Lake City",
        state: "UT",
        zip: "84103",
      },
    ];
    expect(findDuplicateProperty(lean, address({ street_address: "817 Isham Street" }))?.id).toBe(
      "lean",
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  normalizeOwnerName                                                        */
/* -------------------------------------------------------------------------- */

describe("normalizeOwnerName", () => {
  it.each([
    ["lowercases and squashes", "  John   SMITH ", "john smith"],
    ["strips periods and commas", "John A. Smith", "john a smith"],
    ["drops a Jr suffix", "John Smith Jr.", "john smith"],
    ["drops an III suffix", "Robert Downey III", "robert downey"],
    ["collapses L.L.C. to llc", "Acme Properties, L.L.C.", "acme properties llc"],
    ["leaves an existing LLC alone", "Acme Properties LLC", "acme properties llc"],
    ["expands Incorporated", "Acme Incorporated", "acme inc"],
    ["expands Corporation", "Acme Corporation", "acme corp"],
    ["expands Company", "Acme Company", "acme co"],
    ["expands Limited", "Acme Limited", "acme ltd"],
    ["empty string stays empty", "", ""],
    ["whitespace only collapses to empty", "   ", ""],
  ])("%s", (_label, input, expected) => {
    expect(normalizeOwnerName(input)).toBe(expected);
  });

  /**
   * County assessor and recorder exports overwhelmingly write "LAST, FIRST M".
   * `squash` throws the comma away, so the ordering has to be recovered BEFORE
   * squashing or a genuine owner whose deed reads "SMITH, JOHN A" never matches
   * "John A. Smith". Tokens are NOT sorted — the surname-first case is handled
   * explicitly, which keeps "John Smith" and "Smith John" distinguishable.
   */
  it.each([
    ["Smith, John A", "john a smith"],
    ["SMITH, JOHN A", "john a smith"],
    ["Smith, John", "john smith"],
    ["Doe, Jane Marie", "jane marie doe"],
    ["Watson, Mary Jane", "mary jane watson"],
  ])("reorders the surname-first spelling %s to %s", (input, expected) => {
    expect(normalizeOwnerName(input)).toBe(expected);
  });

  it("makes surname-first and natural order produce the same key", () => {
    expect(normalizeOwnerName("Smith, John A")).toBe(normalizeOwnerName("John A. Smith"));
  });

  it("does not sort tokens, so a genuinely reordered name stays distinguishable", () => {
    // No comma → no reordering. "Smith John" is not treated as "John Smith".
    expect(normalizeOwnerName("Smith John")).toBe("smith john");
    expect(normalizeOwnerName("John Smith")).toBe("john smith");
    expect(normalizeOwnerName("Smith John")).not.toBe(normalizeOwnerName("John Smith"));
  });

  it.each([
    ["Acme Properties, LLC", "acme properties llc"],
    ["Acme Properties, L.L.C.", "acme properties llc"],
    ["Acme, Inc.", "acme inc"],
    ["Acme, L.L.P.", "acme llp"],
    ["Beta, P.C.", "beta pc"],
    ["Gamma, L.P.", "gamma lp"],
    ["Smith, Jr", "smith"],
  ])("does NOT reorder %s — the comma only separates a suffix", (input, expected) => {
    expect(normalizeOwnerName(input)).toBe(expected);
  });

  /**
   * Dotted and spaced entity abbreviations are collapsed to a single token
   * BEFORE tokenising, so the suffix test never has to treat bare letters as
   * entity words (which used to break "Smith, C").
   */
  it.each([
    ["L.L.C. → llc", "Acme L.L.C.", "acme llc"],
    ["L L C → llc", "Acme L L C", "acme llc"],
    ["L.L.P. → llp", "Acme L.L.P.", "acme llp"],
    ["L L P → llp", "Acme L L P", "acme llp"],
    ["P.C. → pc", "Delta P.C.", "delta pc"],
    ["L.P. → lp", "Gamma L.P.", "gamma lp"],
    ["already collapsed", "Acme LLC", "acme llc"],
  ])("collapses a dotted entity abbreviation: %s", (_label, input, expected) => {
    expect(normalizeOwnerName(input)).toBe(expected);
  });

  it.each([
    ["Pat Cohen", "pat cohen"],
    ["Carl P Smith", "carl p smith"],
    ["L Paul Smith", "l paul smith"],
    ["P Carter", "p carter"],
    ["John L. Peterson", "john l peterson"],
    ["J L C Smith", "j l c smith"],
  ])(
    "does not mangle an ordinary name that merely contains those letters: %s",
    (input, expected) => {
      expect(normalizeOwnerName(input)).toBe(expected);
    },
  );

  /**
   * RESIDUAL (reported, not a blocker).
   *
   * Entity-abbreviation collapsing is TRAILING-ONLY and dotted forms are
   * treated as unambiguous, so a person whose initials happen to spell an
   * entity abbreviation is still read as a person: "Hartley, L P" is a
   * surname-first record, while "Acme, L.L.P." is a company.
   */
  it("reads a person's initials as initials, not an entity suffix", () => {
    expect(normalizeOwnerName("L P Hartley")).toBe("l p hartley");
    expect(normalizeOwnerName("P C Wren")).toBe("p c wren");
    expect(compareOwnerName("L P Hartley", "L. P. Hartley").match).toBe("exact");
    // the surname-first spelling of the same name reorders and matches
    expect(normalizeOwnerName("Hartley, L P")).toBe("l p hartley");
    expect(compareOwnerName("Hartley, L P", "L P Hartley").match).toBe("exact");
    expect(compareOwnerName("Wren, P C", "P C Wren").match).toBe("exact");
  });

  /**
   * A DOTTED abbreviation after a single-word head is still a company, because
   * "L.L.P." is not a plausible pair of given-name initials.
   */
  it("still reads a dotted abbreviation after a one-word head as an entity", () => {
    expect(normalizeOwnerName("Acme, L.L.P.")).toBe("acme llp");
    expect(normalizeOwnerName("Beta, P.C.")).toBe("beta pc");
    expect(normalizeOwnerName("Gamma, L.P.")).toBe("gamma lp");
    expect(normalizeOwnerName("Acme Holdings, L L C")).toBe("acme holdings llc");
  });

  it.each([
    ["keeps a middle initial V", "John V Smith", "john v smith"],
    ["keeps any other middle initial", "John B Smith", "john b smith"],
    ["strips a trailing V", "John Smith V", "john smith"],
    ["strips a trailing Jr", "John Smith Jr.", "john smith"],
    ["strips a trailing III", "Robert Downey III", "robert downey"],
    ["keeps a leading Jr in a company name", "Jr Realty LLC", "jr realty llc"],
    ["keeps a lone suffix that is the whole name", "Jr", "jr"],
    ["keeps a lone V that is the whole name", "V", "v"],
  ])("%s", (_label, input, expected) => {
    expect(normalizeOwnerName(input)).toBe(expected);
  });

  it("strips a run of trailing suffixes but never the last remaining token", () => {
    expect(normalizeOwnerName("John Smith Jr II")).toBe("john smith");
    expect(normalizeOwnerName("Jr")).toBe("jr");
  });
});

/* -------------------------------------------------------------------------- */
/*  compareOwnerName                                                          */
/* -------------------------------------------------------------------------- */

describe("compareOwnerName", () => {
  it.each([
    ["identical names", "John Smith", "John Smith", "exact"],
    ["case and punctuation only", "  john   smith ", "John Smith.", "exact"],
    ["a dropped Jr suffix", "John Smith Jr.", "John Smith", "exact"],
    [
      "differing generational suffixes still collapse",
      "Robert Downey II",
      "Robert Downey III",
      "exact",
    ],
    ["L.L.C. vs LLC", "Acme Properties LLC", "Acme Properties, L.L.C.", "exact"],
    ["Inc vs Incorporated", "Acme Inc", "Acme Incorporated", "exact"],
    ["a middle initial added on one side", "John Smith", "John A Smith", "strong"],
    ["a middle initial added on the other side", "John A. Smith", "John Smith", "strong"],
    ["a spelled-out middle name", "Mary Jane Watson", "Mary Watson", "strong"],
    ["surname-first on one side", "Smith, John A", "John A. Smith", "exact"],
    ["surname-first, upper case, on one side", "SMITH, JOHN A", "John A Smith", "exact"],
    ["surname-first with no middle name", "Smith, John", "John Smith", "exact"],
    [
      "a middle initial V, which is no longer eaten as a suffix",
      "John V Smith",
      "John Smith",
      "strong",
    ],
    ["a trailing V, which still is a suffix", "John Smith V", "John Smith", "exact"],
    ["reversed given and family name WITHOUT a comma", "John Smith", "Smith John", "candidate"],
    [
      "a partially expanded entity suffix",
      "Acme Properties LLC",
      "Acme Properties Limited Liability Company",
      "candidate",
    ],
    ["a different first name", "John Smith", "Jane Smith", "none"],
    ["a different entity", "Acme Corp", "Beta Corp", "none"],
    ["an initial vs the full first name", "J Smith", "John Smith", "none"],
    ["a missing claimed name", "", "John Smith", "none"],
    ["a missing recorded name", "John Smith", "", "none"],
    ["both names missing", "", "", "none"],
    ["a bare suffix as the claimed name", "Jr.", "John Smith", "none"],
    [
      "an entity whose comma only separates its suffix",
      "Acme Properties, LLC",
      "Acme Properties LLC",
      "exact",
    ],
  ])("%s → %s", (_label, claimed, recorded, expected) => {
    expect(compareOwnerName(claimed, recorded).match).toBe(expected);
  });

  it("always returns a human-readable reason alongside the verdict", () => {
    for (const [a, b] of [
      ["John Smith", "John Smith"],
      ["John Smith", "John A Smith"],
      ["John Smith", "Smith John"],
      ["John Smith", "Jane Smith"],
      ["", "John Smith"],
    ] as const) {
      const result = compareOwnerName(a, b);
      expect(result.reason).toBeTruthy();
      expect(result.reason.length).toBeGreaterThan(10);
    }
  });

  it("is symmetric for every verdict it can reach", () => {
    for (const [a, b] of [
      ["John Smith", "John Smith"],
      ["John Smith", "John A Smith"],
      ["Smith, John A", "John A. Smith"],
      ["John Smith", "Jane Smith"],
      ["Acme Properties LLC", "Acme Properties, L.L.C."],
    ] as const) {
      expect(compareOwnerName(a, b).match).toBe(compareOwnerName(b, a).match);
    }
  });

  it("never claims better than 'candidate' on a surname collision alone", () => {
    // A shared last name is the single most common false positive in county
    // records; it must not corroborate a claim by itself.
    expect(compareOwnerName("Aaron Smith", "Jane Smith").match).toBe("none");
    expect(compareOwnerName("Smith", "Smith Family Trust").match).toBe("none");
  });

  describe("surname-first edge cases", () => {
    it("peels a comma-separated generational suffix before moving the surname", () => {
      // "SMITH, JOHN, JR" is a common recorder spelling. The trailing suffix
      // segment comes off first, so the GIVEN name moves to the front and the
      // suffix ends up trailing, where the suffix strip can reach it.
      expect(normalizeOwnerName("Smith, John, Jr")).toBe("john smith");
      expect(compareOwnerName("Smith, John, Jr", "John Smith").match).toBe("exact");
      expect(compareOwnerName("Smith, John, Jr", "John Smith Jr").match).toBe("exact");
    });

    it.each([
      ["Doe, Jane Marie, III", "jane marie doe"],
      ["Smith, John A, Jr", "john a smith"],
      ["Smith, John, Jr, II", "john smith"],
    ])("handles the multi-comma spelling %s", (input, expected) => {
      expect(normalizeOwnerName(input)).toBe(expected);
    });

    it("reorders a single-letter given name like any other", () => {
      // Bare "l"/"c" are no longer entity tokens — dotted abbreviations are
      // collapsed before tokenising instead — so an initial-only given name is
      // just a name.
      expect(normalizeOwnerName("Smith, J")).toBe("j smith");
      expect(normalizeOwnerName("Smith, C")).toBe("c smith");
      expect(compareOwnerName("Smith, C", "C Smith").match).toBe("exact");
      expect(compareOwnerName("Smith, J", "J Smith").match).toBe("exact");
    });

    it("keeps a multi-token surname together when reordering", () => {
      expect(normalizeOwnerName("Van Der Berg, Johan")).toBe("johan van der berg");
      expect(compareOwnerName("Van Der Berg, Johan", "Johan Van Der Berg").match).toBe("exact");
    });

    it.each([
      ["a trailing comma with nothing after it", "Smith,", "smith"],
      ["a leading comma with nothing before it", ", John", "john"],
      ["a comma on its own", ",", ""],
      ["a trailing comma and whitespace", "Smith, ", "smith"],
      ["a doubled comma", "Smith,,John", "john smith"],
    ])("survives malformed punctuation — %s", (_label, input, expected) => {
      // A truncated records export should degrade to the plain name, not throw
      // and not produce a key with a stray empty token in it.
      expect(normalizeOwnerName(input)).toBe(expected);
    });

    it("still matches a name whose export left a dangling comma", () => {
      expect(compareOwnerName("Smith,", "Smith").match).toBe("exact");
    });

    it("reorders a deed capacity word along with the name", () => {
      // "Trustee" is not an entity suffix, so the whole tail is reordered.
      expect(normalizeOwnerName("Smith, John A, Trustee")).toBe("john a trustee smith");
      expect(compareOwnerName("Smith, John A, Trustee", "John A Smith").match).toBe("strong");
    });
  });

  it("reports 'exact' only when the normalized keys are byte-identical", () => {
    const exactPairs: Array<[string, string]> = [
      ["John Smith", "john smith"],
      ["ACME INC", "Acme Incorporated"],
    ];
    for (const [a, b] of exactPairs) {
      expect(normalizeOwnerName(a)).toBe(normalizeOwnerName(b));
      expect(compareOwnerName(a, b).match).toBe("exact");
    }
  });
});
