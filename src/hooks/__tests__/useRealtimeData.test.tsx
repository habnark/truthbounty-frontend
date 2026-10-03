import React from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUnsubscribe = jest.fn();
const mockSubscribe = jest.fn(() => mockUnsubscribe);

jest.mock('../../components/providers/WebSocketProvider', () => ({
  useWebSocketContext: () => ({
    subscribe: mockSubscribe,
    isConnected: true,
  }),
}));

jest.mock('../../app/queries/queryKeys', () => ({
  queryKeys: {
    claims: {
      all: ['claims'],
      detail: (id: string) => ['claims', id],
    },
    leaderboard: ['leaderboard'],
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useRealtimeData - memory leak fix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls unsubscribe for all subscriptions on unmount', async () => {
    const { useRealtimeData } = await import('../../hooks/useRealtimeData');
    const { unmount } = renderHook(() => useRealtimeData(), { wrapper });

    expect(mockSubscribe).toHaveBeenCalledTimes(8);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(8);
  });

  it('useRealtimeLeaderboard calls unsubscribe on unmount', async () => {
    const { useRealtimeLeaderboard } = await import('../../hooks/useRealtimeData');
    const { unmount } = renderHook(() => useRealtimeLeaderboard(), { wrapper });

    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
