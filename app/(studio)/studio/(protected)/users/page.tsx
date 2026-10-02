import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { canManageUsers } from "../../../../../modules/auth/policy";
import { listStudioUsers } from "../../../../../modules/db/repositories/studioUserAdminRepository";
import { assignableRoles, roleRank } from "../../../../../modules/auth/userManagementRules";
import { ConfirmSubmitButton } from "../../../../../components/studio/ConfirmSubmitButton";
import { inviteUserAction, disableUserAction, reactivateUserAction, changeRoleAction } from "./actions";

// Phase 6J-1: the controls shown here mirror the server rules in
// modules/auth/userManagementRules.ts (a courtesy only — the repositories
// enforce them): you can only manage users ranked below you, only hand out roles
// below your own, never touch yourself or the Founder, and a user who has not
// accepted their invitation is re-invited rather than "reactivated".

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!canManageUsers(session.user.role)) {
    return <p>You do not have permission to manage users.</p>;
  }
  const { error } = await searchParams;

  const users = await listStudioUsers();
  const actorRole = session.user.role;
  const grantable = assignableRoles(actorRole);

  return (
    <div>
      <h1>Users</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Name</th>
            <th style={{ textAlign: "left" }}>Email</th>
            <th style={{ textAlign: "left" }}>Role</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.id === session.user.id;
            const manageable = !isSelf && user.role !== "FOUNDER" && roleRank(user.role) < roleRank(actorRole);
            return (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>
                  {manageable ? (
                    <form action={changeRoleAction.bind(null, user.id)} style={{ display: "flex", gap: "0.5rem" }}>
                      <select name="role" defaultValue={user.role} aria-label={`Role for ${user.name}`}>
                        {Array.from(new Set([...grantable, user.role])).map((role) => (
                          <option key={role} value={role} disabled={!grantable.includes(role)}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <ConfirmSubmitButton confirmMessage={`Change ${user.name}'s role? Their permissions change immediately.`} pendingLabel="Saving…">
                        Save
                      </ConfirmSubmitButton>
                    </form>
                  ) : (
                    user.role
                  )}
                </td>
                <td>{user.status}</td>
                <td>
                  {!manageable ? (
                    <span style={{ color: "#666" }}>{isSelf ? "This is you" : user.role === "FOUNDER" ? "Protected" : "—"}</span>
                  ) : user.status === "DISABLED" ? (
                    <form action={reactivateUserAction.bind(null, user.id)}>
                      <ConfirmSubmitButton confirmMessage={`Reactivate ${user.name}? They will be able to sign in again.`} pendingLabel="Reactivating…">
                        Reactivate
                      </ConfirmSubmitButton>
                    </form>
                  ) : user.status === "INVITED" ? (
                    <span style={{ color: "#666" }}>Invitation pending</span>
                  ) : (
                    <form action={disableUserAction.bind(null, user.id)}>
                      <ConfirmSubmitButton
                        confirmMessage={`Disable ${user.name}? They will be signed out immediately and cannot sign in until reactivated.`}
                        pendingLabel="Disabling…"
                      >
                        Disable
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Invite a user</h2>
      {grantable.length === 0 ? (
        <p>Your role cannot invite new users.</p>
      ) : (
        <form action={inviteUserAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: "24rem" }}>
          <label>
            Name
            <input name="name" required style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Email
            <input name="email" type="email" required style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Role
            <select name="role" required style={{ display: "block", width: "100%" }}>
              {grantable.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <ConfirmSubmitButton pendingLabel="Sending…">Send invitation</ConfirmSubmitButton>
        </form>
      )}
      <p>The invitation is sent by email. The link works once and expires after 72 hours.</p>
    </div>
  );
}
