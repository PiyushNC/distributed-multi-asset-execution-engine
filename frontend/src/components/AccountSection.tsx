import { useEffect, useMemo, useState } from 'react';

import { useSocket } from '../context/SocketContext';
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

  return (
    <>
      <button className="account-card account-trigger" onClick={() => setOpen(true)} type="button">
        <span className="account-avatar">TA</span>
        <span><strong>Trading account</strong><small>{token ? 'Authenticated' : 'Sign in to trade'}</small></span>
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
              <div><span>USD available</span><strong>${(balance.quoteBalance.USD ?? 0).toLocaleString()}</strong></div>
              <div><span>BTC available</span><strong>{(balance.assetBalance.BTC ?? 0).toFixed(4)}</strong></div>
            </div>
            <button className="logout-button" onClick={() => { setOpen(false); onLogout(); }} type="button">Log out</button>
          </aside>
        </div>
      ) : null}
    </>
  );
}
