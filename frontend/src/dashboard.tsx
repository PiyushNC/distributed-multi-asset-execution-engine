import { useState } from 'react';

import { AuthPanel } from './components/AuthPanel';
import { AccountSection } from './components/AccountSection';
import { EngineVisualizer } from './components/EngineVisualizer';
import { OrderBook } from './components/OrderBook';
import { MarketTrades } from './components/MarketTrades';
import { OrderForm } from './components/OrderForm';
import { PriceChart, useLiveTrades } from './components/PriceChart';
import { UserOrders } from './components/UserOrders';
import { useSocket } from './context/SocketContext';

function formatUsd(price: number) {
  return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Dashboard() {
  const { status, token, setToken, user } = useSocket();
  const [pair, setPair] = useState('BTC-USD');
  const [authOpen, setAuthOpen] = useState(false);
  const { last, changePct } = useLiveTrades(pair);
  const positive = changePct >= 0;

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <div className="brand-mark"><span className="brand-symbol">◇</span><div><strong>ARC / EXECUTION</strong><span>multi-asset trading terminal</span></div></div>
        <div className="market-picker">
          <span className="status-dot" /> <strong>{pair}</strong>
          <span className="market-last">{formatUsd(last)}</span>
          <span className={positive ? 'change-up' : 'change-down'}>{positive ? '+' : ''}{changePct.toFixed(2)}%</span>
        </div>
        <div className="topbar-right">
          <span className={`connection ${status}`}><i /> {status}</span>
          <span className="network">TESTNET · USD</span>
          {user?.role === 'ADMIN' ? <EngineVisualizer /> : null}
          {token ? <button className="auth-button" onClick={() => setToken('')}>Sign out</button> : <button className="auth-button" onClick={() => setAuthOpen(true)}>Sign in</button>}
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-label">Markets</div>
          <button className={`watch-row ${pair === 'BTC-USD' ? 'selected' : ''}`} onClick={() => setPair('BTC-USD')} type="button"><span className="watch-icon">₿</span><span><strong>BTC / USD</strong><small>Bitcoin</small></span><b className={pair === 'BTC-USD' && !positive ? 'change-down' : undefined}>{pair === 'BTC-USD' ? `${positive ? '+' : ''}${changePct.toFixed(2)}%` : '—'}</b></button>
          <button className={`watch-row ${pair === 'ETH-USD' ? 'selected' : ''}`} onClick={() => setPair('ETH-USD')} type="button"><span className="watch-icon eth">Ξ</span><span><strong>ETH / USD</strong><small>Ethereum</small></span><b>—</b></button>
          <button className={`watch-row ${pair === 'SOL-USD' ? 'selected' : ''}`} onClick={() => setPair('SOL-USD')} type="button"><span className="watch-icon sol">S</span><span><strong>SOL / USD</strong><small>Solana</small></span><b>—</b></button>
          <div className="sidebar-spacer" />
          <div className="sidebar-label">Account</div>
          <AccountSection onLogout={() => setToken('')} />
          <div className="sidebar-footer">v0.8.0 · execution engine</div>
        </aside>
        <section className="main-column">
          <PriceChart pair={pair} />
          <div className="market-grid"><OrderBook pair={pair} /><MarketTrades pair={pair} /></div>
          <UserOrders />
        </section>
        <aside className="right-column"><OrderForm pair={pair} /><div className="risk-note"><span>◎</span><div><strong>Execution protected</strong><p>Orders settle atomically through the matching engine.</p></div></div></aside>
      </div>
      {authOpen ? <AuthPanel onClose={() => setAuthOpen(false)} /> : null}
    </main>
  );
}
