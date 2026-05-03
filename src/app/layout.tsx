import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LibraryBootstrap } from "@/components/LibraryBootstrap";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Content Studio",
  description: "Real estate social media content generator — static posts",
};

// Mobile viewport: full-width device, allow user pinch-zoom (don't lock
// it — the audio caption preview and clip thumbnails benefit from
// occasional zoom). viewportFit=cover lets the FAB respect notched
// safe-area insets via env(safe-area-inset-bottom).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LibraryBootstrap />
        {children}
      </body>
    </html>
  );
}
