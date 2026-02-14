import { generateId } from '@hasna/assistants-shared';
import type { Task, TaskPriority, TaskStatus, TaskStoreData, TaskCreateOptions, TaskRecurrence } from './types';
import { PRIORITY_ORDER } from './types';
import { getNextCronRun } from '../scheduler/cron';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';

function getDb(): DatabaseConnection {
  return getDatabase();
}

interface TaskRow {
  id: string;
  project_path: string;
  description: string;
  status: string;
  priority: string;
  result: string | null;
  error: string | null;
  assignee: string | null;
  project_id: string | null;
  blocked_by: string | null;
  blocks: string | null;
  is_recurring_template: number;
  next_run_at: number | null;
  recurrence: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

function rowToTask(row: TaskRow): Task {
  const task: Task = {
    id: row.id,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    createdAt: row.created_at,
  };
  if (row.started_at != null) task.startedAt = row.started_at;
  if (row.completed_at != null) task.completedAt = row.completed_at;
  if (row.result != null) task.result = row.result;
  if (row.error != null) task.error = row.error;
  if (row.project_id != null) task.projectId = row.project_id;
  if (row.assignee != null) task.assignee = row.assignee;
  if (row.blocked_by) {
    const arr = JSON.parse(row.blocked_by) as string[];
    if (arr.length > 0) task.blockedBy = arr;
  }
  if (row.blocks) {
    const arr = JSON.parse(row.blocks) as string[];
    if (arr.length > 0) task.blocks = arr;
  }
  if (row.is_recurring_template) task.isRecurringTemplate = true;
  if (row.next_run_at != null) task.nextRunAt = row.next_run_at;
  if (row.recurrence) task.recurrence = JSON.parse(row.recurrence) as TaskRecurrence;
  return task;
}

function calculateNextRunAt(recurrence: TaskRecurrence, fromTime: number): number | undefined {
  if (recurrence.endAt && fromTime >= recurrence.endAt) {
    return undefined;
  }
  if (recurrence.maxOccurrences && (recurrence.occurrenceCount ?? 0) >= recurrence.maxOccurrences) {
    return undefined;
  }

  if (recurrence.kind === 'cron' && recurrence.cron) {
    return getNextCronRun(recurrence.cron, fromTime, recurrence.timezone);
  }

  if (recurrence.kind === 'interval' && recurrence.intervalMs) {
    return fromTime + recurrence.intervalMs;
  }

  return undefined;
}

export async function loadTaskStore(cwd: string): Promise<TaskStoreData> {
  const tasks = await getTasks(cwd);
  const paused = await isPaused(cwd);
  const autoRun = await isAutoRun(cwd);
  return { tasks, paused, autoRun };
}

export async function saveTaskStore(_cwd: string, _data: TaskStoreData): Promise<void> {
  // No-op: individual operations write directly to SQLite
}

export async function getTasks(cwd: string): Promise<Task[]> {
  const rows = getDb().query<TaskRow>(
    'SELECT * FROM tasks WHERE project_path = ? ORDER BY created_at'
  ).all(cwd);
  const tasks = rows.map(rowToTask);
  // Sanitize blockedBy/blocks to remove references to missing tasks
  const knownIds = new Set(tasks.map((t) => t.id));
  for (const task of tasks) {
    if (task.blockedBy?.length) {
      const filtered = task.blockedBy.filter((id) => knownIds.has(id));
      task.blockedBy = filtered.length > 0 ? Array.from(new Set(filtered)) : undefined;
    }
    if (task.blocks?.length) {
      const filtered = task.blocks.filter((id) => knownIds.has(id));
      task.blocks = filtered.length > 0 ? Array.from(new Set(filtered)) : undefined;
    }
  }
  return tasks;
}

export async function getTask(cwd: string, id: string): Promise<Task | null> {
  const row = getDb().query<TaskRow>(
    'SELECT * FROM tasks WHERE project_path = ? AND id = ?'
  ).get(cwd, id);
  return row ? rowToTask(row) : null;
}

export async function resolveTaskId(
  cwd: string,
  idOrPrefix: string,
  filter?: (task: Task) => boolean
): Promise<{ task: Task | null; matches: Task[] }> {
  const allTasks = await getTasks(cwd);
  const candidates = filter ? allTasks.filter(filter) : allTasks;

  const exact = candidates.find((t) => t.id === idOrPrefix);
  if (exact) {
    return { task: exact, matches: [exact] };
  }

  const matches = candidates.filter((t) => t.id.startsWith(idOrPrefix));
  return { task: matches.length === 1 ? matches[0] : null, matches };
}

export async function addTask(
  cwd: string,
  options: TaskCreateOptions | string,
  priority: TaskPriority = 'normal',
  projectId?: string
): Promise<Task> {
  const d = getDb();
  return d.transaction(() => {
    const now = Date.now();

    const opts: TaskCreateOptions =
      typeof options === 'string'
        ? { description: options, priority, projectId }
        : options;

    let recurrence: TaskRecurrence | undefined;
    let nextRunAt: number | undefined;
    let isRecurringTemplate = false;

    if (opts.recurrence) {
      recurrence = {
        kind: opts.recurrence.kind,
        cron: opts.recurrence.cron,
        intervalMs: opts.recurrence.intervalMs,
        timezone: opts.recurrence.timezone,
        maxOccurrences: opts.recurrence.maxOccurrences,
        endAt: opts.recurrence.endAt,
        occurrenceCount: 0,
      };
      nextRunAt = calculateNextRunAt(recurrence, now);
      isRecurringTemplate = true;
    }

    // Get existing task IDs for this project
    const existingRows = d.query<{ id: string }>(
      'SELECT id FROM tasks WHERE project_path = ?'
    ).all(cwd);
    const existingIds = new Set(existingRows.map((r) => r.id));

    const filteredBlockedBy = opts.blockedBy?.filter((id) => existingIds.has(id)) ?? [];
    const filteredBlocks = opts.blocks?.filter((id) => existingIds.has(id)) ?? [];

    const taskId = generateId();

    const task: Task = {
      id: taskId,
      description: opts.description.trim(),
      status: 'pending',
      priority: opts.priority ?? 'normal',
      createdAt: now,
      projectId: opts.projectId,
      blockedBy: filteredBlockedBy.length ? filteredBlockedBy : undefined,
      blocks: filteredBlocks.length ? filteredBlocks : undefined,
      assignee: opts.assignee || undefined,
      recurrence,
      isRecurringTemplate,
      nextRunAt,
    };

    d.prepare(
      `INSERT INTO tasks (id, project_path, description, status, priority, result, error, assignee, project_id, blocked_by, blocks, is_recurring_template, next_run_at, recurrence, created_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      task.id,
      cwd,
      task.description,
      task.status,
      task.priority,
      task.result ?? null,
      task.error ?? null,
      task.assignee ?? null,
      task.projectId ?? null,
      task.blockedBy ? JSON.stringify(task.blockedBy) : null,
      task.blocks ? JSON.stringify(task.blocks) : null,
      task.isRecurringTemplate ? 1 : 0,
      task.nextRunAt ?? null,
      task.recurrence ? JSON.stringify(task.recurrence) : null,
      task.createdAt,
      task.startedAt ?? null,
      task.completedAt ?? null
    );

    // If this task blocks other tasks, update those tasks' blockedBy arrays
    if (filteredBlocks.length) {
      for (const blockedId of filteredBlocks) {
        const row = d.query<TaskRow>(
          'SELECT * FROM tasks WHERE project_path = ? AND id = ?'
        ).get(cwd, blockedId);
        if (row) {
          const blockedBy = row.blocked_by ? JSON.parse(row.blocked_by) as string[] : [];
          if (!blockedBy.includes(taskId)) {
            blockedBy.push(taskId);
            d.prepare('UPDATE tasks SET blocked_by = ? WHERE id = ?').run(
              JSON.stringify(blockedBy), blockedId
            );
          }
        }
      }
    }

    // If this task is blocked by others, update those tasks' blocks arrays
    if (filteredBlockedBy.length) {
      for (const blockingId of filteredBlockedBy) {
        const row = d.query<TaskRow>(
          'SELECT * FROM tasks WHERE project_path = ? AND id = ?'
        ).get(cwd, blockingId);
        if (row) {
          const blocks = row.blocks ? JSON.parse(row.blocks) as string[] : [];
          if (!blocks.includes(taskId)) {
            blocks.push(taskId);
            d.prepare('UPDATE tasks SET blocks = ? WHERE id = ?').run(
              JSON.stringify(blocks), blockingId
            );
          }
        }
      }
    }

    return task;
  });
}

export async function updateTask(
  cwd: string,
  id: string,
  updates: Partial<Pick<Task, 'status' | 'priority' | 'result' | 'error' | 'startedAt' | 'completedAt'>>
): Promise<Task | null> {
  const d = getDb();
  const row = d.query<TaskRow>(
    'SELECT * FROM tasks WHERE project_path = ? AND id = ?'
  ).get(cwd, id);
  if (!row) return null;

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) { setClauses.push('status = ?'); params.push(updates.status); }
  if (updates.priority !== undefined) { setClauses.push('priority = ?'); params.push(updates.priority); }
  if (updates.result !== undefined) { setClauses.push('result = ?'); params.push(updates.result); }
  if (updates.error !== undefined) { setClauses.push('error = ?'); params.push(updates.error); }
  if (updates.startedAt !== undefined) { setClauses.push('started_at = ?'); params.push(updates.startedAt); }
  if (updates.completedAt !== undefined) { setClauses.push('completed_at = ?'); params.push(updates.completedAt); }

  if (setClauses.length > 0) {
    params.push(id);
    d.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = d.query<TaskRow>(
    'SELECT * FROM tasks WHERE project_path = ? AND id = ?'
  ).get(cwd, id);
  return updated ? rowToTask(updated) : null;
}

export async function deleteTask(cwd: string, id: string): Promise<boolean> {
  const d = getDb();
  return d.transaction(() => {
    const row = d.query<TaskRow>(
      'SELECT * FROM tasks WHERE project_path = ? AND id = ?'
    ).get(cwd, id);
    if (!row) return false;

    d.prepare('DELETE FROM tasks WHERE id = ?').run(id);

    // Remove references from remaining tasks' blockedBy/blocks
    const remaining = d.query<TaskRow>(
      'SELECT * FROM tasks WHERE project_path = ?'
    ).all(cwd);

    for (const r of remaining) {
      let changed = false;
      let blockedBy = r.blocked_by ? JSON.parse(r.blocked_by) as string[] : [];
      let blocks = r.blocks ? JSON.parse(r.blocks) as string[] : [];

      if (blockedBy.includes(id)) {
        blockedBy = blockedBy.filter((bid) => bid !== id);
        changed = true;
      }
      if (blocks.includes(id)) {
        blocks = blocks.filter((bid) => bid !== id);
        changed = true;
      }

      if (changed) {
        d.prepare('UPDATE tasks SET blocked_by = ?, blocks = ? WHERE id = ?').run(
          blockedBy.length > 0 ? JSON.stringify(blockedBy) : null,
          blocks.length > 0 ? JSON.stringify(blocks) : null,
          r.id
        );
      }
    }

    return true;
  });
}

export async function clearPendingTasks(cwd: string): Promise<number> {
  const d = getDb();
  return d.transaction(() => {
    const pending = d.query<{ id: string }>(
      "SELECT id FROM tasks WHERE project_path = ? AND status = 'pending'"
    ).all(cwd);
    if (pending.length === 0) return 0;

    const removedIds = new Set(pending.map((r) => r.id));

    d.prepare(
      "DELETE FROM tasks WHERE project_path = ? AND status = 'pending'"
    ).run(cwd);

    // Update remaining tasks' blockedBy/blocks
    const remaining = d.query<TaskRow>(
      'SELECT * FROM tasks WHERE project_path = ?'
    ).all(cwd);

    for (const r of remaining) {
      let changed = false;
      let blockedBy = r.blocked_by ? JSON.parse(r.blocked_by) as string[] : [];
      let blocks = r.blocks ? JSON.parse(r.blocks) as string[] : [];

      const newBlockedBy = blockedBy.filter((bid) => !removedIds.has(bid));
      const newBlocks = blocks.filter((bid) => !removedIds.has(bid));

      if (newBlockedBy.length !== blockedBy.length || newBlocks.length !== blocks.length) {
        changed = true;
      }

      if (changed) {
        d.prepare('UPDATE tasks SET blocked_by = ?, blocks = ? WHERE id = ?').run(
          newBlockedBy.length > 0 ? JSON.stringify(newBlockedBy) : null,
          newBlocks.length > 0 ? JSON.stringify(newBlocks) : null,
          r.id
        );
      }
    }

    return removedIds.size;
  });
}

export async function clearCompletedTasks(cwd: string): Promise<number> {
  const d = getDb();
  return d.transaction(() => {
    const completed = d.query<{ id: string }>(
      "SELECT id FROM tasks WHERE project_path = ? AND (status = 'completed' OR status = 'failed')"
    ).all(cwd);
    if (completed.length === 0) return 0;

    const removedIds = new Set(completed.map((r) => r.id));

    d.prepare(
      "DELETE FROM tasks WHERE project_path = ? AND (status = 'completed' OR status = 'failed')"
    ).run(cwd);

    const remaining = d.query<TaskRow>(
      'SELECT * FROM tasks WHERE project_path = ?'
    ).all(cwd);

    for (const r of remaining) {
      let changed = false;
      let blockedBy = r.blocked_by ? JSON.parse(r.blocked_by) as string[] : [];
      let blocks = r.blocks ? JSON.parse(r.blocks) as string[] : [];

      const newBlockedBy = blockedBy.filter((bid) => !removedIds.has(bid));
      const newBlocks = blocks.filter((bid) => !removedIds.has(bid));

      if (newBlockedBy.length !== blockedBy.length || newBlocks.length !== blocks.length) {
        changed = true;
      }

      if (changed) {
        d.prepare('UPDATE tasks SET blocked_by = ?, blocks = ? WHERE id = ?').run(
          newBlockedBy.length > 0 ? JSON.stringify(newBlockedBy) : null,
          newBlocks.length > 0 ? JSON.stringify(newBlocks) : null,
          r.id
        );
      }
    }

    return removedIds.size;
  });
}

export async function getNextTask(cwd: string): Promise<Task | null> {
  const tasks = await getTasks(cwd);

  const completedIds = new Set(
    tasks
      .filter((t) => t.status === 'completed')
      .map((t) => t.id)
  );

  const pending = tasks.filter((t) => {
    if (t.status !== 'pending') return false;
    if (t.blockedBy?.length) {
      return t.blockedBy.every((blockerId) => completedIds.has(blockerId));
    }
    return true;
  });

  if (pending.length === 0) return null;

  pending.sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.createdAt - b.createdAt;
  });

  return pending[0];
}

export async function isPaused(cwd: string): Promise<boolean> {
  const row = getDb().query<{ paused: number }>(
    'SELECT paused FROM task_queue_settings WHERE project_path = ?'
  ).get(cwd);
  return row ? row.paused === 1 : false;
}

export async function setPaused(cwd: string, paused: boolean): Promise<void> {
  getDb().prepare(
    'INSERT OR REPLACE INTO task_queue_settings (project_path, paused, auto_run) VALUES (?, ?, COALESCE((SELECT auto_run FROM task_queue_settings WHERE project_path = ?), 1))'
  ).run(cwd, paused ? 1 : 0, cwd);
}

export async function isAutoRun(cwd: string): Promise<boolean> {
  const row = getDb().query<{ auto_run: number }>(
    'SELECT auto_run FROM task_queue_settings WHERE project_path = ?'
  ).get(cwd);
  return row ? row.auto_run === 1 : true;
}

export async function setAutoRun(cwd: string, autoRun: boolean): Promise<void> {
  getDb().prepare(
    'INSERT OR REPLACE INTO task_queue_settings (project_path, paused, auto_run) VALUES (?, COALESCE((SELECT paused FROM task_queue_settings WHERE project_path = ?), 0), ?)'
  ).run(cwd, cwd, autoRun ? 1 : 0);
}

export async function startTask(cwd: string, id: string): Promise<Task | null> {
  return updateTask(cwd, id, {
    status: 'in_progress',
    startedAt: Date.now(),
  });
}

export async function completeTask(cwd: string, id: string, result?: string): Promise<Task | null> {
  return updateTask(cwd, id, {
    status: 'completed',
    completedAt: Date.now(),
    result,
  });
}

export async function failTask(cwd: string, id: string, error?: string): Promise<Task | null> {
  return updateTask(cwd, id, {
    status: 'failed',
    completedAt: Date.now(),
    error,
  });
}

export async function getTaskCounts(cwd: string): Promise<Record<TaskStatus, number>> {
  const rows = getDb().query<{ status: string; cnt: number }>(
    'SELECT status, COUNT(*) as cnt FROM tasks WHERE project_path = ? GROUP BY status'
  ).all(cwd);

  const counts: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    completed: 0,
    failed: 0,
  };
  for (const row of rows) {
    counts[row.status as TaskStatus] = row.cnt;
  }
  return counts;
}

export async function getRecurringTasks(cwd: string): Promise<Task[]> {
  const rows = getDb().query<TaskRow>(
    'SELECT * FROM tasks WHERE project_path = ? AND is_recurring_template = 1'
  ).all(cwd);
  return rows.map(rowToTask);
}

export async function getDueRecurringTasks(cwd: string): Promise<Task[]> {
  const now = Date.now();
  const rows = getDb().query<TaskRow>(
    'SELECT * FROM tasks WHERE project_path = ? AND is_recurring_template = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?'
  ).all(cwd, now);
  return rows.map(rowToTask);
}

export async function createRecurringInstance(cwd: string, templateId: string): Promise<Task | null> {
  const d = getDb();
  return d.transaction(() => {
    const row = d.query<TaskRow>(
      'SELECT * FROM tasks WHERE project_path = ? AND id = ? AND is_recurring_template = 1'
    ).get(cwd, templateId);
    if (!row || !row.recurrence) return null;

    const template = rowToTask(row);
    if (!template.recurrence) return null;

    const now = Date.now();
    const instanceId = generateId();

    const instance: Task = {
      id: instanceId,
      description: template.description,
      status: 'pending',
      priority: template.priority,
      createdAt: now,
      projectId: template.projectId,
      assignee: template.assignee,
      recurrence: {
        ...template.recurrence,
        parentId: template.id,
      },
    };

    d.prepare(
      `INSERT INTO tasks (id, project_path, description, status, priority, assignee, project_id, recurrence, is_recurring_template, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      instance.id, cwd, instance.description, instance.status, instance.priority,
      instance.assignee ?? null, instance.projectId ?? null,
      instance.recurrence ? JSON.stringify(instance.recurrence) : null,
      instance.createdAt
    );

    // Update template
    template.recurrence.occurrenceCount = (template.recurrence.occurrenceCount ?? 0) + 1;
    const nextRun = calculateNextRunAt(template.recurrence, now);

    if (!nextRun) {
      d.prepare(
        'UPDATE tasks SET recurrence = ?, next_run_at = NULL, status = ?, completed_at = ?, result = ? WHERE id = ?'
      ).run(
        JSON.stringify(template.recurrence),
        'completed', now,
        `Recurring task completed after ${template.recurrence.occurrenceCount} occurrence(s)`,
        templateId
      );
    } else {
      d.prepare(
        'UPDATE tasks SET recurrence = ?, next_run_at = ? WHERE id = ?'
      ).run(JSON.stringify(template.recurrence), nextRun, templateId);
    }

    return instance;
  });
}

export async function processDueRecurringTasks(cwd: string): Promise<Task[]> {
  const dueTasks = await getDueRecurringTasks(cwd);
  const createdInstances: Task[] = [];

  for (const template of dueTasks) {
    const instance = await createRecurringInstance(cwd, template.id);
    if (instance) {
      createdInstances.push(instance);
    }
  }

  return createdInstances;
}

export async function cancelRecurringTask(cwd: string, id: string): Promise<Task | null> {
  const d = getDb();
  return d.transaction(() => {
    const row = d.query<TaskRow>(
      'SELECT * FROM tasks WHERE project_path = ? AND id = ? AND is_recurring_template = 1'
    ).get(cwd, id);
    if (!row) return null;

    const now = Date.now();
    d.prepare(
      "UPDATE tasks SET status = 'completed', completed_at = ?, next_run_at = NULL, result = 'Recurring task cancelled' WHERE id = ?"
    ).run(now, id);

    const updated = d.query<TaskRow>(
      'SELECT * FROM tasks WHERE id = ?'
    ).get(id);
    return updated ? rowToTask(updated) : null;
  });
}
