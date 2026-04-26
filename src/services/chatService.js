import { query } from "../config/db.js";
import redis from "../config/redis.js";
import { generateEmbedding } from "../utils/embedding.js";

const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";

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
    custom: null
};

export const buildSystemPrompt = (config, knowledgeText) => {
    const role = config.role === "custom"
        ? (config.instructions || "You are a helpful AI assistant")
        : (roleMap[config.role] || "You are a helpful assistant");

    const tone = toneMap[config.tone] || "Be neutral and professional";
    const length = lengthMap[config.length] || "Keep the answer concise";
    const language = languageMap[config.language] || "English";

    const extraInstructions = (config.instructions && config.role !== "custom")
        ? `\nExtra instructions: ${config.instructions}`
        : "";

    return `ROLE: ${role}
Tone: ${tone}. ${length}. Respond in ${language}.${extraInstructions}

RULES (never violate):
- Output the final answer ONLY — no preamble, reasoning, or closing remark
- Never think out loud or use: "let me", "I think", "maybe", "okay", "so,", "well,", "based on", "it seems", "hmm", "sure", "of course", "certainly"
- Never repeat or rephrase the question
- Never hallucinate — only use facts from the Knowledge Base below
- Max 3 sentences unless listing multiple distinct items
- Answer ONLY from the Knowledge Base — no general knowledge or assumptions
- If the question has typos, gibberish, or cannot be matched to the Knowledge Base → respond exactly: I don't know
- Do not ask for clarification
- If a policy has multiple conditions → include ALL of them
- Never start your answer with: "I", "The", "Sure", "Of course", "Certainly", "Based on", "According to"

KNOWLEDGE BASE:
${knowledgeText}

Answer ONLY from the knowledge above. If not found → I don't know.`;
};

// Strips both closed AND unclosed <think> blocks
// (unclosed = model was cut off by max_tokens before emitting </think>)
export const stripThinkBlocks = (text) => {
    if (!text) return "";
    let stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
    stripped = stripped.replace(/<think>[\s\S]*/gi, "");
    return stripped.trim();
};

export const hasReasoning = (text) => {
    if (!text) return false;
    if (text.length > 300) return true;
    return /let me|i think|maybe|wait|hmm|the user|okay,|so,|well,|looking at|based on|it seems|i should|alright|first,/i.test(text);
};

export const cleanAIResponse = (text) => {
    if (!text) return "I don't know";

    let cleaned = text.trim();

    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    if (cleaned.length > 300) {
        const firstSentence = cleaned.match(/^[^.!?]*[.!?]/);
        cleaned = firstSentence ? firstSentence[0].trim() : "I don't know";
    }

    cleaned = cleaned
        .replace(/^(okay[,.]?|so[,.]?|well[,.]?|alright[,.]?|looking at|based on|it seems|first[,]?)[\s\S]*?\./i, "")
        .replace(/let me[\s\S]*?\./i, "")
        .replace(/i think[\s\S]*?\./i, "")
        .replace(/maybe[\s\S]*?\./i, "")
        .replace(/the user[\s\S]*?\./i, "")
        .replace(/wait[, ]*[\s\S]*?\./i, "")
        .replace(/i should[\s\S]*?\./i, "")
        .replace(/hmm[, ]*[\s\S]*?\./i, "");

    cleaned = cleaned
        .replace(/```[\s\S]*?```/g, "")
        .replace(/<\/?[^>]+(>|$)/g, "")
        .trim();

    cleaned = cleaned.replace(/\s+/g, " ").trim();

    if (!cleaned || cleaned.length < 3) {
        return "I don't know";
    }

    return cleaned;
};

