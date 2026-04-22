// =========================
// routes/greet.js
// =========================

import { query } from "../config/db.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { generateGreeting } from "../services/greetingService.js";

export default async function greetRoutes(fastify, options) {

    fastify.post("/", {
        preHandler: verifyToken,
        schema: {
            body: {
                type: "object",
                required: ["agent_id"],
                properties: {
                    agent_id: { type: "string", format: "uuid" }
                }
            }
        }
    }, async (request, reply) => {

        const { agent_id } = request.body;
        const userId = request.user.id;

        try {
            const agentRes = await query(
                `SELECT name FROM agents WHERE id = $1 AND user_id = $2`,
                [agent_id, userId]
            );

            if (agentRes.rows.length === 0) {
                return reply.status(404).send({
                    success: false,
                    message: "Agent not found"
                });
            }

            const agentName =
                agentRes.rows[0].name?.trim() || "Assistant";

            // 🔥 call service
            const greeting = await generateGreeting(agentName);

            console.log(`✅ GREETING for "${agentName}":`, greeting);

            return reply.send({
                success: true,
                greeting,
                agentName
            });

        } catch (error) {
            console.error("❌ Greet Route Error:", error);

            return reply.send({
                success: true,
                greeting: "Hi! I'm your assistant. What's your name?",
                agentName: "Assistant"
            });
        }
    });
}