import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { PrivacyModeProvider } from "@/lib/privacy-mode";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Crest",
  description: "Zero-based budgeting",
  // manifest and icon links are auto-generated from app/manifest.ts and
  // app/icon.svg / app/apple-icon.png via Next's file conventions.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Crest",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Matches app/manifest.ts's theme_color.
  themeColor: "#0d946e",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <PrivacyModeProvider>{children}</PrivacyModeProvider>
          <RegisterServiceWorker />
        </ThemeProvider>
      </body>
    </html>
  );
}
