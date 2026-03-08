import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { AgentState } from './types.js';

export interface ExternalAgentTool {
  id?: string;
  status: string;
  done?: boolean;
  permissionWait?: boolean;
}

export interface ExternalAgentRecord {
  key: string;
  name: string;
  folderName?: string;
  status?: 'active' | 'waiting';
  tool?: ExternalAgentTool | null;
}

interface ExternalStateFile {
  version: 1;
  generatedAt?: string;
  agents?: ExternalAgentRecord[];
}

export interface ExternalBridgeState {
  watcher?: fs.FSWatcher;
  pollTimer?: ReturnType<typeof setInterval>;
  lastFingerprints: Map<string, string>;
}

const EXTERNAL_DIR = '.digispace';
const EXTERNAL_FILE = 'external-agents.json';
const POLL_MS = 1500;
const EXTERNAL_ID_OFFSET = 1_000_000;

export function createExternalBridgeState(): ExternalBridgeState {
  return {
    lastFingerprints: new Map<string, string>(),
  };
}

export function disposeExternalBridge(state: ExternalBridgeState): void {
  try {
    state.watcher?.close();
  } catch {
    /* ignore */
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  state.watcher = undefined;
  state.pollTimer = undefined;
  state.lastFingerprints.clear();
}

export function getExternalAgentsFilePath(): string | null {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return null;
  return path.join(workspaceRoot, EXTERNAL_DIR, EXTERNAL_FILE);
}

export function startExternalBridge(
  state: ExternalBridgeState,
  agents: Map<number, AgentState>,
  webview: vscode.Webview | undefined,
): void {
  const filePath = getExternalAgentsFilePath();
  if (!filePath) return;

  const apply = () => {
    applyExternalState(filePath, state, agents, webview);
  };

  apply();

  const parentDir = path.dirname(filePath);
  try {
    fs.mkdirSync(parentDir, { recursive: true });
  } catch {
    /* ignore */
  }

  try {
    state.watcher = fs.watch(parentDir, (_eventType, filename) => {
      if (!filename) return;
      if (path.basename(filename.toString()) !== EXTERNAL_FILE) return;
      apply();
    });
  } catch {
    /* ignore */
  }

  state.pollTimer = setInterval(apply, POLL_MS);
}

function applyExternalState(
  filePath: string,
  state: ExternalBridgeState,
  agents: Map<number, AgentState>,
  webview: vscode.Webview | undefined,
): void {
  const parsed = readExternalState(filePath);
  const records = parsed?.agents ?? [];
  const nextKeys = new Set<string>();

  for (const record of records) {
    if (!record?.key || !record?.name) continue;
    nextKeys.add(record.key);
  }

  for (const [id, agent] of agents) {
    if (agent.agentKind !== 'external' || !agent.externalKey) continue;
    if (!nextKeys.has(agent.externalKey)) {
      agents.delete(id);
      state.lastFingerprints.delete(agent.externalKey);
      webview?.postMessage({ type: 'agentClosed', id });
    }
  }

  for (const record of records) {
    if (!record?.key || !record?.name) continue;

    const id = externalKeyToId(record.key);
    const fingerprint = JSON.stringify(record);
    if (state.lastFingerprints.get(record.key) === fingerprint) {
      continue;
    }
    state.lastFingerprints.set(record.key, fingerprint);

    let agent = agents.get(id);
    if (!agent) {
      agent = {
        id,
        agentKind: 'external',
        externalKey: record.key,
        projectDir: '',
        jsonlFile: '',
        fileOffset: 0,
        lineBuffer: '',
        activeToolIds: new Set(),
        activeToolStatuses: new Map(),
        activeToolNames: new Map(),
        activeSubagentToolIds: new Map(),
        activeSubagentToolNames: new Map(),
        isWaiting: false,
        permissionSent: false,
        hadToolsInTurn: false,
        folderName: record.folderName || record.name,
      };
      agents.set(id, agent);
      webview?.postMessage({
        type: 'agentCreated',
        id,
        folderName: agent.folderName,
      });
    } else {
      agent.folderName = record.folderName || record.name;
    }

    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();
    agent.activeSubagentToolIds.clear();
    agent.activeSubagentToolNames.clear();
    agent.permissionSent = false;
    agent.hadToolsInTurn = false;

    webview?.postMessage({ type: 'agentToolsClear', id });

    const tool = record.tool;
    if (tool && typeof tool.status === 'string' && tool.status.trim()) {
      const toolId = tool.id || `external:${record.key}`;
      agent.activeToolIds.add(toolId);
      agent.activeToolStatuses.set(toolId, tool.status);
      agent.activeToolNames.set(toolId, record.name);
      webview?.postMessage({
        type: 'agentToolStart',
        id,
        toolId,
        status: tool.status,
      });
      if (tool.done) {
        webview?.postMessage({
          type: 'agentToolDone',
          id,
          toolId,
        });
      }
      if (tool.permissionWait) {
        agent.permissionSent = true;
        webview?.postMessage({ type: 'agentToolPermission', id });
      }
    }

    const status = record.status === 'waiting' ? 'waiting' : 'active';
    agent.isWaiting = status === 'waiting';
    webview?.postMessage({
      type: 'agentStatus',
      id,
      status,
    });
  }
}

function readExternalState(filePath: string): ExternalStateFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as ExternalStateFile;
  } catch {
    return null;
  }
}

function externalKeyToId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return EXTERNAL_ID_OFFSET + (hash % 900_000_000);
}
