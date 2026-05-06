import mongoose from 'mongoose';

const SENSITIVE_FIELDS = [
  'passwordHash',
  'otpHash',
  'otpExpiresAt',
  'otpAttempts',
  'passwordResetTokenHash',
  'passwordResetExpiresAt',
];

const authSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },

    isVerified: { type: Boolean, default: false },

    otpHash: { type: String, default: null },
    otpExpiresAt: { type: Date, default: null },
    otpAttempts: { type: Number, default: 0 },

    passwordResetTokenHash: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },

    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        for (const field of SENSITIVE_FIELDS) delete ret[field];
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const Auth = mongoose.model('Auth', authSchema);
