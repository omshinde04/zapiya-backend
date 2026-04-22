import pkg from "pg";

const { Pool } = pkg;

// Create connection pool (STRICT CONFIG)
const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "omshinde",
    password: String(process.env.DB_PASSWORD || ""),
    database: String(process.env.DB_NAME || "ai_agent"),
    port: Number(process.env.DB_PORT) || 5432,

    // Production configs
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test DB connection
export const connectDB = async () => {
    try {
        console.log("🔍 DB CONFIG:", {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            database: process.env.DB_NAME,
        });

        // 🔥 FORCE connect to correct DB
        const client = await pool.connect();

        // 🔥 Double check active database
        const checkDB = await client.query("SELECT current_database()");
        console.log("📂 Connected DB:", checkDB.rows[0].current_database);

        console.log("✅ PostgreSQL Connected Successfully");

        const res = await client.query("SELECT NOW()");
        console.log("🕒 DB Time:", res.rows[0].now);

        client.release();
    } catch (error) {
        console.error("❌ DB Connection Failed:", error.message);

        console.log("\n⚠️ QUICK FIX:");
        console.log("1. Run: psql -U omshinde -d ai_agent");
        console.log("2. If fails → create DB:");
        console.log("   CREATE DATABASE ai_agent;");

        process.exit(1);
    }
};

// Global query helper
export const query = async (text, params) => {
    try {
        return await pool.query(text, params);
    } catch (error) {
        console.error("❌ Query Error:", error.message);
        throw error;
    }
};

export default pool;