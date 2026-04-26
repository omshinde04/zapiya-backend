// =========================
// ENV CONFIG
// =========================
import dotenv from "dotenv";
dotenv.config();

// =========================
// IMPORTS
// =========================
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";

import { connectDB } from "./config/db.js";
import { initDB } from "./config/initDB.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import agentRoutes from "./routes/agents.js";
import knowledgeRoutes from "./routes/knowledge.js";
import chatRoutes from "./routes/chat.js";
import greetRoutes from "./routes/greet.js";



import path from "path";
import { fileURLToPath } from "url";
import fastifyStatic from "@fastify/static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================
// CREATE APP
// =========================
const app = Fastify({
    logger: true,
});

// =========================
// 🔥 READINESS FLAG
// =========================
let isReady = false;

// =========================
// 🔥 WAIT FOR EMBEDDING SERVICE
// =========================
const waitForEmbedding = async () => {
    const MAX_RETRIES = 20;
    const DELAY = 1000;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const res = await fetch("http://localhost:8000/health");

            if (res.ok) {
                console.log("✅ Embedding service is ready");
                return;
            }
        } catch { }

        console.log(`⏳ Waiting for embedding service... (${i + 1})`);
        await new Promise((r) => setTimeout(r, DELAY));
    }

    console.error("❌ Embedding service failed to start");
    process.exit(1);
};

// =========================
// SECURITY & MIDDLEWARE (FINAL FIX)
// =========================
await app.register(cors, {
    origin: true, // 🔥 allow all origins (safe for dev, restrict in prod)
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
});

// =========================
// STATIC FILES (WIDGET)
// =========================
await app.register(fastifyStatic, {
    root: path.join(__dirname, "../public"),
    prefix: "/", // so /widget.js works
});

await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
});

await app.register(helmet, {
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
});

// =========================
// ROUTES
// =========================
app.get("/", async () => {
    return {
        success: true,
        message: "AI Agent Backend Running 🚀",
    };
});

app.get("/api/ready", async (req, reply) => {
    if (isReady) {
        return { ready: true };
    }
    return reply.status(503).send({ ready: false });
});

await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(userRoutes, { prefix: "/api/user" });
await app.register(agentRoutes, { prefix: "/api/agents" });
await app.register(chatRoutes, { prefix: "/api/chat" });
await app.register(knowledgeRoutes, { prefix: "/api/knowledge" });
await app.register(greetRoutes, { prefix: "/api/greet" });


// =========================
// ERROR HANDLING
// =========================
app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
        success: false,
        message: "Route not found",
    });
});

app.setErrorHandler((error, request, reply) => {
    app.log.error(error);

    reply.status(error.statusCode || 500).send({
        success: false,
        message: error.message || "Internal Server Error",
    });
});

// =========================
// START SERVER
// =========================
const start = async () => {
    try {
        await connectDB();
        await initDB();

        const PORT = process.env.PORT || 3001;

        await app.listen({
            port: PORT,
            host: "0.0.0.0",
        });

        console.log(`🚀 Server running on http://localhost:${PORT}`);
        console.log(`⏳ Waiting for embedding service...`);

        await waitForEmbedding();

        // 🔥 AI WARMUP
        try {
            console.log("🔥 Warming up AI...");

            await fetch("https://api.sarvam.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.SARVAM_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "sarvam-m",
                    messages: [{ role: "user", content: "hello" }],
                    max_tokens: 5,
                }),
            });

            console.log("✅ AI Warmup Done");
        } catch (err) {
            console.warn("⚠️ AI Warmup failed:", err.message);
        }

        isReady = true;
        console.log("✅ Server fully ready");
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

// =========================
// SHUTDOWN
// =========================
const shutdown = async (signal) => {
    console.log(`🛑 ${signal} received`);

    try {
        await app.close();
        console.log("✅ Server closed");
        process.exit(0);
    } catch (err) {
        console.error("❌ Shutdown error:", err);
        process.exit(1);
    }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// =========================
// RUN
// =========================
start();