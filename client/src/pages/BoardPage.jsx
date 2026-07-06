import { useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart2, Users } from 'lucide-react';
import { useBoard } from '../hooks/useBoards';
import { useBoardTasksList } from '../hooks/useTasks';
import useSocketStore from '../store/useSocketStore';
import useUIStore from '../store/useUIStore';
import useAuthStore from '../store/useAuthStore';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queryKeys';
import Navbar from '../components/layout/Navbar';
import KanbanBoard from '../components/kanban/KanbanBoard';
import FilterBar from '../components/filters/FilterBar';
import TaskModal from '../components/task/TaskModal';
import Modal from '../components/ui/Modal';
import { TaskCardSkeleton } from '../components/ui/Skeleton';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import { AvatarGroup } from '../components/ui/Avatar';
import { isOverdue } from '../utils/dates';

const BoardPage = () => {
  const { boardId } = useParams();
  const { user } = useAuthStore();
  const { filters, activeModal, activeTaskId, closeModal } = useUIStore();
  const { joinBoard, leaveBoard, connect, isConnected, onlineMembers, setReconnectSync } = useSocketStore();
  const queryClient = useQueryClient();

  const { data: board, isLoading: boardLoading } = useBoard(boardId);
  const { data: tasks = [], isLoading: tasksLoading } = useBoardTasksList(boardId, {});

  // Re-sync function for reconnect
  const handleReconnectSync = useCallback((syncBoardId) => {
    if (syncBoardId === boardId) {
      // Invalidate queries to re-fetch fresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.detail(boardId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.tasks(boardId, {}) });
    }
  }, [boardId, queryClient]);

  // Set reconnect sync callback
  useEffect(() => {
    setReconnectSync(handleReconnectSync);
  }, [handleReconnectSync, setReconnectSync]);

  // Connect socket + join board room
  useEffect(() => {
    if (!isConnected) {
      // Access token from cookie — socket connects with it
      const token = document.cookie
        .split(';')
        .find((c) => c.trim().startsWith('access_token='))
        ?.split('=')[1];
      if (token) connect(token);
    }
  }, [isConnected, connect]);

  useEffect(() => {
    if (boardId && isConnected) {
      joinBoard(boardId);
      return () => leaveBoard(boardId);
    }
  }, [boardId, isConnected, joinBoard, leaveBoard]);

  // Apply client-side filters
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (task.isArchived) return false;
      if (filters.priority.length > 0 && !filters.priority.includes(task.priority)) return false;
      if (filters.assignee.length > 0) {
        const taskAssigneeIds = (task.assignedTo || []).map((u) => u._id || u.toString());
        if (!filters.assignee.some((id) => taskAssigneeIds.includes(id))) return false;
      }
      if (filters.label.length > 0) {
        if (!filters.label.some((l) => task.labels?.includes(l))) return false;
      }
      if (filters.dueDate) {
        const now = new Date();
        const due = task.dueDate ? new Date(task.dueDate) : null;
        if (!due) return false;
        if (filters.dueDate === 'overdue' && !isOverdue(due)) return false;
        if (filters.dueDate === 'today') {
          const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
          if (due < startOfDay || due > endOfDay) return false;
        }
        if (filters.dueDate === 'week') {
          const endOfWeek = new Date(now); endOfWeek.setDate(endOfWeek.getDate() + 7);
          if (due > endOfWeek) return false;
        }
        if (filters.dueDate === 'month') {
          const endOfMonth = new Date(now); endOfMonth.setDate(endOfMonth.getDate() + 30);
          if (due > endOfMonth) return false;
        }
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!task.title?.toLowerCase().includes(q) && !task.description?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filters]);

  const onlineUsers = useMemo(() => {
    if (!board) return [];
    return board.members
      ?.filter((m) => onlineMembers.includes(m.user._id?.toString() || m.user.toString()))
      .map((m) => m.user)
      .filter(Boolean);
  }, [board, onlineMembers]);

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)] overflow-hidden">
      <Navbar
        title={board?.title}
        right={
          <div className="flex items-center gap-3">
            {onlineUsers.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
                <AvatarGroup users={onlineUsers} max={4} size="xs" />
              </div>
            )}
            <Link
              to={`/boards/${boardId}/analytics`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-secondary)]
                hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-btn transition-colors"
            >
              <BarChart2 size={14} />
              <span className="hidden sm:block">Analytics</span>
            </Link>
          </div>
        }
      />

      <div className="px-6 py-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        {!boardLoading && (
          <FilterBar
            boardMembers={board?.members || []}
            boardLabels={board?.labels || []}
          />
        )}
      </div>

      <main className="flex-1 overflow-hidden px-6 py-4">
        <ErrorBoundary>
          {boardLoading || tasksLoading ? (
            <div className="flex gap-4">
              {Array.from({ length: 4 }).map((_, colIdx) => (
                <div key={colIdx} className="w-72 shrink-0 space-y-2">
                  <div className="skeleton h-4 w-24 mb-4" />
                  {Array.from({ length: 3 }).map((_, i) => <TaskCardSkeleton key={i} />)}
                </div>
              ))}
            </div>
          ) : board ? (
            <KanbanBoard board={board} tasks={filteredTasks} boardId={boardId} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-[var(--text-muted)]">Board not found</p>
            </div>
          )}
        </ErrorBoundary>
      </main>

      {/* Task detail modal */}
      <Modal
        isOpen={activeModal === 'task-detail' && !!activeTaskId}
        onClose={closeModal}
        size="xl"
        hideClose={false}
      >
        {activeModal === 'task-detail' && activeTaskId && (
          <TaskModal boardId={boardId} taskId={activeTaskId} />
        )}
      </Modal>
    </div>
  );
};

export default BoardPage;
