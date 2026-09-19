import { useEffect, useState } from 'react';

import { useSocket } from '../context/SocketContext';

type QueueTelemetry = { queue?: string; waiting: number; active: number; completed: number; failed: number; timestamp: string };
type HeapTelemetry = { pair: string; bids: Array<{ price: number; quantity: number; orderCount: number }>; asks: Array<{ price: number; quantity: number; orderCount: number }>; timestamp: string };
type TxTelemetry = { sessionId: string; sessionID?: string; durationMs: number; status: 'COMMITTED' | 'ROLLED_BACK'; error?: string; timestamp: string };

const QUEUE_KEYS = ['waiting', 'active', 'completed', 'failed'] as const;

function normalizeTx(payload: TxTelemetry): TxTelemetry {
  const sessionId = payload.sessionID ?? payload.sessionId ?? 'unknown';
  return { ...payload, sessionId, sessionID: sessionId };
}

export function EngineVisualizer() {
  const { socket, user } = useSocket();
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<QueueTelemetry | null>(null);
  const [heap, setHeap] = useState<HeapTelemetry | null>(null);
  const [transactions, setTransactions] = useState<TxTelemetry[]>([]);

  useEffect(() => {
    if (!socket || user?.role !== 'ADMIN') return;
    const handleQueue = (next: QueueTelemetry) => setQueue(next);
    const handleHeap = (next: HeapTelemetry) => setHeap(next);
    const handleTx = (next: TxTelemetry) => {
      const tx = normalizeTx(next);
      setTransactions((current) => [tx, ...current].slice(0, 40));
    };
    socket.emit('admin:join');
    socket.on('telemetry:queue', handleQueue);
    socket.on('telemetry:heap', handleHeap);
    socket.on('telemetry:tx', handleTx);
    return () => {
      socket.off('telemetry:queue', handleQueue);
      socket.off('telemetry:heap', handleHeap);
      socket.off('telemetry:tx', handleTx);
    };
  }, [socket, user?.role]);

  if (user?.role !== 'ADMIN') return null;

  return (
    <>
      <button className="admin-button" onClick={() => setOpen(true)} type="button">Admin visualizer</button>
      {open ? <div className="admin-backdrop" onClick={() => setOpen(false)} role="presentation">
        <aside className="admin-drawer" onClick={(event) => event.stopPropagation()}>
          <button className="close-button" onClick={() => setOpen(false)} type="button">×</button>
          <span className="eyebrow">Restricted telemetry</span>
          <h2>Admin Engine Visualizer</h2>
          <div className="telemetry-grid">
            {QUEUE_KEYS.map((key) => (
              <div className="telemetry-gauge" key={key}>
                <span>{key}</span>
                <strong>{queue?.[key] ?? 0}</strong>
              </div>
            ))}
          </div>
          <h3>Heap snapshot · {heap?.pair ?? 'waiting'}</h3>
          <div className="heap-columns">
            <div>
              <b>Max-Heap bids</b>
              {(heap?.bids.slice(0, 5) ?? []).length === 0 ? <code>empty</code> : heap?.bids.slice(0, 5).map((level, index) => (
                <code key={`bid-${level.price}-${index}`}>{level.price} × {level.quantity.toFixed(4)}</code>
              ))}
            </div>
            <div>
              <b>Min-Heap asks</b>
              {(heap?.asks.slice(0, 5) ?? []).length === 0 ? <code>empty</code> : heap?.asks.slice(0, 5).map((level, index) => (
                <code key={`ask-${level.price}-${index}`}>{level.price} × {level.quantity.toFixed(4)}</code>
              ))}
            </div>
          </div>
          <div className="tx-heading">
            <h3>MongoDB transactions</h3>
            <button className="rollback-button" onClick={() => socket?.emit('admin:test-rollback')} type="button">Test forced rollback</button>
          </div>
          <div className="tx-list tx-terminal">
            {transactions.length === 0 ? <p className="muted">Waiting for settlement telemetry...</p> : transactions.map((tx, index) => {
              const session = tx.sessionID ?? tx.sessionId;
              return (
                <div className="tx-row" key={`${session}-${tx.timestamp}-${index}`}>
                  <span className={tx.status === 'COMMITTED' ? 'buy-text' : 'sell-text'}>{tx.status}</span>
                  <code>{session.slice(0, 16)}</code>
                  <span>{tx.durationMs}ms</span>
                </div>
              );
            })}
          </div>
        </aside>
      </div> : null}
    </>
  );
}
