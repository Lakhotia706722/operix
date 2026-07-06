const mongoose = require('mongoose');
const { Schema } = mongoose;

const boardSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, maxlength: 500, default: '' },
    coverColor: { type: String, default: '#6366f1' },
    coverImage: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    members: [
      {
        user: { type: Schema.Types.ObjectId, ref: 'User' },
        role: {
          type: String,
          enum: ['owner', 'admin', 'member', 'viewer'],
          default: 'member',
        },
        joinedAt: { type: Date, default: Date.now },
      },
    ],
    columns: [
      {
        id: { type: String, required: true },
        title: { type: String, required: true },
        color: { type: String, default: '#6366f1' },
        position: { type: Number, required: true },
        isDefault: { type: Boolean, default: false },
      },
    ],
    labels: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        color: { type: String, required: true },
      },
    ],
    isArchived: { type: Boolean, default: false },
    isStarred: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    settings: {
      allowMemberInvite: { type: Boolean, default: true },
      taskLimit: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

// Index for fast member lookup
boardSchema.index({ 'members.user': 1 });
boardSchema.index({ createdBy: 1 });
boardSchema.index({ isArchived: 1 });
boardSchema.index({ isStarred: 1 });

module.exports = mongoose.model('Board', boardSchema);
