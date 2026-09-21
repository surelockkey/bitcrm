import { Link2 } from "lucide-react";

/** The bare domain: the portal is only ever entered through a personal link. */
export default function Home() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center shadow-xs">
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Link2 className="size-6" aria-hidden />
      </span>
      <h1 className="text-lg font-semibold">Your documents</h1>
      <p className="text-sm text-muted-foreground">
        Open the link in the text message or email you received to see your estimates and invoices.
      </p>
    </div>
  );
}
