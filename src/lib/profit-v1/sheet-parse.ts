/**
 * Pure parsing + validation of the Google Sheet (values as returned by the Sheets API).
 * First non-empty row = headers. Column order does not matter; headers are matched by name.
 */
import { normalizeName } from "./names";
import type { NameMapping, ShoeConfig } from "./types";

export interface SheetRowError {
  tab: "config" | "mapping";
  row: number;
  shoeName?: string;
  message: string;
}

type ConfigField =
  | "shoeName"
  | "prepaidSellingPrice"
  | "codOrPartialSellingPrice"
  | "productCost"
  | "prepaidShippingCost"
  | "codShippingCost"
  | "prepaidDeliveryPercent"
  | "codOrPartialDeliveryPercent"
  | "gstPercent";

const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Accepted header spellings (after removing spaces/symbols and lowercasing). */
const CONFIG_HEADERS: Record<ConfigField, string[]> = {
  shoeName: ["shoename", "shoe", "productname", "product", "name"],
  prepaidSellingPrice: ["prepaidsellingprice", "prepaidsp", "prepaidprice"],
  codOrPartialSellingPrice: [
    "codorpartialsellingprice",
    "codpartialsellingprice",
    "codorpartialsp",
    "codpartialsp",
    "partialcodsellingprice",
    "partialcodsp",
    "codsp",
    "partialsp",
    "codorpartialprice",
    "codpartialprice",
  ],
  productCost: ["productcost", "cost", "cogs"],
  prepaidShippingCost: ["prepaidshippingcost", "prepaidshipping"],
  codShippingCost: ["codshippingcost", "codshipping", "codpartialshipping", "codorpartialshipping", "partialshipping"],
  prepaidDeliveryPercent: ["prepaiddeliverypercent", "prepaiddelivery", "prepaiddeliverypct", "prepaiddeliveryrate"],
  codOrPartialDeliveryPercent: [
    "codorpartialdeliverypercent",
    "codpartialdeliverypercent",
    "codorpartialdelivery",
    "codpartialdelivery",
    "coddelivery",
    "partialdelivery",
    "codpartialdeliverypct",
    "coddeliverypercent",
  ],
  gstPercent: ["gstpercent", "gst", "gstrate", "gstpct"],
};

const REQUIRED: ConfigField[] = [
  "shoeName",
  "prepaidSellingPrice",
  "codOrPartialSellingPrice",
  "productCost",
  "prepaidShippingCost",
  "codShippingCost",
  "prepaidDeliveryPercent",
  "codOrPartialDeliveryPercent",
];

const LABELS: Record<ConfigField, string> = {
  shoeName: "Shoe Name",
  prepaidSellingPrice: "Prepaid SP",
  codOrPartialSellingPrice: "COD/Partial SP",
  productCost: "Product Cost",
  prepaidShippingCost: "Prepaid Shipping",
  codShippingCost: "COD Shipping",
  prepaidDeliveryPercent: "Prepaid Delivery %",
  codOrPartialDeliveryPercent: "COD/Partial Delivery %",
  gstPercent: "GST %",
};

