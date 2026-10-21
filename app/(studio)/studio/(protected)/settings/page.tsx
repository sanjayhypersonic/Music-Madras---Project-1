import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { ChangePasswordForm } from "./ChangePasswordForm";

export default async function SettingsPage() {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  return (
    <div>
      <h1>Settings</h1>

      <section>
        <h2>Profile</h2>
        <p>Name: {session.user.name}</p>
        <p>Email: {session.user.email}</p>
        <p>Role: {session.user.role}</p>
      </section>

      <section>
        <h2>Security</h2>
        <ChangePasswordForm />
      </section>

      <section>
        <h2>Site and editorial settings</h2>
        <p>
          <Link href="/studio/settings/site">Open site and editorial settings</Link> — preferences with a defined owner (what you see depends on your role).
        </p>
      </section>

      <section>
        <h2>API connections</h2>
        <p>YouTube, analytics, email and AI connections are configured by the site operator in the deployment settings; nothing here is editable.</p>
      </section>
    </div>
  );
}
