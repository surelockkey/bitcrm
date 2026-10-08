"use client";

import { useId, useState } from "react";
import type { Contact } from "@bitcrm/types";
import { WzSuggestion, WzSuggestionList, WzTextField } from "@/components/workiz";
import { useCompanyMap, useContactSearch } from "@/features/clients/hooks";
import { contactName, formatPhone, searchContacts } from "@/features/clients/lib";

/** What the client book is searched with, and how much — the page loader asks the same. */
export const CLIENT_SEARCH_MIN = 3;
export const CLIENT_SEARCH_LIMIT = 16;
const MAX_MATCHES = 8;

/** The grey line under a match: their street, as Workiz shows it, else how to reach them. */
export function clientSubtitle(c: Contact): string | undefined {
  const street = c.addresses?.[0]?.street?.trim();
  if (street) return street;
  if (c.phones[0]) return formatPhone(c.phones[0]);
  return c.emails[0];
}

/**
 * Workiz's "Client name" (new_07_client_search, new_13a_add_new_dropdown):
 * type to search the client book — "Searching ●●●" while it looks, then
 * `+ Add new "Dustin"` first and the matches under it, the typed part bold,
 * the street underneath. Picking a match hands the client up; "+ Add new"
 * (or simply carrying on) keeps the typed name as a new client.
 */
export function WzClientNameField({
  value,
  onChange,
  onPick,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (name: string) => void;
  onPick: (c: Contact) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const { map: companyMap } = useCompanyMap();

  const query = value.trim();
  const long = query.length >= CLIENT_SEARCH_MIN;
  const found = useContactSearch(long ? query : "", CLIENT_SEARCH_LIMIT);
  const companyNames = new Map([...companyMap.values()].map((co) => [co.id, co.title] as [string, string]));
  const matches = long ? searchContacts(found.data, query, companyNames).slice(0, MAX_MATCHES) : [];
  const searching = long && !found.answered;

  const open = focused && long && !dismissed;
  // Row 0 is "+ Add new"; the matches follow.
  const count = searching ? 0 : 1 + matches.length;
  const pickRow = (i: number) => {
    setDismissed(true);
    setActive(-1);
    if (i > 0) onPick(matches[i - 1]);
  };

  return (
    <div className="relative min-w-0">
      <WzTextField
        label="Client name"
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open ? listId : undefined}
        value={value}
        error={error}
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
          setActive(-1);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (!open || !count) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % count);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? count - 1 : a - 1));
          } else if (e.key === "Enter") {
            // Never submits the form from here: it answers the list.
            e.preventDefault();
            pickRow(active < 0 ? 0 : active);
          } else if (e.key === "Escape") {
            setDismissed(true);
          }
        }}
      />
      {open ? (
        <WzSuggestionList id={listId} aria-label="Clients" className="top-12 max-h-[276px]">
          {searching ? (
            <SearchingRow />
          ) : (
            <>
              <WzSuggestion addNew title="+ Add new" query={query} active={active === 0} onSelect={() => pickRow(0)} />
              {matches.map((c, i) => (
                <WzSuggestion
                  key={c.id}
                  title={contactName(c) || formatPhone(c.phones[0] ?? "")}
                  subtitle={clientSubtitle(c)}
                  query={query}
                  active={active === i + 1}
                  onSelect={() => pickRow(i + 1)}
                />
              ))}
            </>
          )}
        </WzSuggestionList>
      ) : null}
    </div>
  );
}

/**
 * "Searching ●●●" (`sajComplete-suggestion` + Workiz's spinnerDots): 15px
 * light words, padded 15px, three 15px ink dots 20px on, pulsing in turn
 * (sk-bouncedelay, 1.4s).
 */
function SearchingRow() {
  return (
    <div
      role="status"
      className="flex h-[49px] items-center border border-b-0 border-input px-[15px] text-[15px] leading-[19px] font-light text-wz-strong"
    >
      Searching
      <style href="wz-bounce-delay" precedence="default">
        {"@keyframes wz-bounce-delay{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}"}
      </style>
      <span aria-hidden className="ml-5 flex">
        {[-0.32, -0.16, 0].map((delay) => (
          <span
            key={delay}
            className="mr-[5px] inline-block size-[15px] animate-[wz-bounce-delay_1.4s_ease-in-out_infinite_both] rounded-full bg-foreground"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </span>
    </div>
  );
}
