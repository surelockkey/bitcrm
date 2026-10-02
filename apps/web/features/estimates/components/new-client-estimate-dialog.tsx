"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Search } from "lucide-react";
import type { Contact } from "@bitcrm/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useContactSearch } from "@/features/clients/hooks";
import { contactName, formatPhone } from "@/features/clients/lib";
import { ContactForm } from "@/features/clients/components/contact-form";
import { useCreateClientEstimate } from "../hooks";

/**
 * Workiz's "Add New" on the Estimates page: "Create New Estimate — before we
 * proceed, please select a client". Typing a name, email or phone lists the
 * matching clients; picking one makes that client's estimate (no job, like
 * Create new → Estimate on the client card) and opens it. "+ Add new client"
 * swaps in the new-client form, and the client it makes gets the estimate.
 */
export function NewClientEstimateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <Body onClose={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const create = useCreateClientEstimate();
  const [step, setStep] = useState<"pick" | "new">("pick");

  const start = (contactId: string) =>
    create.mutate(contactId, {
      onSuccess: (estimate) => {
        onClose();
        router.push(`/estimates/${estimate.id}`);
      },
    });

  if (step === "new") {
    return (
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Estimate</DialogTitle>
          <DialogDescription>Add the client — their estimate opens next.</DialogDescription>
        </DialogHeader>
        {create.isPending ? (
          <Creating />
        ) : (
          <ContactForm onCancel={() => setStep("pick")} onDone={(c) => start(c.id)} />
        )}
      </DialogContent>
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader className="items-center text-center">
        <span aria-hidden className="mb-1 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileText className="size-7" />
        </span>
        <DialogTitle>Create New Estimate</DialogTitle>
        <DialogDescription>Before we proceed, please select a client</DialogDescription>
      </DialogHeader>
      {create.isPending ? <Creating /> : <ClientSearch onPick={(c) => start(c.id)} />}
      <div className="flex flex-col items-center gap-1 text-sm">
        <span className="text-xs text-muted-foreground">- OR -</span>
        <button
          type="button"
          onClick={() => setStep("new")}
          disabled={create.isPending}
          className="font-medium text-brand hover:underline disabled:opacity-50"
        >
          + Add new client
        </button>
      </div>
    </DialogContent>
  );
}

function Creating() {
  return (
    <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" /> Creating the estimate…
    </p>
  );
}

/** "Name, email or phone" with the matching clients under it; the typed text is bold in each name (Workiz). */
function ClientSearch({ onPick }: { onPick: (c: Contact) => void }) {
  const [query, setQuery] = useState("");
  const { data: matches, isLoading, tooShort } = useContactSearch(query, 10);
  const listId = useId();
  const showList = !tooShort && query.trim().length >= 2;

  return (
    <div>
      {/* The magnifier belongs to the field, not to the field + list below it. */}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          role="combobox"
          aria-label="Name, email or phone"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Name, email or phone"
          className="h-11 pr-9"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      {showList ? (
        <div id={listId} role="listbox" aria-label="Clients" className="mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover shadow-md">
          {isLoading && matches.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No clients match.</p>
          ) : (
            matches.map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={false}
                // The bold highlight splits the name into pieces; say it whole.
                aria-label={[contactName(c), c.phones?.[0] ? formatPhone(c.phones[0]) : ""].filter(Boolean).join(", ")}
                onClick={() => onPick(c)}
                className="flex w-full items-baseline gap-2 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="min-w-0 truncate">
                  <Highlight text={contactName(c)} query={query} />
                </span>
                {c.phones?.[0] ? <span className="flex-none text-xs text-muted-foreground tabular-nums">{formatPhone(c.phones[0])}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** `text` with each occurrence of the typed words in bold. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="font-semibold">{p}</strong> : <span key={i}>{p}</span>))}
    </>
  );
}
