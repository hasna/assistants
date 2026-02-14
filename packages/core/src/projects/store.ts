import { generateId } from '@hasna/assistants-shared';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';

export type ProjectContextType = 'file' | 'connector' | 'database' | 'note' | 'entity';

export interface ProjectContextEntry {
  id: string;
  type: ProjectContextType;
  value: string;
  label?: string;
  addedAt: number;
}

export type PlanStepStatus = 'todo' | 'doing' | 'done' | 'blocked';

export interface ProjectPlanStep {
  id: string;
  text: string;
  status: PlanStepStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectPlan {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  steps: ProjectPlanStep[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  context: ProjectContextEntry[];
  plans: ProjectPlan[];
}

function getDb(): DatabaseConnection {
  return getDatabase();
}

interface ProjectRow {
  id: string;
  project_path: string;
  name: string;
  description: string | null;
  context: string;
  plans: string;
  created_at: number;
  updated_at: number;
}

function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    context: JSON.parse(row.context) as ProjectContextEntry[],
    plans: JSON.parse(row.plans) as ProjectPlan[],
  };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export async function listProjects(cwd: string): Promise<ProjectRecord[]> {
  const rows = getDb().query<ProjectRow>(
    'SELECT * FROM projects WHERE project_path = ? ORDER BY updated_at DESC'
  ).all(cwd);
  return rows.map(rowToProject);
}

export async function readProject(cwd: string, id: string): Promise<ProjectRecord | null> {
  const row = getDb().query<ProjectRow>(
    'SELECT * FROM projects WHERE id = ?'
  ).get(id);
  if (!row) return null;
  return rowToProject(row);
}

export async function findProjectByName(cwd: string, name: string): Promise<ProjectRecord | null> {
  const normalized = normalizeName(name);
  const projects = await listProjects(cwd);
  return projects.find((project) => normalizeName(project.name) === normalized) || null;
}

export async function saveProject(cwd: string, project: ProjectRecord): Promise<void> {
  getDb().prepare(
    `INSERT OR REPLACE INTO projects (id, project_path, name, description, context, plans, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    project.id,
    cwd,
    project.name,
    project.description ?? null,
    JSON.stringify(project.context),
    JSON.stringify(project.plans),
    project.createdAt,
    project.updatedAt
  );
}

export async function deleteProject(cwd: string, id: string): Promise<boolean> {
  const result = getDb().prepare(
    'DELETE FROM projects WHERE id = ?'
  ).run(id);
  return result.changes > 0;
}

export async function createProject(
  cwd: string,
  name: string,
  description?: string
): Promise<ProjectRecord> {
  const now = Date.now();
  const project: ProjectRecord = {
    id: generateId(),
    name: name.trim(),
    description: description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    context: [],
    plans: [],
  };
  await saveProject(cwd, project);
  return project;
}

export async function updateProject(
  cwd: string,
  id: string,
  updater: (project: ProjectRecord) => ProjectRecord
): Promise<ProjectRecord | null> {
  const project = await readProject(cwd, id);
  if (!project) return null;
  const updated = updater(project);
  await saveProject(cwd, updated);
  return updated;
}

export async function ensureDefaultProject(cwd: string): Promise<ProjectRecord> {
  const projects = await listProjects(cwd);
  if (projects.length > 0) return projects[0];
  return createProject(cwd, 'default', 'Default project for this folder');
}

export function hasProjectNameConflict(projects: ProjectRecord[], name: string): boolean {
  const normalized = normalizeName(name);
  return projects.some((project) => normalizeName(project.name) === normalized);
}
