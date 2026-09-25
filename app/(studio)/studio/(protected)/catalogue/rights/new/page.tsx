import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createRightsInformationAction } from "./actions";

export default async function NewRightsInformationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/rights?error=You+do+not+have+permission+to+add+rights+information.");
  }
  const { error } = await searchParams;

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/rights">← Rights Information</Link>
      </p>
      <h1>New Rights Information</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <form action={createRightsInformationAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
        <label>
          Holder (optional)
          <input name="holder" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Licence type (optional)
          <input name="licenseType" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Notes (optional)
          <textarea name="notes" style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit">Create Rights Information</button>
      </form>
    </div>
  );
}
