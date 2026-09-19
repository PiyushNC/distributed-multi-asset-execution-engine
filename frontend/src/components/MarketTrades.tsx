import { useEffect, useState } from 'react';

import { useSocket } from '../context/SocketContext';
import type { MarketTrade } from '../types';

function isMarketTrade(value: unknown): value is MarketTrade {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MarketTrade>;
  return typeof candidate.pair === 'string'
    && Number.isFinite(candidate.price)
    && Number.isFinite(candidate.quantity)
    && typeof candidate.timestamp === 'string';
}

export function MarketTrades({ pair }: { pair: string }) {
  const { socket } = useSocket();
  const [trades, setTrades] = useState<MarketTrade[]>([]);

  useEffect(() => {
    setTrades([]);
  }, [pair]);

  useEffect(() => {
    if (!socket) return;
    const handleTrade = (trade: unknown) => {
      if (!isMarketTrade(trade) || trade.pair !== pair) return;
      setTrades((current) => [trade, ...current].slice(0, 40));
    };
    socket.emit('market:join', pair);
    socket.on('trade:executed', handleTrade);
    return () => {
      socket.emit('market:leave', pair);
      socket.off('trade:executed', handleTrade);
    };
  }, [pair, socket]);

  return (
    <section className="panel trades-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Live tape</span><h2>Market trades</h2></div>
        <span className="live-dot">LIVE</span>
      </div>
      <div className="trade-header"><span>Time</span><span>Price</span><span>Qty</span></div>
      <div className="trade-list">
        {trades.length === 0 ? <div className="empty-state">No executions yet</div> : null}
        {trades.map((trade, index) => (
          <div className={`trade-row ${index === 0 ? 'fresh' : ''}`} key={`${trade.timestamp}-${trade.price}-${trade.quantity}-${index}`}>
            <span className="muted">{new Date(trade.timestamp).toLocaleTimeString()}</span>
            <span className="trade-price">{trade.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span>{trade.quantity.toFixed(4)}</span>
            <span className="trade-tag">EXECUTED</span>
          </div>
        ))}
      </div>
    </section>
  );
}
