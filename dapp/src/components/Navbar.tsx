"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "./ConnectButton";

const navItems = [
  { href: "/", label: "Home" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/wrap", label: "Wrap" },
  { href: "/transfer", label: "Transfer" },
  { href: "/receive", label: "Receive" },
  { href: "/unwrap", label: "Unwrap" },
  { href: "/explorer", label: "Explorer" },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-stellar-blue/20 bg-stellar-dark/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-xl font-bold text-stellar-accent">
              SCT-01
            </Link>
            <div className="hidden md:flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                    pathname === item.href
                      ? "bg-stellar-blue text-white"
                      : "text-stellar-blue hover:text-white hover:bg-stellar-blue/50"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
