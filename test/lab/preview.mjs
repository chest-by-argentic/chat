// The tool on the local Chest of the tests, with a team and their
// conversations, until stopped (Ctrl-C): npm run preview, then open the
// address it prints. Sign in as someone with /__as/<member id>.
import { startLab } from "./lab.mjs";
import { members, groups } from "./people.mjs";
import { seed } from "./seed.mjs";

const lab = await startLab({ members, groups });
await seed(lab);
console.log(`Chat on ${lab.url}`);
for (const m of members) console.log(`  ${m.name.padEnd(16)} ${lab.url}/__as/${m.id}`);
const stop = async () => { await lab.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
