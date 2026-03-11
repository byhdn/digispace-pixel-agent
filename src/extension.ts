import * as vscode from 'vscode';

import {
  COMMAND_CAPTURE_AGENT_SUMMARY,
  COMMAND_EXPORT_DEFAULT_LAYOUT,
  COMMAND_LAUNCH_AGENT_FOR_CARD,
  COMMAND_NEW_CARD,
  COMMAND_SHOW_BOARD,
  COMMAND_SHOW_PANEL,
  VIEW_ID,
} from './constants.js';
import { PixelAgentsViewProvider } from './PixelAgentsViewProvider.js';

let providerInstance: PixelAgentsViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  const provider = new PixelAgentsViewProvider(context);
  providerInstance = provider;

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider));

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
      vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_SHOW_BOARD, async () => {
      await provider.focusBoard();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_NEW_CARD, async () => {
      await provider.createCardFromCommand();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_LAUNCH_AGENT_FOR_CARD, async () => {
      await provider.launchSelectedCardAgent();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_CAPTURE_AGENT_SUMMARY, async () => {
      await provider.captureAgentSummary();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
      provider.exportDefaultLayout();
    }),
  );
}

export function deactivate() {
  providerInstance?.dispose();
}
