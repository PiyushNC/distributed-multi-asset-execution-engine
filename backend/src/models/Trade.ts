import mongoose, { Schema } from 'mongoose';

export interface ITrade {
  _id: mongoose.Types.ObjectId;
  buyOrderId: mongoose.Types.ObjectId;
  sellOrderId: mongoose.Types.ObjectId;
  pair: string;
  price: number;
  quantity: number;
  executedAt: Date;
}

const TradeSchema = new Schema<ITrade>(
  {
    buyOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    sellOrderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    pair: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    executedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  },
);

export const Trade = mongoose.model<ITrade>('Trade', TradeSchema);
