import { useEffect, useMemo, useState } from 'react';

import { useSocket } from '../context/SocketContext';
import { useLiveTrades } from './PriceChart';
import type { AccountBalance } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function decodeToken(token: string): { userId: string; email: string; expiresAt: string; role: string } {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      userId: payload.userId ?? 'Unknown',
      email: payload.email ?? 'Unknown',
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toLocaleString() : 'Unknown',
      role: payload.role ?? 'USER',
    };
  } catch {
    return { userId: 'Unknown', email: 'Unknown', expiresAt: 'Unknown', role: 'USER' };
  }
}

function PortfolioValue({ balance }: { balance: AccountBalance }) {
  const { last: btcPrice } = useLiveTrades('BTC-USD');
  const { last: ethPrice } = useLiveTrades('ETH-USD');
  const { last: solPrice } = useLiveTrades('SOL-USD');

  const usd = balance.quoteBalance?.USD ?? 0;
  const btc = balance.assetBalance?.BTC ?? 0;
  const eth = balance.assetBalance?.ETH ?? 0;
  const sol = balance.assetBalance?.SOL ?? 0;

  const total = usd + btc * btcPrice + eth * ethPrice + sol * solPrice;

  return (
    <div className="portfolio-total">
      <span>Est. portfolio value</span>
      <strong>${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
    </div>
  );
}

export function AccountSection({ onLogout }: { onLogout: () => void }) {
  const { socket, token } = useSocket();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<AccountBalance>({ assetBalance: {}, quoteBalance: {} });
  const identity = useMemo(() => decodeToken(token), [token]);

  useEffect(() => {
    if (!token) return;
    void fetch(`${API_URL}/api/account`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() as Promise<AccountBalance> : null)
      .then((next) => { if (next) setBalance(next); })
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const handleBalance = (next: AccountBalance) => setBalance(next);
    socket.on('balance:updated', handleBalance);
    return () => { socket.off('balance:updated', handleBalance); };
  }, [socket]);

  const assets = [
    { label: 'BTC', value: (balance.assetBalance?.BTC ?? 0).toFixed(6), unit: 'BTC' },
    { label: 'ETH', value: (balance.assetBalance?.ETH ?? 0).toFixed(4), unit: 'ETH' },
    { label: 'SOL', value: (balance.assetBalance?.SOL ?? 0).toFixed(2), unit: 'SOL' },
    { label: 'USD', value: `$${(balance.quoteBalance?.USD ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, unit: '' },
  ];

  return (
    <>
      <button className="account-card account-trigger" onClick={() => setOpen(true)} type="button">
        <span className="account-avatar">{identity.email.slice(0, 2).toUpperCase()}</span>
        <span><strong>Trading account</strong><small>{token ? identity.email : 'Sign in to trade'}</small></span>
        <span className="account-chevron">›</span>
      </button>
      {open ? (
        <div className="account-backdrop" onClick={() => setOpen(false)} role="presentation">
          <aside className="account-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setOpen(false)} type="button">×</button>
            <span className="eyebrow">Account</span>
            <h2>Trading account</h2>
            <p className="account-email">{identity.email}</p>
            <div className="account-detail"><span>User ID</span><code>{identity.userId}</code></div>
            <div className="account-detail"><span>Role</span><strong>{identity.role}</strong></div>
            <div className="account-detail"><span>JWT expires</span><strong>{identity.expiresAt}</strong></div>
            <div className="balance-grid">
              {assets.map((asset) => (
                <div key={asset.label}>
                  <span>{asset.label} available</span>
                  <strong>{asset.value}{asset.unit ? ` ${asset.unit}` : ''}</strong>
                </div>
              ))}
            </div>
            {token ? <PortfolioValue balance={balance} /> : null}
            <button className="logout-button" onClick={() => { setOpen(false); onLogout(); }} type="button">Log out</button>
          </aside>
        </div>
      ) : null}
    </>
  );
}
