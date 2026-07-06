const mongoose = require('mongoose');
const { Schema } = mongoose;

const taskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, maxlength: 5000, default: '' },
    board: { type: Schema.Types.ObjectId, ref: 'Board', required: true, index: true },
    columnId: { type: String, required: true },
    position: { type: Number, required: true },
    priority: {
      type: String,
      enum: ['none', 'low', 'medium', 'high', 'urgent'],
      default: 'none',
    },
    status: {
      type: String,
      enum: ['todo', 'in-progress', 'review', 'done'],
      default: 'todo',
    },
    assignedTo: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dueDate: { type: Date, default: null },
    startDate: { type: Date, default: null },
    estimatedHours: { type: Number, default: null },
    labels: [{ type: String }], // references Board.labels[].id
    attachments: [
      {
        filename: String,
        originalName: String,
        url: String,
        publicId: String,
        size: Number,
        mimeType: String,
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    checklist: [
      {
        id: { type: String, required: true },
        text: { type: String, required: true },
        completed: { type: Boolean, default: false },
        completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        completedAt: { type: Date, default: null },
      },
    ],
    isArchived: { type: Boolean, default: false },
    archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archivedAt: { type: Date, default: null },
    watchedBy: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    // Task dependencies
    blockedBy: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
    // Time tracking
    timeEntries: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        startTime: Date,
        endTime: Date,
        duration: Number, // minutes
        note: String,
      },
    ],
    // Recurrence
    recurrence: {
      enabled: { type: Boolean, default: false },
      frequency: { type: String, enum: ['daily', 'weekly', 'monthly', null], default: null },
      nextDue: { type: Date, default: null },
    },
    // Optimistic concurrency control
    version: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound index for efficient board task queries
taskSchema.index({ board: 1, columnId: 1, position: 1 });
taskSchema.index({ board: 1, isArchived: 1 });
taskSchema.index({ assignedTo: 1, dueDate: 1 });
taskSchema.index({ dueDate: 1, isArchived: 1 }); // for due-date reminders cron
taskSchema.index({ status: 1 });
taskSchema.index({ priority: 1 });

module.exports = mongoose.model('Task', taskSchema);
