import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type {
  AgentProvider,
  BoardCard,
  BoardCardPriority,
  BoardCardStatus,
  BoardState,
  JournalEntry,
  ProjectContextState,
} from './types.js';

const DIGISPACE_DIR = '.digispace';
const BOARD_FILE = 'kanban.json';
const CONTEXT_FILE = 'context.json';
const JOURNAL_FILE = 'journal.ndjson';
const HANDOFF_FILE = 'agent-handoff.md';
const SESSIONS_DIR = 'sessions';
const LAYOUT_FILE = 'layout.json';
const BOARD_WATCH_POLL_MS = 1500;
const DIGISPACE_EXCLUDE_ENTRY = '.digispace/';

const DEFAULT_COLUMNS: BoardState['columns'] = [
  { id: 'inbox', title: 'Inbox' },
  { id: 'ready', title: 'Ready' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'blocked', title: 'Blocked' },
  { id: 'done', title: 'Done' },
];

const ALLOWED_TRANSITIONS: Record<BoardCardStatus, BoardCardStatus[]> = {
  inbox: ['ready'],
  ready: ['in_progress'],
  in_progress: ['review', 'blocked'],
  review: ['in_progress', 'done', 'blocked'],
  blocked: ['ready', 'in_progress'],
  done: [],
  archived: [],
};

export interface ProjectStorePaths {
  workspaceRoot: string;
  digispaceDir: string;
  boardPath: string;
  contextPath: string;
  journalPath: string;
  handoffPath: string;
  sessionsDir: string;
  layoutFile: string;
}

