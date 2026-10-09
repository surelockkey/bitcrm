"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";

import { WzButton } from "./button";
import { WzLocalGrid, type WzGridColumn, type WzGridSort } from "./local-grid";
import { WzSettingsBar, WzSettingsHeader, wzShowRows, type WzShowFilter } from "./settings-page";

/**
 * A Workiz settings catalog page, whole (uikit_wz_set_jobtypes, _substatus,
 * _servicearea, pg_settings_catalogs_wz_adgroups): the grey band, "Show:"
 * (when the catalog can be switched off) with the yellow add button, and the
 * react-table grid — its strip (Search, page size), the rows that open their
 * record on a click, the pager inside the frame.
 *
 * Until `ready` the band stands over one skeleton: the button, the filter
 * and the rows come in one frame (lib/use-page-ready).
 *
 * The first column's words open the record from the keyboard too (a button
 * that reads as plain text), named by `openLabel`.
 */
export function WzSettingsCatalog<T>({
  icon,
  title,
  description,
  label,
  ready,
  rows,
  rowKey,
  columns,
  isActive,
  defaultShow = "active",
  defaultSort = null,
  defaultPageSize = 10,
  onAdd,
  addLabel = "Add New",
  onOpen,
  openLabel,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  /** The grid's accessible name ("Job types"). */
  label: string;
  ready: boolean;
  rows: readonly T[];
  rowKey: (row: T) => string;
  columns: readonly WzGridColumn<T>[];
  /** With it, "Show: Active / Disabled / All" filters the rows by it. */
  isActive?: (row: T) => boolean;
  defaultShow?: WzShowFilter;
  defaultSort?: WzGridSort | null;
  defaultPageSize?: number;
  /** Absent: no add button (the reader may not add). */
  onAdd?: () => void;
  addLabel?: string;
  /** Absent: rows do not open (the reader may not edit). */
  onOpen?: (row: T) => void;
  openLabel?: (row: T) => string;
  /** The page's dialogs. */
  children?: ReactNode;
}) {
  const [show, setShow] = useState<WzShowFilter>(defaultShow);
  const shown = useMemo(() => (isActive ? wzShowRows(rows, show, isActive) : [...rows]), [rows, show, isActive]);

  const gridColumns = useMemo<WzGridColumn<T>[]>(() => {
    if (!onOpen || columns.length === 0) return [...columns];
    const [first, ...rest] = columns;
    return [
      {
        ...first,
        render: (row: T) => (
          <button
            type="button"
            aria-label={openLabel?.(row)}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(row);
            }}
            className="max-w-full cursor-pointer truncate text-left outline-none focus-visible:underline"
          >
            {first.render(row)}
          </button>
        ),
      },
      ...rest,
    ];
  }, [columns, onOpen, openLabel]);

  const add = onAdd ? (
    <WzButton size="regular" icon={<Plus strokeWidth={1.75} />} onClick={onAdd}>
      {addLabel}
    </WzButton>
  ) : null;

  return (
    <div data-slot="wz-settings-catalog" className="flex min-w-0 flex-1 flex-col">
      <WzSettingsHeader icon={icon} title={title} description={description} />
      {!ready ? (
        <div className="px-5 pt-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <>
          {isActive ? (
            <WzSettingsBar show={show} onShowChange={setShow} action={add} />
          ) : (
            <WzSettingsBar action={add} />
          )}
          <WzLocalGrid<T>
            label={label}
            columns={gridColumns}
            rows={shown}
            rowKey={rowKey}
            defaultSort={defaultSort}
            defaultPageSize={defaultPageSize}
            onRowClick={onOpen ? (row) => onOpen(row) : undefined}
            pagerInside
          />
        </>
      )}
      {children}
    </div>
  );
}
