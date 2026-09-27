/**
 * One reusable date-range helper for every dashboard period.
 * All dates are business dates (YYYY-MM-DD) in the brand timezone. Ranges are inclusive.
 */
import type { DateRange } from "./types";

export const RANGE_PRESETS = ["today", "yesterday", "7d", "15d", "30d"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 366;

export function isRangePreset(value: unknown): value is RangePreset {
  return typeof value === "string" && (RANGE_PRESETS as readonly string[]).includes(value);
}

/** YYYY-MM-DD of an instant in a timezone. */
export function dateInTimeZone(instant: Date | string, timeZone: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function addDays(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(range: DateRange): number {
  const [fy, fm, fd] = range.from.split("-").map(Number);
  const [ty, tm, td] = range.to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1;
}

export function listDates(range: DateRange): string[] {
  const days = daysBetweenInclusive(range);
  return Array.from({ length: Math.max(days, 0) }, (_, i) => addDays(range.from, i));
}

export function isDateInRange(value: string, range: DateRange): boolean {
  return value >= range.from && value <= range.to;
}

/** Today / Yesterday / last 7, 15, 30 days (each including today). */
export function presetRange(preset: RangePreset, timeZone: string, now: Date = new Date()): DateRange {
  const today = dateInTimeZone(now, timeZone);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "15d":
      return { from: addDays(today, -14), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
  }
}

export type RangeResult = { ok: true; range: DateRange; label: string } | { ok: false; error: string };

/** Resolve a request (?range=7d or ?range=custom&from=…&to=…) into a validated date range. */
export function resolveRange(
  input: { range?: string | null; from?: string | null; to?: string | null },
  timeZone: string,
  now: Date = new Date()
): RangeResult {
  const kind = input.range ?? "today";
  if (isRangePreset(kind)) {
    return { ok: true, range: presetRange(kind, timeZone, now), label: kind };
  }
  if (kind !== "custom") return { ok: false, error: "Unknown range" };
  if (!isValidDate(input.from) || !isValidDate(input.to)) {
    return { ok: false, error: "Custom range needs from and to as YYYY-MM-DD" };
  }
  const range = { from: input.from, to: input.to };
  if (range.from > range.to) return { ok: false, error: "'from' must be on or before 'to'" };
  if (daysBetweenInclusive(range) > MAX_RANGE_DAYS) {
    return { ok: false, error: `Custom range can be at most ${MAX_RANGE_DAYS} days` };
  }
  return { ok: true, range, label: "custom" };
}
