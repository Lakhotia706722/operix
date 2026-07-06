/**
 * Socket event handler that wires socket.io events to React Query cache + Zustand store.
 * Call registerSocketHandlers(socket, queryClient, boardId, currentUserId) when joining a board.
 *
 * Note: Handlers extract boardId from event payloads to avoid stale closure issues.
 * This ensures handlers work correctly even if boardId changes between registrations.
 */
import { queryKeys } from '../api/queryKeys';

export const registerSocketHandlers = (socket, queryClient, boardId, currentUserId) => {
  // Store handler references for cleanup
  const handlers = {};

  // ── Task events ────────────────────────────────────────────────────────────

  handlers['task:created'] = ({ task, createdBy }) => {
    // Skip if created by current user (optimistic update already applied)
    if (createdBy === currentUserId) return;

    const taskBoardId = task.board || task.boardId || boardId;
    const boardTasksKey = queryKeys.boards.tasks(taskBoardId, {});
    queryClient.setQueryData(boardTasksKey, (old) =>
      old ? [...old, task] : [task]
    );
  };

  handlers['task:updated'] = ({ taskId, changes, task, updatedBy }) => {
    // Skip if updated by current user (optimistic update already applied)
    if (updatedBy === currentUserId) return;

    // If full task is provided, use it; otherwise apply changes
    if (task) {
      const taskBoardId = task.board || task.boardId || boardId;
      const boardTasksKey = queryKeys.boards.tasks(taskBoardId, {});
      queryClient.setQueryData(boardTasksKey, (old) =>
        old?.map((t) => (t._id === taskId ? task : t))
      );
      queryClient.setQueryData(queryKeys.tasks.detail(taskId), task);
    } else {
      const boardTasksKey = queryKeys.boards.tasks(boardId, {});
      queryClient.setQueryData(boardTasksKey, (old) =>
        old?.map((t) => (t._id === taskId ? { ...t, ...changes } : t))
      );
      queryClient.setQueryData(queryKeys.tasks.detail(taskId), (old) =>
        old ? { ...old, ...changes } : old
      );
    }
  };

  handlers['task:moved'] = ({ taskId, toColumn, position, movedBy, board: eventBoardId }) => {
    if (movedBy === currentUserId) return; // already applied optimistically
    const taskBoardId = eventBoardId || boardId;
    const boardTasksKey = queryKeys.boards.tasks(taskBoardId, {});
    queryClient.setQueryData(boardTasksKey, (old) =>
      old?.map((t) =>
        t._id === taskId ? { ...t, columnId: toColumn, position } : t
      )
    );
  };

  handlers['task:deleted'] = ({ taskId, board: eventBoardId, deletedBy }) => {
    // Skip if deleted by current user (optimistic update already applied)
    if (deletedBy === currentUserId) return;

    const taskBoardId = eventBoardId || boardId;
    const boardTasksKey = queryKeys.boards.tasks(taskBoardId, {});
    queryClient.setQueryData(boardTasksKey, (old) =>
      old?.filter((t) => t._id !== taskId)
    );
  };

  handlers['task:archived'] = ({ taskId, board: eventBoardId, archivedBy }) => {
    // Skip if archived by current user (optimistic update already applied)
    if (archivedBy === currentUserId) return;

    const taskBoardId = eventBoardId || boardId;
    const boardTasksKey = queryKeys.boards.tasks(taskBoardId, {});
    queryClient.setQueryData(boardTasksKey, (old) =>
      old?.filter((t) => t._id !== taskId)
    );
  };

  // ── Comment events ─────────────────────────────────────────────────────────

  handlers['comment:added'] = ({ taskId, comment }) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId, 1) });
  };

  handlers['comment:updated'] = ({ commentId, content }) => {
    // Invalidate comment queries that may contain this comment
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  handlers['comment:deleted'] = ({ commentId, taskId }) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId, 1) });
  };

  // ── Board events ───────────────────────────────────────────────────────────

  handlers['board:updated'] = ({ board }) => {
    const eventBoardId = board._id || boardId;
    queryClient.setQueryData(queryKeys.boards.detail(eventBoardId), (old) =>
      old ? { ...old, ...board } : board
    );
  };

  handlers['board:deleted'] = ({ boardId: deletedBoardId }) => {
    // Remove board from cache
    queryClient.removeQueries({ queryKey: queryKeys.boards.detail(deletedBoardId) });
    queryClient.removeQueries({ queryKey: queryKeys.boards.tasks(deletedBoardId, {}) });
  };

  // Register all handlers
  Object.entries(handlers).forEach(([event, handler]) => {
    socket.on(event, handler);
  });

  // Return cleanup function
  return () => {
    Object.keys(handlers).forEach((event) => {
      socket.off(event, handlers[event]);
    });
  };
};
