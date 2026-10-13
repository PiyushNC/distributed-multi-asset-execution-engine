import { useEffect, useState, type FormEvent } from 'react';

import { useSocket } from '../context/SocketContext';
import type { AccountBalance } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';
const initialBalance: AccountBalance = { assetBalance: {}, quoteBalance: {} };

function isAccountBalance(value: unknown): value is AccountBalance {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AccountBalance>;
  return Boolean(candidate.assetBalance && typeof candidate.assetBalance === 'object'
    && candidate.quoteBalance && typeof candidate.quoteBalance === 'object');
}

export function OrderForm({ pair }: { pair: string }) {
  const { socket, token } = useSocket();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [price, setPrice] = useState('50000');
  const [quantity, setQuantity] = useState('0.1');
  const [balance, setBalance] = useState<AccountBalance>(initialBalance);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const [baseAsset, quoteAsset] = pair.split('-');
  const quoteAvailable = balance.quoteBalance?.[quoteAsset] ?? 0;
  const baseAvailable = balance.assetBalance?.[baseAsset] ?? 0;

  useEffect(() => {
    if (!socket) return;
    const handleBalance = (nextBalance: AccountBalance) => {
      if (isAccountBalance(nextBalance)) setBalance(nextBalance);
    };
    socket.on('balance:updated', handleBalance);
    return () => {
      socket.off('balance:updated', handleBalance);
    };
  }, [socket]);

  useEffect(() => {
    if (!token) return;
    void fetch(`${API_URL}/api/account`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok || !isAccountBalance(data)) return;
        setBalance(data);
      })
      .catch(() => undefined);
  }, [token]);

  async function submitOrder(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      setMessage('Sign in before placing an order.');
      setToast({ kind: 'error', text: 'Sign in before placing an order.' });
      return;
    }
    setMessage('Submitting to execution queue...');
    try {
      const body: Record<string, unknown> = {
        pair,
        side,
        type: orderType,
        quantity: Number(quantity),
      };
      if (orderType === 'LIMIT') {
        body.price = Number(price);
      }
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { message?: string; order?: { status: string } };
      if (!response.ok) throw new Error(data.message ?? 'Order could not be submitted');
      setMessage(`Queued · ${data.order?.status ?? 'PENDING'}`);
      setToast({ kind: 'success', text: `${side} ${orderType} order queued for execution.` });
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Order could not be submitted';
      setMessage(text);
      setToast({ kind: 'error', text });
    }
  }

  return (
    <section className="panel order-form-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Execution</span><h2>Place order</h2></div>
        <div className="order-type-toggle">
          <button
            className={orderType === 'LIMIT' ? 'type-active' : ''}
            onClick={() => setOrderType('LIMIT')}
            type="button"
          >
            LIMIT
          </button>
          <button
            className={orderType === 'MARKET' ? 'type-active' : ''}
            onClick={() => setOrderType('MARKET')}
            type="button"
          >
            MARKET
          </button>
        </div>
      </div>
      <div className="side-toggle">
        <button className={side === 'BUY' ? 'active buy-action' : ''} onClick={() => setSide('BUY')} type="button">Buy {baseAsset}</button>
        <button className={side === 'SELL' ? 'active sell-action' : ''} onClick={() => setSide('SELL')} type="button">Sell {baseAsset}</button>
      </div>
      <form onSubmit={submitOrder}>
        {orderType === 'LIMIT' ? (
          <label>
            Limit price <span>{quoteAsset}</span>
            <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
          </label>
        ) : (
          <div className="market-order-notice">
            <span>⚡</span>
            <span>Market order — fills at best available price</span>
          </div>
        )}
        <label>Quantity <span>{baseAsset}</span><input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        <div className="available-row">
          <span>Available</span>
          <strong>{side === 'BUY' ? `${quoteAvailable.toLocaleString()} ${quoteAsset}` : `${baseAvailable} ${baseAsset}`}</strong>
        </div>
        <button className={`submit-order ${side.toLowerCase()}`} type="submit">
          {side} {orderType === 'MARKET' ? 'at market' : `${baseAsset} →`}
          <span>{orderType === 'MARKET' ? '⚡' : '→'}</span>
        </button>
      </form>
      {!token ? <p className="form-message">Sign in above to place orders.</p> : null}
      {message ? <p className="form-message">{message}</p> : null}
      {toast ? <div className={`toast toast-${toast.kind}`} role="status"><span>{toast.kind === 'success' ? '✓' : '!'}</span>{toast.text}<button onClick={() => setToast(null)} type="button">×</button></div> : null}
    </section>
  );
}
