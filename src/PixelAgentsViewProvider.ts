import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  getProjectDirPath,
  launchNewTerminal,
  persistAgents,
  removeAgent,
  restoreAgents,
  sendExistingAgents,
  sendLayout,
} from './agentManager.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadWallTiles,
  sendAssetsToWebview,
  sendCharacterSpritesToWebview,
  sendFloorTilesToWebview,
  sendWallTilesToWebview,
} from './assetLoader.js';
import {
  COMMAND_EXPORT_DEFAULT_LAYOUT,
  GLOBAL_KEY_SOUND_ENABLED,
  VIEW_ID,
  WORKSPACE_KEY_AGENT_SEATS,
} from './constants.js';
import {
  createExternalBridgeState,
  disposeExternalBridge,
  startExternalBridge,
} from './externalAgentBridge.js';
import { ensureProjectScan } from './fileWatcher.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { readLayoutFromFile, watchLayoutFile, writeLayoutToFile } from './layoutPersistence.js';
import type { FileBackedWatcher } from './projectStore.js';
import {
  appendJournalEntry,
  archiveBoardCard,
  assignCardToAgent,
  createBoardCard,
  createSessionSummary,
  ensureProjectStore,
  getBoardCard,
  getPrimaryWorkspaceRoot,
  moveBoardCard,
  readBoardState,
  readProjectContext,
  selectBoardCard,
  syncProjectContext,
  updateBoardCard,
  watchProjectState,
} from './projectStore.js';
import type { AgentLifecycleStatus, AgentProvider, AgentState, BoardCardStatus } from './types.js';

export class PixelAgentsViewProvider implements vscode.WebviewViewProvider {
  nextAgentId = { current: 1 };
  nextTerminalIndex = { current: 1 };
  agents = new Map<number, AgentState>();
  webviewView: vscode.WebviewView | undefined;

  // Per-agent timers
  fileWatchers = new Map<number, fs.FSWatcher>();
  pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();
  permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

  // /clear detection: project-level scan for new JSONL files
  activeAgentId = { current: null as number | null };
  knownJsonlFiles = new Set<string>();
  projectScanTimer = { current: null as ReturnType<typeof setInterval> | null };

  // Bundled default layout (loaded from assets/default-layout.json)
  defaultLayout: Record<string, unknown> | null = null;

  // Cross-window layout sync
  layoutWatcher: LayoutWatcher | null = null;
  boardWatcher: FileBackedWatcher | null = null;
  activeWorkspaceRoot = { current: null as string | null };
  selectedCardId = { current: null as string | null };
  externalBridge = createExternalBridgeState();

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get extensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  private get webview(): vscode.Webview | undefined {
    return this.webviewView?.webview;
  }

  private persistAgents = (): void => {
    persistAgents(this.agents, this.context);
  };

  private getCurrentWorkspaceRoot(): string | null {
    return this.activeWorkspaceRoot.current || getPrimaryWorkspaceRoot();
  }

  private pushBoardState(workspaceRoot: string): void {
    const board = readBoardState(workspaceRoot);
    if (!board) return;
    this.selectedCardId.current =
      typeof board.selectedCardId === 'string' ? board.selectedCardId : null;
    this.webview?.postMessage({ type: 'boardLoaded', board });
  }

  private pushContextState(workspaceRoot: string): void {
    const context = readProjectContext(workspaceRoot);
    this.webview?.postMessage({ type: 'contextLoaded', context });
  }

  private loadProjectWorkspace(workspaceRoot: string): void {
    this.activeWorkspaceRoot.current = workspaceRoot;
    ensureProjectStore(workspaceRoot);
    syncProjectContext(workspaceRoot);
    this.pushBoardState(workspaceRoot);
    this.pushContextState(workspaceRoot);
    this.startBoardWatcher(workspaceRoot);
  }

  private startBoardWatcher(workspaceRoot: string): void {
    this.boardWatcher?.dispose();
    this.boardWatcher = watchProjectState(workspaceRoot, ({ board, context }) => {
      this.selectedCardId.current =
        typeof board.selectedCardId === 'string' ? board.selectedCardId : null;
      this.webview?.postMessage({ type: 'boardUpdated', board });
      this.webview?.postMessage({ type: 'contextLoaded', context });
    });
  }

