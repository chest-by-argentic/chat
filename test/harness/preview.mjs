// The tool on the local Chest of the tests, with a team and their
// conversations, until stopped (Ctrl-C): npm run preview, then open the
// address it prints. Sign in as someone with /__as/<member id>.
import { startChest } from "./chest.mjs";
import { members, groups } from "./people.mjs";
import { seed } from "./seed.mjs";

const local = await startChest({ members, groups });
await seed(local);
console.log(`Chat on ${local.url}`);
for (const m of members) console.log(`  ${m.name.padEnd(16)} ${local.url}/__as/${m.id}`);
const stop = async () => { await local.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
