import { startChest } from "../harness/chest.mjs";
import { groups, members } from "../harness/people.mjs";
import { seed } from "../harness/seed.mjs";

// The local for the whole run, seeded with a team's conversations; its
// address goes to the tests in CHAT_URL.
export default async function setup() {
  const local = await startChest({ members, groups });
  const made = await seed(local);
  process.env["CHAT_URL"] = local.url;
  process.env["CHAT_SEED"] = JSON.stringify({ design: made.design.id, board: made.board.id, general: made.general.id, dm: made.dm.id, kickoff: made.kickoff.id });
  return () => local.close();
}
