import type * as vscode from 'vscode';

export type AgentProvider = 'claude' | 'codex' | 'gemini';
export type BoardCardStatus =
  | 'inbox'
  | 'ready'
  | 'in_progress'
  | 'review'
  | 'blocked'
  | 'done'
  | 'archived';
export type BoardCardPriority = 'low' | 'medium' | 'high' | 'urgent';
export type AgentLifecycleStatus = 'active' | 'waiting' | 'blocked' | 'review' | 'done';

export interface AgentState {
  id: number;
  terminalRef?: vscode.Terminal;
  agentKind?: 'terminal' | 'external';
  externalKey?: string;
  provider?: AgentProvider;
  workspaceRoot?: string;
  activeCardId?: string | null;
  sessionRef?: string | null;
  lastSummaryAt?: string | null;
  status?: AgentLifecycleStatus;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}

export interface PersistedAgent {
  id: number;
  terminalName: string;
  jsonlFile: string;
  projectDir: string;
  provider?: AgentProvider;
  workspaceRoot?: string;
  activeCardId?: string | null;
  sessionRef?: string | null;
  lastSummaryAt?: string | null;
  status?: AgentLifecycleStatus;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
}

export interface BoardCardLink {
  label: string;
  href: string;
}

export interface BoardCard {
  id: string;
  title: string;
  description: string;
  status: BoardCardStatus;
  priority: BoardCardPriority;
  ownerProvider?: AgentProvider;
  ownerAgentId?: number | null;
  labels: string[];
  links: BoardCardLink[];
  source: 'ui' | 'agent' | 'import';
  workspaceRoot: string;
  sessionRef?: string | null;
  summary?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface BoardColumn {
  id: Exclude<BoardCardStatus, 'archived'>;
  title: string;
}

export interface BoardState {
  version: 1;
  workspaceRoot: string;
  columns: BoardColumn[];
  cards: BoardCard[];
  selectedCardId?: string | null;
  updatedAt: string;
}

export interface ProjectContextState {
  version: 1;
  workspaceRoot: string;
  projectName: string;
  projectLinkPath?: string | null;
  clientName?: string | null;
  partnerName?: string | null;
  projectId?: string | null;
  providerInstructionFiles: string[];
  gitRepoRoot?: string | null;
  rules: {
    localFirst: true;
    autonomousControlled: true;
  };
  updatedAt: string;
}

export interface JournalEntry {
  timestamp: string;
  actorType: 'ui' | 'agent' | 'system';
  actorName: string;
  action: string;
  workspaceRoot: string;
  cardId?: string | null;
  agentId?: number | null;
  provider?: AgentProvider;
  message?: string;
  metadata?: Record<string, unknown>;
}
