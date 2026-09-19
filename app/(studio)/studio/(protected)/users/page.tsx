import { redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../modules/auth/authService";
import { canManageUsers } from "../../../../../modules/auth/policy";
import { listStudioUsers } from "../../../../../modules/db/repositories/studioUserAdminRepository";
import { inviteUserAction, disableUserAction, reactivateUserAction, changeRoleAction } from "./actions";
import type { StudioRoleName } from "../../../../../modules/auth/types";

const ROLES: StudioRoleName[] = ["FOUNDER", "SUPER_ADMINISTRATOR", "ADMINISTRATOR", "EDITOR", "REVIEWER", "CONTRIBUTOR"];

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!canManageUsers(session.user.role)) {
    return <p>You do not have permission to manage users.</p>;
  }
  const { error } = await searchParams;

  const users = await listStudioUsers();

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
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>
                <form action={changeRoleAction.bind(null, user.id)} style={{ display: "flex", gap: "0.5rem" }}>
                  <select name="role" defaultValue={user.role}>
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <button type="submit">Save</button>
                </form>
              </td>
              <td>{user.status}</td>
              <td>
                {user.status === "DISABLED" ? (
                  <form action={reactivateUserAction.bind(null, user.id)}>
                    <button type="submit">Reactivate</button>
                  </form>
                ) : (
                  user.id !== session.user.id && (
                    <form action={disableUserAction.bind(null, user.id)}>
                      <button type="submit">Disable</button>
                    </form>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Invite a user</h2>
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
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Send invitation</button>
      </form>
      <p>
        No real email delivery is configured in this environment — the invitation link is logged to the server
        console (see modules/auth/email/emailProvider.ts).
      </p>
    </div>
  );
}
