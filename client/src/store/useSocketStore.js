import { create } from 'zustand';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
const TYPING_TIMEOUT = 5000; // 5 seconds

const useSocketStore = create((set, get) => ({
  socket: null,
  isConnected: false,
  onlineMembers: [],
  typingUsers: {}, // { taskId: [{ userId, userName }] }
  typingTimeouts: {}, // { taskId_userId: timeoutId }
  currentBoardId: null, // Track current board for reconnect sync
  onReconnectSync: null, // Callback for board sync on reconnect

  connect: (token) => {
    const existingSocket = get().socket;
    if (existingSocket?.connected) return;

    // Disconnect existing socket if any to prevent duplicate listeners
    if (existingSocket) {
      existingSocket.disconnect();
    }

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    // Store references to handlers for cleanup
    const handleConnect = () => {
      set({ isConnected: true });
      // On reconnect, re-join current board and trigger sync
      const { currentBoardId } = get();
      if (currentBoardId) {
        socket.emit('join-board', { boardId: currentBoardId });
        // Trigger sync callback to re-fetch board state
        const { onReconnectSync } = get();
        if (onReconnectSync) {
          onReconnectSync(currentBoardId);
        }
      }
    };
    const handleDisconnect = () => {
      // Clear all typing timeouts on disconnect
      const { typingTimeouts } = get();
      Object.values(typingTimeouts).forEach((timeoutId) => clearTimeout(timeoutId));
      set({ isConnected: false, onlineMembers: [], typingUsers: {}, typingTimeouts: {} });
    };
    const handleMembersOnline = ({ userIds }) => set({ onlineMembers: userIds });
    const handleTypingStart = ({ taskId, userId }) => {
      const { typingTimeouts } = get();
      const timeoutKey = `${taskId}_${userId}`;

      // Clear existing timeout for this user if any
      if (typingTimeouts[timeoutKey]) {
        clearTimeout(typingTimeouts[timeoutKey]);
      }

      // Set new timeout to auto-clear typing state
      const timeoutId = setTimeout(() => {
        set((state) => ({
          typingUsers: {
            ...state.typingUsers,
            [taskId]: (state.typingUsers[taskId] || []).filter((u) => u.userId !== userId),
          },
          typingTimeouts: {
            ...state.typingTimeouts,
            [timeoutKey]: undefined,
          },
        }));
      }, TYPING_TIMEOUT);

      set((state) => ({
        typingUsers: {
          ...state.typingUsers,
          [taskId]: [...(state.typingUsers[taskId] || []).filter((u) => u.userId !== userId), { userId }],
        },
        typingTimeouts: {
          ...state.typingTimeouts,
          [timeoutKey]: timeoutId,
        },
      }));
    };
    const handleTypingStop = ({ taskId, userId }) => {
      const { typingTimeouts } = get();
      const timeoutKey = `${taskId}_${userId}`;

      // Clear timeout if exists
      if (typingTimeouts[timeoutKey]) {
        clearTimeout(typingTimeouts[timeoutKey]);
      }

      set((state) => ({
        typingUsers: {
          ...state.typingUsers,
          [taskId]: (state.typingUsers[taskId] || []).filter((u) => u.userId !== userId),
        },
        typingTimeouts: {
          ...state.typingTimeouts,
          [timeoutKey]: undefined,
        },
      }));
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('members:online', handleMembersOnline);
    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);

    // Store cleanup function on socket instance
    socket._cleanup = () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('members:online', handleMembersOnline);
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
    };

    set({ socket });
  },

  disconnect: () => {
    const { socket, typingTimeouts } = get();
    if (socket) {
      // Clear all typing timeouts
      Object.values(typingTimeouts).forEach((timeoutId) => {
        if (timeoutId) clearTimeout(timeoutId);
      });
      // Call cleanup function if exists
      if (socket._cleanup) {
        socket._cleanup();
        delete socket._cleanup;
      }
      socket.disconnect();
      set({ socket: null, isConnected: false, onlineMembers: [], typingUsers: {}, typingTimeouts: {}, currentBoardId: null });
    }
  },

  joinBoard: (boardId) => {
    set({ currentBoardId: boardId });
    get().socket?.emit('join-board', { boardId });
  },

  leaveBoard: (boardId) => {
    set({ currentBoardId: null });
    get().socket?.emit('leave-board', { boardId });
  },

  setReconnectSync: (callback) => {
    set({ onReconnectSync: callback });
  },

  emitTypingStart: (boardId, taskId) => {
    get().socket?.emit('typing:start', { boardId, taskId });
  },

  emitTypingStop: (boardId, taskId) => {
    get().socket?.emit('typing:stop', { boardId, taskId });
  },
}));

export default useSocketStore;