export interface FileBackedWatcher {
  markOwnWrite?(): void;
  dispose(): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function workspaceProjectName(workspaceRoot: string): string {
  return path.basename(workspaceRoot);
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizePriority(value: unknown): BoardCardPriority {
  return value === 'low' || value === 'high' || value === 'urgent' ? value : 'medium';
}

function normalizeStatus(value: unknown): BoardCardStatus {
  switch (value) {
    case 'inbox':
    case 'ready':
    case 'in_progress':
    case 'review':
    case 'blocked':
    case 'done':
    case 'archived':
      return value;
    default:
      return 'inbox';
  }
}

function normalizeCard(workspaceRoot: string, card: Partial<BoardCard>): BoardCard {
  const createdAt = typeof card.createdAt === 'string' ? card.createdAt : nowIso();
  const updatedAt = typeof card.updatedAt === 'string' ? card.updatedAt : createdAt;
  return {
    id: typeof card.id === 'string' && card.id ? card.id : crypto.randomUUID(),
    title:
      typeof card.title === 'string' && card.title.trim() ? card.title.trim() : 'Untitled card',
    description: typeof card.description === 'string' ? card.description : '',
    status: normalizeStatus(card.status),
    priority: normalizePriority(card.priority),
    ownerProvider: card.ownerProvider,
    ownerAgentId: typeof card.ownerAgentId === 'number' ? card.ownerAgentId : null,
    labels: Array.isArray(card.labels)
      ? card.labels.filter(
          (label): label is string => typeof label === 'string' && label.trim().length > 0,
        )
      : [],
    links: Array.isArray(card.links)
      ? card.links.filter(
          (link): link is { label: string; href: string } =>
            !!link && typeof link.label === 'string' && typeof link.href === 'string',
        )
      : [],
    source: card.source === 'agent' || card.source === 'import' ? card.source : 'ui',
    workspaceRoot,
    sessionRef: typeof card.sessionRef === 'string' ? card.sessionRef : null,
    summary: typeof card.summary === 'string' ? card.summary : null,
    createdAt,
    updatedAt,
    archivedAt: typeof card.archivedAt === 'string' ? card.archivedAt : null,
  };
}

function findGitRoot(workspaceRoot: string): string | null {
  let current = workspaceRoot;
  while (true) {
    const gitDir = path.join(current, '.git');
    if (fs.existsSync(gitDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function ensureGitExclude(workspaceRoot: string): string | null {
  const gitRoot = findGitRoot(workspaceRoot);
  if (!gitRoot) return null;
  const gitMetaDir = resolveGitMetadataDir(gitRoot);
  if (!gitMetaDir) return gitRoot;
  const excludePath = path.join(gitMetaDir, 'info', 'exclude');
  try {
    const current = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf-8') : '';
    const lines = current.split(/\r?\n/).map((line) => line.trim());
    if (!lines.includes(DIGISPACE_EXCLUDE_ENTRY)) {
      const next = current.endsWith('\n') || current.length === 0 ? current : `${current}\n`;
      fs.mkdirSync(path.dirname(excludePath), { recursive: true });
      fs.writeFileSync(excludePath, `${next}${DIGISPACE_EXCLUDE_ENTRY}\n`, 'utf-8');
    }
  } catch (err) {
    console.error('[DigiSpace] Failed to update .git/info/exclude:', err);
  }
  return gitRoot;
}

function defaultBoard(workspaceRoot: string): BoardState {
  return {
    version: 1,
    workspaceRoot,
    columns: DEFAULT_COLUMNS,
    cards: [],
    selectedCardId: null,
    updatedAt: nowIso(),
  };
}

function projectLinkData(workspaceRoot: string): {
  projectLinkPath?: string;
  link?: Record<string, unknown>;
} {
  const projectLinkPath = path.join(workspaceRoot, '.allmystack', 'project-link.json');
  const link = readJsonFile<Record<string, unknown>>(projectLinkPath) ?? undefined;
  return { projectLinkPath: fs.existsSync(projectLinkPath) ? projectLinkPath : undefined, link };
}

function defaultContext(workspaceRoot: string): ProjectContextState {
  const gitRepoRoot = ensureGitExclude(workspaceRoot);
  const providerInstructionFiles = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].filter((file) =>
    fs.existsSync(path.join(workspaceRoot, file)),
  );
  const { projectLinkPath, link } = projectLinkData(workspaceRoot);
  const clientRecord =
    link && typeof link.client === 'object' && link.client
      ? (link.client as Record<string, unknown>)
      : undefined;
  const partnerRecord =
    link && typeof link.partner === 'object' && link.partner
      ? (link.partner as Record<string, unknown>)
      : undefined;

  return {
    version: 1,
    workspaceRoot,
    projectName:
      (typeof link?.project_name === 'string' && link.project_name.trim()) ||
      workspaceProjectName(workspaceRoot),
    projectLinkPath: projectLinkPath ?? null,
    clientName:
      (typeof clientRecord?.name === 'string' && clientRecord.name) ||
      (typeof link?.client_name === 'string' ? link.client_name : null),
    partnerName:
      (typeof partnerRecord?.name === 'string' && partnerRecord.name) ||
      (typeof link?.partner_name === 'string' ? link.partner_name : null),
    projectId: typeof link?.project_id === 'string' ? link.project_id : null,
    providerInstructionFiles,
    gitRepoRoot,
    rules: {
      localFirst: true,
      autonomousControlled: true,
    },
    updatedAt: nowIso(),
  };
}

export function getProjectStorePaths(workspaceRoot: string): ProjectStorePaths {
  const digispaceDir = path.join(workspaceRoot, DIGISPACE_DIR);
  return {
    workspaceRoot,
    digispaceDir,
    boardPath: path.join(digispaceDir, BOARD_FILE),
    contextPath: path.join(digispaceDir, CONTEXT_FILE),
    journalPath: path.join(digispaceDir, JOURNAL_FILE),
    handoffPath: path.join(digispaceDir, HANDOFF_FILE),
    sessionsDir: path.join(digispaceDir, SESSIONS_DIR),
    layoutFile: path.join(digispaceDir, LAYOUT_FILE),
  };
}

export function getProjectPaths(workspaceRoot: string): ProjectStorePaths {
  return getProjectStorePaths(workspaceRoot);
}

export function getPrimaryWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

export function ensureProjectStore(workspaceRoot: string): {
  board: BoardState;
  context: ProjectContextState;
  paths: ProjectStorePaths;
} {
  const paths = getProjectStorePaths(workspaceRoot);
  fs.mkdirSync(paths.digispaceDir, { recursive: true });
  fs.mkdirSync(paths.sessionsDir, { recursive: true });

  const board = readBoardState(workspaceRoot) ?? defaultBoard(workspaceRoot);
  atomicWriteJson(paths.boardPath, board);

  const context = defaultContext(workspaceRoot);
  atomicWriteJson(paths.contextPath, context);

  if (!fs.existsSync(paths.journalPath)) {
    fs.writeFileSync(paths.journalPath, '', 'utf-8');
  }

  return { board, context, paths };
}

export function migrateLegacyLayoutToWorkspace(_workspaceRoot: string): void {
  // Layout persistence already writes to the workspace-local .digispace folder.
  // This hook remains to preserve compatibility with existing call sites.
}

export function syncProjectContext(workspaceRoot: string): ProjectContextState {
  const paths = getProjectStorePaths(workspaceRoot);
  const context = defaultContext(workspaceRoot);
  atomicWriteJson(paths.contextPath, context);
  return context;
}

export function readBoardState(workspaceRoot: string): BoardState | null {
  const paths = getProjectStorePaths(workspaceRoot);
  const parsed = readJsonFile<BoardState>(paths.boardPath);
  if (!parsed) return null;
  const cards = Array.isArray(parsed.cards)
    ? parsed.cards.map((card) => normalizeCard(workspaceRoot, card))
    : [];
  return {
    version: 1,
    workspaceRoot,
    columns:
      Array.isArray(parsed.columns) && parsed.columns.length > 0 ? parsed.columns : DEFAULT_COLUMNS,
    cards,
    selectedCardId: typeof parsed.selectedCardId === 'string' ? parsed.selectedCardId : null,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
  };
}

export function writeBoardState(workspaceRoot: string, board: BoardState): BoardState {
  const paths = getProjectStorePaths(workspaceRoot);
  const normalized: BoardState = {
    ...board,
    version: 1,
    workspaceRoot,
    cards: board.cards.map((card) => normalizeCard(workspaceRoot, card)),
    updatedAt: nowIso(),
  };
  atomicWriteJson(paths.boardPath, normalized);
  return normalized;
}

export function readProjectContext(workspaceRoot: string): ProjectContextState {
  const ensured = ensureProjectStore(workspaceRoot);
  const fromDisk = readJsonFile<ProjectContextState>(ensured.paths.contextPath);
  if (!fromDisk) return ensured.context;
  return {
    ...ensured.context,
    ...fromDisk,
    version: 1,
    workspaceRoot,
    providerInstructionFiles: ensured.context.providerInstructionFiles,
    projectLinkPath: ensured.context.projectLinkPath,
    gitRepoRoot: ensured.context.gitRepoRoot,
    updatedAt: nowIso(),
  };
}

export function appendJournalEntry(
  workspaceRoot: string,
  entry: Omit<JournalEntry, 'timestamp' | 'workspaceRoot'>,
): JournalEntry {
  const paths = getProjectStorePaths(workspaceRoot);
  fs.mkdirSync(paths.digispaceDir, { recursive: true });
  const record: JournalEntry = {
    timestamp: nowIso(),
    workspaceRoot,
    ...entry,
  };
  fs.appendFileSync(paths.journalPath, `${JSON.stringify(record)}\n`, 'utf-8');
  return record;
}

export function updateBoardState(
  workspaceRoot: string,
  updater: (board: BoardState) => BoardState,
): BoardState {
  const current = readBoardState(workspaceRoot) ?? defaultBoard(workspaceRoot);
  const next = updater(current);
  return writeBoardState(workspaceRoot, next);
}

export function createBoardCard(
  workspaceRoot: string,
  input: Pick<BoardCard, 'title' | 'description'> &
    Partial<Pick<BoardCard, 'priority' | 'labels' | 'links' | 'source' | 'status'>>,
): BoardState {
  return updateBoardState(workspaceRoot, (board) => {
    const createdAt = nowIso();
    const card = normalizeCard(workspaceRoot, {
      id: crypto.randomUUID(),
      title: input.title,
      description: input.description,
      priority: input.priority,
      labels: input.labels,
      links: input.links,
      source: input.source ?? 'ui',
      status: input.status ?? 'inbox',
      createdAt,
      updatedAt: createdAt,
    });
    return {
      ...board,
      cards: [...board.cards, card],
      selectedCardId: card.id,
      updatedAt: createdAt,
    };
  });
}

export function updateBoardCard(
  workspaceRoot: string,
  cardId: string,
  patch: Partial<
    Pick<
      BoardCard,
      'title' | 'description' | 'priority' | 'labels' | 'links' | 'summary' | 'sessionRef'
    >
  >,
): BoardState {
  return updateBoardState(workspaceRoot, (board) => ({
    ...board,
    cards: board.cards.map((card) =>
      card.id === cardId
        ? normalizeCard(workspaceRoot, {
            ...card,
            ...patch,
            updatedAt: nowIso(),
          })
        : card,
    ),
  }));
}

export function moveBoardCard(
  workspaceRoot: string,
  cardId: string,
  nextStatus: BoardCardStatus,
): BoardState {
  return updateBoardState(workspaceRoot, (board) => ({
    ...board,
    cards: board.cards.map((card) => {
      if (card.id !== cardId) return card;
      if (card.status === nextStatus) return card;
      if (!(ALLOWED_TRANSITIONS[card.status] || []).includes(nextStatus)) {
        throw new Error(`Invalid board transition: ${card.status} -> ${nextStatus}`);
      }
      if (nextStatus === 'done' && (!card.summary || !card.sessionRef)) {
        throw new Error('A card needs a summary and session ref before moving to done.');
      }
      return normalizeCard(workspaceRoot, {
        ...card,
        status: nextStatus,
        updatedAt: nowIso(),
      });
    }),
  }));
}

export function archiveBoardCard(workspaceRoot: string, cardId: string): BoardState {
  return updateBoardState(workspaceRoot, (board) => ({
    ...board,
    cards: board.cards.map((card) =>
      card.id === cardId
        ? normalizeCard(workspaceRoot, {
            ...card,
            status: 'archived',
            archivedAt: nowIso(),
            updatedAt: nowIso(),
          })
        : card,
    ),
    selectedCardId: board.selectedCardId === cardId ? null : board.selectedCardId,
  }));
}

export function selectBoardCard(workspaceRoot: string, cardId: string | null): BoardState {
  return updateBoardState(workspaceRoot, (board) => ({
    ...board,
    selectedCardId: cardId,
  }));
}

export function assignCardToAgent(
  workspaceRoot: string,
  cardId: string,
  provider: AgentProvider | undefined,
  agentId: number | null,
): BoardState {
  return updateBoardState(workspaceRoot, (board) => ({
    ...board,
    cards: board.cards.map((card) =>
      card.id === cardId
        ? normalizeCard(workspaceRoot, {
            ...card,
            ownerProvider: provider,
            ownerAgentId: agentId,
            status:
              card.status === 'ready' || card.status === 'inbox' ? 'in_progress' : card.status,
            updatedAt: nowIso(),
          })
        : card,
    ),
    selectedCardId: cardId,
  }));
}

export function getBoardCard(workspaceRoot: string, cardId: string): BoardCard | null {
  const board = readBoardState(workspaceRoot);
  return board?.cards.find((card) => card.id === cardId) ?? null;
}

export function watchBoardState(
  workspaceRoot: string,
  onChange: (board: BoardState) => void,
): FileBackedWatcher {
  const { boardPath } = getProjectStorePaths(workspaceRoot);
  let fsWatcher: fs.FSWatcher | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastMtime = 0;
  let disposed = false;

  const apply = () => {
    if (disposed) return;
    try {
      if (!fs.existsSync(boardPath)) return;
      const stat = fs.statSync(boardPath);
      if (stat.mtimeMs <= lastMtime) return;
      lastMtime = stat.mtimeMs;
      const board = readBoardState(workspaceRoot);
      if (board) {
        onChange(board);
      }
    } catch (err) {
      console.error('[DigiSpace] Failed to refresh board state:', err);
    }
  };

  try {
    fsWatcher = fs.watch(path.dirname(boardPath), (_event, filename) => {
      if (!filename) return;
      if (path.basename(filename.toString()) !== BOARD_FILE) return;
      apply();
    });
  } catch {
    /* ignore */
  }

  pollTimer = setInterval(apply, BOARD_WATCH_POLL_MS);

  return {
    dispose(): void {
      disposed = true;
      fsWatcher?.close();
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    },
  };
}

export function watchProjectState(
  workspaceRoot: string,
  onChange: (payload: { board: BoardState; context: ProjectContextState }) => void,
): FileBackedWatcher {
  const { digispaceDir } = getProjectStorePaths(workspaceRoot);
  let fsWatcher: fs.FSWatcher | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastFingerprint = '';
  let skipNext = false;
  let disposed = false;

  const fingerprint = (): string => {
    return [BOARD_FILE, CONTEXT_FILE, JOURNAL_FILE]
      .map((name) => {
        const filePath = path.join(digispaceDir, name);
        try {
          const stat = fs.statSync(filePath);
          return `${name}:${stat.mtimeMs}:${stat.size}`;
        } catch {
          return `${name}:missing`;
        }
      })
      .join('|');
  };

  const apply = (): void => {
    if (disposed) return;
    const next = fingerprint();
    if (next === lastFingerprint) return;
    lastFingerprint = next;
    if (skipNext) {
      skipNext = false;
      return;
    }
    const board = readBoardState(workspaceRoot) ?? defaultBoard(workspaceRoot);
    const context = readProjectContext(workspaceRoot);
    onChange({ board, context });
  };

  try {
    fsWatcher = fs.watch(digispaceDir, apply);
  } catch {
    /* ignore */
  }

  pollTimer = setInterval(apply, BOARD_WATCH_POLL_MS);
  lastFingerprint = fingerprint();

  return {
    markOwnWrite(): void {
      skipNext = true;
      lastFingerprint = fingerprint();
    },
    dispose(): void {
      disposed = true;
      fsWatcher?.close();
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    },
  };
}

export function createSessionSummary(
  workspaceRoot: string,
  provider: AgentProvider | undefined,
  title: string,
  summary: string,
  cardId?: string | null,
): { filePath: string; sessionRef: string } {
  const { sessionsDir } = getProjectStorePaths(workspaceRoot);
  fs.mkdirSync(sessionsDir, { recursive: true });
  const stamp = nowIso().replace(/[:.]/g, '-');
  const providerName = provider ?? 'agent';
  const filename = `${providerName}-${stamp}.md`;
  const filePath = path.join(sessionsDir, filename);
  const content = [
    `# ${title || 'Session Summary'}`,
    '',
    `- Generated: ${nowIso()}`,
    `- Provider: ${providerName}`,
    ...(cardId ? [`- Card: ${cardId}`] : []),
    '',
    summary.trim(),
    '',
  ].join('\n');
  fs.writeFileSync(filePath, content, 'utf-8');
  return {
    filePath,
    sessionRef: `${DIGISPACE_DIR}/${SESSIONS_DIR}/${filename}`,
  };
}

function resolveGitMetadataDir(gitRoot: string): string | null {
  const dotGit = path.join(gitRoot, '.git');
  if (!fs.existsSync(dotGit)) return null;
  const stat = fs.statSync(dotGit);
  if (stat.isDirectory()) {
    return dotGit;
  }
  if (stat.isFile()) {
    try {
      const raw = fs.readFileSync(dotGit, 'utf-8').trim();
      if (raw.toLowerCase().startsWith('gitdir:')) {
        return path.resolve(gitRoot, raw.slice('gitdir:'.length).trim());
      }
    } catch {
      return null;
    }
  }
  return null;
}
