"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export interface Column<T> {
  key: string;
  header: string;
  hint?: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  className?: (row: T) => string | undefined;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  emptyText = "No data for this period",
  initialLimit = 15,
  footer,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  emptyText?: string;
  initialLimit?: number;
  footer?: ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, initialLimit);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((column) => (
              <th
                key={column.key}
                title={column.hint}
                className={cn("px-3 py-2 font-medium whitespace-nowrap", column.align === "right" ? "text-right" : "text-left")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          ) : (
            visible.map((row) => (
              <tr key={rowKey(row)} className="border-b last:border-0 hover:bg-muted/40">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-3 py-2 whitespace-nowrap",
                      column.align === "right" ? "text-right tabular-nums" : "text-left",
                      column.className?.(row)
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
          {footer}
        </tbody>
      </table>
      {rows.length > initialLimit && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {showAll ? "Show less" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

export const profitClass = (value: number) => (value < 0 ? "text-red-600 font-medium" : "text-emerald-700 font-medium");
