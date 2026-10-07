import { startLab } from "../lab/lab.mjs";
import { groups, members } from "../lab/people.mjs";
import { seed } from "../lab/seed.mjs";

// The lab for the whole run, seeded with a team's conversations; its
// address goes to the tests in CHAT_LAB.
export default async function setup() {
  const lab = await startLab({ members, groups });
  const made = await seed(lab);
  process.env["CHAT_LAB"] = lab.url;
  process.env["CHAT_SEED"] = JSON.stringify({ design: made.design.id, board: made.board.id, general: made.general.id, dm: made.dm.id, kickoff: made.kickoff.id });
  return () => lab.close();
}
