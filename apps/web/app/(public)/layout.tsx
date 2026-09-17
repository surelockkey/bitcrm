import type { Metadata } from "next";

/**
 * Client-facing pages (no sign-in, no app shell). Access is by the token in
 * the URL, so these pages must never be indexed.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-muted/30">
      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-10">{children}</main>
      <footer className="px-4 pb-6 text-center text-[11px] text-muted-foreground">
        This page is private to you — please don&apos;t share the link.
      </footer>
    </div>
  );
}
