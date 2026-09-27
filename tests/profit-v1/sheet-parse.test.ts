import { describe, expect, it } from "vitest";
import { extractSheetId, parseConfigSheet, parseMappingSheet, parseMoney, parsePercent } from "@/lib/profit-v1/sheet-parse";

const HEADER = ["Shoe Name", "Prepaid SP", "COD/Partial SP", "Product Cost", "Prepaid Shipping", "COD Shipping", "Prepaid Delivery %", "COD/Partial Delivery %"];

describe("Google Sheet configuration parsing", () => {
  it("reads one row per shoe with the spec's column names", () => {
    const result = parseConfigSheet([
      HEADER,
      ["Nepolian Clog", "₹1,499", "1399", "350", "80", "105", "95%", "85%"],
      ["Barestep", "999", "899", "250", "80", "105", "0.94", "82"],
    ]);
    expect(result.errors).toEqual([]);
    expect(result.configs).toHaveLength(2);
    expect(result.configs[0]).toMatchObject({
      shoeName: "Nepolian Clog",
      normalizedName: "nepolian clog",
      prepaidSellingPrice: 1499,
      codOrPartialSellingPrice: 1399,
      productCost: 350,
      prepaidShippingCost: 80,
      codShippingCost: 105,
      prepaidDeliveryPercent: 95,
      codOrPartialDeliveryPercent: 85,
      gstPercent: null,
    });
    expect(result.configs[1].prepaidDeliveryPercent).toBeCloseTo(94, 6);
  });

  it("accepts snake_case headers in any order", () => {
    const result = parseConfigSheet([
      ["product_cost", "shoe_name", "prepaid_selling_price", "cod_or_partial_selling_price", "prepaid_shipping_cost", "cod_shipping_cost", "prepaid_delivery_percent", "cod_or_partial_delivery_percent"],
      ["350", "Nepolian Clog", "1499", "1399", "80", "105", "95", "85"],
    ]);
    expect(result.configs[0].productCost).toBe(350);
  });

  it.each([
    [["", "1499", "1399", "350", "80", "105", "95", "85"], "Shoe Name is empty"],
    [["X", "-1", "1399", "350", "80", "105", "95", "85"], "Prepaid SP cannot be negative"],
    [["X", "1499", "1399", "-350", "80", "105", "95", "85"], "Product Cost cannot be negative"],
    [["X", "1499", "1399", "350", "80", "-5", "95", "85"], "COD Shipping cannot be negative"],
    [["X", "1499", "1399", "350", "80", "105", "120%", "85"], "Prepaid Delivery % must be between 0% and 100%"],
    [["X", "1499", "1399", "350", "80", "105", "95", "-10"], "COD/Partial Delivery % must be between 0% and 100%"],
    [["X", "abc", "1399", "350", "80", "105", "95", "85"], "Prepaid SP is not a number"],
    [["X", "1499", "", "350", "80", "105", "95", "85"], "COD/Partial SP is empty"],
  ])("rejects invalid row %j (%s)", (row, message) => {
    const result = parseConfigSheet([HEADER, row]);
    expect(result.configs).toHaveLength(0);
    expect(result.errors[0].message).toContain(message);
    expect(result.errors[0].row).toBe(2);
  });

  it("rejects duplicate shoe names", () => {
    const row = ["Nepolian Clog", "1499", "1399", "350", "80", "105", "95", "85"];
    const result = parseConfigSheet([HEADER, row, ["NEPOLIAN  clog", ...row.slice(1)]]);
    expect(result.configs).toHaveLength(1);
    expect(result.errors[0].message).toContain("Duplicate");
  });

  it("reports missing columns instead of guessing", () => {
    const result = parseConfigSheet([HEADER.slice(0, 5), ["Nepolian Clog", "1499", "1399", "350", "80"]]);
    expect(result.missingColumns).toEqual(["COD Shipping", "Prepaid Delivery %", "COD/Partial Delivery %"]);
    expect(result.configs).toHaveLength(0);
  });

  it("parses money and percentages", () => {
    expect(parseMoney("₹1,499.50")).toBe(1499.5);
    expect(parseMoney("")).toBeNull();
    expect(parsePercent("95%")).toBe(95);
    expect(parsePercent("0.95")).toBeCloseTo(95, 6);
    expect(parsePercent("95")).toBe(95);
  });
});

describe("mapping tab", () => {
  it("maps Shopify names to known shoes and rejects unknown targets", () => {
    const result = parseMappingSheet(
      [
        ["Shopify Product Name", "Shoe Name"],
        ["Zenwalkers Signature Shoes - Black", "Zenwalkers Signature Shoes"],
        ["GMSOLO Nepolian", "Unknown Shoe"],
      ],
      new Set(["zenwalkers signature shoes"])
    );
    expect(result.mappings).toEqual([
      {
        shopifyName: "Zenwalkers Signature Shoes - Black",
        shoeName: "Zenwalkers Signature Shoes",
        normalizedShopifyName: "zenwalkers signature shoes black",
        normalizedShoeName: "zenwalkers signature shoes",
      },
    ]);
    expect(result.errors[0].message).toContain("not in the config tab");
  });
});

describe("sheet id", () => {
  it("accepts a full URL or a bare id", () => {
    expect(extractSheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjK_lmn-OP/edit#gid=0")).toBe("1AbCdEfGhIjK_lmn-OP");
    expect(extractSheetId("1AbCdEfGhIjK_lmn-OP")).toBe("1AbCdEfGhIjK_lmn-OP");
  });
});
