import { describe, expect, it } from "vitest";
import {
  calculateOrderProfit,
  createProfitContext,
  economicsForPaymentType,
  metaCost,
  type ProfitContext,
} from "@/lib/profit-v1/engine";
import { BARESTEP, CONFIGS, NEPOLIAN, order, shoe } from "./fixtures";
import type { ShoeConfig } from "@/lib/profit-v1/types";

function ctx(configs: ShoeConfig[] = CONFIGS, defaultGstPercent = 0): ProfitContext {
  return createProfitContext({ configs, mappings: [], creatives: [], campaigns: [], defaultGstPercent });
}

describe("payment type selects the correct sheet columns", () => {
  it("PREPAID uses Prepaid SP, Prepaid shipping, Prepaid delivery %", () => {
    expect(economicsForPaymentType(NEPOLIAN, "PREPAID")).toEqual({
      basis: "PREPAID",
      sellingPrice: 1499,
      shippingCost: 80,
      deliveryPercent: 95,
    });
  });

  it.each(["COD", "PARTIAL_COD"] as const)("%s uses COD/Partial SP, COD shipping, COD/Partial delivery %%", (type) => {
    expect(economicsForPaymentType(NEPOLIAN, type)).toEqual({
      basis: "COD_OR_PARTIAL",
      sellingPrice: 1399,
      shippingCost: 105,
      deliveryPercent: 85,
    });
  });

  it("UNKNOWN payment type has no economics", () => {
    expect(economicsForPaymentType(NEPOLIAN, "UNKNOWN")).toBeNull();
  });
});

describe("calculateOrderProfit: spec example (Nepolian Clog, GST 0%)", () => {
  it("prepaid order uses prepaid SP (₹1499), 95% delivery, ₹350 cost, ₹80 shipping", () => {
    const result = calculateOrderProfit(order({ paymentType: "PREPAID" }), ctx());
    expect(result.included).toBe(true);
    expect(result.lines[0].sellingPrice).toBe(1499);
    expect(result.lines[0].deliveryPercent).toBe(95);
    expect(result.grossRevenue).toBeCloseTo(1424.05, 2); // 1499 × 95%
    expect(result.productCost).toBeCloseTo(332.5, 2); //    350 × 95%
    expect(result.shippingCost).toBe(80);
    expect(result.profit).toBeCloseTo(1011.55, 2);
  });

  it("COD order uses COD/Partial SP (₹1399), 85% delivery, ₹105 shipping", () => {
    const result = calculateOrderProfit(order({ paymentType: "COD" }), ctx());
    expect(result.lines[0].sellingPrice).toBe(1399);
    expect(result.grossRevenue).toBeCloseTo(1189.15, 2);
    expect(result.productCost).toBeCloseTo(297.5, 2);
    expect(result.shippingCost).toBe(105);
    expect(result.profit).toBeCloseTo(786.65, 2);
  });

  it("partial COD order uses COD/Partial SP and COD shipping", () => {
    const result = calculateOrderProfit(order({ paymentType: "PARTIAL_COD" }), ctx());
    expect(result.lines[0].sellingPrice).toBe(1399);
    expect(result.shippingCost).toBe(105);
    expect(result.profit).toBeCloseTo(786.65, 2);
  });

  it.each([
    ["PREPAID", "DELIVERED", 80],
    ["PREPAID", "RTO", 80],
    ["COD", "DELIVERED", 105],
    ["COD", "RTO", 105],
    ["PARTIAL_COD", "DELIVERED", 105],
    ["PARTIAL_COD", "RTO", 105],
    ["PREPAID", "PENDING", 80],
  ] as const)("%s + %s charges shipping exactly once (₹%i)", (paymentType, orderStatus, shipping) => {
    const result = calculateOrderProfit(order({ paymentType, orderStatus }), ctx());
    expect(result.shippingCost).toBe(shipping);
    expect(result.lines.reduce((s, l) => s + l.shippingAllocated, 0)).toBeCloseTo(shipping, 6);
  });

  it("RTO order profit equals delivered order profit (the sheet delivery % already prices RTO in)", () => {
    const delivered = calculateOrderProfit(order({ orderStatus: "DELIVERED" }), ctx());
    const rto = calculateOrderProfit(order({ orderStatus: "RTO" }), ctx());
    expect(rto.profit).toBeCloseTo(delivered.profit, 6);
  });

  it("an order with several pairs / shoes still pays shipping once", () => {
    const multi = order({
      paymentType: "PREPAID",
      items: [
        { productTitle: "Nepolian Clog", variantTitle: "Black", lineName: null, quantity: 2, unitPrice: 1499 },
        { productTitle: "Barestep", variantTitle: null, lineName: null, quantity: 1, unitPrice: 999 },
      ],
    });
    const result = calculateOrderProfit(multi, ctx());
    expect(result.shippingCost).toBe(80);
    const expectedRevenue = 1499 * 2 * 0.95 + 999 * 0.94;
    const expectedCost = 350 * 2 * 0.95 + 250 * 0.94;
    expect(result.profit).toBeCloseTo(expectedRevenue - expectedCost - 80, 2);
  });

  it("quantity multiplies revenue and cost but not shipping", () => {
    const result = calculateOrderProfit(order({ quantity: 3 }), ctx());
    expect(result.grossRevenue).toBeCloseTo(1499 * 3 * 0.95, 2);
    expect(result.productCost).toBeCloseTo(350 * 3 * 0.95, 2);
    expect(result.shippingCost).toBe(80);
  });
});

