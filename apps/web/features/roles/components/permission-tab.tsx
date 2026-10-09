"use client";

import { useState, type ReactNode } from "react";
import type { PermissionMatrix } from "@bitcrm/types";
import { WzInfoTip } from "@/components/workiz/form-section-title";
import { Skeleton } from "@/components/ui/skeleton";
import { WzTextField } from "@/components/workiz/text-field";
import { WzWindowFrame } from "@/components/workiz/window-frame";
import { cn } from "@/lib/utils";
import type { Schema } from "../lib";
import { PermissionMatrixEditor, type PermissionSection } from "./permission-matrix";

/**
 * The Actions / Reports tab of a permission editor, as Workiz's
 * (pg_admin_users_wz_10_role_dispatch): 20px in, "Enable permissions by
 * switching them on" (16px/19px 600 #404040) with its "?" — "Permissions are
 * enabled when the toggle switch is green" — then the legacy 483×48 Search
 * 15px under it, and the rows 25px under that. `tools` sit on Search's line
 * (ours: copy from a role, clear all).
 */
export function PermissionTab({
  section,
  schema,
  permissions,
  baseline,
  readOnly,
  onChange,
  tools,
  summary,
}: {
  section: PermissionSection;
  schema: Schema;
  permissions: PermissionMatrix;
  baseline?: PermissionMatrix;
  readOnly?: boolean;
  onChange: (next: PermissionMatrix) => void;
  /** On Search's line, at the right. */
  tools?: ReactNode;
  /** Ours, under the heading: "12 permissions granted", "1 switch overridden …". */
  summary?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="px-5 pt-5">
      <div className="flex items-center">
        <h4 className="text-base leading-[19px] font-semibold tracking-[0.4px] text-wz-strong">
          Enable permissions by switching them on
        </h4>
        <WzInfoTip label="the switches" text="Permissions are enabled when the toggle switch is green" />
      </div>
      {summary ? <p className="mt-1 text-[13px] leading-[19px] text-wz-outline-label">{summary}</p> : null}
      <div className={cn("mb-[25px] flex flex-wrap items-center gap-x-6 gap-y-3", summary ? "mt-2.5" : "mt-[15px]")}>
        <WzTextField
          label="Search"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          overhang={false}
          className="-ml-0.5 w-[483px] max-w-full"
          inputClassName="[&::-webkit-search-cancel-button]:hidden"
        />
        {tools ? <div className="ml-auto flex flex-wrap items-center gap-4">{tools}</div> : null}
      </div>
      <PermissionMatrixEditor
        schema={schema}
        permissions={permissions}
        baseline={baseline}
        readOnly={readOnly}
        onChange={onChange}
        section={section}
        query={query}
      />
    </div>
  );
}

/**
 * Workiz's Advanced tab (pg_admin_users_wz_13_tab_advanced): 40px in, "Please
 * choose rules" (16px/19px 600), then a section per rule — a 20px/25px
 * thin title in #3e4b51 and a 14px line saying what it chooses.
 */
export function RulesTab({ children }: { children: ReactNode }) {
  return (
    <div className="px-10 pt-5 pb-6">
      <h4 className="text-base leading-[19px] font-semibold tracking-[0.4px] text-wz-strong">Please choose rules</h4>
      {children}
    </div>
  );
}

/** A permission window while it loads: grey bars where the title, the tabs and the first rows will be. */
export function EditorSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <WzWindowFrame title={<Skeleton className="h-6 w-80" />} onClose={onClose}>
      <Skeleton className="h-[43px] w-full max-w-[420px]" />
      <div className="space-y-6 px-5 pt-5">
        <Skeleton className="h-5 w-80" />
        <Skeleton className="h-12 w-[483px] max-w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[57px] w-full" />
        ))}
      </div>
    </WzWindowFrame>
  );
}

export function RulesSection({ title, helper, children }: { title: string; helper: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-[19px]">
      <h3 className="text-xl leading-[25px] font-normal tracking-[0.4px] text-wz-tab-bar">{title}</h3>
      <p className="mt-3 mb-[17px] pl-1 text-sm leading-4 tracking-[0.4px] text-wz-strong">{helper}</p>
      {children}
    </section>
  );
}
