#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import { config } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Auth } from '../src/models/Auth.js';
import { User } from '../src/models/User.js';

// NOTE: per docs/prd-auth.md §Open risks #4a, the seed script intentionally
// does NOT use a transaction. If the second insert fails, an orphan auth row
// remains and must be cleaned up via mongo shell.

const main = async () => {
  await connectDb();
  const rl = readline.createInterface({ input, output });

  try {
    const email = (await rl.question('Admin email: ')).toLowerCase().trim();
    const username = (await rl.question('Admin username: ')).toLowerCase().trim();
    const password = await rl.question('Admin password (visible): ');
    const confirm = await rl.question('Confirm password: ');

    if (!email || !username || !password) {
      throw new Error('email, username, and password are all required');
    }
    if (password !== confirm) {
      throw new Error('passwords do not match');
    }
    if (password.length < 8) {
      throw new Error('password must be at least 8 characters');
    }

    const existing = await Auth.findOne({ email });
    if (existing) {
      const ans = (
        await rl.question(
          `Account ${email} already exists. Elevate existing user to admin? (yes/no): `,
        )
      )
        .toLowerCase()
        .trim();
      if (ans !== 'yes' && ans !== 'y') {
        throw new Error('aborted');
      }
      const updated = await User.findOneAndUpdate(
        { authId: existing._id },
        { $set: { role: 'admin', isVerified: true } },
        { new: true },
      );
      if (!updated) {
        throw new Error(
          `auth row found but no matching users row (orphan). Clean up via: db.auth.deleteOne({_id: ObjectId("${existing._id}")})`,
        );
      }
      if (!existing.isVerified) {
        existing.isVerified = true;
        await existing.save();
      }
      console.log(`Elevated to admin: ${email}`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const authId = new mongoose.Types.ObjectId();

    // Two sequential inserts, NOT wrapped in a transaction (per PRD).
    await Auth.create({
      _id: authId,
      email,
      username,
      passwordHash,
      isVerified: true,
      otpHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
    });

    try {
      await User.create({
        authId,
        email,
        username,
        role: 'admin',
        isVerified: true,
      });
    } catch (err) {
      console.error(
        `Failed to create users row: ${err.message || err}\n` +
          `Orphan auth row created with _id: ${authId}. ` +
          `Clean up via: db.auth.deleteOne({_id: ObjectId("${authId}")})`,
      );
      throw err;
    }

    console.log(`admin created: ${email}`);
  } finally {
    rl.close();
    await disconnectDb();
  }
};

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
