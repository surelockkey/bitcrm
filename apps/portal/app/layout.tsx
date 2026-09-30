import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Your documents", template: "%s" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-muted/30" suppressHydrationWarning>
        <main className="flex-1 px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6 sm:px-6 sm:py-10">{children}</main>
        <footer className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center text-[11px] text-muted-foreground">
          This page is private to you — please don&apos;t share the link.
        </footer>
      </body>
    </html>
  );
}
