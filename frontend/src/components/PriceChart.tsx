import { useEffect, useMemo, useState } from 'react';

import { useSocket } from '../context/SocketContext';
import type { MarketTrade } from '../types';

export type PricePoint = {
  price: number;
  timestamp: number;
};

const MAX_POINTS = 240;
const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 250;
const CHART_BOTTOM = 228;

function isMarketTrade(value: unknown): value is MarketTrade {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MarketTrade>;
  return typeof candidate.pair === 'string'
    && Number.isFinite(candidate.price)
    && Number.isFinite(candidate.quantity)
    && typeof candidate.timestamp === 'string';
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function useLiveTrades(pair: string) {
  const { socket } = useSocket();
  const [points, setPoints] = useState<PricePoint[]>([]);

  useEffect(() => {
    setPoints([]);
  }, [pair]);

  useEffect(() => {
    if (!socket) return;
    const handleTrade = (payload: unknown) => {
      if (!isMarketTrade(payload) || payload.pair !== pair) return;
      const timestamp = Date.parse(payload.timestamp);
      if (!Number.isFinite(timestamp)) return;
      setPoints((current) => [...current, { price: payload.price, timestamp }].slice(-MAX_POINTS));
    };
    socket.emit('market:join', pair);
    socket.on('trade:executed', handleTrade);
    return () => {
      socket.emit('market:leave', pair);
      socket.off('trade:executed', handleTrade);
    };
  }, [pair, socket]);

  const last = points.at(-1)?.price ?? 50_000;
  const windowStart = Date.now() - 24 * 60 * 60 * 1000;
  const open = points.find((point) => point.timestamp >= windowStart)?.price ?? points[0]?.price ?? last;
  const changePct = open === 0 ? 0 : ((last - open) / open) * 100;

  return { points, last, changePct, open };
}

function buildPath(points: PricePoint[]) {
  if (points.length === 0) {
    return { line: 'M0 125 L900 125', fill: 'M0 125 L900 125 L900 250 L0 250Z', min: 50_000, max: 50_000 };
  }

  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 1);
  const step = points.length === 1 ? 0 : VIEW_WIDTH / (points.length - 1);

  const coords = points.map((point, index) => {
    const x = points.length === 1 ? VIEW_WIDTH : index * step;
    const y = 18 + ((max - point.price) / range) * (CHART_BOTTOM - 18);
    return { x, y };
  });

  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const last = coords[coords.length - 1];
  const fill = `${line} L${last.x.toFixed(2)} ${VIEW_HEIGHT} L0 ${VIEW_HEIGHT}Z`;
  return { line, fill, min, max };
}

function formatUsdParts(price: number) {
  const [whole, fraction] = price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).split('.');
  return { whole, fraction };
}

export function PriceChart({ pair }: { pair: string }) {
  const { points, last, changePct } = useLiveTrades(pair);
  const { line, fill } = useMemo(() => buildPath(points), [points]);
  const { whole, fraction } = formatUsdParts(last);
  const positive = changePct >= 0;
  const axis = useMemo(() => {
    if (points.length === 0) return ['Waiting', '', '', '', 'Now'];
    const first = points[0].timestamp;
    const lastTime = points[points.length - 1].timestamp;
    const span = Math.max(lastTime - first, 1);
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => formatClock(first + span * ratio));
  }, [points]);

  return (
    <div className="chart-panel panel">
      <div className="chart-head">
        <div>
          <span className="eyebrow">{pair.replace('-', ' / ')} · 24h</span>
          <h1>{whole}<span>.{fraction}</span></h1>
          <span className={positive ? 'change-up' : 'change-down'}>
            {positive ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        </div>
        <div className="chart-tabs">
          <button className="selected" type="button">LIVE</button>
          <button type="button">1H</button>
          <button type="button">1D</button>
        </div>
      </div>
      <div className="chart-canvas">
        <div className="grid-lines" />
        <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${pair} live price chart`}>
          <defs>
            <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={positive ? '#45d6a2' : '#e58b80'} stopOpacity=".22" />
              <stop offset="1" stopColor={positive ? '#45d6a2' : '#e58b80'} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fill} fill="url(#chartFill)" />
          <path d={line} fill="none" stroke={positive ? '#45d6a2' : '#e58b80'} strokeWidth="2.5" />
        </svg>
        <div className="chart-axis">{axis.map((label) => <span key={label}>{label}</span>)}</div>
      </div>
    </div>
  );
}
