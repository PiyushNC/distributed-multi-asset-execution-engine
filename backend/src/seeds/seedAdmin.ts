import { Account } from '../models/Account.js';
import { User } from '../models/User.js';
import { hashPassword } from '../services/authService.js';

export const SEEDED_ADMIN_EMAIL = 'admin@arc.io';
export const SEEDED_ADMIN_PASSWORD = 'Admin123!';

export async function seedAdmin(): Promise<void> {
  const email = SEEDED_ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email });

  if (existing) {
    if (existing.role !== 'ADMIN') {
      existing.role = 'ADMIN';
      await existing.save();
      console.log(`Promoted ${email} to ADMIN`);
    }
    return;
  }

  const user = await User.create({
    email,
    password: await hashPassword(SEEDED_ADMIN_PASSWORD),
    role: 'ADMIN',
  });

  await Account.create({
    userId: user._id,
    assetBalance: { BTC: 10, ETH: 50 },
    quoteBalance: { USD: 1_000_000 },
  });

  console.log(`Seeded admin user ${email}`);
}
