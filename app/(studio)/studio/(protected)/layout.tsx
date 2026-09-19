import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession, signOutCurrentUser } from "../../../../modules/auth/authService";
import { can, canManageUsers } from "../../../../modules/auth/policy";

// The authentication + account-status gate for every real Studio screen
// (brief §2/§3: "no fake functionality" also means no page that merely
// *looks* protected — this runs server-side, on every request, because
// the session strategy is "database" (ADR §7), not a JWT the client could
// hold onto after being disabled).
export default async function ProtectedStudioLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentStudioSession();

  if (!session || session.user.status !== "ACTIVE") {
    redirect("/studio/signin");
  }

  const { role, name, email } = session.user;

  async function signOut() {
    "use server";
    await signOutCurrentUser();
    redirect("/studio/signin");
  }

  const navLinks: Array<{ href: string; label: string }> = [
    { href: "/studio/dashboard", label: "Dashboard" },
    { href: "/studio/recordings", label: "Recordings" },
    { href: "/studio/catalogue", label: "Catalogue" },
    { href: "/studio/editorial", label: "Editorial" },
    { href: "/studio/sheet-music", label: "Sheet Music Requests" },
  ];
  if (canManageUsers(role)) {
    navLinks.push({ href: "/studio/users", label: "Users" });
  }
  if (can(role, "AUDIT_VIEW")) {
    navLinks.push({ href: "/studio/audit", label: "Audit Log" });
  }
  navLinks.push({ href: "/studio/settings", label: "Settings" });

  return (
    <div style={{ display: "flex", gap: "2rem" }}>
      <nav style={{ minWidth: "12rem", flexShrink: 0 }}>
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href}>{link.label}</Link>
            </li>
          ))}
        </ul>
        <hr />
        <p style={{ fontSize: "0.85rem" }}>
          Signed in as {name} ({email})
          <br />
          Role: {role}
        </p>
        <form action={signOut}>
          <button type="submit">Sign out</button>
        </form>
      </nav>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
