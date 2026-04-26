import { query } from "../config/db.js";
import { verifyToken } from "../middleware/authMiddleware.js";

export default async function agentRoutes(fastify, options) {

    // =========================
    // DEFAULT CONFIG
    // =========================
    const defaultConfig = {
        language: "EN",
        tone: "friendly",
        length: "medium",
        role: "support",
        instructions: ""
    };

    // =========================
    // SCHEMA VALIDATION
    // =========================
    const createAgentSchema = {
        body: {
            type: "object",
            required: ["name"],
            properties: {
                name: {
                    type: "string",
                    minLength: 2,
                    maxLength: 100
                },
                description: {
                    type: "string",
                    maxLength: 1000
                },
                config: {
                    type: "object",
                    properties: {
                        language: {
                            type: "string",
                            enum: ["EN", "MR", "AUTO"]
                        },
                        tone: {
                            type: "string",
                            enum: ["friendly", "professional", "calm"]
                        },
                        length: {
                            type: "string",
                            enum: ["short", "medium", "detailed"]
                        },
                        role: {
                            type: "string",
                            enum: ["support", "sales", "assistant", "custom"]
                        },
                        instructions: {
                            type: "string",
                            maxLength: 2000
                        }
                    },
                    additionalProperties: false
                }
            }
        }
    };

    // =========================
    // CREATE AGENT
    // =========================
    fastify.post(
        "/",
        {
            preHandler: verifyToken,
            schema: createAgentSchema
        },
        async (request, reply) => {

            const { name, description, config } = request.body;
            const userId = request.user.id;

            try {
                // =========================
                // SANITIZE INPUT
                // =========================
                const trimmedName = name.trim();
                const trimmedDescription = description ? description.trim() : null;

                // =========================
                // VALIDATION (EXTRA SAFETY)
                // =========================
                if (!trimmedName) {
                    return reply.status(400).send({
                        success: false,
                        message: "Agent name is required"
                    });
                }

                // =========================
                // MERGE DEFAULT CONFIG
                // =========================
                const finalConfig = {
                    ...defaultConfig,
                    ...(config || {})
                };

                // =========================
                // INSERT INTO DB
                // =========================
                const result = await query(
                    `
                    INSERT INTO agents (user_id, name, description, config, status)
                    VALUES ($1, $2, $3, $4, 'draft')
                   RETURNING id, user_id, name, description, config, status, created_at, updated_at
                    `,
                    [
                        userId,
                        trimmedName,
                        trimmedDescription,
                        finalConfig
                    ]
                );

                return reply.status(201).send({
                    success: true,
                    message: "Agent created successfully",
                    agent: result.rows[0]
                });

            } catch (error) {
                console.error("Create Agent Error:", error);

                return reply.status(500).send({
                    success: false,
                    message: "Internal Server Error"
                });
            }
        }
    );





    //Get Api for agents All 

    fastify.get(
        "/",
        {
            preHandler: verifyToken
        },
        async (request, reply) => {

            const userId = request.user.id;

            // 🔥 QUERY PARAMS
            const {
                page = 1,
                limit = 10,
                status,
                search
            } = request.query;

            const offset = (page - 1) * limit;

            try {
                let baseQuery = `
                SELECT 
                    id,
                    user_id,
                    name,
                    description,
                    config,
                    status,
                    created_at,
                    updated_at
                FROM agents
                WHERE user_id = $1
            `;

                const values = [userId];
                let index = 2;

                // 🔍 FILTER BY STATUS
                if (status) {
                    baseQuery += ` AND status = $${index}`;
                    values.push(status);
                    index++;
                }

                // 🔍 SEARCH BY NAME
                if (search) {
                    baseQuery += ` AND name ILIKE $${index}`;
                    values.push(`%${search}%`);
                    index++;
                }

                // 📄 PAGINATION
                baseQuery += ` ORDER BY created_at DESC LIMIT $${index} OFFSET $${index + 1}`;
                values.push(limit, offset);

                const result = await query(baseQuery, values);

                return reply.status(200).send({
                    success: true,
                    page: Number(page),
                    limit: Number(limit),
                    count: result.rows.length,
                    agents: result.rows
                });

            } catch (error) {
                console.error("Get Agents Error:", error);

                return reply.status(500).send({
                    success: false,
                    message: "Internal Server Error"
                });
            }
        }
    );


    // get agent by particular id 

    fastify.get(
        "/:id",
        {
            preHandler: verifyToken,
            schema: {
                params: {
                    type: "object",
                    required: ["id"],
                    properties: {
                        id: {
                            type: "string",
                            format: "uuid"
                        }
                    }
                }
            }
        },
        async (request, reply) => {

            const { id } = request.params;
            const userId = request.user.id;

            try {
                // =========================
                // FETCH SINGLE AGENT
                // =========================
                const result = await query(
                    `
                SELECT 
                    id,
                    user_id,
                    name,
                    description,
                    config,
                    status,
                    created_at,
                    updated_at
                FROM agents
                WHERE id = $1 AND user_id = $2
                LIMIT 1
                `,
                    [id, userId]
                );

                // =========================
                // NOT FOUND
                // =========================
                if (result.rows.length === 0) {
                    return reply.status(404).send({
                        success: false,
                        message: "Agent not found"
                    });
                }

                return reply.status(200).send({
                    success: true,
                    agent: result.rows[0]
                });

            } catch (error) {
                console.error("Get Agent Error:", error);

                return reply.status(500).send({
                    success: false,
                    message: "Internal Server Error"
                });
            }
        }
    );





    //put Api 
    fastify.put(
        "/:id",
        {
            preHandler: verifyToken,
            schema: {
                params: {
                    type: "object",
                    required: ["id"],
                    properties: {
                        id: { type: "string", format: "uuid" }
                    }
                },
                body: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            minLength: 2,
                            maxLength: 100
                        },
                        description: {
                            type: "string",
                            maxLength: 1000
                        },
                        config: {
                            type: "object",
                            properties: {
                                language: {
                                    type: "string",
                                    enum: ["EN", "MR", "AUTO"]
                                },
                                tone: {
                                    type: "string",
                                    enum: ["friendly", "professional", "calm"]
                                },
                                length: {
                                    type: "string",
                                    enum: ["short", "medium", "detailed"]
                                },
                                role: {
                                    type: "string",
                                    enum: ["support", "sales", "assistant", "custom"]
                                },
                                instructions: {
                                    type: "string",
                                    maxLength: 2000
                                }
                            },
                            additionalProperties: false
                        }
                    },
                    additionalProperties: false
                }
            }
        },
        async (request, reply) => {

            const { id } = request.params;
            const userId = request.user.id;
            const { name, description, config } = request.body;

            try {
                // =========================
                // CHECK AGENT EXISTS + OWNERSHIP
                // =========================
                const existing = await query(
                    "SELECT * FROM agents WHERE id = $1 AND user_id = $2",
                    [id, userId]
                );

                if (existing.rows.length === 0) {
                    return reply.status(404).send({
                        success: false,
                        message: "Agent not found"
                    });
                }

                const currentAgent = existing.rows[0];

                // =========================
                // PREPARE UPDATED VALUES
                // =========================
                const updatedName = name ? name.trim() : currentAgent.name;
                const updatedDescription =
                    description !== undefined
                        ? description.trim()
                        : currentAgent.description;

                const updatedConfig = {
                    ...currentAgent.config,
                    ...(config || {})
                };

                // =========================
                // UPDATE QUERY
                // =========================
                const result = await query(
                    `
                UPDATE agents
                SET 
                    name = $1,
                    description = $2,
                    config = $3
                WHERE id = $4 AND user_id = $5
                RETURNING id, user_id, name, description, config, status, created_at, updated_at
                `,
                    [
                        updatedName,
                        updatedDescription,
                        updatedConfig,
                        id,
                        userId
                    ]
                );

                return reply.status(200).send({
                    success: true,
                    message: "Agent updated successfully",
                    agent: result.rows[0]
                });

            } catch (error) {
                console.error("Update Agent Error:", error);

                return reply.status(500).send({
                    success: false,
                    message: "Internal Server Error"
                });
            }
        }
    );




    //patch Api For handleing Status Live or Draft 
    fastify.patch(
        "/:id/status",
        {
            preHandler: verifyToken,
            schema: {
                params: {
                    type: "object",
                    required: ["id"],
                    properties: {
                        id: { type: "string", format: "uuid" }
                    }
                },
                body: {
                    type: "object",
                    required: ["status"],
                    properties: {
                        status: {
                            type: "string",
                            enum: ["draft", "live"]
                        }
                    }
                }
            }
        },
        async (request, reply) => {

            const { id } = request.params;
            const { status } = request.body;
            const userId = request.user.id;

            try {
                // =========================
                // CHECK AGENT EXISTS + OWNERSHIP
                // =========================
                const existing = await query(
                    "SELECT id FROM agents WHERE id = $1 AND user_id = $2",
                    [id, userId]
                );

                if (existing.rows.length === 0) {
                    return reply.status(404).send({
                        success: false,
                        message: "Agent not found"
                    });
                }

                // =========================
                // UPDATE STATUS
                // =========================
                const result = await query(
                    `
                UPDATE agents
                SET status = $1
                WHERE id = $2 AND user_id = $3
                RETURNING id, user_id, name, status, updated_at
                `,
                    [status, id, userId]
                );

                return reply.status(200).send({
                    success: true,
                    message: `Agent ${status === "live" ? "deployed" : "set to draft"}`,
                    agent: result.rows[0]
                });

            } catch (error) {
                console.error("Update Status Error:", error);

                return reply.status(500).send({
                    success: false,
                    message: "Internal Server Error"
                });
            }
        }
    );


    // =========================
    // DELETE AGENT (PRODUCTION GRADE)
    // =========================
    fastify.delete(
        "/:id",
        {
            preHandler: verifyToken,
            schema: {
                params: {
                    type: "object",
                    required: ["id"],
                    properties: {
                        id: { type: "string", format: "uuid" }
                    }
                }
            }
        },
        async (request, reply) => {

            const { id } = request.params;
            const userId = request.user.id;

            try {
                // =========================
                // CHECK AGENT EXISTS + OWNERSHIP
                // =========================
                const existing = await query(
                    `
                SELECT id, name 
                FROM agents 
                WHERE id = $1 AND user_id = $2
                LIMIT 1
                `,
                    [id, userId]
                );

                if (existing.rows.length === 0) {
                    return reply.status(404).send({
                        success: false,
                        message: "Agent not found"
                    });
                }

                const agent = existing.rows[0];

                // =========================
                // DELETE AGENT
                // =========================
                await query(
                    `
                DELETE FROM agents 
                WHERE id = $1 AND user_id = $2
                `,
                    [id, userId]
                );

                // =========================
                // SUCCESS RESPONSE
                // =========================
                return reply.status(200).send({
                    success: true,
                    message: `Agent "${agent.name}" deleted successfully`,
                    agent: {
                        id: agent.id
                    }
                });

            } catch (error) {
                console.error("❌ Delete Agent Error:", {
                    id,
                    userId,
                    error: error.message
                });

                return reply.status(500).send({
                    success: false,
                    message: "Internal Server Error"
                });
            }
        }
    );

    fastify.get("/stats", {
        preHandler: verifyToken
    }, async (request, reply) => {

        const userId = request.user.id;

        try {
            // ================= AGENTS =================
            const agentsRes = await query(
                "SELECT id FROM agents WHERE user_id = $1",
                [userId]
            );

            const agentIds = agentsRes.rows.map(a => a.id);

            if (!agentIds.length) {
                return reply.send({
                    success: true,
                    stats: {
                        totalRequests: 0,
                        tokensUsed: 0,
                        amountSpent: 0
                    },
                    agents: []
                });
            }

            // ================= REQUESTS PER AGENT =================
            const perAgentRes = await query(
                `SELECT c.agent_id, COUNT(*) as requests
             FROM messages m
             JOIN conversations c ON m.conversation_id = c.id
             WHERE c.agent_id = ANY($1)
            AND m.role = 'user'
             GROUP BY c.agent_id`,
                [agentIds]
            );

            // map for quick lookup
            const requestMap = {};
            let totalRequests = 0;

            perAgentRes.rows.forEach(r => {
                const count = Number(r.requests);
                requestMap[r.agent_id] = count;
                totalRequests += count;
            });

            // ================= TOKENS =================
            const tokensRes = await query(
                `SELECT SUM(tokens_used) as total
             FROM usage_logs
             WHERE agent_id = ANY($1)`,
                [agentIds]
            );

            const tokens = Number(tokensRes.rows[0]?.total || 0);
            const amountSpent = tokens * 0.000002;

            return reply.send({
                success: true,
                stats: {
                    totalRequests,
                    tokensUsed: tokens,
                    amountSpent: Number(amountSpent.toFixed(4))
                },
                agents: agentIds.map(id => ({
                    id,
                    requests: requestMap[id] || 0
                }))
            });

        } catch (err) {
            console.error("Stats Error:", err);

            return reply.status(500).send({
                success: false,
                message: "Internal Server Error"
            });
        }
    });

}







