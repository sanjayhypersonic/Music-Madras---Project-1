import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { StudioNav } from "../../../../components/studio/StudioNav";
import { getCurrentStudioSession, signOutCurrentUser } from "../../../../modules/auth/authService";
import { can, canManageUsers } from "../../../../modules/auth/policy";
import { countUnreadNotifications } from "../../../../modules/db/repositories/studioNotificationRepository";
import { runStewardshipSweepIfStale } from "../../../../modules/stewardship/runStewardshipSweepIfStale";

// Phase 6J-3B: the layout is a sidebar + content grid; StudioNav (client) adds the\n// current-page marker and the mobile disclosure, with the account block and the\n// sign-out Server Action passed in as server-rendered children.\n//\n// The authentication + account-status gate for every real Studio screen
// (brief §2/§3: "no fake functionality" also means no page that merely
// *looks* protected — this runs server-side, on every request, because
// the session strategy is "database" (ADR §7), not a JWT the client could
// hold onto after being disabled).
export default async function ProtectedStudioLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentStudioSession();

  if (!session || session.user.status !== "ACTIVE") {
    redirect("/studio/signin");
  }

  const { id: userId, role, name, email } = session.user;
  await runStewardshipSweepIfStale();
  const unread = await countUnreadNotifications({ userId, role });

  async function signOut() {
    "use server";
    await signOutCurrentUser();
    redirect("/studio/signin");
  }

  const navLinks: Array<{ href: string; label: string }> = [
    { href: "/studio/dashboard", label: "Dashboard" },
    { href: "/studio/notifications", label: unread > 0 ? `Notifications (${unread})` : "Notifications" },
    { href: "/studio/catalogue/videos", label: "YouTube Videos" },
    { href: "/studio/recordings", label: "Recordings" },
    { href: "/studio/catalogue", label: "Catalogue" },
    { href: "/studio/editorial", label: "Editorial" },
    { href: "/studio/sheet-music", label: "Sheet Music Requests" },
  ];
  if (can(role, "RECORDING_WRITE")) {
    navLinks.push({ href: "/studio/content-suggestions", label: "Content Suggestions" });
  }
  if (canManageUsers(role)) {
    navLinks.push({ href: "/studio/users", label: "Users" });
  }
  if (can(role, "AUDIT_VIEW")) {
    navLinks.push({ href: "/studio/audit", label: "Audit Log" });
  }
  if (can(role, "SETTINGS_MANAGE")) {
    navLinks.push({ href: "/studio/health", label: "Health" });
  }
  navLinks.push({ href: "/studio/settings", label: "Settings" });

  return (
    <div className="studio-layout">
      <StudioNav links={navLinks}>
        <div className="studio-account">
          <p>
            <span className="studio-account__name">{name}</span>
            <br />
            {email}
            <br />
            Role: {role}
          </p>
          <form action={signOut}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </StudioNav>
      <div className="studio-layout__content">{children}</div>
    </div>
  );}
