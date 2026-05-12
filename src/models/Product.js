import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, default: '', trim: true },
    price: { type: Number, required: true, min: 0 },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      default: 'USD',
    },
    stockQty: { type: Number, required: true, min: 0, default: 0 },
    images: { type: [String], default: [] },
    category: {
      type: String,
      lowercase: true,
      trim: true,
      default: '',
      index: true,
    },
    isActive: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const Product = mongoose.model('Product', productSchema);
