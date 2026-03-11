import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getBoardCard, readProjectContext } from './projectStore.js';
import type { AgentProvider, AgentState, BoardCard } from './types.js';

export interface LaunchPlan {
  command: string;
  displayLabel: string;
  projectDir: string;
  expectedJsonlFile?: string;
}

const HANDOFF_DIR = '.digispace';
const HANDOFF_FILE = 'agent-handoff.md';

function providerLabel(provider: AgentProvider): string {
  switch (provider) {
    case 'codex':
      return 'Codex';
    case 'gemini':
      return 'Gemini';
    case 'claude':
    default:
      return 'Claude';
  }
}

function shellEscapeSingleQuoted(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function shellEscapeDoubleQuoted(text: string): string {
  return `"${text.replace(/"/g, '\\"')}"`;
}

function getClaudeProjectDir(cwd: string): string {
  const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', dirName);
}

function fileExists(cwd: string, relativePath: string): boolean {
  return fs.existsSync(path.join(cwd, relativePath));
}

function summarizeExistingAgents(agents: Map<number, AgentState>, workspaceRoot: string): string[] {
  const lines: string[] = [];
  const sorted = [...agents.values()]
    .filter((agent) => !agent.workspaceRoot || agent.workspaceRoot === workspaceRoot)
    .sort((a, b) => a.id - b.id);
  for (const agent of sorted) {
    const provider = providerLabel(agent.provider ?? 'claude');
    const toolStatuses = [...agent.activeToolStatuses.values()].filter(Boolean);
    const latestStatus = toolStatuses.length > 0 ? toolStatuses[toolStatuses.length - 1] : '';
    lines.push(
      `- Agent #${agent.id} (${provider})${agent.folderName ? ` [${agent.folderName}]` : ''}${
        agent.activeCardId ? ` -> card ${agent.activeCardId}` : ''
      }${latestStatus ? `: ${latestStatus}` : ''}`,
    );
  }
  return lines;
}

function summarizeSelectedCard(card: BoardCard | null): string[] {
  if (!card) {
    return ['- No active card selected in DigiSpace.'];
  }
  return [
    `- Card ID: ${card.id}`,
    `- Title: ${card.title}`,
    `- Status: ${card.status}`,
    `- Priority: ${card.priority}`,
    ...(card.description ? [`- Description: ${card.description}`] : []),
    ...(card.summary ? [`- Latest summary: ${card.summary}`] : []),
    ...(card.sessionRef ? [`- Session ref: ${card.sessionRef}`] : []),
  ];
}

function buildHandoffContent(
  cwd: string,
  provider: AgentProvider,
  agents: Map<number, AgentState>,
  activeCardId?: string | null,
): string {
  const projectFiles = [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    path.join('.digispace', 'context.json'),
    path.join('.digispace', 'kanban.json'),
    path.join('.allmystack', 'project-link.json'),
  ];
  const availableFiles = projectFiles.filter((file) => fileExists(cwd, file));
  const agentSummary = summarizeExistingAgents(agents, cwd);
  const context = readProjectContext(cwd);
  const activeCard = activeCardId ? getBoardCard(cwd, activeCardId) : null;
  const lines = [
    '# DigiSpace Agent Handoff',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Requested provider: ${providerLabel(provider)}`,
    `Workspace: ${cwd}`,
    '',
    '## Read First',
    ...availableFiles.map((file) => `- ${file}`),
    ...(availableFiles.length === 0
      ? ['- No project instruction files detected in workspace root']
      : []),
    '',
    '## Project Context',
    `- Project: ${context.projectName}`,
    ...(context.clientName ? [`- Client: ${context.clientName}`] : []),
    ...(context.partnerName ? [`- Partner: ${context.partnerName}`] : []),
    ...(context.projectId ? [`- Project ID: ${context.projectId}`] : []),
    '',
    '## Selected Card',
    ...summarizeSelectedCard(activeCard),
    '',
    '## Prior Agent State',
    ...(agentSummary.length > 0
      ? agentSummary
      : ['- No prior DigiSpace-managed agents recorded in this window']),
    '',
    '## Intent',
    '- Continue the current project context instead of restarting discovery.',
    '- Treat existing project instruction files, DigiSpace board state, and AllMyStack metadata as authoritative.',
    '- If a selected card exists, use it as the current task.',
  ];
  return lines.join('\n') + '\n';
}

function ensureHandoffFile(
  cwd: string,
  provider: AgentProvider,
  agents: Map<number, AgentState>,
  activeCardId?: string | null,
): string {
  const handoffDir = path.join(cwd, HANDOFF_DIR);
  fs.mkdirSync(handoffDir, { recursive: true });
  const handoffPath = path.join(handoffDir, HANDOFF_FILE);
  fs.writeFileSync(handoffPath, buildHandoffContent(cwd, provider, agents, activeCardId), 'utf-8');
  return handoffPath;
}

function buildPrompt(
  provider: AgentProvider,
  handoffPath: string,
  activeCardId?: string | null,
): string {
  const providerFile =
    provider === 'claude' ? 'CLAUDE.md' : provider === 'gemini' ? 'GEMINI.md' : 'AGENTS.md';
  const handoffRef = path.join(HANDOFF_DIR, path.basename(handoffPath)).replace(/\\/g, '/');
  return [
    'Continue this project using the existing workspace context.',
    `First read ${providerFile} if it exists.`,
    'Then read .digispace/context.json and .digispace/kanban.json if they exist.',
    `Then read ${handoffRef}.`,
    'If .allmystack/project-link.json exists, use it as project metadata.',
    ...(activeCardId ? [`Treat DigiSpace card ${activeCardId} as your current task.`] : []),
    'Do not restart discovery from scratch.',
  ].join(' ');
}

export function createLaunchPlan(
  provider: AgentProvider,
  cwd: string,
  agents: Map<number, AgentState>,
  folderName?: string,
  activeCardId?: string | null,
): LaunchPlan {
  const label = providerLabel(provider);
  const displayLabel = folderName ? `${label} - ${folderName}` : label;
  const handoffPath = ensureHandoffFile(cwd, provider, agents, activeCardId);
  const prompt = buildPrompt(provider, handoffPath, activeCardId);

  if (provider === 'claude') {
    const sessionId = crypto.randomUUID();
    return {
      command: `claude --session-id ${sessionId} ${shellEscapeSingleQuoted(prompt)}`,
      displayLabel,
      projectDir: getClaudeProjectDir(cwd),
      expectedJsonlFile: path.join(getClaudeProjectDir(cwd), `${sessionId}.jsonl`),
    };
  }

  if (provider === 'codex') {
    return {
      command: `codex ${shellEscapeDoubleQuoted(prompt)}`,
      displayLabel,
      projectDir: cwd,
    };
  }

  return {
    command: `gemini -i ${shellEscapeDoubleQuoted(prompt)}`,
    displayLabel,
    projectDir: cwd,
  };
}

export function terminalNameForProvider(provider: AgentProvider, terminalIndex: number): string {
  return `${providerLabel(provider)} #${terminalIndex}`;
}
