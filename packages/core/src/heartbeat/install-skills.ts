/**
 * Installs the main-loop and watchdog SKILL.md files into
 * `~/.skill/` if they don't already exist.
 *
 * These skills are loaded by SkillLoader on startup just like any other skill.
 */

import { join } from 'path';
import { homedir } from 'os';

// ── Skill content ───────────────────────────────────────────────────

const MAIN_LOOP_SKILL = `---
name: main-loop
description: Autonomous heartbeat — review goals, check async results, act on pending items, and schedule next wakeup.
user-invocable: false
---

## Autonomous Heartbeat

You are running as an autonomous heartbeat turn. This is a scheduled wakeup — no user is waiting for an immediate answer.

### What to do (in order)

1. **Check async job results** — call \`jobs_list\` to see if any background jobs have finished since last heartbeat. Summarise results and act on them if needed.
2. **Read goals** — call \`memory_recall agent.goals\` to see what you're working toward. If no goals are set, skip.
3. **Check pending items** — call \`memory_recall agent.state.pending\` for items flagged for follow-up.
4. **Inspect relevant connectors / tools** — based on the goals and pending items, decide which connectors or tools to call. You have ALL tools available. Use your judgement.
5. **Handle quick items directly** — if something is fast and straightforward, do it now. For heavy work, use \`assistant_delegate\` or create tasks with \`tasks_add\`.
6. **Update state** — save any new observations to memory:
   - \`memory_save agent.state.lastActions "..."\` with a brief summary of what you did this turn.
   - \`memory_save agent.state.pending "..."\` with any items still pending.
7. **Schedule next heartbeat** — choose when you should wake up next based on urgency:
   - Delete the old heartbeat schedule: call \`schedule\` with \`{ action: "delete", id: "heartbeat-{SESSION_ID}" }\`
   - Create a new schedule: call \`schedule\` with \`action: "create"\`, \`actionType: "message"\`, \`message: "/main-loop"\`, and either \`at\` (one-shot) or \`cron\` + \`startImmediately: true\` (recurring).
   - Save your reasoning: \`memory_save agent.heartbeat.intention "..."\`
8. **Record timestamp** — \`memory_save agent.heartbeat.last\` with the current ISO timestamp.

### Timing guidelines

- If tasks are actively running or jobs are pending → wake up in **1–3 minutes**.
- If goals exist but nothing is urgent → wake up in **5–15 minutes**.
- If nothing is pending → wake up in **15–30 minutes** (respect maxSleepMs).
- Always respect the configured maximum sleep time.

### Important

- Be concise — you're running in the background.
- Don't produce user-facing output unless there's something critical.
- If you encounter an error, log it to memory and schedule a retry.
`;

const WATCHDOG_SKILL = `---
name: watchdog
description: Safety-net watchdog — checks if the heartbeat is healthy and forces a wakeup if overdue.
user-invocable: false
allowed-tools: memory_recall, memory_save, schedule
---

## Watchdog Check

You are the watchdog. Your only job is to verify the heartbeat is running and force a wakeup if it's overdue.

### Steps

1. Read \`memory_recall agent.heartbeat.last\` to get the last heartbeat timestamp.
2. Read \`memory_recall agent.heartbeat.next\` to get the expected next heartbeat time.
3. If the last heartbeat is more than **double** the expected interval overdue:
   - Call \`schedule\` with \`{ action: "list" }\` to check if a heartbeat schedule exists.
   - If no active heartbeat schedule exists, create one that fires immediately:
     call \`schedule\` with \`action: "create"\`, \`actionType: "message"\`, \`message: "/main-loop"\`, and \`cron: "* * * * *"\` + \`startImmediately: true\`.
   - Save \`memory_save agent.heartbeat.intention "Watchdog forced wakeup — heartbeat was overdue."\`
4. If the heartbeat is healthy, do nothing.
`;

// ── Installer ───────────────────────────────────────────────────────

const LEGACY_SKILL_PATTERNS = [
  /`schedule_create`/,
  /`schedule_delete`/,
  /`schedules_list`/,
  /allowed-tools:\s*.*schedule_create/i,
];

async function writeSkillIfNeeded(dir: string, skillName: string, content: string): Promise<boolean> {
  const { mkdir, writeFile, readFile } = await import('fs/promises');
  const skillDir = join(dir, `skill-${skillName}`);
  const skillFile = join(skillDir, 'SKILL.md');

  await mkdir(skillDir, { recursive: true });

  // Update only when needed:
  // - file missing (install)
  // - file contains legacy schedule tool names (migration)
  try {
    const existing = await readFile(skillFile, 'utf-8');
    if (existing === content) {
      return false; // already current
    }
    const hasLegacyPatterns = LEGACY_SKILL_PATTERNS.some((pattern) => pattern.test(existing));
    if (!hasLegacyPatterns) {
      return false; // preserve user-customized non-legacy content
    }
    await writeFile(skillFile, content, 'utf-8');
    return true;
  } catch {
    // Missing/unreadable file — install fresh content
    await writeFile(skillFile, content, 'utf-8');
    return true;
  }
}

/**
 * Install or migrate the main-loop and watchdog skills in the shared skills directory.
 * Existing non-legacy user-customized skills are preserved.
 *
 * @returns names of skills that were installed or migrated
 */
export async function installHeartbeatSkills(): Promise<string[]> {
  const sharedSkillsDir = join(homedir(), '.skill');
  const installed: string[] = [];

  const results = await Promise.all([
    writeSkillIfNeeded(sharedSkillsDir, 'main-loop', MAIN_LOOP_SKILL),
    writeSkillIfNeeded(sharedSkillsDir, 'watchdog', WATCHDOG_SKILL),
  ]);

  if (results[0]) installed.push('main-loop');
  if (results[1]) installed.push('watchdog');

  return installed;
}
