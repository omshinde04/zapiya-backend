// =========================
// services/greetingService.js
// =========================

const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";

// 🔥 reuse same cleaner logic (copy from chat.js)
const stripThinkBlocks = (text) => {
    if (!text) return "";
    return text
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<think>[\s\S]*/gi, "")
        .trim();
};

const cleanResponse = (text) => {
    if (!text) return "";

    let cleaned = stripThinkBlocks(text);
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    return cleaned;
};

// =========================
// MAIN GREETING FUNCTION
// =========================
export const generateGreeting = async (agentName) => {

    const systemPrompt = `
You are an AI assistant named "${agentName}".

STRICT RULES:
- Output ONLY 1-2 sentences
- Introduce yourself using EXACTLY this name: ${agentName}
- Ask the user for their name
- NO reasoning
- NO "I don't know"
- DO NOT include <think>
`;

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
                    { role: "system", content: systemPrompt },
                    { role: "user", content: "Greet the user." }
                ],
                temperature: 0.3,
                max_tokens: 60
            })
        });

        const data = await res.json();

        const raw = data?.choices?.[0]?.message?.content || "";

        const cleaned = cleanResponse(raw);

        const isValidGreeting =
            cleaned &&
            cleaned.length > 10 &&
            cleaned.toLowerCase().includes(agentName.toLowerCase()) &&
            cleaned.includes("?");

        if (!isValidGreeting) {
            return `Hi! I'm ${agentName}. What's your name?`;
        }

        return cleaned;

    } catch (err) {
        console.error("❌ Greeting AI Error:", err.message);
        return `Hi! I'm ${agentName}. What's your name?`;
    }
};