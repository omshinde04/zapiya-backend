/**
 * Production-grade embedding generator
 * -----------------------------------
 * Features:
 * - Timeout protection
 * - Retry with exponential backoff
 * - Input normalization
 * - Response validation
 * - Service health check (NEW 🔥)
 * - Safe fallback (never crashes main system)
 * - Structured logging for observability
 */

const EMBEDDING_URL =
    process.env.EMBEDDING_SERVICE_URL || "http://127.0.0.1:8000/embed";

const HEALTH_URL =
    process.env.EMBEDDING_HEALTH_URL || "http://127.0.0.1:8000/health";

// =========================
// HEALTH CACHE (avoid spam)
// =========================
let isServiceHealthy = false;
let lastHealthCheck = 0;
const HEALTH_TTL = 5000; // 5 sec cache

// =========================
// HELPER: Delay
// =========================
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// =========================
// HEALTH CHECK FUNCTION
// =========================
async function checkEmbeddingService() {
    const now = Date.now();

    // Use cached health status
    if (isServiceHealthy && now - lastHealthCheck < HEALTH_TTL) {
        return true;
    }

    try {
        const res = await fetch(HEALTH_URL, { method: "GET" });

        if (res.ok) {
            isServiceHealthy = true;
            lastHealthCheck = now;
            return true;
        }
    } catch (err) {
        console.warn("⚠️ Embedding service not reachable");
    }

    isServiceHealthy = false;
    return false;
}

// =========================
// WAIT UNTIL SERVICE READY
// =========================
async function waitForEmbeddingService(maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        const ok = await checkEmbeddingService();

        if (ok) {
            console.log("✅ Embedding service ready");
            return true;
        }

        console.log("⏳ Waiting for embedding service...");
        await delay(500);
    }

    console.warn("⚠️ Embedding service still not ready");
    return false;
}

// =========================
// MAIN FUNCTION
// =========================
export async function generateEmbedding(text, options = {}) {
    const {
        timeoutMs = 4000,
        retries = 2
    } = options;

    // =========================
    // 1. INPUT VALIDATION
    // =========================
    if (!text || typeof text !== "string") {
        console.error("❌ Invalid input for embedding:", text);
        return null;
    }

    const cleanText = text.trim().slice(0, 2000);

    // =========================
    // 2. ENSURE SERVICE READY
    // =========================
    const healthy = await checkEmbeddingService();

    if (!healthy) {
        console.log("🔄 Trying to wait for embedding service...");
        await waitForEmbeddingService(5);
    }

    // =========================
    // 3. RETRY LOOP
    // =========================
    for (let attempt = 0; attempt <= retries; attempt++) {

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const startTime = Date.now();

            const res = await fetch(EMBEDDING_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    text: cleanText,
                    type: options.type || "query"   // ✅ ADD THIS
                }),
                signal: controller.signal
            });

            clearTimeout(timeout);

            // =========================
            // 4. READ RESPONSE
            // =========================
            const raw = await res.text();

            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                console.error("❌ Invalid JSON from embedding service:", raw);
                return null;
            }

            // =========================
            // 5. HTTP ERROR
            // =========================
            if (!res.ok) {
                console.error("❌ Embedding Service Error:", data);
                return null;
            }

            // =========================
            // 6. VALIDATION
            // =========================
            if (!data?.embedding || !Array.isArray(data.embedding)) {
                console.error("❌ Invalid embedding format:", data);
                return null;
            }

            if (data.embedding.length < 10) {
                console.error("❌ Embedding too small:", data.embedding.length);
                return null;
            }

            // =========================
            // 7. SUCCESS LOG
            // =========================
            console.log({
                type: "embedding_success",
                length: data.embedding.length,
                responseTime: Date.now() - startTime,
                attempt
            });

            return data.embedding;

        } catch (error) {
            clearTimeout(timeout);

            // =========================
            // 8. ERROR HANDLING
            // =========================
            if (error.name === "AbortError") {
                console.error(`⏱ Embedding timeout (attempt ${attempt})`);
            } else {
                console.error(`❌ Embedding error (attempt ${attempt}):`, error.message);
            }

            // =========================
            // 9. RETRY LOGIC
            // =========================
            if (attempt < retries) {
                const backoff = 200 * Math.pow(2, attempt);
                await delay(backoff);
                continue;
            }

            // =========================
            // 10. FINAL FALLBACK
            // =========================
            return null;
        }
    }

    return null;
}