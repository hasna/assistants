/**
 * Project and Plan tools for assistant use
 * Native tools that allow assistants to manage projects and implementation plans
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import {
  listProjects,
  readProject,
  findProjectByName,
  createProject,
  updateProject,
  deleteProject,
  hasProjectNameConflict,
  saveProject,
  type ProjectRecord,
  type ProjectPlan,
  type ProjectPlanStep,
  type PlanStepStatus,
} from '../projects/store';
import { generateId } from '@hasna/assistants-shared';

// ==================== PROJECT TOOLS ====================

/**
 * project_list - List all projects
 */
export const projectListTool: Tool = {
  name: 'project_list',
  description: 'List all projects in the current working directory. Returns project names, descriptions, and summary statistics.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * project_get - Get project details
 */
export const projectGetTool: Tool = {
  name: 'project_get',
  description: 'Get detailed information about a specific project, including its context entries and plans.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Project name to retrieve (case-insensitive)',
      },
      id: {
        type: 'string',
        description: 'Project ID to retrieve (alternative to name)',
      },
    },
    required: [],
  },
};

/**
 * project_create - Create a new project
 */
export const projectCreateTool: Tool = {
  name: 'project_create',
  description: 'Create a new project for organizing work, context, and plans.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Project name (must be unique in the workspace)',
      },
      description: {
        type: 'string',
        description: 'Optional project description',
      },
    },
    required: ['name'],
  },
};

/**
 * project_update - Update project metadata
 */
export const projectUpdateTool: Tool = {
  name: 'project_update',
  description: 'Update a project\'s name or description.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Project ID to update',
      },
      name: {
        type: 'string',
        description: 'New project name (optional)',
      },
      description: {
        type: 'string',
        description: 'New project description (optional)',
      },
    },
    required: ['id'],
  },
};

/**
 * project_delete - Delete a project
 */
export const projectDeleteTool: Tool = {
  name: 'project_delete',
  description: 'Delete a project and all its associated data (context entries, plans).',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Project ID to delete',
      },
    },
    required: ['id'],
  },
};

// ==================== PLAN TOOLS ====================

/**
 * plan_list - List plans for a project
 */
export const planListTool: Tool = {
  name: 'plan_list',
  description: 'List all plans for a specific project.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (optional, uses most recent project if not specified)',
      },
    },
    required: [],
  },
};

/**
 * plan_get - Get plan details
 */
export const planGetTool: Tool = {
  name: 'plan_get',
  description: 'Get detailed information about a specific plan, including all steps.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID containing the plan',
      },
      planId: {
        type: 'string',
        description: 'Plan ID to retrieve',
      },
    },
    required: ['projectId', 'planId'],
  },
};

/**
 * plan_create - Create a new plan
 */
export const planCreateTool: Tool = {
  name: 'plan_create',
  description: 'Create a new plan within a project for tracking implementation steps.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID (optional, uses most recent project if not specified)',
      },
      title: {
        type: 'string',
        description: 'Plan title',
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          description: 'A step in the plan',
          properties: {
            text: { type: 'string', description: 'Step description' },
            status: { type: 'string', description: 'Step status: todo, doing, done, blocked' },
          },
          required: ['text'],
        },
        description: 'Optional initial steps to add to the plan',
      },
    },
    required: ['title'],
  },
};

/**
 * plan_add_step - Add a step to a plan
 */
export const planAddStepTool: Tool = {
  name: 'plan_add_step',
  description: 'Add a new step to an existing plan.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID containing the plan',
      },
      planId: {
        type: 'string',
        description: 'Plan ID to add the step to',
      },
      text: {
        type: 'string',
        description: 'Step description',
      },
      status: {
        type: 'string',
        description: 'Initial step status (default: todo)',
        enum: ['todo', 'doing', 'done', 'blocked'],
      },
    },
    required: ['projectId', 'planId', 'text'],
  },
};

/**
 * plan_update_step - Update a step's status or text
 */
