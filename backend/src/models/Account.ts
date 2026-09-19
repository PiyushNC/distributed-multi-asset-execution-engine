import mongoose, { Schema } from 'mongoose';

export interface IAccount {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  assetBalance: Record<string, number>;
  quoteBalance: Record<string, number>;
  createdAt: Date;
}

const AccountSchema = new Schema<IAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    assetBalance: {
      type: Schema.Types.Mixed,
      default: {},
    },
    quoteBalance: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: {
      createdAt: true,
      updatedAt: false,
    },
    versionKey: false,
  },
);

export const Account = mongoose.model<IAccount>('Account', AccountSchema);
