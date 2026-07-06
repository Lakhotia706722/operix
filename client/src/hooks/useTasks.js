import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { tasksApi } from '../api/tasks';
import { queryKeys } from '../api/queryKeys';

export const useBoardTasksList = (boardId, filters = {}) =>
  useQuery({
    queryKey: queryKeys.boards.tasks(boardId, filters),
    queryFn: () => tasksApi.getAll(boardId, filters),
    enabled: !!boardId,
    staleTime: 30000,
  });

export const useTask = (boardId, taskId) =>
  useQuery({
    queryKey: queryKeys.tasks.detail(taskId),
    queryFn: () => tasksApi.getOne(boardId, taskId),
    enabled: !!boardId && !!taskId,
    retry: false,
    onError: (err) => {
      // If task not found (404), it may have been deleted by another user
      if (err.response?.status === 404) {
        // Let the component handle this case
        throw err;
      }
    },
  });

export const useTaskComments = (boardId, taskId, page = 1) =>
  useQuery({
    queryKey: queryKeys.tasks.comments(taskId, page),
    queryFn: () => tasksApi.getComments(boardId, taskId, page),
    enabled: !!boardId && !!taskId,
    staleTime: 0,
  });

export const useCreateTask = (boardId) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => tasksApi.create(boardId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.tasks(boardId) });
      toast.success('Task created');
    },
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to create task'),
  });
};

export const useUpdateTask = (boardId, taskId) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => tasksApi.update(boardId, taskId, data),
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks.detail(taskId) });
      const prev = queryClient.getQueryData(queryKeys.tasks.detail(taskId));
      queryClient.setQueryData(queryKeys.tasks.detail(taskId), (old) => old ? { ...old, ...data } : old);
      return { prev };
    },
    onError: (err, _, context) => {
      if (context?.prev) queryClient.setQueryData(queryKeys.tasks.detail(taskId), context.prev);
      if (err.response?.data?.error?.code === 'VERSION_CONFLICT') {
        toast.error('This task was modified by another user. Please refresh.');
      } else {
        toast.error(err.response?.data?.error?.message || 'Failed to update task');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.tasks(boardId) });
    },
  });
};

export const useMoveTask = (boardId) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, columnId, position }) => tasksApi.move(boardId, taskId, { columnId, position }),
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.tasks(boardId) });
      toast.error('Move failed. Board refreshed.');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.tasks(boardId) });
    },
  });
};

export const useDeleteTask = (boardId) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId) => tasksApi.delete(boardId, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.boards.tasks(boardId) });
      toast.success('Task deleted');
    },
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to delete task'),
  });
};

export const useAddComment = (boardId, taskId) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => tasksApi.addComment(boardId, taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId, 1) });
    },
    onError: (err) => toast.error(err.response?.data?.error?.message || 'Failed to add comment'),
  });
};