  private appendBoardJournal(
    action: string,
    actorName: string,
    metadata?: Record<string, unknown>,
    cardId?: string | null,
    agentId?: number | null,
    provider?: AgentProvider,
  ): void {
    const workspaceRoot = this.getCurrentWorkspaceRoot();
    if (!workspaceRoot) return;
    appendJournalEntry(workspaceRoot, {
      actorType: agentId ? 'agent' : 'ui',
      actorName,
      action,
      cardId,
      agentId,
      provider,
      metadata,
      message: typeof metadata?.message === 'string' ? metadata.message : undefined,
    });
  }

  private mapCardStatusToAgentStatus(status: BoardCardStatus): AgentLifecycleStatus {
    switch (status) {
      case 'blocked':
        return 'blocked';
      case 'review':
        return 'review';
      case 'done':
        return 'done';
      case 'in_progress':
        return 'active';
      default:
        return 'waiting';
    }
  }

  private updateAgentLifecycle(agentId: number, status: AgentLifecycleStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.status = status;
    this.persistAgents();
    this.webview?.postMessage({ type: 'agentStatus', id: agentId, status });
    sendExistingAgents(this.agents, this.context, this.webview);
  }

  private syncAssignedAgentStatus(workspaceRoot: string, cardId: string): void {
    const card = getBoardCard(workspaceRoot, cardId);
    if (!card || typeof card.ownerAgentId !== 'number') return;
    this.updateAgentLifecycle(card.ownerAgentId, this.mapCardStatusToAgentStatus(card.status));
  }

