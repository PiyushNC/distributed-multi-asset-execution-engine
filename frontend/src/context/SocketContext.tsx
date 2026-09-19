import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:4000';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type SocketContextValue = {
  socket: Socket | null;
  status: ConnectionStatus;
  token: string;
  setToken: (token: string) => void;
  user: { userId: string; email: string; role: 'USER' | 'ADMIN' } | null;
};

const SocketContext = createContext<SocketContextValue | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(() => localStorage.getItem('accessToken') ?? '');
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [socket, setSocket] = useState<Socket | null>(null);
  const user = useMemo(() => {
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { userId: payload.userId, email: payload.email, role: payload.role === 'ADMIN' ? 'ADMIN' as const : 'USER' as const };
    } catch {
      return null;
    }
  }, [token]);

  const setToken = (nextToken: string) => {
    const cleanToken = nextToken.trim();
    setTokenState(cleanToken);
    if (cleanToken) {
      localStorage.setItem('accessToken', cleanToken);
    } else {
      localStorage.removeItem('accessToken');
    }
  };

  useEffect(() => {
    const nextSocket = io(SOCKET_URL, {
      auth: token ? { token } : undefined,
      autoConnect: true,
    });

    setSocket(nextSocket);
    setStatus('connecting');
    nextSocket.on('connect', () => setStatus('connected'));
    nextSocket.on('disconnect', () => setStatus('disconnected'));
    nextSocket.on('connect_error', () => setStatus('disconnected'));

    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [token]);

  const value = useMemo(() => ({ socket, status, token, setToken, user }), [socket, status, token, user]);
  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
}