export const planUpdateStepTool: Tool = {
  name: 'plan_update_step',
  description: 'Update a plan step\'s status or description.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID containing the plan',
      },
      planId: {
        type: 'string',
        description: 'Plan ID containing the step',
      },
      stepId: {
        type: 'string',
        description: 'Step ID to update',
      },
      text: {
        type: 'string',
        description: 'New step description (optional)',
      },
      status: {
        type: 'string',
        description: 'New step status (optional)',
        enum: ['todo', 'doing', 'done', 'blocked'],
      },
    },
    required: ['projectId', 'planId', 'stepId'],
  },
};

/**
 * plan_remove_step - Remove a step from a plan
 */
export const planRemoveStepTool: Tool = {
  name: 'plan_remove_step',
  description: 'Remove a step from a plan.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID containing the plan',
      },
      planId: {
        type: 'string',
        description: 'Plan ID containing the step',
      },
      stepId: {
        type: 'string',
        description: 'Step ID to remove',
      },
    },
    required: ['projectId', 'planId', 'stepId'],
  },
};

/**
 * plan_delete - Delete a plan
 */
export const planDeleteTool: Tool = {
  name: 'plan_delete',
  description: 'Delete an entire plan from a project.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID containing the plan',
      },
      planId: {
        type: 'string',
        description: 'Plan ID to delete',
      },
    },
    required: ['projectId', 'planId'],
  },
};

// ==================== HELPER FUNCTIONS ====================

function formatProject(project: ProjectRecord): string {
  const lines: string[] = [];
  lines.push(`## ${project.name}`);
  lines.push(`**ID:** ${project.id}`);
  if (project.description) {
    lines.push(`**Description:** ${project.description}`);
  }
  lines.push(`**Created:** ${new Date(project.createdAt).toLocaleString()}`);
  lines.push(`**Updated:** ${new Date(project.updatedAt).toLocaleString()}`);
  lines.push(`**Context Entries:** ${project.context.length}`);
  lines.push(`**Plans:** ${project.plans.length}`);
  return lines.join('\n');
}

function formatProjectSummary(project: ProjectRecord): string {
  const planCount = project.plans.length;
  const contextCount = project.context.length;
  return `- **${project.name}** (ID: ${project.id}) - ${planCount} plan${planCount !== 1 ? 's' : ''}, ${contextCount} context item${contextCount !== 1 ? 's' : ''}`;
}

function formatPlan(plan: ProjectPlan): string {
  const lines: string[] = [];
  lines.push(`## ${plan.title}`);
  lines.push(`**ID:** ${plan.id}`);
  lines.push(`**Created:** ${new Date(plan.createdAt).toLocaleString()}`);
  lines.push(`**Updated:** ${new Date(plan.updatedAt).toLocaleString()}`);
  lines.push('');
  lines.push('### Steps');
  if (plan.steps.length === 0) {
    lines.push('_No steps yet_');
  } else {
    for (const step of plan.steps) {
      const statusEmoji = {
        todo: '⬜',
        doing: '🔄',
        done: '✅',
        blocked: '🚫',
      }[step.status] || '⬜';
      lines.push(`${statusEmoji} [${step.status}] ${step.text} (ID: ${step.id})`);
    }
  }
  return lines.join('\n');
}

function formatPlanSummary(plan: ProjectPlan): string {
  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === 'done').length;
  const doing = plan.steps.filter((s) => s.status === 'doing').length;
  const blocked = plan.steps.filter((s) => s.status === 'blocked').length;
  return `- **${plan.title}** (ID: ${plan.id}) - ${done}/${total} done${doing > 0 ? `, ${doing} in progress` : ''}${blocked > 0 ? `, ${blocked} blocked` : ''}`;
}

function isValidStepStatus(status: unknown): status is PlanStepStatus {
  return typeof status === 'string' && ['todo', 'doing', 'done', 'blocked'].includes(status);
}

// ==================== TOOL EXECUTORS ====================

/**
 * Context provider interface for project tools
 */
export interface ProjectToolContext {
  cwd: string;
}

/**
 * Create executors for project and plan tools
 */
