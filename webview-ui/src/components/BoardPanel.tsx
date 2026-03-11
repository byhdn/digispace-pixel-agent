import { useEffect, useMemo, useState } from 'react';

import type { AgentDetail, BoardCard, BoardState } from '../hooks/useExtensionMessages.js';

type CardStatus = 'inbox' | 'ready' | 'in_progress' | 'review' | 'blocked' | 'done';
type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

interface BoardPanelProps {
  board: BoardState | null;
  agents: number[];
  agentDetails: Record<number, AgentDetail>;
  onSelectCard: (cardId: string | null) => void;
  onCreateCard: (payload: { title: string; description: string; priority: CardPriority }) => void;
  onUpdateCard: (
    cardId: string,
    payload: { title?: string; description?: string; priority?: CardPriority; summary?: string },
  ) => void;
  onMoveCard: (cardId: string, status: CardStatus) => void;
  onArchiveCard: (cardId: string) => void;
  onLaunchAgentForCard: (cardId: string) => void;
  onAssignAgent: (cardId: string, agentId: number | null) => void;
  onCaptureSummary: () => void;
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 58,
  right: 10,
  bottom: 10,
  width: 'min(46vw, 760px)',
  display: 'flex',
  flexDirection: 'column',
  background: 'rgba(15, 23, 42, 0.94)',
  border: '2px solid var(--pixel-border-light)',
  boxShadow: 'var(--pixel-shadow)',
  zIndex: 46,
  overflow: 'hidden',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#f8fafc',
  margin: 0,
};

function providerLabel(provider?: AgentDetail['provider']): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  return 'Claude';
}

