import type { Metadata, Viewport } from "next";
import "./globals.css";
import { themeScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "QorgauAI",
  description: "Информационный помощник по Конституции и Трудовому кодексу Республики Казахстан",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f9" },
    { media: "(prefers-color-scheme: dark)", color: "#040a14" },
  ],
};

// System font on purpose: SF ships optical sizing and tracking tables, and
// covers Cyrillic without a web-font download.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script sets data-theme before hydration, hence the warning opt-out.
    <html lang="ru" className="h-full" suppressHydrationWarning>
      <head>
        {/* Executable in the server HTML only; on the client React would warn
            about a script tag it never runs (Next.js "preventing flash" guide). */}
        <script
          type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
