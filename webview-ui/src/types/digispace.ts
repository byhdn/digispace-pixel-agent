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

export interface AgentDetail {
  provider?: AgentProvider;
  workspaceRoot?: string;
  activeCardId?: string | null;
  sessionRef?: string | null;
  lastSummaryAt?: string | null;
  status?: 'active' | 'waiting' | 'blocked' | 'review' | 'done';
}