/** "₹1,499" → 1499. Returns null for blank, NaN for garbage. */
export function parseMoney(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const cleaned = value.replace(/[₹,\s]|rs\.?|inr/gi, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * "95%" → 95, "95" → 95, "0.95" → 95 (a plain number ≤ 1 is read as a fraction).
 * Returns null for blank, NaN for garbage.
 */
export function parsePercent(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const trimmed = value.trim();
  const hasPercent = trimmed.endsWith("%");
  const n = Number(trimmed.replace(/[%\s,]/g, ""));
  if (!Number.isFinite(n)) return NaN;
  if (!hasPercent && n > 0 && n <= 1) return n * 100;
  return n;
}

function findHeaderRow(values: string[][]): number {
  return values.findIndex((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
}

export interface ConfigParseResult {
  configs: ShoeConfig[];
  errors: SheetRowError[];
  rowsRead: number;
  /** Headers that could not be found (sheet structure problem). */
  missingColumns: string[];
  /** Normalized names that appeared in the sheet (valid or not) — used to deactivate removed shoes. */
  namesInSheet: string[];
}

export function parseConfigSheet(values: string[][]): ConfigParseResult {
  const headerIndex = findHeaderRow(values);
  if (headerIndex < 0) {
    return { configs: [], errors: [], rowsRead: 0, missingColumns: REQUIRED.map((f) => LABELS[f]), namesInSheet: [] };
  }
  const headers = values[headerIndex].map((cell) => headerKey(String(cell ?? "")));
  const columns = new Map<ConfigField, number>();
  (Object.keys(CONFIG_HEADERS) as ConfigField[]).forEach((field) => {
    const index = headers.findIndex((h) => CONFIG_HEADERS[field].includes(h));
    if (index >= 0) columns.set(field, index);
  });
  const missingColumns = REQUIRED.filter((field) => !columns.has(field)).map((field) => LABELS[field]);
  if (missingColumns.length > 0) {
    return { configs: [], errors: [], rowsRead: 0, missingColumns, namesInSheet: [] };
  }

  const configs: ShoeConfig[] = [];
  const errors: SheetRowError[] = [];
  const seen = new Set<string>();
  const namesInSheet: string[] = [];
  let rowsRead = 0;

  values.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2; // 1-based sheet row
    const cell = (field: ConfigField) => {
      const index = columns.get(field);
      return index === undefined ? undefined : String(row[index] ?? "");
    };
    if (row.every((c) => String(c ?? "").trim() === "")) return; // blank row
    rowsRead += 1;

    const shoeName = (cell("shoeName") ?? "").trim();
    const problems: string[] = [];
    if (!shoeName) problems.push("Shoe Name is empty");
    const normalizedName = normalizeName(shoeName);
    if (normalizedName) namesInSheet.push(normalizedName);

    const money = (field: ConfigField) => {
      const v = parseMoney(cell(field));
      if (v === null) problems.push(`${LABELS[field]} is empty`);
      else if (Number.isNaN(v)) problems.push(`${LABELS[field]} is not a number`);
      else if (v < 0) problems.push(`${LABELS[field]} cannot be negative`);
      return v ?? NaN;
    };
    const percent = (field: ConfigField, required: boolean) => {
      const v = parsePercent(cell(field));
      if (v === null) {
        if (required) problems.push(`${LABELS[field]} is empty`);
        return null;
      }
      if (Number.isNaN(v)) problems.push(`${LABELS[field]} is not a number`);
      else if (v < 0 || v > 100) problems.push(`${LABELS[field]} must be between 0% and 100%`);
      return v;
    };

    const config: ShoeConfig = {
      shoeName,
      normalizedName,
      prepaidSellingPrice: money("prepaidSellingPrice"),
      codOrPartialSellingPrice: money("codOrPartialSellingPrice"),
      productCost: money("productCost"),
      prepaidShippingCost: money("prepaidShippingCost"),
      codShippingCost: money("codShippingCost"),
      prepaidDeliveryPercent: percent("prepaidDeliveryPercent", true) ?? NaN,
      codOrPartialDeliveryPercent: percent("codOrPartialDeliveryPercent", true) ?? NaN,
      gstPercent: columns.has("gstPercent") ? percent("gstPercent", false) : null,
    };

    if (normalizedName && seen.has(normalizedName)) problems.push("Duplicate shoe name");
    if (problems.length > 0) {
      errors.push({ tab: "config", row: rowNumber, shoeName: shoeName || undefined, message: problems.join("; ") });
      return;
    }
    seen.add(normalizedName);
    configs.push(config);
  });

  return { configs, errors, rowsRead, missingColumns, namesInSheet };
}

export interface MappingParseResult {
  mappings: Array<NameMapping & { shopifyName: string; shoeName: string }>;
  errors: SheetRowError[];
}

/** Two columns: Shopify product name | Shoe name (header row required). */
export function parseMappingSheet(values: string[][], knownShoes: Set<string>): MappingParseResult {
  const headerIndex = findHeaderRow(values);
  if (headerIndex < 0) return { mappings: [], errors: [] };
  const headers = values[headerIndex].map((cell) => headerKey(String(cell ?? "")));
  const shopifyCol = headers.findIndex((h) =>
    ["shopifyproductname", "shopifyname", "shopifyproduct", "productname", "shopifytitle"].includes(h)
  );
  const shoeCol = headers.findIndex((h) =>
    ["shoename", "profitskuname", "shoe", "mappedshoe", "reportingshoe", "mastershoe"].includes(h)
  );
  if (shopifyCol < 0 || shoeCol < 0) {
    return {
      mappings: [],
      errors: [{ tab: "mapping", row: headerIndex + 1, message: "Mapping tab needs 'Shopify Product Name' and 'Shoe Name' columns" }],
    };
  }
  const mappings: MappingParseResult["mappings"] = [];
  const errors: SheetRowError[] = [];
  const seen = new Set<string>();
  values.slice(headerIndex + 1).forEach((row, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const shopifyName = String(row[shopifyCol] ?? "").trim();
    const shoeName = String(row[shoeCol] ?? "").trim();
    if (!shopifyName && !shoeName) return;
    const normalizedShopifyName = normalizeName(shopifyName);
    const normalizedShoeName = normalizeName(shoeName);
    if (!normalizedShopifyName || !normalizedShoeName) {
      errors.push({ tab: "mapping", row: rowNumber, shoeName, message: "Both Shopify product name and shoe name are required" });
      return;
    }
    if (!knownShoes.has(normalizedShoeName)) {
      errors.push({ tab: "mapping", row: rowNumber, shoeName, message: `Shoe "${shoeName}" is not in the config tab` });
      return;
    }
    if (seen.has(normalizedShopifyName)) {
      errors.push({ tab: "mapping", row: rowNumber, shoeName, message: `Duplicate mapping for "${shopifyName}"` });
      return;
    }
    seen.add(normalizedShopifyName);
    mappings.push({ shopifyName, shoeName, normalizedShopifyName, normalizedShoeName });
  });
  return { mappings, errors };
}

/** Accepts a bare sheet ID or a full Google Sheets URL. */
export function extractSheetId(value: string): string {
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : value.trim();
}
