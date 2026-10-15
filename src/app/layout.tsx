import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { ToastProvider } from "@/components/feedback/Toaster";
import { FlashNotice } from "@/components/feedback/FlashNotice";
import { BRAND } from "@/lib/brand";

// The one typeface (IETC redesign). Its width axis gives the condensed headings and figures
// (font-stretch 78%) from the same file as the body text, so one variable font does everything.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: {
    default: BRAND.name,
    template: `%s · ${BRAND.shortName}`,
  },
  description: BRAND.footerBlurb,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} h-full antialiased`}
    >
      <body className="ietc min-h-full flex flex-col">
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