export function createProjectToolExecutors(
  getContext: () => ProjectToolContext
): Record<string, ToolExecutor> {
  return {
    // ==================== PROJECT EXECUTORS ====================

    project_list: async () => {
      const { cwd } = getContext();
      try {
        const projects = await listProjects(cwd);
        if (projects.length === 0) {
          return 'No projects found. Use `project_create` to create a new project.';
        }

        const lines: string[] = [];
        lines.push(`## Projects (${projects.length})`);
        lines.push('');
        for (const project of projects) {
          lines.push(formatProjectSummary(project));
        }
        return lines.join('\n');
      } catch (error) {
        return `Error listing projects: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    project_get: async (input) => {
      const { cwd } = getContext();
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const id = typeof input.id === 'string' ? input.id.trim() : '';

      if (!name && !id) {
        return 'Error: Either project name or ID is required.';
      }

      try {
        let project: ProjectRecord | null = null;
        if (id) {
          project = await readProject(cwd, id);
        } else {
          project = await findProjectByName(cwd, name);
        }

        if (!project) {
          return `Project not found: ${id || name}`;
        }

        const lines: string[] = [];
        lines.push(formatProject(project));

        if (project.plans.length > 0) {
          lines.push('');
          lines.push('### Plans');
          for (const plan of project.plans) {
            lines.push(formatPlanSummary(plan));
          }
        }

        return lines.join('\n');
      } catch (error) {
        return `Error getting project: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    project_create: async (input) => {
      const { cwd } = getContext();
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const description = typeof input.description === 'string' ? input.description.trim() : undefined;

      if (!name) {
        return 'Error: Project name is required.';
      }

      try {
        const projects = await listProjects(cwd);
        if (hasProjectNameConflict(projects, name)) {
          return `Error: A project named "${name}" already exists.`;
        }

        const project = await createProject(cwd, name, description);
        return `Project created successfully.\n\n${formatProject(project)}`;
      } catch (error) {
        return `Error creating project: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    project_update: async (input) => {
      const { cwd } = getContext();
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      const newName = typeof input.name === 'string' ? input.name.trim() : undefined;
      const newDescription = typeof input.description === 'string' ? input.description.trim() : undefined;

      if (!id) {
        return 'Error: Project ID is required.';
      }

      if (!newName && newDescription === undefined) {
        return 'Error: At least one of name or description must be provided.';
      }

      try {
        // Check name conflict if renaming
        if (newName) {
          const projects = await listProjects(cwd);
          const existingWithName = projects.find(
            (p) => p.id !== id && p.name.toLowerCase() === newName.toLowerCase()
          );
          if (existingWithName) {
            return `Error: A project named "${newName}" already exists.`;
          }
        }

        const updated = await updateProject(cwd, id, (project) => ({
          ...project,
          name: newName || project.name,
          description: newDescription !== undefined ? newDescription : project.description,
          updatedAt: Date.now(),
        }));

        if (!updated) {
          return `Project not found: ${id}`;
        }

        return `Project updated successfully.\n\n${formatProject(updated)}`;
      } catch (error) {
        return `Error updating project: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    project_delete: async (input) => {
      const { cwd } = getContext();
      const id = typeof input.id === 'string' ? input.id.trim() : '';

      if (!id) {
        return 'Error: Project ID is required.';
      }

      try {
        const project = await readProject(cwd, id);
        if (!project) {
          return `Project not found: ${id}`;
        }

        const deleted = await deleteProject(cwd, id);
        if (!deleted) {
          return `Error: Could not delete project ${id}`;
        }

        return `Project "${project.name}" (ID: ${id}) deleted successfully.`;
      } catch (error) {
        return `Error deleting project: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    // ==================== PLAN EXECUTORS ====================

    plan_list: async (input) => {
      const { cwd } = getContext();
      let projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';

      try {
        // If no project ID, use most recent project
        if (!projectId) {
          const projects = await listProjects(cwd);
          if (projects.length === 0) {
            return 'No projects found. Create a project first with `project_create`.';
          }
          projectId = projects[0].id;
        }

        const project = await readProject(cwd, projectId);
        if (!project) {
          return `Project not found: ${projectId}`;
        }

        if (project.plans.length === 0) {
          return `No plans found in project "${project.name}". Use \`plan_create\` to create a new plan.`;
        }

        const lines: string[] = [];
        lines.push(`## Plans for ${project.name} (${project.plans.length})`);
        lines.push('');
        for (const plan of project.plans) {
          lines.push(formatPlanSummary(plan));
        }
        return lines.join('\n');
      } catch (error) {
        return `Error listing plans: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    plan_get: async (input) => {
      const { cwd } = getContext();
      const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
      const planId = typeof input.planId === 'string' ? input.planId.trim() : '';

      if (!projectId) {
        return 'Error: Project ID is required.';
      }
      if (!planId) {
        return 'Error: Plan ID is required.';
      }

      try {
        const project = await readProject(cwd, projectId);
        if (!project) {
          return `Project not found: ${projectId}`;
        }

        const plan = project.plans.find((p) => p.id === planId);
        if (!plan) {
          return `Plan not found: ${planId}`;
        }

        return formatPlan(plan);
      } catch (error) {
        return `Error getting plan: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    plan_create: async (input) => {
      const { cwd } = getContext();
      let projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const stepsInput = Array.isArray(input.steps) ? input.steps : [];

      if (!title) {
        return 'Error: Plan title is required.';
      }

      try {
        // If no project ID, use most recent project
        if (!projectId) {
          const projects = await listProjects(cwd);
          if (projects.length === 0) {
            return 'No projects found. Create a project first with `project_create`.';
          }
          projectId = projects[0].id;
        }

        const now = Date.now();
        const steps: ProjectPlanStep[] = stepsInput.map((s: unknown) => {
          const stepObj = s as Record<string, unknown>;
          const text = typeof stepObj.text === 'string' ? stepObj.text.trim() : '';
          const status = isValidStepStatus(stepObj.status) ? stepObj.status : 'todo';
          return {
            id: generateId(),
            text,
            status,
            createdAt: now,
            updatedAt: now,
          };
        }).filter((s) => s.text !== '');

        const plan: ProjectPlan = {
          id: generateId(),
          title,
          createdAt: now,
          updatedAt: now,
          steps,
        };

        const updated = await updateProject(cwd, projectId, (project) => ({
          ...project,
          plans: [...project.plans, plan],
          updatedAt: now,
        }));

        if (!updated) {
          return `Project not found: ${projectId}`;
        }

        return `Plan created successfully in project "${updated.name}".\n\n${formatPlan(plan)}`;
      } catch (error) {
        return `Error creating plan: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    plan_add_step: async (input) => {
      const { cwd } = getContext();
      const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
      const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      const status: PlanStepStatus = isValidStepStatus(input.status) ? input.status : 'todo';

      if (!projectId) {
        return 'Error: Project ID is required.';
      }
      if (!planId) {
        return 'Error: Plan ID is required.';
      }
      if (!text) {
        return 'Error: Step text is required.';
      }

      try {
        const now = Date.now();
        const step: ProjectPlanStep = {
          id: generateId(),
          text,
          status,
          createdAt: now,
          updatedAt: now,
        };

        const updated = await updateProject(cwd, projectId, (project) => ({
          ...project,
          plans: project.plans.map((plan) =>
            plan.id === planId
              ? { ...plan, steps: [...plan.steps, step], updatedAt: now }
              : plan
          ),
          updatedAt: now,
        }));

        if (!updated) {
          return `Project not found: ${projectId}`;
        }

        const plan = updated.plans.find((p) => p.id === planId);
        if (!plan) {
          return `Plan not found: ${planId}`;
        }

        return `Step added successfully to plan "${plan.title}".\n\nStep ID: ${step.id}\nStatus: ${step.status}\nText: ${step.text}`;
      } catch (error) {
        return `Error adding step: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    plan_update_step: async (input) => {
      const { cwd } = getContext();
      const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
      const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
      const stepId = typeof input.stepId === 'string' ? input.stepId.trim() : '';
      const newText = typeof input.text === 'string' ? input.text.trim() : undefined;
      const newStatus = isValidStepStatus(input.status) ? input.status : undefined;

      if (!projectId) {
        return 'Error: Project ID is required.';
      }
      if (!planId) {
        return 'Error: Plan ID is required.';
      }
      if (!stepId) {
        return 'Error: Step ID is required.';
      }
      if (!newText && !newStatus) {
        return 'Error: At least one of text or status must be provided.';
      }

      try {
        const now = Date.now();
        let stepFound = false;

        const updated = await updateProject(cwd, projectId, (project) => ({
          ...project,
          plans: project.plans.map((plan) => {
            if (plan.id !== planId) return plan;
            return {
              ...plan,
              steps: plan.steps.map((step) => {
                if (step.id !== stepId) return step;
                stepFound = true;
                return {
                  ...step,
                  text: newText || step.text,
                  status: newStatus || step.status,
                  updatedAt: now,
                };
              }),
              updatedAt: now,
            };
          }),
          updatedAt: now,
        }));

        if (!updated) {
          return `Project not found: ${projectId}`;
        }

        if (!stepFound) {
          return `Step not found: ${stepId}`;
        }

        const plan = updated.plans.find((p) => p.id === planId);
        const step = plan?.steps.find((s) => s.id === stepId);

        return `Step updated successfully.\n\nStep ID: ${step?.id}\nStatus: ${step?.status}\nText: ${step?.text}`;
      } catch (error) {
        return `Error updating step: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    plan_remove_step: async (input) => {
      const { cwd } = getContext();
      const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
      const planId = typeof input.planId === 'string' ? input.planId.trim() : '';
      const stepId = typeof input.stepId === 'string' ? input.stepId.trim() : '';

      if (!projectId) {
        return 'Error: Project ID is required.';
      }
      if (!planId) {
        return 'Error: Plan ID is required.';
      }
      if (!stepId) {
        return 'Error: Step ID is required.';
      }

      try {
        // First, find the step to get its text before removing
        const project = await readProject(cwd, projectId);
        if (!project) {
          return `Project not found: ${projectId}`;
        }

        const plan = project.plans.find((p) => p.id === planId);
        if (!plan) {
          return `Plan not found: ${planId}`;
        }

        const step = plan.steps.find((s) => s.id === stepId);
        if (!step) {
          return `Step not found: ${stepId}`;
        }

        const stepText = step.text;
        const now = Date.now();

        await updateProject(cwd, projectId, (proj) => ({
          ...proj,
          plans: proj.plans.map((p) => {
            if (p.id !== planId) return p;
            return {
              ...p,
              steps: p.steps.filter((s) => s.id !== stepId),
              updatedAt: now,
            };
          }),
          updatedAt: now,
        }));

        return `Step removed successfully.\n\nRemoved: "${stepText}"`;
      } catch (error) {
        return `Error removing step: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    plan_delete: async (input) => {
      const { cwd } = getContext();
      const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
      const planId = typeof input.planId === 'string' ? input.planId.trim() : '';

      if (!projectId) {
        return 'Error: Project ID is required.';
      }
      if (!planId) {
        return 'Error: Plan ID is required.';
      }

      try {
        // First, find the plan to get its title before removing
        const project = await readProject(cwd, projectId);
        if (!project) {
          return `Project not found: ${projectId}`;
        }

        const plan = project.plans.find((p) => p.id === planId);
        if (!plan) {
          return `Plan not found: ${planId}`;
        }

        const planTitle = plan.title;
        const now = Date.now();

        await updateProject(cwd, projectId, (proj) => ({
          ...proj,
          plans: proj.plans.filter((p) => p.id !== planId),
          updatedAt: now,
        }));

        return `Plan "${planTitle}" deleted successfully.`;
      } catch (error) {
        return `Error deleting plan: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

// ==================== TOOL COLLECTIONS ====================

/**
 * All project tools
 */
export const projectTools: Tool[] = [
  projectListTool,
  projectGetTool,
  projectCreateTool,
  projectUpdateTool,
  projectDeleteTool,
];

/**
 * All plan tools
 */
export const planTools: Tool[] = [
  planListTool,
  planGetTool,
  planCreateTool,
  planAddStepTool,
  planUpdateStepTool,
  planRemoveStepTool,
  planDeleteTool,
];

/**
 * All project and plan tools combined
 */
export const projectAndPlanTools: Tool[] = [...projectTools, ...planTools];

/**
 * Register project and plan tools with a tool registry
 */
export function registerProjectTools(
  registry: ToolRegistry,
  getContext: () => ProjectToolContext
): void {
  const executors = createProjectToolExecutors(getContext);

  for (const tool of projectAndPlanTools) {
    registry.register(tool, executors[tool.name]);
  }
}
