// =========================
// IMPORTS
// =========================
import { query } from "../config/db.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import redis from "../config/redis.js";
import { generateEmbedding } from "../utils/embedding.js";

// =========================
// CONSTANTS
// =========================
const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";

// =========================
// CHAT ROUTES PLUGIN
// =========================
export default async function chatRoutes(fastify, options) {

    // =========================
    // REQUEST SCHEMA VALIDATION
    // =========================
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

    // =========================
    // AGENT CONFIG MAPS
    // Match EXACTLY the values from ConfigSection.jsx
    // stored in agents.config JSON column in DB
    // Fields: language, tone, length, role, instructions
    // =========================

    const languageMap = {
        EN: "English",
        MR: "Marathi",
        HI: "Hindi",
        AUTO: "Same language as the user's message — detect and match it"
    };

    const toneMap = {
        friendly: "Be friendly, warm, and conversational",
        professional: "Be formal, precise, and professional",
        calm: "Be calm, reassuring, and polite"
    };

    const lengthMap = {
        short: "Keep the answer very short — 1 sentence if possible",
        medium: "Keep the answer balanced — 2 to 3 sentences",
        detailed: "Give a complete answer — include all relevant conditions and details"
    };

    const roleMap = {
        support: "You are a customer support assistant helping users with their queries",
        sales: "You are a persuasive sales expert who helps customers make decisions",
        assistant: "You are a helpful AI assistant",
        custom: null  // resolved dynamically from config.instructions
    };

    // =========================
    // BUILD DYNAMIC SYSTEM PROMPT
    // 100% driven by each user's agent config from DB.
    // No hardcoded domain data anywhere.
    // =========================
    const buildSystemPrompt = (config, knowledgeText) => {

        const role = config.role === "custom"
            ? (config.instructions || "You are a helpful AI assistant")
            : (roleMap[config.role] || "You are a helpful assistant");

        const tone = toneMap[config.tone] || "Be neutral and professional";
        const length = lengthMap[config.length] || "Keep the answer concise";
        const language = languageMap[config.language] || "English";

        const extraInstructions = (config.instructions && config.role !== "custom")
            ? `\nExtra Instructions from agent owner: ${config.instructions}`
            : "";

        return `
ROLE: ${role}

════════════════════════════════════════════════════════
🔒  ABSOLUTE RULES — NEVER VIOLATE ANY OF THESE
════════════════════════════════════════════════════════
1.  Output the FINAL ANSWER ONLY — nothing else before or after
2.  NEVER think out loud, reason, or analyze in your response
3.  NEVER use any of these phrases:
    "let me", "I think", "maybe", "wait", "okay", "so,", "well,",
    "looking at", "based on", "it seems", "I should", "hmm",
    "sure", "of course", "certainly", "the user is asking"
4.  NEVER repeat or rephrase the question in your answer
5.  NEVER hallucinate — do not invent facts not in the Knowledge Base
6.  NEVER contradict anything in the Knowledge Base
7.  NEVER produce more than 3 sentences unless listing multiple
    distinct items is required by the question
8.  If your response is longer than 3 sentences → it is WRONG

════════════════════════════════════════════════════════
📚  KNOWLEDGE BASE RULES
════════════════════════════════════════════════════════
- Answer ONLY from the Knowledge Base provided below
- DO NOT use general knowledge, assumptions, or training data
- Extract and state ONLY what is explicitly written — nothing more
- DO NOT suggest "contact support", "visit the website", or any
  action not explicitly stated in the Knowledge Base

════════════════════════════════════════════════════════
🧠  HANDLING AMBIGUOUS OR UNCLEAR QUESTIONS
════════════════════════════════════════════════════════
- If the question has typos, gibberish, or unclear meaning
  → respond EXACTLY with: I don't know
- If the question cannot be matched to any entry in the Knowledge Base
  → respond EXACTLY with: I don't know
- DO NOT try to interpret, guess, or reason about unclear input
- DO NOT ask for clarification

════════════════════════════════════════════════════════
📋  OUTPUT FORMAT RULES
════════════════════════════════════════════════════════
- Final answer only — no preamble, no explanation, no closing remark
- If a policy/item has multiple conditions → include ALL of them
- If multiple entries apply → state each clearly, no comparisons
- Be concise but complete — do NOT omit limits or conditions
- NEVER start your answer with: "I", "The", "Sure", "Of course",
  "Certainly", "Based on", "According to"

════════════════════════════════════════════════════════
✅  CORRECT BEHAVIOR EXAMPLES
(Generic placeholders — NOT real knowledge data)
════════════════════════════════════════════════════════
Q: [Clear question matching something in the Knowledge Base]
A: [Direct answer from Knowledge Base — no extra words]

Q: [Question with typos or gibberish]
A: I don't know

Q: [Question about something not in the Knowledge Base]
A: I don't know

Q: [Question where a policy has multiple conditions]
A: [State ALL conditions from Knowledge Base in one concise answer]

════════════════════════════════════════════════════════
❌  WRONG BEHAVIOR — NEVER DO ANY OF THESE
════════════════════════════════════════════════════════
- "Okay, let me think about this..."              → WRONG
- "The user is asking about..."                   → WRONG
- "Based on the knowledge base, I can see..."     → WRONG
- "I'm not sure but maybe..."                     → WRONG
- Answering with 10+ sentences of reasoning      → WRONG
- Using general knowledge not in the KB          → WRONG

════════════════════════════════════════════════════════
⚙️  AGENT BEHAVIOR CONFIGURATION
════════════════════════════════════════════════════════
Tone:     ${tone}
Length:   ${length}
Language: Respond in ${language}${extraInstructions}

════════════════════════════════════════════════════════
📖  KNOWLEDGE BASE
════════════════════════════════════════════════════════
${knowledgeText}
════════════════════════════════════════════════════════

⚠️  FINAL REMINDER: Output the final answer ONLY.
    Maximum 3 sentences. Not in KB → I don't know.
`;
    };

    // =========================
    // 🔥 STRIP THINK BLOCKS FIRST
    // Must run before hasReasoning check — sarvam-m wraps
    // its reasoning in <think> tags. Strip them to get the
    // actual answer, THEN decide if a retry is needed.
    // =========================
    const stripThinkBlocks = (text) => {
        if (!text) return "";
        return text
            .replace(/<think>[\s\S]*?<\/think>/gi, "")
            .trim();
    };

    // =========================
    // REASONING LEAK DETECTOR
    // Only called on text AFTER <think> blocks are stripped.
    // If the model answered cleanly inside <think> then outside,
    // the outside text will be short and clean — no retry needed.
    // =========================
    const hasReasoning = (text) => {
        if (!text) return false;

        // Over 300 chars after stripping <think> = reasoning leaked outside tags
        if (text.length > 300) return true;

        return /let me|i think|maybe|wait|hmm|the user|okay,|so,|well,|looking at|based on|it seems|i should|alright|first,/i.test(text);
    };

    // =========================
    // CLEAN AI RESPONSE
    // Runs after think-stripping and optional retry.
    // Final safety pass to remove any remaining junk.
    // =========================
    const cleanAIResponse = (text) => {
        if (!text) return "I don't know";

        let cleaned = text.trim();

        // PASS 1: Strip any remaining <think> blocks (safety)
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

        // PASS 2: If still long → leaked reasoning without tags
        if (cleaned.length > 300) {
            const firstSentence = cleaned.match(/^[^.!?]*[.!?]/);
            cleaned = firstSentence ? firstSentence[0].trim() : "I don't know";
        }

        // PASS 3: Remove reasoning opener patterns
        cleaned = cleaned
            .replace(/^(okay[,.]?|so[,.]?|well[,.]?|alright[,.]?|looking at|based on|it seems|first[,]?)[\s\S]*?\./i, "")
            .replace(/let me[\s\S]*?\./i, "")
            .replace(/i think[\s\S]*?\./i, "")
            .replace(/maybe[\s\S]*?\./i, "")
            .replace(/the user[\s\S]*?\./i, "")
            .replace(/wait[, ]*[\s\S]*?\./i, "")
            .replace(/i should[\s\S]*?\./i, "")
            .replace(/hmm[, ]*[\s\S]*?\./i, "");

        // PASS 4: Strip markdown and HTML
        cleaned = cleaned
            .replace(/```[\s\S]*?```/g, "")
            .replace(/<\/?[^>]+(>|$)/g, "")
            .trim();

        // PASS 5: Collapse whitespace
        cleaned = cleaned.replace(/\s+/g, " ").trim();

        // PASS 6: Too short = garbage
        if (!cleaned || cleaned.length < 3) {
            return "I don't know";
        }

        return cleaned;
    };

    // =========================
    // CALL SARVAM AI (REUSABLE)
    // =========================
    const callSarvam = async (systemContent, userContent, temperature = 0) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        try {
            const res = await fetch(SARVAM_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.SARVAM_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "sarvam-m",
                    messages: [
                        { role: "system", content: systemContent },
                        { role: "user", content: userContent }
                    ],
                    temperature,
                    top_p: 0.8,
                    max_tokens: 500
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);
            return await res.json();

        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    };

    // =========================================================
    // POST /api/chat — Main RAG + AI generation endpoint
    // =========================================================
    fastify.post("/", {
        preHandler: verifyToken,
        schema: chatSchema
    }, async (request, reply) => {

        const startTime = Date.now();
        const { agent_id, message } = request.body;
        const userId = request.user.id;

        try {

            // ── STEP 1: SANITIZE INPUT ────────────────────────────
            const cleanMessage = message.trim();
            if (!cleanMessage) {
                return reply.status(400).send({
                    success: false,
                    message: "Message cannot be empty"
                });
            }

            // ── STEP 2: CONVERSATION INIT ─────────────────────────
            let conversationId = request.body.conversation_id;

            if (!conversationId) {
                const convRes = await query(
                    `INSERT INTO conversations (user_id, agent_id, title)
                     VALUES ($1, $2, $3) RETURNING id`,
                    [userId, agent_id, cleanMessage.slice(0, 50)]
                );
                conversationId = convRes.rows[0].id;
            }

            const normalizedMessage = cleanMessage.toLowerCase().trim();

            // ── STEP 3: VERSIONED RESPONSE CACHE ─────────────────
            const agentMeta = await query(
                "SELECT updated_at FROM agents WHERE id = $1",
                [agent_id]
            );

            const version = agentMeta.rows[0]?.updated_at
                ? new Date(agentMeta.rows[0].updated_at).getTime()
                : "v1";

            const cacheKey = `chat:v2:${agent_id}:${userId}:${version}:${normalizedMessage}`;
            const cached = await redis.get(cacheKey);

            if (cached) {
                console.log("⚡ CHAT CACHE HIT");
                const parsed = JSON.parse(cached);
                return reply.send({
                    success: true,
                    response: parsed.response,
                    cached: true,
                    conversation_id: conversationId
                });
            }

            // ── STEP 4: STORE USER MESSAGE ────────────────────────
            await query(
                `INSERT INTO messages (conversation_id, role, content)
                 VALUES ($1, 'user', $2)`,
                [conversationId, cleanMessage]
            );

            // ── STEP 5: GENERATE / FETCH EMBEDDING ───────────────
            const embedKey = `embed:${normalizedMessage}`;
            let queryEmbedding = await redis.get(embedKey);

            if (queryEmbedding) {
                console.log("⚡ EMBEDDING CACHE HIT");
                queryEmbedding = JSON.parse(queryEmbedding);
            } else {
                console.log("🧠 GENERATING EMBEDDING");
                const t0 = Date.now();

                queryEmbedding = await generateEmbedding(cleanMessage, { type: "query" });

                console.log(`⏱ Embedding: ${Date.now() - t0}ms`);

                if (!queryEmbedding) {
                    console.error("❌ EMBEDDING FAILED");
                    return reply.send({ success: true, response: "I don't know" });
                }

                await redis.set(embedKey, JSON.stringify(queryEmbedding), "EX", 86400);
            }

            // ── STEP 6: FORMAT EMBEDDING ──────────────────────────
            let embeddingStr = null;

            if (Array.isArray(queryEmbedding)) {
                embeddingStr = `[${queryEmbedding.join(",")}]`;
            }

            if (!embeddingStr) {
                console.error("❌ INVALID EMBEDDING FORMAT");
                return reply.send({ success: true, response: "I don't know" });
            }

            // ── STEP 7: FETCH AGENT CONFIG ────────────────────────
            const agentRes = await query(
                "SELECT id, config FROM agents WHERE id = $1 AND user_id = $2",
                [agent_id, userId]
            );

            if (agentRes.rows.length === 0) {
                return reply.status(404).send({
                    success: false,
                    message: "Agent not found"
                });
            }

            const config = agentRes.rows[0].config || {};

            // ── STEP 8: HYBRID KNOWLEDGE SEARCH ───────────────────
            const fallbackSQL = `
                SELECT content FROM knowledge
                WHERE agent_id = $1
                ORDER BY created_at DESC LIMIT 5
            `;

            const textSearchSQL = `
                SELECT content,
                    ts_rank(
                        to_tsvector('english', content),
                        plainto_tsquery($2)
                    ) AS text_score
                FROM knowledge
                WHERE agent_id = $1
                ORDER BY text_score DESC NULLS LAST LIMIT 5
            `;

            let knowledgeRes;

            try {
                const vectorRes = await query(
                    `SELECT content, embedding <-> $2::vector AS distance
                     FROM knowledge WHERE agent_id = $1
                     ORDER BY embedding <-> $2::vector LIMIT 5`,
                    [agent_id, embeddingStr]
                );

                const textRes = await query(textSearchSQL, [agent_id, cleanMessage]);

                const combined = [...vectorRes.rows, ...textRes.rows];
                const uniqueMap = new Map();
                combined.forEach(row => {
                    if (!uniqueMap.has(row.content)) uniqueMap.set(row.content, row);
                });

                knowledgeRes = { rows: Array.from(uniqueMap.values()).slice(0, 5) };
                console.log("🔎 HYBRID SEARCH USED");

            } catch (err) {
                console.error("⚠️ Hybrid search failed → fallback:", err.message);
                knowledgeRes = await query(fallbackSQL, [agent_id]);
            }

            // ── STEP 9: FILTER LOW-QUALITY MATCHES ────────────────
            const filtered = knowledgeRes.rows.filter((row) =>
                row.distance !== undefined ? row.distance < 0.9 : true
            );

            console.log("📊 DISTANCES:", knowledgeRes.rows);

            let finalResults = filtered.length
                ? filtered
                : knowledgeRes.rows.slice(0, 3);

            if (!finalResults.length) {
                const lastResort = await query(
                    `SELECT content FROM knowledge WHERE agent_id = $1
                     ORDER BY created_at DESC LIMIT 3`,
                    [agent_id]
                );
                finalResults = lastResort.rows;
            }

            if (!finalResults.length) {
                console.warn("⚠️ No knowledge found for agent:", agent_id);
                return reply.send({ success: true, response: "I don't know" });
            }

            // ── STEP 10: BUILD KNOWLEDGE CONTEXT ─────────────────
            const knowledgeText = finalResults.map(k => k.content).join("\n\n");
            console.log("🔥 FINAL KNOWLEDGE USED:", finalResults);

            // ── STEP 11: BUILD SYSTEM PROMPT ──────────────────────
            const systemPrompt = buildSystemPrompt(config, knowledgeText);

            // ── STEP 12: CALL SARVAM AI ───────────────────────────
            console.log("🤖 CALLING SARVAM AI...");
            const t2 = Date.now();

            let data;
            try {
                data = await callSarvam(systemPrompt, cleanMessage, config.temperature ?? 0);
            } catch (err) {
                if (err.name === "AbortError") {
                    console.error("❌ SARVAM TIMEOUT");
                    return reply.status(500).send({
                        success: false,
                        message: "AI timeout — please try again"
                    });
                }
                throw err;
            }

            console.log(`⏱ AI: ${Date.now() - t2}ms`);

            if (!data?.choices?.length) {
                console.error("❌ SARVAM ERROR:", data);
                return reply.send({ success: true, response: "I don't know" });
            }

            const rawResponse = data.choices[0].message?.content || "I don't know";
            console.log("🧠 RAW RESPONSE:", rawResponse);

            // ── STEP 13: STRIP <think> BLOCKS FIRST ──────────────
            // 🔥 THIS IS THE KEY FIX:
            // Strip <think>...</think> BEFORE checking for reasoning leaks.
            // sarvam-m puts its thinking inside <think> tags and the actual
            // answer AFTER them. We only want what comes after the tags.
            // Previously we were running hasReasoning on the full raw text
            // (including <think> content = 800+ chars) which always triggered
            // a retry — even when the real answer was already correct.
            const strippedResponse = stripThinkBlocks(rawResponse);
            console.log("✂️  STRIPPED RESPONSE:", strippedResponse);

            // ── STEP 14: CHECK IF RETRY NEEDED ───────────────────
            // Only retry if the text AFTER stripping is still leaking.
            // This saves an API call in the majority of cases.
            let aiResponse = strippedResponse;

            if (hasReasoning(strippedResponse)) {
                console.log("🔁 STILL LEAKING AFTER STRIP — retrying with strict prompt");

                try {
                    const retrySystem = `STRICT MODE: Give the FINAL ANSWER ONLY.
No reasoning. No explanation. Maximum 2 sentences.
If the answer is not in the knowledge → respond exactly: I don't know

Knowledge Base:
────────────────
${knowledgeText}
────────────────
Answer ONLY from the knowledge above. Nothing else.`;

                    const retryData = await callSarvam(retrySystem, cleanMessage, 0);

                    if (retryData?.choices?.length) {
                        const retryRaw = retryData.choices[0].message?.content;
                        if (retryRaw) {
                            // Strip think blocks from retry response too
                            aiResponse = stripThinkBlocks(retryRaw);
                            console.log("✅ RETRY STRIPPED RESPONSE:", aiResponse);
                        }
                    }
                } catch (err) {
                    console.error("⚠️ Retry failed — cleaning original:", err.message);
                }
            }

            // ── STEP 15: FINAL CLEAN ──────────────────────────────
            aiResponse = cleanAIResponse(aiResponse);
            console.log("✅ FINAL CLEAN RESPONSE:", aiResponse);

            // ── STEP 16: STORE AI RESPONSE ────────────────────────
            await query(
                `INSERT INTO messages (conversation_id, role, content)
                 VALUES ($1, 'assistant', $2)`,
                [conversationId, aiResponse]
            );

            // ── STEP 17: CACHE RESPONSE ───────────────────────────
            const TTL = config.length === "detailed" ? 7200 : 3600;

            await redis.set(
                cacheKey,
                JSON.stringify({ response: aiResponse, createdAt: Date.now() }),
                "EX",
                TTL
            );

            // ── STEP 18: UPDATE CONVERSATION MEMORY ───────────────
            const historyKey = `history:${agent_id}:${userId}`;
            const historyRaw = await redis.get(historyKey);
            const history = historyRaw ? JSON.parse(historyRaw) : [];

            history.push(
                { role: "user", content: cleanMessage },
                { role: "assistant", content: aiResponse }
            );

            // Cap at 20 turns — prevents unbounded Redis growth
            await redis.set(
                historyKey,
                JSON.stringify(history.slice(-20)),
                "EX",
                3600
            );

            // ── STEP 19: LOG + SEND ───────────────────────────────
            console.log({
                type: "chat_request",
                agent_id,
                userId,
                cached: false,
                responseTime: Date.now() - startTime
            });

            return reply.send({
                success: true,
                response: aiResponse,
                conversation_id: conversationId
            });

        } catch (error) {
            console.error("❌ Chat Route Error:", error);

            if (error.name === "AbortError") {
                return reply.status(500).send({
                    success: false,
                    message: "AI timeout — please try again"
                });
            }

            return reply.send({ success: true, response: "I don't know" });
        }
    });

    // =========================================================
    // POST /api/chat/stream — SSE streaming endpoint
    // =========================================================
    fastify.post("/stream", {
        preHandler: verifyToken,
        schema: chatSchema
    }, async (request, reply) => {

        let keepAlive;

        try {

            // ── STEP 1: GET RESPONSE FROM CHAT ROUTE ─────────────
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

            // ── STEP 2: SSE HEADERS ───────────────────────────────
            reply.raw.setHeader("Content-Type", "text/event-stream");
            reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
            reply.raw.setHeader("Connection", "keep-alive");
            reply.raw.setHeader("X-Accel-Buffering", "no");
            reply.raw.setHeader("Access-Control-Allow-Origin", "*");
            reply.raw.flushHeaders();

            // ── STEP 3: HEARTBEAT ─────────────────────────────────
            keepAlive = setInterval(() => {
                if (!reply.raw.destroyed) reply.raw.write(": ping\n\n");
            }, 15000);

            // ── STEP 4: STREAM CHUNKS ─────────────────────────────
            const chunks = text.match(/.{1,25}(\s|$)/g) || [text];

            for (const chunk of chunks) {
                if (reply.raw.destroyed) break;
                reply.raw.write(`data: ${JSON.stringify({ chunk })}\n\n`);
                await new Promise(r => setTimeout(r, 10));
            }

            await new Promise(r => setTimeout(r, 50));

            // ── STEP 5: END STREAM ────────────────────────────────
            reply.raw.write("data: [DONE]\n\n");

        } catch (error) {
            console.error("❌ Streaming Error:", error);

            try {
                if (!reply.raw.destroyed) {
                    reply.raw.write(`data: ${JSON.stringify({ chunk: "I don't know" })}\n\n`);
                    reply.raw.write("data: [DONE]\n\n");
                }
            } catch (_) { /* connection gone */ }

        } finally {
            if (keepAlive) clearInterval(keepAlive);
            if (!reply.raw.destroyed) reply.raw.end();
        }
    });
}