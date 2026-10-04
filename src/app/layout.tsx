import type { Metadata } from "next";
import { Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { ToastProvider } from "@/components/feedback/Toaster";
import { FlashNotice } from "@/components/feedback/FlashNotice";

// Schibsted Grotesk carries the interface and headings; JetBrains Mono is reserved for
// figures, times and references (cohort codes, order references). Both are variable
// fonts, so no explicit weight list is needed.
const schibstedGrotesk = Schibsted_Grotesk({
  variable: "--font-schibsted-grotesk",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Training Administration",
    template: "%s · Training Administration",
  },
  description: "Professional training management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${schibstedGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* One place every screen reports what happened (confirmations in the bottom-right corner). */}
        <ToastProvider>
          {children}
          {/* Reads the address, so it sits in its own Suspense boundary and never holds up a page. */}
          <Suspense fallback={null}>
            <FlashNotice />
          </Suspense>
        </ToastProvider>
      </body>
    </html>
  );
}
