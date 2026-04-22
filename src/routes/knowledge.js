import { query } from "../config/db.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { generateEmbedding } from "../utils/embedding.js";

export default async function knowledgeRoutes(fastify, options) {

    // =========================
    // SCHEMA VALIDATION
    // =========================
    const knowledgeSchema = {
        body: {
            type: "object",
            required: ["agent_id", "content"],
            properties: {
                agent_id: {
                    type: "string",
                    format: "uuid"
                },
                content: {
                    type: "string",
                    minLength: 10,
                    maxLength: 10000
                }
            }
        }
    };

    // =========================
    // ADD KNOWLEDGE
    // =========================
    // =========================
    // ADD KNOWLEDGE
    // =========================
    // =========================
    // ADD / REPLACE KNOWLEDGE (PRODUCTION)
    // =========================
    fastify.post(
        "/",
        {
            preHandler: verifyToken,
            schema: knowledgeSchema
        },
        async (request, reply) => {

            const { agent_id, content } = request.body;
            const userId = request.user.id;

            try {
                // =========================
                // 1. CHECK AGENT OWNERSHIP 🔐
                // =========================
                const agentCheck = await query(
                    "SELECT id FROM agents WHERE id = $1 AND user_id = $2",
                    [agent_id, userId]
                );

                if (agentCheck.rows.length === 0) {
                    return reply.status(404).send({
                        success: false,
                        message: "Agent not found or unauthorized"
                    });
                }

                // =========================
                // 2. CLEAN CONTENT
                // =========================
                const cleanedContent = content.trim();

                if (!cleanedContent) {
                    return reply.status(400).send({
                        success: false,
                        message: "Content cannot be empty"
                    });
                }

                // =========================
                // 🔥 3. DELETE OLD KNOWLEDGE
                // =========================
                await query(
                    "DELETE FROM knowledge WHERE agent_id = $1",
                    [agent_id]
                );

                console.log("🗑 Old knowledge removed");

                // =========================
                // 4. SPLIT INTO CHUNKS
                // =========================
                const chunkSize = 500;
                const chunks = [];

                for (let i = 0; i < cleanedContent.length; i += chunkSize) {
                    chunks.push(cleanedContent.slice(i, i + chunkSize));
                }

                // =========================
                // 5. INSERT NEW CHUNKS
                // =========================
                const inserted = [];

                for (let i = 0; i < chunks.length; i++) {

                    const chunk = chunks[i];

                    const embedding = await generateEmbedding(chunk, {
                        type: "passage"
                    });

                    let embeddingStr = null;

                    if (embedding && Array.isArray(embedding)) {
                        embeddingStr = `[${embedding.join(",")}]`;
                    }

                    const res = await query(
                        `
                    INSERT INTO knowledge (agent_id, content, chunk_index, embedding)
                    VALUES ($1, $2, $3, $4::vector)
                    RETURNING id, content, chunk_index, created_at
                    `,
                        [agent_id, chunk, i, embeddingStr]
                    );

                    inserted.push(res.rows[0]);
                }

                // =========================
                // 6. UPDATE AGENT VERSION
                // =========================
                await query(
                    "UPDATE agents SET updated_at = NOW() WHERE id = $1",
                    [agent_id]
                );

                // =========================
                // 7. RESPONSE
                // =========================
                return reply.status(200).send({
                    success: true,
                    message: "Knowledge updated successfully",
                    chunks_created: inserted.length
                });

            } catch (error) {
                console.error("Knowledge Error:", error);

                return reply.status(500).send({
                    success: false,
                    message: "Internal Server Error"
                });
            }
        }
    );

    //get api for knowledge
    fastify.get(
        "/:agent_id",
        {
            preHandler: verifyToken,
            schema: {
                params: {
                    type: "object",
                    required: ["agent_id"],
                    properties: {
                        agent_id: {
                            type: "string",
                            format: "uuid"
                        }
                    }
                }
            }
        },
        async (request, reply) => {

            const { agent_id } = request.params;
            const userId = request.user.id;

            try {
                // =========================
                // CHECK AGENT OWNERSHIP 🔐
                // =========================
                const agentCheck = await query(
                    "SELECT id FROM agents WHERE id = $1 AND user_id = $2",
                    [agent_id, userId]
                );

                if (agentCheck.rows.length === 0) {
                    return reply.status(404).send({
                        success: false,
                        message: "Agent not found or unauthorized"
                    });
                }

                // =========================
                // FETCH KNOWLEDGE
                // =========================
                const result = await query(
                    `
                SELECT 
                    id,
                    content,
                    chunk_index,
                    created_at
                FROM knowledge
                WHERE agent_id = $1
                ORDER BY chunk_index ASC
                `,
                    [agent_id]
                );

                return reply.status(200).send({
                    success: true,
                    count: result.rows.length,
                    knowledge: result.rows
                });

            } catch (error) {
                console.error("Get Knowledge Error:", error);

                return reply.status(500).send({
                    success: false,
                    message: "Internal Server Error"
                });
            }
        }
    );

}