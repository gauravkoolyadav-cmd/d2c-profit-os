/**
 * Deterministic shoe-name mapping. No fuzzy / AI matching.
 *
 * Order of rules (first match wins):
 *  1. Manual mapping table (sheet "Mapping" tab): Shopify product name → shoe name
 *  2. Exact normalized match with a shoe name in the config sheet
 *  3. Same as 1–2 after removing a variant suffix ("Nepolian Clog - Black" → "Nepolian Clog")
 *  4. A shoe name appears as whole words inside the Shopify title
 *     ("Zenwalkers Signature Shoes Black" contains "Zenwalkers Signature Shoes").
 *     The longest matching shoe name wins; if two different shoes tie → UNMAPPED (ambiguous).
 */
import type { EngineOrderItem, NameMapping, ShoeConfig } from "./types";

/** lowercase, strip accents and punctuation, collapse whitespace. */
export function normalizeName(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type MappingMethod = "mapping_table" | "exact" | "variant_removed" | "contains";
export type UnmappedReason = "NOT_FOUND" | "AMBIGUOUS" | "MAPPING_TARGET_MISSING";

export interface ShoeMatch {
  shoe: ShoeConfig | null;
  method: MappingMethod | null;
  reason: UnmappedReason | null;
}

export interface ShoeIndex {
  byName: Map<string, ShoeConfig>;
  mappings: Map<string, string>;
  /** config names sorted longest first (for rule 4) */
  namesByLength: ShoeConfig[];
}

export function buildShoeIndex(configs: ShoeConfig[], mappings: NameMapping[]): ShoeIndex {
  const byName = new Map<string, ShoeConfig>();
  for (const config of configs) {
    const key = config.normalizedName || normalizeName(config.shoeName);
    if (key) byName.set(key, config);
  }
  const mappingMap = new Map<string, string>();
  for (const mapping of mappings) {
    if (mapping.normalizedShopifyName) {
      mappingMap.set(mapping.normalizedShopifyName, mapping.normalizedShoeName);
    }
  }
  const namesByLength = [...byName.values()].sort(
    (a, b) => b.normalizedName.length - a.normalizedName.length
  );
  return { byName, mappings: mappingMap, namesByLength };
}

function stripVariantSuffix(value: string | null): string | null {
  if (!value) return null;
  const index = value.lastIndexOf(" - ");
  return index > 0 ? value.slice(0, index) : null;
}

function lookupExact(index: ShoeIndex, normalized: string): ShoeMatch | null {
  if (!normalized) return null;
  const mapped = index.mappings.get(normalized);
  if (mapped !== undefined) {
    const shoe = index.byName.get(mapped) ?? null;
    return shoe
      ? { shoe, method: "mapping_table", reason: null }
      : { shoe: null, method: null, reason: "MAPPING_TARGET_MISSING" };
  }
  const shoe = index.byName.get(normalized);
  return shoe ? { shoe, method: "exact", reason: null } : null;
}

export function resolveShoe(
  item: Pick<EngineOrderItem, "productTitle" | "lineName">,
  index: ShoeIndex
): ShoeMatch {
  const candidates = [item.productTitle, item.lineName].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0
  );

  // Rules 1 + 2
  for (const candidate of candidates) {
    const match = lookupExact(index, normalizeName(candidate));
    if (match) return match;
  }

  // Rule 3: remove " - Variant" suffix
  for (const candidate of candidates) {
    const stripped = stripVariantSuffix(candidate);
    const match = stripped ? lookupExact(index, normalizeName(stripped)) : null;
    if (match) {
      return match.method === "exact" ? { ...match, method: "variant_removed" } : match;
    }
  }

  // Rule 4: whole-word containment, longest shoe name wins
  const title = ` ${normalizeName(candidates[0] ?? "")} `;
  if (title.trim()) {
    const hits = index.namesByLength.filter((config) =>
      title.includes(` ${config.normalizedName} `)
    );
    if (hits.length > 0) {
      const longest = hits[0].normalizedName.length;
      const tied = hits.filter((hit) => hit.normalizedName.length === longest);
      if (tied.length > 1) return { shoe: null, method: null, reason: "AMBIGUOUS" };
      return { shoe: hits[0], method: "contains", reason: null };
    }
  }

  return { shoe: null, method: null, reason: "NOT_FOUND" };
}
