import { useState, useCallback, useEffect } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import KanbanColumn from './KanbanColumn';
import TaskCard from './TaskCard';
import { tasksApi } from '../../api/tasks';
import { queryKeys } from '../../api/queryKeys';
import { getInsertPosition } from '../../utils/positionClient';
import useSocketStore from '../../store/useSocketStore';
import useAuthStore from '../../store/useAuthStore';
import { registerSocketHandlers } from '../../socket/socketManager';

const KanbanBoard = ({ board, tasks = [], boardId }) => {
  const [activeTask, setActiveTask] = useState(null);
  const queryClient = useQueryClient();
  const { socket } = useSocketStore();
  const { user } = useAuthStore();

  // Register socket event handlers for real-time sync
  useEffect(() => {
    if (!socket || !boardId) return;
    const cleanup = registerSocketHandlers(socket, queryClient, boardId, user?._id);
    return cleanup;
  }, [socket, boardId, queryClient, user?._id]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const columns = [...(board?.columns || [])].sort((a, b) => a.position - b.position);

  const getTasksForColumn = useCallback(
    (columnId) =>
      tasks
        .filter((t) => t.columnId === columnId && !t.isArchived)
        .sort((a, b) => a.position - b.position),
    [tasks]
  );

  const handleDragStart = ({ active }) => {
    const task = tasks.find((t) => t._id === active.id);
    setActiveTask(task);
  };

  const handleDragEnd = async ({ active, over }) => {
    setActiveTask(null);
    if (!over || active.id === over.id) return;

    const taskId = active.id;
    const task = tasks.find((t) => t._id === taskId);
    if (!task) return;

    // Store previous state for rollback
    const previousColumnId = task.columnId;
    const previousPosition = task.position;

    // Determine target column (over could be a column id or a task id)
    let toColumnId = over.id;
    const overTask = tasks.find((t) => t._id === over.id);
    if (overTask) toColumnId = overTask.columnId;

    const columnTasks = getTasksForColumn(toColumnId).filter((t) => t._id !== taskId);
    const overIndex = overTask ? columnTasks.findIndex((t) => t._id === over.id) : columnTasks.length;

    const before = columnTasks[overIndex - 1]?.position ?? null;
    const after = columnTasks[overIndex]?.position ?? null;
    const newPosition = getInsertPosition(before, after);

    // Optimistic update
    queryClient.setQueryData(queryKeys.boards.tasks(boardId, {}), (old) =>
      old?.map((t) =>
        t._id === taskId ? { ...t, columnId: toColumnId, position: newPosition } : t
      )
    );

    try {
      await tasksApi.move(boardId, taskId, { columnId: toColumnId, position: newPosition });
    } catch {
      // Rollback to previous state (no network request)
      queryClient.setQueryData(queryKeys.boards.tasks(boardId, {}), (old) =>
        old?.map((t) =>
          t._id === taskId ? { ...t, columnId: previousColumnId, position: previousPosition } : t
        )
      );
      toast.error('Failed to move task');
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveTask(null)}
    >
      <div className="flex gap-4 overflow-x-auto pb-6 h-full">
        {columns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={getTasksForColumn(column.id)}
            boardId={boardId}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeTask && <TaskCard task={activeTask} boardId={boardId} isDragging />}
      </DragOverlay>
    </DndContext>
  );
};

export default KanbanBoard;
