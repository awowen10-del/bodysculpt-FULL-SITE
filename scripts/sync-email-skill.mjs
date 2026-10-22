// scripts/sync-email-skill.mjs  (v244.1)
//
//     npm run sync-skill
//
// Copies the MASTER email skill (netlify/lib/email-skill.js) out to every other place it
// lives on this Mac, so Ash edits one file and every copy follows:
//
//   ~/.claude/skills/inbox-zero/voice.md          inbox-zero's voice file (Claude)
//   ~/.agents/skills/inbox-zero/voice.md          …and the Codex copy
//   ~/.claude/skills/synced/*/bodysculpt-email-replies/SKILL.md   the skill as Claude Code
//   ~/.agents/skills/synced/*/bodysculpt-email-replies/SKILL.md   sees it on this Mac
//   ~/Downloads/bodysculpt-email-replies.zip      ready to UPLOAD to claude.ai
//
// WHY THE ZIP. bodysculpt-email-replies is a skill uploaded to Ash's claude.ai account; the
// "synced" folders are claude.ai's copies of it, refreshed from the account. Writing them
// makes this Mac right at once, but the next sync puts the account's version back — so the
// account must get the new one too: claude.ai → Settings → Capabilities → Skills →
// bodysculpt-email-replies → replace it with the zip. Until then the test's drift check
// will say so, which is the reminder.
//
// Only files that ALREADY exist are overwritten (a missing folder is reported, not
// created — a new folder would be a second skill with the same name). Each overwritten file
// is backed up beside itself as <name>.bak first.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SKILL_FRONTMATTER, SKILL_TEXT } from "../netlify/lib/email-skill.js";

const HOME = os.homedir();
const full = SKILL_FRONTMATTER + SKILL_TEXT;

function syncedCopies(base) {
  const dir = path.join(base, "skills", "synced");
  try {
    return fs.readdirSync(dir).map((d) => path.join(dir, d, "bodysculpt-email-replies", "SKILL.md"));
  } catch { return []; }
}

export function targets() {
  return [
    path.join(HOME, ".claude", "skills", "inbox-zero", "voice.md"),
    path.join(HOME, ".agents", "skills", "inbox-zero", "voice.md"),
    ...syncedCopies(path.join(HOME, ".claude")),
    ...syncedCopies(path.join(HOME, ".agents")),
  ];
}
export const MASTER = full;

// run only when called as a script, not when the test imports targets()
if (import.meta.url === "file://" + process.argv[1]) {
  let wrote = 0;
  for (const t of targets()) {
    if (!fs.existsSync(t)) { if (!t.includes("synced")) console.log("  not found (skipped): " + t); continue; }
    if (fs.readFileSync(t, "utf8") === full) { console.log("  already up to date:   " + t); continue; }
    fs.copyFileSync(t, t + ".bak");
    fs.writeFileSync(t, full);
    console.log("  updated:              " + t + "   (old copy kept as .bak)");
    wrote++;
  }
  // the upload for claude.ai: a zip with the skill folder in it
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-"));
  const folder = path.join(tmp, "bodysculpt-email-replies");
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "SKILL.md"), full);
  const zip = path.join(HOME, "Downloads", "bodysculpt-email-replies.zip");
  try { fs.unlinkSync(zip); } catch { /* none yet */ }
  execFileSync("zip", ["-q", "-r", zip, "bodysculpt-email-replies"], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\n" + wrote + " file(s) updated.");
  console.log("Last step, by hand: upload " + zip + "\n  in claude.ai → Settings → Capabilities → Skills → bodysculpt-email-replies (replace),\n  or the next sync will put the old version back on this Mac.");
}
