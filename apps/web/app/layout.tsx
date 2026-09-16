import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BitCRM",
  description: "BitCRM — field-service operations platform",
  // Installed to a phone's home screen, this is the name under the icon.
  applicationName: "BitCRM",
  appleWebApp: { capable: true, title: "BitCRM", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

/**
 * Phone chrome. `themeColor` paints the status bar / address bar to match the
 * app in each scheme, and `viewportFit: "cover"` lets the layout reach under
 * the notch — the safe-area insets are what keep content out of it.
 *
 * `maximumScale` is deliberately absent: capping zoom on a page a technician
 * reads outdoors, one-handed, in the sun, is an accessibility failure.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          data-gr-* attributes on <body> before React hydrates. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
