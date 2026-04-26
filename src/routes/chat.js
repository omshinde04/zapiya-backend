import { query } from "../config/db.js";
import redis from "../config/redis.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { handleChatCore } from "../services/chatService.js";

const chatSchema = {
    body: {
        type: "object",
        required: ["agent_id", "message"],
        properties: {
            agent_id: { type: "string", format: "uuid" },
            message: { type: "string", minLength: 1, maxLength: 2000 }
        }
    }
};

export default async function chatRoutes(fastify, options) {

    // =========================================================
    // POST /api/chat — Dashboard (authenticated)
    // =========================================================
    fastify.post("/", {
        preHandler: verifyToken,
        schema: chatSchema
    }, async (request, reply) => {

        const startTime = Date.now();
        const { agent_id, message } = request.body;
        const userId = request.user.id;

        try {
            const cleanMessage = message.trim();
            if (!cleanMessage) {
                return reply.status(400).send({
                    success: false,
                    message: "Message cannot be empty"
                });
            }

            // ── CONVERSATION INIT ─────────────────────────────
            let conversationId = request.body.conversation_id;

            if (!conversationId) {
                const convRes = await query(
                    `INSERT INTO conversations (user_id, agent_id, title)
                     VALUES ($1, $2, $3) RETURNING id`,
                    [userId, agent_id, cleanMessage.slice(0, 50)]
                );
                conversationId = convRes.rows[0].id;
            }

            // ── STORE USER MESSAGE ────────────────────────────
            await query(
                `INSERT INTO messages (conversation_id, role, content)
                 VALUES ($1, 'user', $2)`,
                [conversationId, cleanMessage]
            );

            // ── CORE LOGIC (cache + AI) ───────────────────────
            const result = await handleChatCore({
                agent_id,
                message: cleanMessage,
                userId,
                conversationId
            });

            if (result.notFound) {
                return reply.status(404).send({
                    success: false,
                    message: "Agent not found"
                });
            }

            // ── STORE AI RESPONSE (skip if cached) ────────────
            if (!result.cached) {
                await query(
                    `INSERT INTO messages (conversation_id, role, content)
                     VALUES ($1, 'assistant', $2)`,
                    [conversationId, result.response]
                );

                // ── UPDATE CONVERSATION MEMORY ─────────────────
                const historyKey = `history:${agent_id}:${userId}`;
                const historyRaw = await redis.get(historyKey);
                const history = historyRaw ? JSON.parse(historyRaw) : [];

                history.push(
                    { role: "user", content: cleanMessage },
                    { role: "assistant", content: result.response }
                );

                await redis.set(
                    historyKey,
                    JSON.stringify(history.slice(-20)),
                    "EX",
                    3600
                );
            }

            console.log({
                type: "chat_request",
                agent_id,
                userId,
                cached: result.cached,
                responseTime: Date.now() - startTime
            });

            return reply.send({
                success: true,
                response: result.response,
                cached: result.cached,
                conversation_id: conversationId
            });

        } catch (error) {
            console.error("❌ Chat Route Error:", error);

            if (error.isTimeout || error.name === "AbortError") {
                return reply.status(500).send({
                    success: false,
                    message: "AI timeout — please try again"
                });
            }

            return reply.send({ success: true, response: "I don't know" });
        }
    });

    // =========================================================
    // POST /api/chat/stream — SSE streaming (authenticated)
    // =========================================================
    fastify.post("/stream", {
        preHandler: verifyToken,
        schema: chatSchema
    }, async (request, reply) => {

        let keepAlive;

        try {
            const result = await fastify.inject({
                method: "POST",
                url: "/api/chat",
                headers: { authorization: request.headers.authorization },
                payload: request.body
            });

            if (result.statusCode !== 200) {
                reply.code(result.statusCode);
                return reply.send(result.payload);
            }

            let parsed;
            try {
                parsed = JSON.parse(result.payload);
            } catch (err) {
                throw new Error("Invalid JSON from chat route");
            }

            const text = parsed?.response || "I don't know";

            reply.raw.setHeader("Content-Type", "text/event-stream");
            reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
            reply.raw.setHeader("Connection", "keep-alive");
            reply.raw.setHeader("X-Accel-Buffering", "no");
            reply.raw.setHeader("Access-Control-Allow-Origin", "*");
            reply.raw.flushHeaders();

            keepAlive = setInterval(() => {
                if (!reply.raw.destroyed) reply.raw.write(": ping\n\n");
            }, 15000);

            const chunks = text.match(/.{1,25}(\s|$)/g) || [text];

            for (const chunk of chunks) {
                if (reply.raw.destroyed) break;
                reply.raw.write(`data: ${JSON.stringify({ chunk })}\n\n`);
                await new Promise(r => setTimeout(r, 10));
            }

            await new Promise(r => setTimeout(r, 50));
            reply.raw.write("data: [DONE]\n\n");

        } catch (error) {
            console.error("❌ Streaming Error:", error);

            try {
                if (!reply.raw.destroyed) {
                    reply.raw.write(`data: ${JSON.stringify({ chunk: "I don't know" })}\n\n`);
                    reply.raw.write("data: [DONE]\n\n");
                }
            } catch (_) { }

        } finally {
            if (keepAlive) clearInterval(keepAlive);
            if (!reply.raw.destroyed) reply.raw.end();
        }
    });

    // =========================================================
    // POST /api/chat/public/chat — Public widget (no auth)
    // =========================================================
    fastify.post("/public/chat", {
        schema: {
            body: {
                type: "object",
                required: ["agent_id", "message"],
                properties: {
                    agent_id: { type: "string", format: "uuid" },
                    message: { type: "string", minLength: 1, maxLength: 2000 }
                }
            }
        }
    }, async (request, reply) => {

        const { agent_id, message } = request.body;

        try {
            const cleanMessage = message.trim();

            if (!cleanMessage) {
                return reply.send({
                    success: true,
                    response: "I don't know"
                });
            }

            // =========================
            // 🔥 STEP 1: CREATE CONVERSATION
            // =========================
            const convoRes = await query(
                `INSERT INTO conversations (id, user_id, agent_id, title, created_at)
            VALUES (gen_random_uuid(), $1, $1, 'Public Chat', NOW())
             RETURNING id`,
                [agent_id]
            );

            const conversationId = convoRes.rows[0].id;

            // =========================
            // 🔥 STEP 2: STORE USER MESSAGE
            // =========================
            await query(
                `INSERT INTO messages (id, conversation_id, role, content, created_at)
             VALUES (gen_random_uuid(), $1, 'user', $2, NOW())`,
                [conversationId, cleanMessage]
            );

            // =========================
            // 🔥 STEP 3: CALL EXISTING WORKING LOGIC
            // =========================
            const result = await handleChatCore({
                agent_id,
                message: cleanMessage,
                userId: null,          // ⚠️ KEEP SAME (DON'T CHANGE)
                conversationId: null   // ⚠️ KEEP SAME (DON'T CHANGE)
            });

            if (result.notFound || result.notLive) {
                return reply.send({
                    success: true,
                    response: result.response || "This assistant is currently unavailable."
                });
            }

            const aiResponse = result.response || "I don't know";

            // =========================
            // 🔥 STEP 4: STORE AI RESPONSE
            // =========================
            await query(
                `INSERT INTO messages (id, conversation_id, role, content, created_at)
             VALUES (gen_random_uuid(), $1, 'assistant', $2, NOW())`,
                [conversationId, aiResponse]
            );

            // =========================
            // ✅ RESPONSE (UNCHANGED)
            // =========================
            return reply.send({
                success: true,
                response: aiResponse
            });

        } catch (error) {
            console.error("❌ PUBLIC CHAT ERROR:", error);

            return reply.send({
                success: true,
                response: "I don't know"
            });
        }
    });



    // =========================================================
    // POST /api/chat/public/greet — Agent greeting (no auth)
    // =========================================================
    fastify.post("/public/greet", {
        schema: {
            body: {
                type: "object",
                required: ["agent_id"],
                properties: {
                    agent_id: { type: "string" }
                }
            }
        }
    }, async (request, reply) => {

        const { agent_id } = request.body;

        try {
            const agentRes = await query(
                `SELECT name, status FROM agents WHERE id = $1`,
                [agent_id]
            );

            // 🔥 CHECK STATUS
            if (
                agentRes.rows.length === 0 ||
                agentRes.rows[0].status !== "live"
            ) {
                return reply.send({
                    success: true,
                    greeting: "This assistant is currently unavailable.",
                    agentName: "Assistant"
                });
            }

            const agentName =
                agentRes.rows[0].name?.trim() || "Assistant";

            const greeting = `Hi! I'm ${agentName}. What's your name?`;

            return reply.send({
                success: true,
                greeting,
                agentName
            });

        } catch (err) {
            console.error("❌ GREET ERROR:", err);

            return reply.send({
                success: true,
                greeting: "Hi! I'm your assistant. What's your name?",
                agentName: "Assistant"
            });
        }
    });


    // =========================================================
    // POST /api/chat/public/stream — SSE streaming (no auth)
    // =========================================================
    fastify.post("/public/stream", async (request, reply) => {

        let keepAlive;

        try {
            // 🔥 USE PUBLIC CHAT (ALREADY HAS STATUS CHECK)
            const result = await fastify.inject({
                method: "POST",
                url: "/api/chat/public/chat",
                payload: request.body
            });

            if (result.statusCode !== 200) {
                reply.code(result.statusCode);
                return reply.send(result.payload);
            }

            const parsed = JSON.parse(result.payload);
            const text = parsed?.response || "I don't know";

            // ================= STREAM HEADERS =================
            reply.raw.setHeader("Content-Type", "text/event-stream");
            reply.raw.setHeader("Cache-Control", "no-cache");
            reply.raw.setHeader("Connection", "keep-alive");
            reply.raw.setHeader("Access-Control-Allow-Origin", "*");
            reply.raw.setHeader("Access-Control-Allow-Headers", "Content-Type");
            reply.raw.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

            reply.raw.flushHeaders();

            // ================= KEEP ALIVE =================
            keepAlive = setInterval(() => {
                if (!reply.raw.destroyed) {
                    reply.raw.write(": ping\n\n");
                }
            }, 15000);

            // ================= STREAM =================
            const words = text.split(" ");

            for (const word of words) {
                if (reply.raw.destroyed) break;

                reply.raw.write(
                    `data: ${JSON.stringify({ chunk: word + " " })}\n\n`
                );

                await new Promise(r => setTimeout(r, 20));
            }

            reply.raw.write("data: [DONE]\n\n");

        } catch (err) {
            console.error("❌ PUBLIC STREAM ERROR:", err);

            try {
                if (!reply.raw.destroyed) {
                    reply.raw.write(
                        `data: ${JSON.stringify({ chunk: "I don't know" })}\n\n`
                    );
                    reply.raw.write("data: [DONE]\n\n");
                }
            } catch (_) { }

        } finally {
            if (keepAlive) clearInterval(keepAlive);
            if (!reply.raw.destroyed) reply.raw.end();
        }
    });
}