function statusLabel(status: CardStatus): string {
  switch (status) {
    case 'in_progress':
      return 'In Progress';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function BoardPanel({
  board,
  agents,
  agentDetails,
  onSelectCard,
  onCreateCard,
  onUpdateCard,
  onMoveCard,
  onArchiveCard,
  onLaunchAgentForCard,
  onAssignAgent,
  onCaptureSummary,
}: BoardPanelProps) {
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftPriority, setDraftPriority] = useState<CardPriority>('medium');
  const [statusFilter, setStatusFilter] = useState<'all' | CardStatus>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | 'claude' | 'codex' | 'gemini'>(
    'all',
  );
  const [priorityFilter, setPriorityFilter] = useState<'all' | CardPriority>('all');

  const selectedCard = useMemo(() => {
    if (!board?.selectedCardId) return null;
    return board.cards.find((card) => card.id === board.selectedCardId) ?? null;
  }, [board]);

  const visibleCards = useMemo(() => {
    if (!board) return [];
    return board.cards.filter((card) => {
      if (card.archivedAt) return false;
      if (statusFilter !== 'all' && card.status !== statusFilter) return false;
      if (providerFilter !== 'all' && card.ownerProvider !== providerFilter) return false;
      if (priorityFilter !== 'all' && card.priority !== priorityFilter) return false;
      return true;
    });
  }, [board, statusFilter, providerFilter, priorityFilter]);

  if (!board) {
    return (
      <div style={panelStyle}>
        <div style={{ padding: 16, color: '#cbd5e1', fontSize: 16 }}>Loading local board...</div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 14px',
          borderBottom: '2px solid rgba(148, 163, 184, 0.18)',
          background: 'rgba(15, 23, 42, 0.98)',
        }}
      >
        <div>
          <h3 style={sectionTitleStyle}>Project Board</h3>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{board.workspaceRoot}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={toolbarBtnStyle} onClick={onCaptureSummary}>
            Summary
          </button>
        </div>
      </div>

      <div style={{ padding: 12, borderBottom: '1px solid rgba(148, 163, 184, 0.12)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr auto auto', gap: 8 }}>
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="New card title"
            style={inputStyle}
          />
          <input
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Description"
            style={inputStyle}
          />
          <select
            value={draftPriority}
            onChange={(e) => setDraftPriority(e.target.value as CardPriority)}
            style={inputStyle}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
          <button
            style={toolbarBtnStyle}
            onClick={() => {
              if (!draftTitle.trim()) return;
              onCreateCard({
                title: draftTitle.trim(),
                description: draftDescription.trim(),
                priority: draftPriority,
              });
              setDraftTitle('');
              setDraftDescription('');
              setDraftPriority('medium');
            }}
          >
            Add
          </button>
        </div>
      </div>

      <div
        style={{
          padding: '10px 12px',
          display: 'flex',
          gap: 8,
          borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
        }}
      >
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | CardStatus)}
          style={filterStyle}
        >
          <option value="all">All status</option>
          {board.columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.title}
            </option>
          ))}
        </select>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value as typeof providerFilter)}
          style={filterStyle}
        >
          <option value="all">All providers</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="gemini">Gemini</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
          style={filterStyle}
        >
          <option value="all">All priority</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr', minHeight: 0, flex: 1 }}>
        <div style={{ minHeight: 0, overflow: 'auto', padding: 12 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            {board.columns.map((column) => {
              const cards = visibleCards.filter((card) => card.status === column.id);
              return (
                <div
                  key={column.id}
                  style={{
                    border: '1px solid rgba(148, 163, 184, 0.18)',
                    background: 'rgba(2, 6, 23, 0.45)',
                    minHeight: 240,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
                      fontSize: 14,
                      color: '#e2e8f0',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{column.title}</span>
                    <span style={{ color: '#94a3b8' }}>{cards.length}</span>
                  </div>
                  <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {cards.map((card) => {
                      const selected = board.selectedCardId === card.id;
                      return (
                        <button
                          key={card.id}
                          onClick={() => onSelectCard(card.id)}
                          style={{
                            textAlign: 'left',
                            padding: '8px 9px',
                            border: selected
                              ? '1px solid #60a5fa'
                              : '1px solid rgba(148, 163, 184, 0.14)',
                            background: selected
                              ? 'rgba(30, 41, 59, 0.9)'
                              : 'rgba(15, 23, 42, 0.78)',
                            color: '#f8fafc',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{card.title}</div>
                          {card.description && (
                            <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 4 }}>
                              {card.description}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                            <span
                              style={chipStyle(card.priority === 'urgent' ? '#f59e0b' : '#64748b')}
                            >
                              {card.priority}
                            </span>
                            {card.ownerProvider && (
                              <span style={chipStyle('#2563eb')}>
                                {providerLabel(card.ownerProvider)}
                                {card.ownerAgentId ? ` #${card.ownerAgentId}` : ''}
                              </span>
                            )}
                            {card.sessionRef && <span style={chipStyle('#10b981')}>session</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            borderLeft: '1px solid rgba(148, 163, 184, 0.14)',
            padding: 12,
            minHeight: 0,
            overflow: 'auto',
            background: 'rgba(2, 6, 23, 0.25)',
          }}
        >
          {!selectedCard ? (
            <div style={{ color: '#94a3b8', fontSize: 14 }}>
              Select a card to inspect or launch work.
            </div>
          ) : (
            <CardDetails
              card={selectedCard}
              agents={agents}
              agentDetails={agentDetails}
              onSelectCard={onSelectCard}
              onUpdateCard={onUpdateCard}
              onMoveCard={onMoveCard}
              onArchiveCard={onArchiveCard}
              onLaunchAgentForCard={onLaunchAgentForCard}
              onAssignAgent={onAssignAgent}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CardDetails({
  card,
  agents,
  agentDetails,
  onSelectCard,
  onUpdateCard,
  onMoveCard,
  onArchiveCard,
  onLaunchAgentForCard,
  onAssignAgent,
}: {
  card: BoardCard;
  agents: number[];
  agentDetails: Record<number, AgentDetail>;
  onSelectCard: (cardId: string | null) => void;
  onUpdateCard: (
    cardId: string,
    payload: { title?: string; description?: string; priority?: CardPriority; summary?: string },
  ) => void;
  onMoveCard: (cardId: string, status: CardStatus) => void;
  onArchiveCard: (cardId: string) => void;
  onLaunchAgentForCard: (cardId: string) => void;
  onAssignAgent: (cardId: string, agentId: number | null) => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [priority, setPriority] = useState<CardPriority>(card.priority);
  const [summary, setSummary] = useState(card.summary ?? '');

  useEffect(() => {
    setTitle(card.title);
    setDescription(card.description);
    setPriority(card.priority);
    setSummary(card.summary ?? '');
  }, [card]);

  const compatibleAgents = agents
    .filter((agentId) => {
      const detail = agentDetails[agentId];
      return !detail?.workspaceRoot || detail.workspaceRoot === card.workspaceRoot;
    })
    .sort((a, b) => a - b);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}
      >
        <div>
          <h4 style={{ ...sectionTitleStyle, fontSize: 16 }}>{card.title}</h4>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>
            {statusLabel(card.status as CardStatus)} · {card.id}
          </div>
        </div>
        <button style={toolbarBtnStyle} onClick={() => onSelectCard(null)}>
          Clear
        </button>
      </div>

      <label style={labelStyle}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ ...inputStyle, minHeight: 90, resize: 'vertical' }}
        />
      </label>
      <label style={labelStyle}>
        Priority
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as CardPriority)}
          style={inputStyle}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <label style={labelStyle}>
        Summary
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          style={{ ...inputStyle, minHeight: 74, resize: 'vertical' }}
        />
      </label>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          style={toolbarBtnStyle}
          onClick={() =>
            onUpdateCard(card.id, {
              title: title.trim(),
              description: description.trim(),
              priority,
              summary: summary.trim(),
            })
          }
        >
          Save
        </button>
        <button style={toolbarBtnStyle} onClick={() => onLaunchAgentForCard(card.id)}>
          Launch Agent
        </button>
        <button style={toolbarBtnStyle} onClick={() => onArchiveCard(card.id)}>
          Archive
        </button>
      </div>

      <label style={labelStyle}>
        Assign Existing Agent
        <select
          value={card.ownerAgentId ?? ''}
          onChange={(e) => onAssignAgent(card.id, e.target.value ? Number(e.target.value) : null)}
          style={inputStyle}
        >
          <option value="">No linked agent</option>
          {compatibleAgents.map((agentId) => (
            <option key={agentId} value={agentId}>
              #{agentId} {providerLabel(agentDetails[agentId]?.provider)}
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Move Card
        <select
          value={card.status}
          onChange={(e) => onMoveCard(card.id, e.target.value as CardStatus)}
          style={inputStyle}
        >
          <option value="inbox">Inbox</option>
          <option value="ready">Ready</option>
          <option value="in_progress">In Progress</option>
          <option value="review">Review</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
      </label>

      {card.sessionRef && (
        <div style={{ fontSize: 12, color: '#cbd5e1' }}>
          <strong>Session:</strong> {card.sessionRef}
        </div>
      )}
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(30, 41, 59, 0.86)',
  color: '#f8fafc',
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 13,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(15, 23, 42, 0.82)',
  color: '#f8fafc',
  padding: '8px 9px',
  fontSize: 13,
  boxSizing: 'border-box',
};

const filterStyle: React.CSSProperties = {
  ...inputStyle,
  width: 'auto',
  minWidth: 130,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  color: '#cbd5e1',
  fontSize: 13,
};

function chipStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    border: `1px solid ${color}`,
    color: '#e2e8f0',
    fontSize: 11,
    padding: '2px 5px',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  };
}
