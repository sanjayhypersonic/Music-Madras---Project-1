import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { findRightsInformationById } from "../../../../../../../modules/db/repositories/rightsInformationRepository";
import { updateRightsInformationAction } from "./actions";

export default async function RightsInformationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");

  const { id } = await params;
  const { error } = await searchParams;

  const rights = await findRightsInformationById(id);
  if (!rights) {
    notFound();
  }

  const canWrite = can(session.user.role, "CATALOGUE_WRITE");

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/rights">← Rights Information</Link>
      </p>
      <h1>{rights.holder ?? rights.licenseType ?? "Untitled Rights Information"}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <h2>Edit</h2>
      {canWrite ? (
        <form
          action={updateRightsInformationAction.bind(null, rights.id)}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}
        >
          <label>
            Holder
            <input name="holder" defaultValue={rights.holder ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Licence type
            <input name="licenseType" defaultValue={rights.licenseType ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Notes
            <textarea name="notes" defaultValue={rights.notes ?? ""} style={{ display: "block", width: "100%" }} />
          </label>
          <button type="submit">Save</button>
        </form>
      ) : (
        <p>You do not have permission to edit this rights information.</p>
      )}
    </div>
  );
}
