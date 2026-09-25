import { type DB, all, run } from "../db.js";
import type { Hub } from "./hub.js";

/** A deactivated person loses their sessions at once, and every agent of theirs
 * loses every grant and its connection, which stops any run in progress. */
export function deactivateUser(db: DB, hub: Hub, userId: string, reason = "account deactivated"): void {
  run(db, "DELETE FROM sessions WHERE user_id = ?", userId);
  for (const ag of all<{ id: string }>(db, "SELECT id FROM agents WHERE user_id = ?", userId)) {
    run(db, "UPDATE grants SET granted = 0, scope_json = '[]', updated_by = 'deactivation' WHERE agent_id = ?", ag.id);
    hub.pushGrants(ag.id, "admin", reason);
    hub.agents.get(ag.id)?.socket.close(4403, reason);
  }
}
