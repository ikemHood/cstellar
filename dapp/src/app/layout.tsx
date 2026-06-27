import type { Metadata } from "next";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { VaultGate } from "@/components/VaultGate";

export const metadata: Metadata = {
  title: "SCT-01 | Confidential Token Standard",
  description:
    "A developer standard and kit for adding confidential transfers to Stellar apps.",
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
          <VaultGate>{children}</VaultGate>
        </main>
        <footer className="border-t border-stellar-blue/20 mt-16 py-6 text-center text-sm text-stellar-blue">
          <p>
            SCT-01 Confidential Transfer Standard &middot;{" "}
            <span className="text-yellow-400">
              NOT AUDITED - Hackathon Demo Only
            </span>
          </p>
        </footer>
      </body>
    </html>
  );
}