export const callSarvam = async (systemContent, userContent, temperature = 0) => {
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

// =========================
// UNIFIED CORE HANDLER
// Single source of truth for all chat routes.
// userId = null for public routes (excluded from cache key).
// conversationId = null for public routes (no DB tracking).
// Returns: { response, cached, conversationId }
// =========================
export const handleChatCore = async ({ agent_id, message, userId, conversationId }) => {

    const cleanMessage = message.trim();
    if (!cleanMessage) {
        return { response: "I don't know", cached: false, conversationId };
    }

    const normalizedMessage = cleanMessage.toLowerCase().trim();

    // ── STEP 1: VERSIONED CACHE KEY ───────────────────────
    const agentMeta = await query(
        "SELECT updated_at FROM agents WHERE id = $1",
        [agent_id]
    );

    const version = agentMeta.rows[0]?.updated_at
        ? new Date(agentMeta.rows[0].updated_at).getTime()
        : "v1";

    // userId included for dashboard (user-scoped), null/public for widget
    const userSegment = userId || "public";
    const cacheKey = `chat:v2:${agent_id}:${userSegment}:${version}:${normalizedMessage}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
        console.log("⚡ CHAT CACHE HIT");
        const parsed = JSON.parse(cached);

        // ── CACHE HIT USAGE LOG ───────────────────────────
        try {
            await query(
                `INSERT INTO usage_logs 
                (id, agent_id, tokens_used, cost, model_used, created_at)
                VALUES (gen_random_uuid(), $1, 0, 0, 'cache', NOW())`,
                [agent_id]
            );
        } catch (err) {
            console.error("Cache usage log failed:", err.message);
        }

        return { response: parsed.response, cached: true, conversationId };
    }

    // ── STEP 2: EMBEDDING ─────────────────────────────────
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
            return { response: "I don't know", cached: false, conversationId };
        }

        await redis.set(embedKey, JSON.stringify(queryEmbedding), "EX", 86400);
    }

    // ── STEP 3: FORMAT EMBEDDING ──────────────────────────
    if (!Array.isArray(queryEmbedding)) {
        console.error("❌ INVALID EMBEDDING FORMAT");
        return { response: "I don't know", cached: false, conversationId };
    }

    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    // =========================
    // 🔥 SEMANTIC CACHE
    // Threshold tuned to 0.45 based on observed distances:
    //   "what is your refund policy ?" <-> "tell me about refunds" = 0.41
    //   0.45 catches rephrased same-topic questions without false positives
    // =========================
    const SEMANTIC_THRESHOLD = 0.45;

    try {
        const semanticRes = await query(
            `SELECT response, embedding <-> $2::vector AS distance
             FROM semantic_cache
             WHERE agent_id = $1
             ORDER BY embedding <-> $2::vector
             LIMIT 1`,
            [agent_id, embeddingStr]
        );

        if (semanticRes.rows.length) {
            const distance = semanticRes.rows[0].distance;
            console.log(`🔬 SEMANTIC DISTANCE: ${distance.toFixed(4)} (threshold: ${SEMANTIC_THRESHOLD})`);

            if (distance < SEMANTIC_THRESHOLD) {
                console.log("🧠 SEMANTIC CACHE HIT");

                try {
                    await query(
                        `INSERT INTO usage_logs 
                        (id, agent_id, tokens_used, cost, model_used, created_at)
                        VALUES (gen_random_uuid(), $1, 0, 0, 'semantic-cache', NOW())`,
                        [agent_id]
                    );
                } catch (logErr) {
                    console.error("Semantic cache usage log failed:", logErr.message);
                }

                return {
                    response: semanticRes.rows[0].response,
                    cached: true,
                    conversationId
                };
            } else {
                console.log(`🔬 SEMANTIC CACHE MISS — distance ${distance.toFixed(4)} > ${SEMANTIC_THRESHOLD}`);
            }
        } else {
            console.log("🔬 SEMANTIC CACHE EMPTY — no entries for this agent yet");
        }
    } catch (err) {
        console.error("Semantic cache lookup error:", err.message);
        // Always continue — semantic cache failure must never block the response
    }

    // ── STEP 4: FETCH AGENT CONFIG ────────────────────────
    const agentQuery = userId
        ? "SELECT id, config FROM agents WHERE id = $1 AND user_id = $2"
        : "SELECT id, config FROM agents WHERE id = $1";

    const agentParams = userId ? [agent_id, userId] : [agent_id];
    const agentRes = await query(agentQuery, agentParams);

    if (agentRes.rows.length === 0) {
        return { response: "I don't know", cached: false, conversationId, notFound: true };
    }

    const config = agentRes.rows[0].config || {};

    // ── STEP 5: HYBRID KNOWLEDGE SEARCH ──────────────────
    const fallbackSQL = `
        SELECT content FROM knowledge
        WHERE agent_id = $1
        ORDER BY created_at DESC LIMIT 3
    `;

    const textSearchSQL = `
        SELECT content,
            ts_rank(
                to_tsvector('english', content),
                plainto_tsquery($2)
            ) AS text_score
        FROM knowledge
        WHERE agent_id = $1
        ORDER BY text_score DESC NULLS LAST LIMIT 3
    `;

    let knowledgeRes;

    try {
        const vectorRes = await query(
            `SELECT content, embedding <-> $2::vector AS distance
             FROM knowledge WHERE agent_id = $1
             ORDER BY embedding <-> $2::vector LIMIT 3`,
            [agent_id, embeddingStr]
        );

        const textRes = await query(textSearchSQL, [agent_id, cleanMessage]);

        const combined = [...vectorRes.rows, ...textRes.rows];
        const uniqueMap = new Map();
        combined.forEach(row => {
            if (!uniqueMap.has(row.content)) uniqueMap.set(row.content, row);
        });

        knowledgeRes = { rows: Array.from(uniqueMap.values()).slice(0, 3) };
        console.log("🔎 HYBRID SEARCH USED");

    } catch (err) {
        console.error("⚠️ Hybrid search failed → fallback:", err.message);
        knowledgeRes = await query(fallbackSQL, [agent_id]);
    }

    // ── STEP 6: FILTER LOW-QUALITY MATCHES ───────────────
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
        return { response: "I don't know", cached: false, conversationId };
    }

    // ── STEP 7: BUILD KNOWLEDGE + SYSTEM PROMPT ──────────
    const knowledgeText = finalResults
        .map(k => k.content)
        .join("\n\n")
        .slice(0, 1500); // limit tokens

    console.log("🔥 FINAL KNOWLEDGE USED:", finalResults);

    const systemPrompt = buildSystemPrompt(config, knowledgeText);

    // ── STEP 8: CALL SARVAM AI ────────────────────────────
    console.log("🤖 CALLING SARVAM AI...");
    const t2 = Date.now();

    let data;
    try {
        data = await callSarvam(systemPrompt, cleanMessage, config.temperature ?? 0);
    } catch (err) {
        if (err.name === "AbortError") {
            throw Object.assign(new Error("AI timeout"), { isTimeout: true });
        }
        throw err;
    }

    console.log(`⏱ AI: ${Date.now() - t2}ms`);

    if (!data?.choices?.length) {
        console.error("❌ SARVAM ERROR:", data);
        return { response: "I don't know", cached: false, conversationId };
    }

    const rawResponse = data.choices[0].message?.content || "I don't know";
    console.log("🧠 RAW RESPONSE:", rawResponse);

    // ── STEP 9: STRIP THINK BLOCKS ────────────────────────
    const strippedResponse = stripThinkBlocks(rawResponse);
    console.log("✂️  STRIPPED RESPONSE:", strippedResponse);

    // ── STEP 10: RETRY IF STILL LEAKING ──────────────────
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
                    aiResponse = stripThinkBlocks(retryRaw);
                    console.log("✅ RETRY STRIPPED RESPONSE:", aiResponse);
                }
            }
        } catch (err) {
            console.error("⚠️ Retry failed — cleaning original:", err.message);
        }
    }

    // ── STEP 11: FINAL CLEAN ──────────────────────────────
    aiResponse = cleanAIResponse(aiResponse);
    console.log("✅ FINAL CLEAN RESPONSE:", aiResponse);

    // =========================
    // 🔥 SAVE SEMANTIC CACHE
    // Only save real answers — never cache "I don't know"
    // =========================
    if (aiResponse && aiResponse !== "I don't know") {
        try {
            await query(
                `INSERT INTO semantic_cache 
                (id, agent_id, question, embedding, response, created_at)
                VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
                [
                    agent_id,
                    cleanMessage,
                    embeddingStr,
                    aiResponse
                ]
            );
            console.log("💾 SEMANTIC CACHE SAVED:", cleanMessage);
        } catch (err) {
            console.error("Semantic cache save failed:", err.message);
        }
    }

    // ── AI TOKEN USAGE LOG ────────────────────────────────
    try {
        const tokensUsed =
            data?.usage?.total_tokens ||
            data?.usage?.completion_tokens ||
            Math.ceil(cleanMessage.length / 4); // fallback

        const cost = tokensUsed * 0.000002;

        await query(
            `INSERT INTO usage_logs 
            (id, agent_id, tokens_used, cost, model_used, created_at)
            VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
            [
                agent_id,
                tokensUsed,
                cost,
                "sarvam"
            ]
        );
    } catch (err) {
        console.error("Usage logging failed:", err.message);
    }

    // ── STEP 12: CACHE SAVE ───────────────────────────────
    const TTL = config.length === "detailed" ? 7200 : 3600;

    await redis.set(
        cacheKey,
        JSON.stringify({ response: aiResponse, createdAt: Date.now() }),
        "EX",
        TTL
    );

    return { response: aiResponse, cached: false, conversationId };
};