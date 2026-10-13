import { useEffect, useState } from 'react';

import { useSocket } from '../context/SocketContext';
import type { UserOrder } from '../types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function orderId(order: UserOrder) { return order._id ?? order.id ?? ''; }

function formatTime(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function UserOrders() {
  const { socket, token } = useSocket();
  const [orders, setOrders] = useState<UserOrder[]>([]);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/orders`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.json())
      .then((data: { orders?: UserOrder[] }) => setOrders(data.orders ?? []))
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const handleOrder = (updated: UserOrder) => {
      setOrders((current) => {
        const index = current.findIndex((order) => orderId(order) === orderId(updated));
        if (index === -1) return [updated, ...current];
        const next = [...current];
        next[index] = { ...next[index], ...updated };
        return next;
      });
    };
    socket.on('order:updated', handleOrder);
    return () => {
      socket.off('order:updated', handleOrder);
    };
  }, [socket]);

  async function cancelOrder(order: UserOrder) {
    const response = await fetch(`${API_URL}/api/orders/${orderId(order)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const data = await response.json() as { order: UserOrder };
      setOrders((current) => current.map((item) => orderId(item) === orderId(order) ? data.order : item));
    }
  }

  return (
    <section className="panel user-orders-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Your activity</span><h2>Orders</h2></div>
        <span className="muted">{orders.length} total</span>
      </div>
      <div className="orders-table">
        <div className="orders-header">
          <span>Pair</span>
          <span>Side</span>
          <span>Price</span>
          <span>Filled</span>
          <span>Type</span>
          <span>Status</span>
          <span>Time</span>
          <span />
        </div>
        {orders.length === 0 ? <div className="empty-state">Authenticate to load orders</div> : null}
        {orders.map((order) => (
          <div className="orders-row" key={orderId(order)}>
            <strong>{order.pair}</strong>
            <span className={order.side === 'BUY' ? 'buy-text' : 'sell-text'}>{order.side}</span>
            <span>{order.type === 'MARKET' ? 'MKT' : order.price.toLocaleString()}</span>
            <span>{order.filledQuantity.toFixed(4)} / {order.quantity.toFixed(4)}</span>
            <span className={`order-type-badge ${order.type === 'MARKET' ? 'type-market' : 'type-limit'}`}>
              {order.type}
            </span>
            <span className={`status status-${order.status.toLowerCase()}`}>{order.status}</span>
            <span className="order-time">{formatTime(order.createdAt)}</span>
            <span>{order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED' ? <button className="cancel-order" onClick={() => void cancelOrder(order)}>Cancel</button> : null}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
