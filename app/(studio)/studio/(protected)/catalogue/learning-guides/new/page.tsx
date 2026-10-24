import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../../modules/auth/authService";
import { can } from "../../../../../../../modules/auth/policy";
import { createLearningGuideAction } from "./actions";
import { decodeMessage } from "../../../../../../../modules/studio/decodeMessage";

export default async function NewLearningGuidePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "CATALOGUE_WRITE")) {
    redirect("/studio/catalogue/learning-guides?error=You+do+not+have+permission+to+add+learning+guides.");
  }
  const { error } = await searchParams;

  return (
    <div>
      <p>
        <Link href="/studio/catalogue/learning-guides">← Learning Guides</Link>
      </p>
      <h1>New Learning Guide</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

      <form action={createLearningGuideAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "32rem" }}>
        <label>
          Title
          <input name="title" required style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Difficulty level (optional, free text — e.g. &quot;Beginner&quot;)
          <input name="difficultyLevel" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Estimated reading time (minutes, optional)
          <input name="estimatedReadingTimeMinutes" type="number" min="0" style={{ display: "block", width: "100%" }} />
        </label>
        <label>
          Content (Markdown, optional)
          <textarea name="contentMarkdown" rows={10} style={{ display: "block", width: "100%" }} />
        </label>
        <button type="submit" className="studio-button--primary">Create Learning Guide</button>
      </form>
    </div>
  );
}
