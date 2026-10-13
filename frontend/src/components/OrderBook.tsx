import { useEffect, useMemo, useState } from 'react';

import { useSocket } from '../context/SocketContext';
import type { OrderBookLevel, OrderBookUpdate } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const emptyBook: OrderBookUpdate = { pair: 'BTC-USD', bids: [], asks: [], timestamp: '' };

function isOrderBookUpdate(value: unknown): value is OrderBookUpdate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<OrderBookUpdate>;
  return candidate.pair === undefined || (Array.isArray(candidate.bids) && Array.isArray(candidate.asks));
}

function formatPrice(price: number) {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sortAsksAscending(levels: OrderBookLevel[]): OrderBookLevel[] {
  return [...levels].sort((left, right) => left.price - right.price);
}

function sortBidsDescending(levels: OrderBookLevel[]): OrderBookLevel[] {
  return [...levels].sort((left, right) => right.price - left.price);
}

function DepthRows({
  levels,
  tone,
  reverseVisual,
}: {
  levels: OrderBookLevel[];
  tone: 'buy' | 'sell';
  reverseVisual?: boolean;
}) {
  const maxQuantity = Math.max(...levels.map((level) => level.quantity), 0);
  const rendered = reverseVisual ? [...levels].reverse() : levels;

  return (
    <div className={`depth-list ${tone}`}>
      {levels.length === 0 ? <div className="empty-state">Waiting for liquidity</div> : null}
      {rendered.map((level) => {
        const depthPercent = maxQuantity > 0 ? Math.max((level.quantity / maxQuantity) * 100, 4) : 0;
        return (
          <div className={`depth-row ${tone}`} key={`${tone}-${level.price}-${level.orderCount}-${level.quantity}`}>
            <span className="depth-bar" style={{ width: `${depthPercent}%` }} />
            <span className="depth-value">{formatPrice(level.price)}</span>
            <span>{level.quantity.toFixed(4)}</span>
            <span className="muted">{level.orderCount}</span>
          </div>
        );
      })}
    </div>
  );
}

export function OrderBook({ pair }: { pair: string }) {
  const { socket } = useSocket();
  const [book, setBook] = useState<OrderBookUpdate>(emptyBook);
  const [baseAsset] = pair.split('-');

  useEffect(() => {
    fetch(`${API_URL}/api/markets/${pair}/orderbook`)
      .then((response) => response.json())
      .then((snapshot: unknown) => {
        if (isOrderBookUpdate(snapshot) && snapshot.bids && snapshot.asks) setBook(snapshot);
      })
      .catch(() => undefined);
  }, [pair]);

  useEffect(() => {
    if (!socket) return;
    const handleUpdate = (nextBook: OrderBookUpdate) => {
      if (nextBook.pair === pair && isOrderBookUpdate(nextBook)) setBook(nextBook);
    };
    socket.emit('market:join', pair);
    socket.on('orderbook:update', handleUpdate);
    return () => {
      socket.emit('market:leave', pair);
      socket.off('orderbook:update', handleUpdate);
    };
  }, [pair, socket]);

  const asks = useMemo(() => sortAsksAscending(book.asks), [book.asks]);
  const bids = useMemo(() => sortBidsDescending(book.bids), [book.bids]);
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : 0;

  return (
    <section className="panel orderbook-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Market depth</span>
          <h2>Order book</h2>
        </div>
        <span className="spread">Spread {spread ? formatPrice(spread) : '--'}</span>
      </div>
      <div className="depth-header"><span>Price (USD)</span><span>Size ({baseAsset})</span><span>Orders</span></div>
      <DepthRows levels={asks} tone="sell" reverseVisual />
      <div className="midpoint spread-indicator">
        {pair.replace('-', ' / ')}
        <span>
          Spread {spread ? formatPrice(spread) : '--'}
          {mid ? ` · Mid ${formatPrice(mid)}` : ''}
          {book.timestamp ? ' · live' : ' · waiting'}
        </span>
      </div>
      <DepthRows levels={bids} tone="buy" />
    </section>
  );
}
