"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ListOrdered,
  Bookmark,
  Settings,
} from "lucide-react";

const navigation = [
  { name: "Sequences", href: "/sequences", icon: ListOrdered },
  { name: "Examples", href: "/examples", icon: Bookmark },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 flex-col bg-sidebar-bg text-sidebar-fg">
      <div className="flex h-14 items-center gap-2 px-5 border-b border-sidebar-accent">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          L
        </div>
        <span className="text-sm font-semibold tracking-tight">LeadLoop</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-3">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-fg/70 hover:bg-sidebar-muted hover:text-sidebar-fg"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
