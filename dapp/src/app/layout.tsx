import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "SCT-01 | Confidential Token Standard",
  description:
    "Wrap any Stellar asset into a confidential token, transfer privately, and unwrap when needed.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Navbar />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
        <footer className="border-t border-stellar-blue/20 mt-16 py-6 text-center text-sm text-stellar-blue">
          <p>
            SCT-01 Confidential Token Standard &middot;{" "}
            <span className="text-yellow-400">
              NOT AUDITED - Hackathon Demo Only
            </span>
          </p>
        </footer>
      </body>
    </html>
  );
}
