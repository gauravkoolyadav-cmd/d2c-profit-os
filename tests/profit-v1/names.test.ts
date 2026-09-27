import { describe, expect, it } from "vitest";
import { buildShoeIndex, normalizeName, resolveShoe } from "@/lib/profit-v1/names";
import { CONFIGS, shoe } from "./fixtures";

const item = (productTitle: string, lineName: string | null = null) => ({ productTitle, lineName });

describe("normalizeName", () => {
  it("lowercases, trims, removes punctuation and collapses spaces", () => {
    expect(normalizeName("  Zenwalker Men's   Gym-Shoe!! ")).toBe("zenwalker men s gym shoe");
    expect(normalizeName("NEPOLIAN CLOG")).toBe("nepolian clog");
  });
});

describe("shoe name mapping (deterministic, no fuzzy matching)", () => {
  const index = buildShoeIndex(CONFIGS, [
    { normalizedShopifyName: normalizeName("GMSOLO Nepolian Clog"), normalizedShoeName: normalizeName("Nepolian Clog") },
  ]);

  it("exact name (case/spacing insensitive)", () => {
    expect(resolveShoe(item("  nepolian   CLOG "), index)).toMatchObject({ shoe: { shoeName: "Nepolian Clog" }, method: "exact" });
  });

  it("manual mapping table wins", () => {
    expect(resolveShoe(item("GMSOLO Nepolian Clog"), index)).toMatchObject({
      shoe: { shoeName: "Nepolian Clog" },
      method: "mapping_table",
    });
  });

  it("variant suffix is removed: 'Nepolian Clog - Black' → Nepolian Clog", () => {
    expect(resolveShoe(item("Nepolian Clog - Black"), index)).toMatchObject({
      shoe: { shoeName: "Nepolian Clog" },
      method: "variant_removed",
    });
  });

  it("shoe name contained as whole words: 'Zenwalkers Signature Shoes - Black'", () => {
    expect(resolveShoe(item("Zenwalkers Signature Shoes Black Edition"), index)).toMatchObject({
      shoe: { shoeName: "Zenwalkers Signature Shoes" },
      method: "contains",
    });
  });

  it("does not fuzzy-match different words ('Zenwalker' ≠ 'Zenwalkers')", () => {
    expect(resolveShoe(item("Zenwalker Signature Shoes"), index)).toMatchObject({ shoe: null, reason: "NOT_FOUND" });
  });

  it("longest matching shoe name wins", () => {
    const idx = buildShoeIndex([...CONFIGS, shoe("Barestep Pro", { ...CONFIGS[2] })], []);
    expect(resolveShoe(item("Barestep Pro Running Shoe"), idx).shoe?.shoeName).toBe("Barestep Pro");
    expect(resolveShoe(item("Barestep Walking Shoe"), idx).shoe?.shoeName).toBe("Barestep");
  });

  it("two different shoes tying → UNMAPPED (ambiguous), never guessed", () => {
    const idx = buildShoeIndex([shoe("Clog", { ...CONFIGS[0] }), shoe("Mule", { ...CONFIGS[0] })], []);
    expect(resolveShoe(item("Clog Mule Combo"), idx)).toMatchObject({ shoe: null, reason: "AMBIGUOUS" });
  });

  it("mapping to a shoe missing from the config → UNMAPPED with a clear reason", () => {
    const idx = buildShoeIndex(CONFIGS, [{ normalizedShopifyName: "old clog", normalizedShoeName: "retired clog" }]);
    expect(resolveShoe(item("Old Clog"), idx)).toMatchObject({ shoe: null, reason: "MAPPING_TARGET_MISSING" });
  });

  it("unknown product → UNMAPPED", () => {
    expect(resolveShoe(item("Leather Wallet"), index)).toMatchObject({ shoe: null, reason: "NOT_FOUND" });
  });
});