describe("values come from the Google Sheet configuration, never hard-coded", () => {
  it("product cost comes from the configuration", () => {
    const cheaper = { ...NEPOLIAN, productCost: 330 };
    const result = calculateOrderProfit(order(), ctx([cheaper]));
    expect(result.productCost).toBeCloseTo(330 * 0.95, 6);
  });

  it("delivery % comes from the configuration", () => {
    const better = { ...NEPOLIAN, prepaidDeliveryPercent: 96 };
    const result = calculateOrderProfit(order(), ctx([better]));
    expect(result.lines[0].deliveryPercent).toBe(96);
    expect(result.grossRevenue).toBeCloseTo(1499 * 0.96, 6);
  });

  it("changing the sheet (spec §33) changes profit for the same raw order", () => {
    const rawPrepaid = order({ paymentType: "PREPAID" });
    const rawCod = order({ paymentType: "COD" });
    const before = ctx([NEPOLIAN]);
    const after = ctx([
      {
        ...NEPOLIAN,
        prepaidSellingPrice: 1599,
        codOrPartialSellingPrice: 1499,
        productCost: 330,
        prepaidShippingCost: 90,
        codShippingCost: 110,
        prepaidDeliveryPercent: 96,
        codOrPartialDeliveryPercent: 87,
      },
    ]);

    expect(calculateOrderProfit(rawPrepaid, before).profit).toBeCloseTo(1011.55, 2);
    expect(calculateOrderProfit(rawPrepaid, after).profit).toBeCloseTo(1599 * 0.96 - 330 * 0.96 - 90, 2); // 1128.24
    expect(calculateOrderProfit(rawCod, before).profit).toBeCloseTo(786.65, 2);
    expect(calculateOrderProfit(rawCod, after).profit).toBeCloseTo(1499 * 0.87 - 330 * 0.87 - 110, 2); // 907.03
    // raw order untouched
    expect(rawPrepaid.items[0].unitPrice).toBe(1499);
  });
});

describe("GST", () => {
  it("sheet SP includes GST; revenue for profit is ex-GST using the shoe GST %", () => {
    const withGst = shoe("Nepolian Clog", { ...NEPOLIAN, gstPercent: 5 });
    const result = calculateOrderProfit(order(), ctx([withGst]));
    expect(result.grossRevenue).toBeCloseTo(1424.05, 2); // incl. GST
    expect(result.netRevenue).toBeCloseTo(1424.05 / 1.05, 2); // ex-GST
    expect(result.gst).toBeCloseTo(1424.05 - 1424.05 / 1.05, 2);
    expect(result.profit).toBeCloseTo(1424.05 / 1.05 - 332.5 - 80, 2);
  });

  it("uses the brand default GST % when the shoe row has none", () => {
    const result = calculateOrderProfit(order(), ctx([NEPOLIAN], 18));
    expect(result.netRevenue).toBeCloseTo(1424.05 / 1.18, 2);
  });

  it("Meta cost = spend × 1.18, with spend and GST kept separate", () => {
    expect(metaCost(10000)).toEqual({ spend: 10000, gst: 1800, total: 11800 });
  });
});

describe("orders that must not produce silent profit", () => {
  it("cancelled orders are excluded (no revenue, no shipping)", () => {
    const result = calculateOrderProfit(order({ orderStatus: "CANCELLED" }), ctx());
    expect(result.included).toBe(false);
    expect(result.exclusionReason).toBe("CANCELLED");
    expect(result.profit).toBe(0);
    expect(result.shippingCost).toBe(0);
  });

  it("unknown payment type is excluded", () => {
    const result = calculateOrderProfit(order({ paymentType: "UNKNOWN" }), ctx());
    expect(result.exclusionReason).toBe("UNKNOWN_PAYMENT_TYPE");
  });

  it("an order whose shoe is not in the sheet is excluded and reported as unmapped", () => {
    const result = calculateOrderProfit(order({ title: "Mystery Sandal" }), ctx());
    expect(result.exclusionReason).toBe("NO_MAPPED_ITEMS");
    expect(result.lines[0].unmappedReason).toBe("NOT_FOUND");
  });

  it("mixed order: unmapped line adds nothing, mapped line still counts", () => {
    const result = calculateOrderProfit(
      order({
        items: [
          { productTitle: "Barestep", variantTitle: null, lineName: null, quantity: 1, unitPrice: 999 },
          { productTitle: "Mystery Sandal", variantTitle: null, lineName: null, quantity: 1, unitPrice: 500 },
        ],
      }),
      ctx()
    );
    expect(result.included).toBe(true);
    expect(result.unmappedUnits).toBe(1);
    expect(result.grossRevenue).toBeCloseTo(999 * BARESTEP.prepaidDeliveryPercent / 100, 6);
  });
});
