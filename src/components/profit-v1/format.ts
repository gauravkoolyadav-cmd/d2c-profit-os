const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const count = new Intl.NumberFormat("en-IN");

export const formatINR = (value: number | null | undefined) => (value === null || value === undefined ? "—" : inr.format(value));
export const formatINR2 = (value: number | null | undefined) => (value === null || value === undefined ? "—" : inr2.format(value));
export const formatCount = (value: number | null | undefined) => (value === null || value === undefined ? "—" : count.format(value));
export const formatPercent = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
