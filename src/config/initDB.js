import { query } from "./db.js";

export const initDB = async () => {
  try {
    console.log("🚀 Initializing Database...");

    // =========================
    // EXTENSIONS
    // =========================
    await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    // =========================
    // USERS TABLE (PRODUCTION)
    // =========================
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        name TEXT NOT NULL CHECK (char_length(name) >= 2),
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,

        phone VARCHAR(15),
        company TEXT,

        is_verified BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),

        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =========================
    // INDEXES
    // =========================
    await query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    `);

    // =========================
    // AUTO UPDATE updated_at
    // =========================
    await query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await query(`
      DROP TRIGGER IF EXISTS set_updated_at ON users;
    `);

    await query(`
      CREATE TRIGGER set_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
    `);

    console.log("✅ Production-grade Users table initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing DB:", error.message);
  }
};