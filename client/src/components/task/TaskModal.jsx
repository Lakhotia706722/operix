import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  X, Plus, Trash2, Paperclip, Archive, Eye, Flag,
  Calendar, Clock, Tag, Users, CheckSquare, Save,
} from 'lucide-react';
import MDEditor from '@uiw/react-md-editor';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';

import { useTask, useUpdateTask, useDeleteTask, useAddComment, useTaskComments } from '../../hooks/useTasks';
import { tasksApi } from '../../api/tasks';
import { queryKeys } from '../../api/queryKeys';
import useUIStore from '../../store/useUIStore';
import useAuthStore from '../../store/useAuthStore';
import useSocketStore from '../../store/useSocketStore';
import { useDebounce } from '../../hooks/useDebounce';
import { getPriorityConfig, PRIORITY_CONFIG } from '../../utils/priority';
import { relativeTime, formatDate } from '../../utils/dates';
import Avatar, { AvatarGroup } from '../ui/Avatar';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';

const SAVE_DEBOUNCE = 800;

const TaskModal = ({ boardId, taskId }) => {
  const { closeModal } = useUIStore();
  const { user } = useAuthStore();
  const { emitTypingStart, emitTypingStop } = useSocketStore();
  const queryClient = useQueryClient();

  const { data: task, isLoading, error } = useTask(boardId, taskId);
  const updateTask = useUpdateTask(boardId, taskId);
  const deleteTask = useDeleteTask(boardId);
  const addComment = useAddComment(boardId, taskId);
  const { data: commentsData } = useTaskComments(boardId, taskId, 1);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved'
  const [newComment, setNewComment] = useState('');
  const [newCheckItem, setNewCheckItem] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(null); // 'due' | 'start' | null
  const [confirmDelete, setConfirmDelete] = useState(false);

  const debouncedTitle = useDebounce(title, SAVE_DEBOUNCE);
  const debouncedDesc = useDebounce(description, SAVE_DEBOUNCE);
  const titleInitialized = useRef(false);
  const descInitialized = useRef(false);

  // Handle task deletion by another user
  useEffect(() => {
    if (error?.response?.status === 404) {
      toast.error('This task was deleted by another user');
      closeModal();
    }
  }, [error, closeModal]);

  // Handle version conflict - refresh task data
  const handleVersionConflict = useCallback(() => {
    // Refetch task data to get latest version
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
    toast.success('Task refreshed with latest changes');
  }, [taskId, queryClient]);

  // Sync task data into local state
  useEffect(() => {
    if (task && !titleInitialized.current) {
      setTitle(task.title);
      setDescription(task.description || '');
      titleInitialized.current = true;
      descInitialized.current = true;
    }
  }, [task]);

  // Auto-save title
  useEffect(() => {
    if (!titleInitialized.current || !debouncedTitle || debouncedTitle === task?.title) return;
    setSaveStatus('saving');
    updateTask.mutate({ title: debouncedTitle, version: task?.version }, {
      onSuccess: () => { setSaveStatus('saved'); setTimeout(() => setSaveStatus(''), 2000); },
      onError: (err) => {
        setSaveStatus('');
        if (err.response?.data?.error?.code === 'VERSION_CONFLICT') {
          handleVersionConflict();
        }
      },
    });
  }, [debouncedTitle, task?.version, updateTask, handleVersionConflict]);

  // Auto-save description
  useEffect(() => {
    if (!descInitialized.current || debouncedDesc === task?.description) return;
    setSaveStatus('saving');
    updateTask.mutate({ description: debouncedDesc, version: task?.version }, {
      onSuccess: () => { setSaveStatus('saved'); setTimeout(() => setSaveStatus(''), 2000); },
      onError: (err) => {
        setSaveStatus('');
        if (err.response?.data?.error?.code === 'VERSION_CONFLICT') {
          handleVersionConflict();
        }
      },
    });
  }, [debouncedDesc, task?.version, updateTask, handleVersionConflict]);

  const handleFieldUpdate = (field, value) => {
    updateTask.mutate({ [field]: value });
  };

  const handleAddChecklistItem = async () => {
    if (!newCheckItem.trim()) return;
    try {
      await tasksApi.addChecklistItem(boardId, taskId, newCheckItem.trim());
      setNewCheckItem('');
    } catch {
      toast.error('Failed to add checklist item');
    }
  };

  const handleToggleChecklistItem = async (itemId, completed) => {
    await tasksApi.updateChecklistItem(boardId, taskId, itemId, { completed });
  };

  const handleDeleteChecklistItem = async (itemId) => {
    await tasksApi.deleteChecklistItem(boardId, taskId, itemId);
  };

  const handleUploadAttachment = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      await tasksApi.uploadAttachment(boardId, taskId, formData);
      toast.success('Attachment uploaded');
    } catch {
      toast.error('Upload failed');
    }
  };

  const handleDeleteAttachment = async (attachmentId) => {
    await tasksApi.deleteAttachment(boardId, taskId, attachmentId);
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      await addComment.mutateAsync({ content: newComment.trim() });
      setNewComment('');
    } catch {
      toast.error('Failed to post comment');
    }
  };

  const handleTyping = useCallback((val) => {
    setNewComment(val);
    if (val) emitTypingStart(boardId, taskId);
    else emitTypingStop(boardId, taskId);
  }, [boardId, taskId, emitTypingStart, emitTypingStop]);

  const handleDelete = async () => {
    try {
      await deleteTask.mutateAsync(taskId);
      closeModal();
      toast.success('Task deleted');
    } catch {
      toast.error('Failed to delete task');
    }
  };

  const handleArchive = async () => {
    try {
      await tasksApi.archive(boardId, taskId);
      closeModal();
      toast.success('Task archived');
    } catch {
      toast.error('Failed to archive task');
    }
  };

  if (isLoading || !task) {
    return (
      <div className="p-6">
        <Skeleton lines={4} height="h-4" gap="gap-4" />
      </div>
    );
  }

  const completedItems = task.checklist?.filter((c) => c.completed).length || 0;
  const totalItems = task.checklist?.length || 0;

  return (
    <div className="flex h-full max-h-[85vh] min-h-[400px]">
      {/* Left: main content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5 border-r border-[var(--border)]">
        {/* Save status */}
        {saveStatus && (
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
            {saveStatus === 'saving' ? (
              <><span className="w-3 h-3 border border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" /> Saving...</>
            ) : (
              <><Save size={11} /> Saved ✓</>
            )}
          </p>
        )}

        {/* Title */}
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full text-xl font-semibold bg-transparent border-none resize-none
            text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
            focus:outline-none leading-snug"
          rows={2}
          placeholder="Task title"
        />

        {/* Description */}
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wider">Description</p>
          <div data-color-mode={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}>
            <MDEditor
              value={description}
              onChange={setDescription}
              preview="edit"
              height={180}
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8 }}
            />
          </div>
        </div>

        {/* Checklist */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
              Checklist {totalItems > 0 && `(${completedItems}/${totalItems})`}
            </p>
          </div>
          {totalItems > 0 && (
            <div className="h-1 bg-[var(--bg-hover)] rounded-full mb-3">
              <div
                className="h-full bg-[var(--success)] rounded-full transition-all"
                style={{ width: `${(completedItems / totalItems) * 100}%` }}
              />
            </div>
          )}
          <div className="space-y-2">
            {task.checklist?.map((item) => (
              <div key={item.id} className="flex items-center gap-2 group">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={(e) => handleToggleChecklistItem(item.id, e.target.checked)}
                  className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
                  aria-label={item.text}
                />
                <span className={`flex-1 text-sm ${item.completed ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
                  {item.text}
                </span>
                <button
                  onClick={() => handleDeleteChecklistItem(item.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-all"
                  aria-label={`Delete checklist item: ${item.text}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <input
              value={newCheckItem}
              onChange={(e) => setNewCheckItem(e.target.value)}
              placeholder="Add item..."
              className="flex-1 px-2 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border)]
                rounded-btn text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddChecklistItem(); }}
            />
            <Button size="xs" variant="secondary" onClick={handleAddChecklistItem}>Add</Button>
          </div>
        </div>

        {/* Attachments */}
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Attachments</p>
          <div className="space-y-1">
            {task.attachments?.map((att) => (
              <div key={att._id} className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)] rounded-btn text-sm group">
                <Paperclip size={12} className="text-[var(--text-muted)] shrink-0" />
                <a href={att.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-[var(--accent)] hover:underline">
                  {att.originalName}
                </a>
                <span className="text-xs text-[var(--text-muted)]">{(att.size / 1024).toFixed(0)} KB</span>
                <button
                  onClick={() => handleDeleteAttachment(att._id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-all"
                  aria-label={`Delete attachment ${att.originalName}`}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-xs text-[var(--accent)] cursor-pointer hover:underline">
            <Plus size={12} /> Upload file
            <input type="file" className="hidden" onChange={handleUploadAttachment} />
          </label>
        </div>

        {/* Comments */}
        <div>
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Comments</p>
          <div className="flex gap-2 mb-4">
            <Avatar user={user} size="sm" />
            <div className="flex-1">
              <textarea
                value={newComment}
                onChange={(e) => handleTyping(e.target.value)}
                placeholder="Write a comment... Use @userId to mention"
                rows={2}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border)]
                  rounded-btn text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                  focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
              />
              <div className="flex justify-end mt-1">
                <Button size="xs" onClick={handleAddComment} loading={addComment.isPending} disabled={!newComment.trim()}>
                  Comment
                </Button>
              </div>
            </div>
          </div>

          {/* Comment list */}
          <div className="space-y-3">
            {commentsData?.comments?.map((comment) => (
              <CommentItem key={comment._id} comment={comment} currentUserId={user?._id} boardId={boardId} taskId={taskId} />
            ))}
          </div>
        </div>
      </div>

      {/* Right: metadata sidebar */}
      <div className="w-56 shrink-0 p-4 overflow-y-auto space-y-4">
        {/* Status */}
        <MetaSection label="Status">
          <select
            value={task.columnId}
            onChange={(e) => handleFieldUpdate('columnId', e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border)]
              rounded-btn text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            <option value="todo">To Do</option>
            <option value="in-progress">In Progress</option>
            <option value="review">Review</option>
            <option value="done">Done</option>
          </select>
        </MetaSection>

        {/* Priority */}
        <MetaSection label="Priority">
          <div className="flex flex-wrap gap-1">
            {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
              <button
                key={key}
                onClick={() => handleFieldUpdate('priority', key)}
                className={`px-2 py-0.5 text-xs rounded-badge font-medium border transition-all ${
                  task.priority === key
                    ? 'ring-2 ring-offset-1 ring-[var(--bg-secondary)]'
                    : 'opacity-60 hover:opacity-100'
                }`}
                style={{
                  background: task.priority === key ? config.bgColor : 'transparent',
                  color: config.color,
                  borderColor: config.color,
                }}
                aria-pressed={task.priority === key}
              >
                {config.label}
              </button>
            ))}
          </div>
        </MetaSection>

        {/* Due date */}
        <MetaSection label="Due date">
          <button
            onClick={() => setShowDatePicker(showDatePicker === 'due' ? null : 'due')}
            className="w-full text-left px-2 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border)]
              rounded-btn text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors"
          >
            {task.dueDate ? formatDate(task.dueDate) : <span className="text-[var(--text-muted)]">Set due date</span>}
          </button>
          {showDatePicker === 'due' && (
            <div className="absolute z-50 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-card shadow-xl p-2">
              <DayPicker
                mode="single"
                selected={task.dueDate ? new Date(task.dueDate) : undefined}
                onSelect={(d) => { handleFieldUpdate('dueDate', d); setShowDatePicker(null); }}
                className="text-[var(--text-primary)] text-sm"
              />
            </div>
          )}
        </MetaSection>

        {/* Estimated hours */}
        <MetaSection label="Est. hours">
          <input
            type="number"
            min="0"
            step="0.5"
            value={task.estimatedHours || ''}
            onChange={(e) => handleFieldUpdate('estimatedHours', parseFloat(e.target.value) || null)}
            placeholder="0h"
            className="w-full px-2 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--border)]
              rounded-btn text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </MetaSection>

        {/* Assignees */}
        <MetaSection label="Assignees">
          <AvatarGroup users={task.assignedTo || []} max={5} size="sm" />
        </MetaSection>

        {/* Created */}
        <MetaSection label="Created">
          <p className="text-xs text-[var(--text-muted)]">
            by {task.createdBy?.name} &bull; {relativeTime(task.createdAt)}
          </p>
        </MetaSection>

        {/* Actions */}
        <div className="pt-2 space-y-1.5 border-t border-[var(--border)]">
          <button
            onClick={handleArchive}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-[var(--text-muted)]
              hover:text-[var(--warning)] hover:bg-[var(--bg-hover)] rounded-btn transition-colors"
          >
            <Archive size={13} /> Archive
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-[var(--text-muted)]
                hover:text-[var(--danger)] hover:bg-[var(--bg-hover)] rounded-btn transition-colors"
            >
              <Trash2 size={13} /> Delete
            </button>
          ) : (
            <div className="flex gap-1">
              <Button size="xs" variant="danger" onClick={handleDelete} loading={deleteTask.isPending} className="flex-1">
                Confirm
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const MetaSection = ({ label, children }) => (
  <div>
    <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">{label}</p>
    {children}
  </div>
);

const CommentItem = ({ comment, currentUserId, boardId, taskId }) => {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const handleSaveEdit = async () => {
    if (!editContent.trim()) return;
    try {
      await tasksApi.editComment(boardId, taskId, comment._id, editContent);
      setEditing(false);
    } catch {
      toast.error('Failed to edit comment');
    }
  };

  return (
    <div className="flex gap-2">
      <Avatar user={comment.author} size="sm" />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-[var(--text-primary)]">{comment.author?.name}</span>
          <span className="text-xs text-[var(--text-muted)]">{relativeTime(comment.createdAt)}</span>
          {comment.isEdited && <span className="text-[10px] text-[var(--text-muted)]">(edited)</span>}
        </div>
        {editing ? (
          <div>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={2}
              className="w-full px-2 py-1.5 text-sm bg-[var(--bg-tertiary)] border border-[var(--accent)]
                rounded-btn text-[var(--text-primary)] resize-none focus:outline-none"
            />
            <div className="flex gap-1 mt-1">
              <Button size="xs" onClick={handleSaveEdit}>Save</Button>
              <Button size="xs" variant="ghost" onClick={() => { setEditing(false); setEditContent(comment.content); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{comment.content}</p>
        )}
        {comment.author?._id === currentUserId && !editing && (
          <button onClick={() => setEditing(true)} className="text-xs text-[var(--text-muted)] hover:text-[var(--accent)] mt-1 transition-colors">
            Edit
          </button>
        )}
      </div>
    </div>
  );
};

export default TaskModal;