  private async pickAgentProvider(): Promise<AgentProvider | undefined> {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: 'Claude',
          description: 'Claude Code with full DigiSpace telemetry',
          provider: 'claude' as const,
        },
        {
          label: 'Codex',
          description: 'OpenAI Codex with project handoff context',
          provider: 'codex' as const,
        },
        {
          label: 'Gemini',
          description: 'Gemini CLI with project handoff context',
          provider: 'gemini' as const,
        },
      ],
      {
        placeHolder: 'Select the agent provider to launch',
        ignoreFocusOut: true,
      },
    );
    return choice?.provider;
  }

  private async pickWorkspaceFolder(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return undefined;
    }
    if (folders.length === 1) {
      return folders[0].uri.fsPath;
    }
    const choice = await vscode.window.showQuickPick(
      folders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        path: folder.uri.fsPath,
      })),
      {
        placeHolder: 'Select the workspace folder for this agent',
        ignoreFocusOut: true,
      },
    );
    return choice?.path;
  }

  private async launchProviderAgent(folderPath?: string): Promise<void> {
    const provider = await this.pickAgentProvider();
    if (!provider) {
      return;
    }
    const resolvedFolderPath = folderPath || (await this.pickWorkspaceFolder());
    if (!resolvedFolderPath) {
      vscode.window.showWarningMessage('DigiSpace: No workspace folder selected for agent launch.');
      return;
    }
    this.loadProjectWorkspace(resolvedFolderPath);
    await launchNewTerminal(
      provider,
      this.nextAgentId,
      this.nextTerminalIndex,
      this.agents,
      this.activeAgentId,
      this.knownJsonlFiles,
      this.fileWatchers,
      this.pollingTimers,
      this.waitingTimers,
      this.permissionTimers,
      this.jsonlPollTimers,
      this.projectScanTimer,
      this.webview,
      this.persistAgents,
      resolvedFolderPath,
      this.selectedCardId.current,
    );
    const newestAgentId = this.nextAgentId.current - 1;
    const linkedCardId = this.selectedCardId.current;
    if (linkedCardId) {
      assignCardToAgent(resolvedFolderPath, linkedCardId, provider, newestAgentId);
      const agent = this.agents.get(newestAgentId);
      if (agent) {
        agent.activeCardId = linkedCardId;
        agent.workspaceRoot = resolvedFolderPath;
        agent.status = 'active';
      }
      this.appendBoardJournal(
        'card.assigned',
        provider,
        { message: `Assigned card ${linkedCardId} to ${provider} agent ${newestAgentId}` },
        linkedCardId,
        newestAgentId,
        provider,
      );
      this.pushBoardState(resolvedFolderPath);
      this.syncAssignedAgentStatus(resolvedFolderPath, linkedCardId);
    }
  }

  async focusBoard(): Promise<void> {
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    this.webview?.postMessage({ type: 'uiTabSelected', tab: 'board' });
  }

  async createCardFromCommand(): Promise<void> {
    const workspaceRoot = this.getCurrentWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('DigiSpace: No workspace folder available.');
      return;
    }
    this.loadProjectWorkspace(workspaceRoot);
    const title = await vscode.window.showInputBox({
      prompt: 'Card title',
      placeHolder: 'Implement local board sync',
      ignoreFocusOut: true,
    });
    if (!title?.trim()) return;
    const description = await vscode.window.showInputBox({
      prompt: 'Card description',
      placeHolder: 'Optional description',
      ignoreFocusOut: true,
    });
    const board = createBoardCard(workspaceRoot, {
      title: title.trim(),
      description: description?.trim() ?? '',
      source: 'ui',
      status: 'inbox',
    });
    this.selectedCardId.current = board.selectedCardId ?? null;
    this.appendBoardJournal(
      'card.created',
      'DigiSpace',
      { message: title.trim() },
      board.selectedCardId,
    );
    this.pushBoardState(workspaceRoot);
    await this.focusBoard();
  }

  async launchSelectedCardAgent(): Promise<void> {
    const workspaceRoot = this.getCurrentWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('DigiSpace: No workspace folder available.');
      return;
    }
    this.loadProjectWorkspace(workspaceRoot);
    if (!this.selectedCardId.current) {
      vscode.window.showWarningMessage('DigiSpace: Select a card before launching an agent.');
      return;
    }
    await this.focusBoard();
    await this.launchProviderAgent(workspaceRoot);
  }

  async captureAgentSummary(): Promise<void> {
    const workspaceRoot = this.getCurrentWorkspaceRoot();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('DigiSpace: No workspace folder available.');
      return;
    }
    const candidateAgents = [...this.agents.values()]
      .filter((agent) => !agent.workspaceRoot || agent.workspaceRoot === workspaceRoot)
      .sort((a, b) => a.id - b.id);
    if (candidateAgents.length === 0) {
      vscode.window.showWarningMessage('DigiSpace: No active agents to summarize.');
      return;
    }
    const selected = await vscode.window.showQuickPick(
      candidateAgents.map((agent) => ({
        label: `#${agent.id} ${agent.provider ?? 'agent'}`,
        description: agent.activeCardId ? `Card ${agent.activeCardId}` : 'No card linked',
        agentId: agent.id,
      })),
      {
        placeHolder: 'Select the agent to summarize',
        ignoreFocusOut: true,
      },
    );
    if (!selected) return;
    const agent = this.agents.get(selected.agentId);
    if (!agent) return;
    const summary = await vscode.window.showInputBox({
      prompt: 'Session summary',
      placeHolder: 'Short summary of the work completed',
      ignoreFocusOut: true,
    });
    if (!summary?.trim()) return;

    const title = agent.activeCardId
      ? `Card ${agent.activeCardId} summary`
      : `Agent #${agent.id} summary`;
    const session = createSessionSummary(
      workspaceRoot,
      agent.provider,
      title,
      summary.trim(),
      agent.activeCardId ?? null,
    );
    agent.sessionRef = session.sessionRef;
    agent.lastSummaryAt = new Date().toISOString();
    agent.status = 'review';

    if (agent.activeCardId) {
      updateBoardCard(workspaceRoot, agent.activeCardId, {
        summary: summary.trim(),
        sessionRef: session.sessionRef,
      });
      const board = readBoardState(workspaceRoot);
      const currentCard = board?.cards.find((card) => card.id === agent.activeCardId);
      if (currentCard?.status === 'in_progress') {
        moveBoardCard(workspaceRoot, agent.activeCardId, 'review');
      }
    }

    this.appendBoardJournal(
      'session.summary',
      agent.provider ?? 'agent',
      { message: summary.trim(), sessionRef: session.sessionRef },
      agent.activeCardId ?? null,
      agent.id,
      agent.provider,
    );
    this.pushBoardState(workspaceRoot);
    this.updateAgentLifecycle(agent.id, 'review');
    this.webview?.postMessage({
      type: 'agentSummarySaved',
      agentId: agent.id,
      cardId: agent.activeCardId ?? null,
      sessionRef: session.sessionRef,
      summary: summary.trim(),
    });
    vscode.window.showInformationMessage('DigiSpace: Session summary saved.');
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === 'openAgent') {
        await this.launchProviderAgent(message.folderPath as string | undefined);
      } else if (message.type === 'showBoard') {
        await this.focusBoard();
      } else if (message.type === 'cardSelected') {
        const workspaceRoot =
          (message.workspaceRoot as string | undefined) || this.getCurrentWorkspaceRoot();
        if (!workspaceRoot) return;
        this.loadProjectWorkspace(workspaceRoot);
        const cardId = typeof message.cardId === 'string' ? message.cardId : null;
        selectBoardCard(workspaceRoot, cardId);
        this.selectedCardId.current = cardId;
        this.pushBoardState(workspaceRoot);
      } else if (message.type === 'cardCreate') {
        const workspaceRoot =
          (message.workspaceRoot as string | undefined) || this.getCurrentWorkspaceRoot();
        if (!workspaceRoot) return;
        this.loadProjectWorkspace(workspaceRoot);
        const title = typeof message.title === 'string' ? message.title.trim() : '';
        if (!title) return;
        const board = createBoardCard(workspaceRoot, {
          title,
          description: typeof message.description === 'string' ? message.description : '',
          priority: message.priority,
          labels: Array.isArray(message.labels) ? message.labels : [],
          source: 'ui',
          status: 'inbox',
        });
        this.selectedCardId.current = board.selectedCardId ?? null;
        this.appendBoardJournal(
          'card.created',
          'DigiSpace',
          { message: title },
          board.selectedCardId,
        );
        this.pushBoardState(workspaceRoot);
      } else if (message.type === 'cardUpdate') {
        const workspaceRoot =
          (message.workspaceRoot as string | undefined) || this.getCurrentWorkspaceRoot();
        const cardId = message.cardId as string | undefined;
        if (!workspaceRoot || !cardId) return;
        this.loadProjectWorkspace(workspaceRoot);
        updateBoardCard(workspaceRoot, cardId, {
          title: typeof message.title === 'string' ? message.title : undefined,
          description: typeof message.description === 'string' ? message.description : undefined,
          priority: message.priority,
          labels: Array.isArray(message.labels) ? message.labels : undefined,
          summary: typeof message.summary === 'string' ? message.summary : undefined,
        });
        this.appendBoardJournal(
          'card.updated',
          'DigiSpace',
          { message: `Updated ${cardId}` },
          cardId,
        );
        this.pushBoardState(workspaceRoot);
      } else if (message.type === 'cardMove') {
        const workspaceRoot =
          (message.workspaceRoot as string | undefined) || this.getCurrentWorkspaceRoot();
        const cardId = message.cardId as string | undefined;
        const status = message.status as BoardCardStatus | undefined;
        if (!workspaceRoot || !cardId || !status) return;
        try {
          this.loadProjectWorkspace(workspaceRoot);
          const board = readBoardState(workspaceRoot);
          const current = board?.cards.find((card) => card.id === cardId);
          if (!current) return;
          const next = status;
          if (current.status === next) return;
          const moved = moveBoardCard(workspaceRoot, cardId, next);
          this.appendBoardJournal(
            'card.moved',
            'DigiSpace',
            { message: `${current.status} -> ${next}` },
            cardId,
          );
          this.selectedCardId.current = moved.selectedCardId ?? cardId;
          this.pushBoardState(workspaceRoot);
          this.syncAssignedAgentStatus(workspaceRoot, cardId);
        } catch (err) {
          vscode.window.showWarningMessage(
            err instanceof Error
              ? `DigiSpace: ${err.message}`
              : 'DigiSpace: Invalid board transition.',
          );
        }
      } else if (message.type === 'cardArchive') {
        const workspaceRoot =
          (message.workspaceRoot as string | undefined) || this.getCurrentWorkspaceRoot();
        const cardId = message.cardId as string | undefined;
        if (!workspaceRoot || !cardId) return;
        this.loadProjectWorkspace(workspaceRoot);
        archiveBoardCard(workspaceRoot, cardId);
        this.appendBoardJournal(
          'card.archived',
          'DigiSpace',
          { message: `Archived ${cardId}` },
          cardId,
        );
        this.pushBoardState(workspaceRoot);
      } else if (message.type === 'agentAssignCard') {
        const workspaceRoot =
          (message.workspaceRoot as string | undefined) || this.getCurrentWorkspaceRoot();
        const cardId = message.cardId as string | undefined;
        const agentId = typeof message.agentId === 'number' ? message.agentId : null;
        if (!workspaceRoot || !cardId) return;
        const agent = agentId !== null ? this.agents.get(agentId) : undefined;
        assignCardToAgent(workspaceRoot, cardId, agent?.provider, agentId);
        if (agent) {
          agent.activeCardId = cardId;
          agent.workspaceRoot = workspaceRoot;
          agent.status = 'active';
        }
        this.appendBoardJournal(
          'card.assigned',
          agent?.provider ?? 'DigiSpace',
          { message: `Assigned ${cardId}` },
          cardId,
          agentId,
          agent?.provider,
        );
        this.selectedCardId.current = cardId;
        this.pushBoardState(workspaceRoot);
        if (agentId !== null) {
          this.syncAssignedAgentStatus(workspaceRoot, cardId);
        }
      } else if (message.type === 'launchAgentForCard') {
        const workspaceRoot =
          (message.workspaceRoot as string | undefined) || this.getCurrentWorkspaceRoot();
        const cardId = message.cardId as string | undefined;
        if (!workspaceRoot || !cardId) return;
        this.loadProjectWorkspace(workspaceRoot);
        selectBoardCard(workspaceRoot, cardId);
        this.selectedCardId.current = cardId;
        await this.launchProviderAgent(workspaceRoot);
      } else if (message.type === 'captureAgentSummary') {
        await this.captureAgentSummary();
      } else if (message.type === 'focusAgent') {
        const agent = this.agents.get(message.id);
        if (agent?.terminalRef) {
          agent.terminalRef.show();
        }
      } else if (message.type === 'closeAgent') {
        const agent = this.agents.get(message.id);
        if (agent?.terminalRef) {
          agent.terminalRef.dispose();
        }
      } else if (message.type === 'saveAgentSeats') {
        // Store seat assignments in a separate key (never touched by persistAgents)
        console.log(`[DigiSpace] saveAgentSeats:`, JSON.stringify(message.seats));
        this.context.workspaceState.update(WORKSPACE_KEY_AGENT_SEATS, message.seats);
      } else if (message.type === 'saveLayout') {
        this.layoutWatcher?.markOwnWrite();
        writeLayoutToFile(message.layout as Record<string, unknown>);
      } else if (message.type === 'setSoundEnabled') {
        this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
      } else if (message.type === 'webviewReady') {
        restoreAgents(
          this.context,
          this.nextAgentId,
          this.nextTerminalIndex,
          this.agents,
          this.knownJsonlFiles,
          this.fileWatchers,
          this.pollingTimers,
          this.waitingTimers,
          this.permissionTimers,
          this.jsonlPollTimers,
          this.projectScanTimer,
          this.activeAgentId,
          this.webview,
          this.persistAgents,
        );
        // Send persisted settings to webview
        const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
        this.webview?.postMessage({ type: 'settingsLoaded', soundEnabled });

        // Send workspace folders to webview (only when multi-root)
        const wsFolders = vscode.workspace.workspaceFolders;
        if (wsFolders && wsFolders.length > 1) {
          this.webview?.postMessage({
            type: 'workspaceFolders',
            folders: wsFolders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
          });
        }

        // Ensure project scan runs even with no restored agents (to adopt external terminals)
        const projectDir = getProjectDirPath();
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
          this.loadProjectWorkspace(workspaceRoot);
        }
        console.log('[Extension] workspaceRoot:', workspaceRoot);
        console.log('[Extension] projectDir:', projectDir);
        if (projectDir) {
          ensureProjectScan(
            projectDir,
            this.knownJsonlFiles,
            this.projectScanTimer,
            this.activeAgentId,
            this.nextAgentId,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.webview,
            this.persistAgents,
          );

          // Load furniture assets BEFORE sending layout
          (async () => {
            try {
              console.log('[Extension] Loading furniture assets...');
              const extensionPath = this.extensionUri.fsPath;
              console.log('[Extension] extensionPath:', extensionPath);

              // Check bundled location first: extensionPath/dist/assets/
              const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
              let assetsRoot: string | null = null;
              if (fs.existsSync(bundledAssetsDir)) {
                console.log('[Extension] Found bundled assets at dist/');
                assetsRoot = path.join(extensionPath, 'dist');
              } else if (workspaceRoot) {
                // Fall back to workspace root (development or external assets)
                console.log('[Extension] Trying workspace for assets...');
                assetsRoot = workspaceRoot;
              }

              if (!assetsRoot) {
                console.log('[Extension] ⚠️  No assets directory found');
                if (this.webview) {
                  sendLayout(this.context, this.webview, this.defaultLayout);
                  this.startLayoutWatcher();
                }
                return;
              }

              console.log('[Extension] Using assetsRoot:', assetsRoot);

              // Load bundled default layout
              this.defaultLayout = loadDefaultLayout(assetsRoot);

              // Load character sprites
              const charSprites = await loadCharacterSprites(assetsRoot);
              if (charSprites && this.webview) {
                console.log('[Extension] Character sprites loaded, sending to webview');
                sendCharacterSpritesToWebview(this.webview, charSprites);
              }

              // Load floor tiles
              const floorTiles = await loadFloorTiles(assetsRoot);
              if (floorTiles && this.webview) {
                console.log('[Extension] Floor tiles loaded, sending to webview');
                sendFloorTilesToWebview(this.webview, floorTiles);
              }

              // Load wall tiles
              const wallTiles = await loadWallTiles(assetsRoot);
              if (wallTiles && this.webview) {
                console.log('[Extension] Wall tiles loaded, sending to webview');
                sendWallTilesToWebview(this.webview, wallTiles);
              }

              const assets = await loadFurnitureAssets(assetsRoot);
              if (assets && this.webview) {
                console.log('[Extension] ✅ Assets loaded, sending to webview');
                sendAssetsToWebview(this.webview, assets);
              }
            } catch (err) {
              console.error('[Extension] ❌ Error loading assets:', err);
            }
            // Always send saved layout (or null for default)
            if (this.webview) {
              console.log('[Extension] Sending saved layout');
              sendLayout(this.context, this.webview, this.defaultLayout);
              this.startLayoutWatcher();
            }
          })();
        } else {
          // No project dir — still try to load floor/wall tiles, then send saved layout
          (async () => {
            try {
              const ep = this.extensionUri.fsPath;
              const bundled = path.join(ep, 'dist', 'assets');
              if (fs.existsSync(bundled)) {
                const distRoot = path.join(ep, 'dist');
                this.defaultLayout = loadDefaultLayout(distRoot);
                const cs = await loadCharacterSprites(distRoot);
                if (cs && this.webview) {
                  sendCharacterSpritesToWebview(this.webview, cs);
                }
                const ft = await loadFloorTiles(distRoot);
                if (ft && this.webview) {
                  sendFloorTilesToWebview(this.webview, ft);
                }
                const wt = await loadWallTiles(distRoot);
                if (wt && this.webview) {
                  sendWallTilesToWebview(this.webview, wt);
                }
              }
            } catch {
              /* ignore */
            }
            if (this.webview) {
              sendLayout(this.context, this.webview, this.defaultLayout);
              this.startLayoutWatcher();
            }
          })();
        }
        sendExistingAgents(this.agents, this.context, this.webview);
        startExternalBridge(this.externalBridge, this.agents, this.webview);
      } else if (message.type === 'openSessionsFolder') {
        const workspaceRoot = this.getCurrentWorkspaceRoot();
        if (workspaceRoot) {
          const store = ensureProjectStore(workspaceRoot);
          if (fs.existsSync(store.paths.sessionsDir)) {
            vscode.env.openExternal(vscode.Uri.file(store.paths.sessionsDir));
          }
        }
      } else if (message.type === 'exportLayout') {
        const layout = readLayoutFromFile();
        if (!layout) {
          vscode.window.showWarningMessage('DigiSpace: No saved layout to export.');
          return;
        }
        const uri = await vscode.window.showSaveDialog({
          filters: { 'JSON Files': ['json'] },
          defaultUri: vscode.Uri.file(path.join(os.homedir(), 'digispace-layout.json')),
        });
        if (uri) {
          fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
          vscode.window.showInformationMessage('DigiSpace: Layout exported successfully.');
        }
      } else if (message.type === 'importLayout') {
        const uris = await vscode.window.showOpenDialog({
          filters: { 'JSON Files': ['json'] },
          canSelectMany: false,
        });
        if (!uris || uris.length === 0) return;
        try {
          const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
          const imported = JSON.parse(raw) as Record<string, unknown>;
          if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
            vscode.window.showErrorMessage('DigiSpace: Invalid layout file.');
            return;
          }
          this.layoutWatcher?.markOwnWrite();
          writeLayoutToFile(imported);
          this.webview?.postMessage({ type: 'layoutLoaded', layout: imported });
          vscode.window.showInformationMessage('DigiSpace: Layout imported successfully.');
        } catch {
          vscode.window.showErrorMessage('DigiSpace: Failed to read or parse layout file.');
        }
      }
    });

    vscode.window.onDidChangeActiveTerminal((terminal) => {
      this.activeAgentId.current = null;
      if (!terminal) return;
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef === terminal) {
          this.activeAgentId.current = id;
          if (agent.activeCardId && agent.workspaceRoot) {
            this.selectedCardId.current = agent.activeCardId;
            selectBoardCard(agent.workspaceRoot, agent.activeCardId);
            this.pushBoardState(agent.workspaceRoot);
          }
          webviewView.webview.postMessage({ type: 'agentSelected', id });
          break;
        }
      }
    });

    vscode.window.onDidCloseTerminal((closed) => {
      for (const [id, agent] of this.agents) {
        if (agent.terminalRef === closed) {
          if (this.activeAgentId.current === id) {
            this.activeAgentId.current = null;
          }
          removeAgent(
            id,
            this.agents,
            this.fileWatchers,
            this.pollingTimers,
            this.waitingTimers,
            this.permissionTimers,
            this.jsonlPollTimers,
            this.persistAgents,
          );
          webviewView.webview.postMessage({ type: 'agentClosed', id });
        }
      }
    });
  }

  /** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
  exportDefaultLayout(): void {
    const layout = readLayoutFromFile();
    if (!layout) {
      vscode.window.showWarningMessage('DigiSpace: No saved layout found.');
      return;
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      vscode.window.showErrorMessage('DigiSpace: No workspace folder found.');
      return;
    }
    const targetPath = path.join(
      workspaceRoot,
      'webview-ui',
      'public',
      'assets',
      'default-layout.json',
    );
    const json = JSON.stringify(layout, null, 2);
    fs.writeFileSync(targetPath, json, 'utf-8');
    vscode.window.showInformationMessage(`DigiSpace: Default layout exported to ${targetPath}`);
  }

  private startLayoutWatcher(): void {
    if (this.layoutWatcher) return;
    this.layoutWatcher = watchLayoutFile((layout) => {
      console.log('[DigiSpace] External layout change - pushing to webview');
      this.webview?.postMessage({ type: 'layoutLoaded', layout });
    });
  }

  dispose() {
    disposeExternalBridge(this.externalBridge);
    this.layoutWatcher?.dispose();
    this.layoutWatcher = null;
    this.boardWatcher?.dispose();
    this.boardWatcher = null;
    for (const id of [...this.agents.keys()]) {
      removeAgent(
        id,
        this.agents,
        this.fileWatchers,
        this.pollingTimers,
        this.waitingTimers,
        this.permissionTimers,
        this.jsonlPollTimers,
        this.persistAgents,
      );
    }
    if (this.projectScanTimer.current) {
      clearInterval(this.projectScanTimer.current);
      this.projectScanTimer.current = null;
    }
  }
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
  const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

  let html = fs.readFileSync(indexPath, 'utf-8');

  html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
    const fileUri = vscode.Uri.joinPath(distPath, filePath);
    const webviewUri = webview.asWebviewUri(fileUri);
    return `${attr}="${webviewUri}"`;
  });

  return html;
}
