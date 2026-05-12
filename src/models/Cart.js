import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const cartSchema = new mongoose.Schema(
  {
    authId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Auth',
      required: true,
      unique: true,
    },
    items: { type: [cartItemSchema], default: [] },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      default: null,
    },
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

export const Cart = mongoose.model('Cart', cartSchema);
