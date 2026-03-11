import type {
  AgentDetail,
  BoardState,
  ProjectContextState,
} from '../hooks/useExtensionMessages.js';

interface ContextPanelProps {
  projectContext: ProjectContextState | null;
  board: BoardState | null;
  agents: number[];
  agentDetails: Record<number, AgentDetail>;
  onOpenSessionsFolder: () => void;
  onCaptureSummary: () => void;
}

export function ContextPanel({
  projectContext,
  board,
  agents,
  agentDetails,
  onOpenSessionsFolder,
  onCaptureSummary,
}: ContextPanelProps) {
  const sessionCards = (board?.cards ?? [])
    .filter((card) => !!card.sessionRef)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);

  return (
    <div
      style={{
        position: 'absolute',
        top: 58,
        right: 10,
        bottom: 10,
        width: 'min(34vw, 540px)',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(15, 23, 42, 0.94)',
        border: '2px solid var(--pixel-border-light)',
        boxShadow: 'var(--pixel-shadow)',
        zIndex: 46,
        overflow: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 14px',
          borderBottom: '2px solid rgba(148, 163, 184, 0.18)',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 18, color: '#f8fafc' }}>Project Context</h3>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            {projectContext?.workspaceRoot ?? 'No workspace'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={buttonStyle} onClick={onCaptureSummary}>
            Summary
          </button>
          <button style={buttonStyle} onClick={onOpenSessionsFolder}>
            Sessions
          </button>
        </div>
      </div>

      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section>
          <div style={headingStyle}>Project</div>
          <div style={gridStyle}>
            <Field label="Name" value={projectContext?.projectName ?? 'n/a'} />
            <Field label="Client" value={projectContext?.clientName ?? 'n/a'} />
            <Field label="Partner" value={projectContext?.partnerName ?? 'n/a'} />
            <Field label="Project ID" value={projectContext?.projectId ?? 'n/a'} />
          </div>
        </section>

        <section>
          <div style={headingStyle}>Rules</div>
          <div
            style={{ color: '#cbd5e1', fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            <Tag text="Local-first" />
            <Tag text="Autonomous controlled" />
            <Tag text="Project-local .digispace" />
          </div>
        </section>

        <section>
          <div style={headingStyle}>Instructions</div>
          <div style={{ color: '#cbd5e1', fontSize: 13 }}>
            {(projectContext?.providerInstructionFiles ?? []).length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(projectContext?.providerInstructionFiles ?? []).map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            ) : (
              'No provider instruction files detected.'
            )}
          </div>
        </section>

        <section>
          <div style={headingStyle}>Agents</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {agents.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>No active agents.</div>
            )}
            {agents
              .slice()
              .sort((a, b) => a - b)
              .map((agentId) => {
                const detail = agentDetails[agentId];
                return (
                  <div
                    key={agentId}
                    style={{
                      border: '1px solid rgba(148, 163, 184, 0.16)',
                      padding: '8px 10px',
                      background: 'rgba(2, 6, 23, 0.35)',
                    }}
                  >
                    <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 700 }}>
                      #{agentId} {providerLabel(detail?.provider)}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <span
                        style={{
                          ...statusTone(detail?.status),
                          border: '1px solid',
                          padding: '2px 6px',
                          fontSize: 11,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                        }}
                      >
                        {statusLabel(detail?.status)}
                      </span>
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>
                      Card: {detail?.activeCardId ?? 'n/a'}
                    </div>
                    {detail?.sessionRef && (
                      <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>
                        Session: {detail.sessionRef}
                      </div>
                    )}
                    {detail?.lastSummaryAt && (
                      <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 3 }}>
                        Last summary: {detail.lastSummaryAt}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </section>

        <section>
          <div style={headingStyle}>Recent Sessions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessionCards.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>No session summaries saved yet.</div>
            )}
            {sessionCards.map((card) => (
              <div
                key={card.id}
                style={{
                  border: '1px solid rgba(148, 163, 184, 0.16)',
                  padding: '8px 10px',
                  background: 'rgba(2, 6, 23, 0.35)',
                }}
              >
                <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 700 }}>{card.title}</div>
                <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 3 }}>
                  {card.sessionRef}
                </div>
                {card.summary && (
                  <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{card.summary}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function providerLabel(provider?: AgentDetail['provider']): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  return 'Claude';
}

function statusLabel(status?: AgentDetail['status']): string {
  switch (status) {
    case 'waiting':
      return 'Waiting';
    case 'blocked':
      return 'Blocked';
    case 'review':
      return 'Review';
    case 'done':
      return 'Done';
    default:
      return 'Active';
  }
}

function statusTone(status?: AgentDetail['status']): React.CSSProperties {
  switch (status) {
    case 'blocked':
      return { borderColor: 'rgba(239, 68, 68, 0.45)', color: '#fecaca' };
    case 'review':
      return { borderColor: 'rgba(245, 158, 11, 0.45)', color: '#fde68a' };
    case 'done':
      return { borderColor: 'rgba(34, 197, 94, 0.45)', color: '#bbf7d0' };
    case 'waiting':
      return { borderColor: 'rgba(148, 163, 184, 0.45)', color: '#e2e8f0' };
    default:
      return { borderColor: 'rgba(96, 165, 250, 0.45)', color: '#dbeafe' };
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}
      >
        {label}
      </div>
      <div style={{ color: '#f8fafc', fontSize: 13, marginTop: 3 }}>{value}</div>
    </div>
  );
}

function Tag({ text }: { text: string }) {
  return (
    <span
      style={{
        border: '1px solid rgba(96, 165, 250, 0.45)',
        color: '#dbeafe',
        padding: '3px 7px',
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {text}
    </span>
  );
}

const buttonStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(30, 41, 59, 0.86)',
  color: '#f8fafc',
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 13,
};

const headingStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontSize: 15,
  fontWeight: 700,
  marginBottom: 8,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10,
};
