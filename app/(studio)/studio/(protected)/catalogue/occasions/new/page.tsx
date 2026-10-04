import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createOccasionAction } from "./actions";

export default async function NewOccasionPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/occasions?error=You+do+not+have+permission+to+add+occasions.");
  }
  const { error } = await searchParams;

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/occasions">← Occasions</Link>
      </p>
      <h1>New Occasion</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeURIComponent(error)}</p>}

      <form action={createOccasionAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
        <label>
          Name
          <input name="name" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Description (optional)
          <textarea name="description" style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" className="studio-button--primary">Create Occasion</button>
      </form>
    </div>
  );
}
