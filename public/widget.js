(function () {

    console.log("✅ Widget loaded");

    // =========================
    // CONFIG
    // =========================
    const API_BASE = "http://localhost:3001/api/chat";

    // =========================
    // GET AGENT ID
    // =========================
    const script = document.currentScript;
    const agentId = script.getAttribute("data-agent");
    const agentName = script.getAttribute("data-name") || "AI Assistant";

    if (!agentId) {
        console.error("❌ No agent ID provided");
        return;
    }

    console.log("🆔 Agent ID:", agentId);

    // =========================
    // STATE
    // =========================
    let chatState = "idle";
    let userName = "";

    // =========================
    // INJECT STYLES
    // =========================
    const style = document.createElement("style");
    style.textContent = `
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');

        #__chat-widget-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 54px;
            height: 54px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 99999;
            box-shadow: 0 4px 20px rgba(99,102,241,0.45);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            font-size: 22px;
            user-select: none;
        }
        #__chat-widget-btn:hover {
            transform: scale(1.08);
            box-shadow: 0 6px 28px rgba(99,102,241,0.6);
        }
        #__chat-widget-btn:active {
            transform: scale(0.96);
        }

        #__chat-widget-box {
            position: fixed;
            bottom: 90px;
            right: 24px;
            width: 360px;
            height: 520px;
            background: #0f172a;
            border-radius: 16px;
            display: none;
            flex-direction: column;
            z-index: 99999;
            box-shadow: 0 24px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
            font-family: 'DM Sans', system-ui, sans-serif;
            overflow: hidden;
            animation: __chat-slideUp 0.22s cubic-bezier(0.16,1,0.3,1);
        }

        @keyframes __chat-slideUp {
            from { opacity: 0; transform: translateY(16px) scale(0.97); }
            to   { opacity: 1; transform: translateY(0) scale(1); }
        }

        #__chat-header {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 14px 16px;
            background: #1e293b;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
        }
        #__chat-header-avatar {
            width: 34px;
            height: 34px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            flex-shrink: 0;
        }
        #__chat-header-info {
            flex: 1;
        }
        #__chat-header-name {
            font-size: 13.5px;
            font-weight: 600;
            color: #f1f5f9;
            line-height: 1.2;
        }
        #__chat-header-subtitle {
            font-size: 11px;
            color: #64748b;
            margin-top: 1px;
            line-height: 1.2;
        }
        #__chat-header-status {
            font-size: 11px;
            color: #22c55e;
            display: flex;
            align-items: center;
            gap: 4px;
            margin-top: 2px;
        }
        #__chat-header-status::before {
            content: '';
            display: inline-block;
            width: 6px;
            height: 6px;
            background: #22c55e;
            border-radius: 50%;
        }
        #__chat-close-btn {
            width: 28px;
            height: 28px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: #64748b;
            font-size: 16px;
            transition: background 0.15s, color 0.15s;
        }
        #__chat-close-btn:hover {
            background: rgba(255,255,255,0.08);
            color: #f1f5f9;
        }

        #__chat-messages {
            flex: 1;
            padding: 16px 14px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 12px;
            scroll-behavior: smooth;
        }
        #__chat-messages::-webkit-scrollbar {
            width: 4px;
        }
        #__chat-messages::-webkit-scrollbar-track {
            background: transparent;
        }
        #__chat-messages::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.1);
            border-radius: 4px;
        }

        .chat-msg-row {
            display: flex;
            align-items: flex-end;
            gap: 7px;
        }
        .chat-msg-row.user {
            flex-direction: row-reverse;
        }

        .chat-avatar {
            width: 26px;
            height: 26px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            flex-shrink: 0;
        }
        .chat-avatar.ai {
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
        }
        .chat-avatar.user {
            background: #1e293b;
            border: 1px solid rgba(255,255,255,0.1);
        }

        .chat-bubble {
            max-width: 240px;
            padding: 9px 13px;
            border-radius: 14px;
            font-size: 13px;
            line-height: 1.55;
            word-break: break-word;
        }
        .chat-bubble.ai {
            background: #1e293b;
            color: #e2e8f0;
            border-bottom-left-radius: 4px;
        }
        .chat-bubble.user {
            background: linear-gradient(135deg, #6366f1, #7c3aed);
            color: #fff;
            border-bottom-right-radius: 4px;
        }

        .chat-typing-dot {
            display: inline-flex;
            gap: 3px;
            padding: 2px 0;
        }
        .chat-typing-dot span {
            width: 5px;
            height: 5px;
            background: #64748b;
            border-radius: 50%;
            animation: __chat-blink 1.2s infinite;
        }
        .chat-typing-dot span:nth-child(2) { animation-delay: 0.2s; }
        .chat-typing-dot span:nth-child(3) { animation-delay: 0.4s; }

        @keyframes __chat-blink {
            0%, 80%, 100% { opacity: 0.2; transform: scale(0.85); }
            40%            { opacity: 1;   transform: scale(1); }
        }

        #__chat-input-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            background: #1e293b;
            border-top: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
            min-height: 52px;
        }
        #__chat-input-row.hidden {
            display: none;
        }

        #__chat-name-row {
            display: none;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            background: #1e293b;
            border-top: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
            min-height: 52px;
        }
        #__chat-name-row.visible {
            display: flex;
        }

        #__chat-greeting-bar {
            display: none;
            align-items: center;
            justify-content: center;
            padding: 10px 12px;
            background: #1e293b;
            border-top: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
            min-height: 52px;
        }
        #__chat-greeting-bar.visible {
            display: flex;
        }
        #__chat-greeting-bar p {
            font-size: 11px;
            color: #475569;
            margin: 0;
        }

        .chat-field {
            flex: 1;
            background: #0f172a;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 10px;
            color: #f1f5f9;
            font-size: 13px;
            font-family: inherit;
            padding: 9px 12px;
            outline: none;
            transition: border-color 0.15s;
        }
        .chat-field::placeholder {
            color: #475569;
        }
        .chat-field:focus {
            border-color: rgba(99,102,241,0.5);
        }
        .chat-send-btn {
            width: 34px;
            height: 34px;
            background: linear-gradient(135deg, #6366f1, #7c3aed);
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
            transition: opacity 0.15s, transform 0.15s;
        }
        .chat-send-btn:hover {
            opacity: 0.88;
            transform: scale(1.05);
        }
        .chat-send-btn:active {
            transform: scale(0.95);
        }
        .chat-send-btn svg {
            width: 15px;
            height: 15px;
            fill: #fff;
        }
        .chat-send-btn.disabled {
            opacity: 0.35;
            pointer-events: none;
        }

        #__chat-header-subtitle {
            font-size: 11px;
            color: #64748b;
            margin-top: 2px;
            line-height: 1.2;
        }

        #__chat-idle-screen {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            flex: 1;
            gap: 18px;
            padding: 32px 16px;
            text-align: center;
        }
        #__chat-idle-screen.hidden {
            display: none;
        }
        #__chat-idle-avatar {
            width: 56px;
            height: 56px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            box-shadow: 0 8px 24px rgba(99,102,241,0.35);
        }
        #__chat-idle-name {
            font-size: 14px;
            font-weight: 600;
            color: #f1f5f9;
            margin: 0 0 2px 0;
        }
        #__chat-idle-tagline {
            font-size: 11px;
            color: #475569;
            margin: 0;
        }
        #__chat-start-btn {
            margin-top: 4px;
            padding: 9px 22px;
            background: #fff;
            color: #0f172a;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            border: none;
            box-shadow: 0 4px 14px rgba(0,0,0,0.25);
            transition: transform 0.15s, box-shadow 0.15s;
        }
        #__chat-start-btn:hover {
            transform: scale(1.04);
            box-shadow: 0 6px 20px rgba(0,0,0,0.3);
        }
        #__chat-start-btn:active {
            transform: scale(0.97);
        }
    `;
    document.head.appendChild(style);

    // =========================
    // BUILD DOM
    // =========================

    // BUTTON
    const button = document.createElement("div");
    button.id = "__chat-widget-btn";
    button.innerHTML = "💬";
    document.body.appendChild(button);

    // CHAT BOX
    const chatBox = document.createElement("div");
    chatBox.id = "__chat-widget-box";

    // HEADER
    const header = document.createElement("div");
    header.id = "__chat-header";
    header.innerHTML = `
        <div id="__chat-header-avatar">🤖</div>
        <div id="__chat-header-info">
            <div id="__chat-header-name">${agentName}</div>
            <div id="__chat-header-status">Online</div>
            <div id="__chat-header-subtitle"></div>
        </div>
        <div id="__chat-close-btn">✕</div>
    `;

    // MESSAGES
    const messages = document.createElement("div");
    messages.id = "__chat-messages";

    // IDLE SPLASH SCREEN (inside messages area)
    const idleScreen = document.createElement("div");
    idleScreen.id = "__chat-idle-screen";
    idleScreen.innerHTML = `
        <div id="__chat-idle-avatar">🤖</div>
        <div>
            <p id="__chat-idle-name">${agentName}</p>
            <p id="__chat-idle-tagline">Ready to assist you</p>
        </div>
        <button id="__chat-start-btn">Start Chat →</button>
    `;
    messages.appendChild(idleScreen);

    // GREETING BAR (shown during greeting state)
    const greetingBar = document.createElement("div");
    greetingBar.id = "__chat-greeting-bar";
    greetingBar.innerHTML = `<p>Connecting to agent...</p>`;

    // NAME INPUT ROW (shown during naming state)
    const nameRow = document.createElement("div");
    nameRow.id = "__chat-name-row";

    const nameInput = document.createElement("input");
    nameInput.className = "chat-field";
    nameInput.placeholder = "Enter your name…";
    nameInput.maxLength = 40;

    const nameSendBtn = document.createElement("div");
    nameSendBtn.className = "chat-send-btn";
    nameSendBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

    nameRow.appendChild(nameInput);
    nameRow.appendChild(nameSendBtn);

    // CHAT INPUT ROW (shown during chatting state)
    const inputRow = document.createElement("div");
    inputRow.id = "__chat-input-row";
    inputRow.classList.add("hidden");

    const input = document.createElement("input");
    input.className = "chat-field";
    input.placeholder = "Type a message…";

    const sendBtn = document.createElement("div");
    sendBtn.className = "chat-send-btn";
    sendBtn.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    chatBox.appendChild(header);
    chatBox.appendChild(messages);
    chatBox.appendChild(greetingBar);
    chatBox.appendChild(nameRow);
    chatBox.appendChild(inputRow);
    document.body.appendChild(chatBox);

    // =========================
    // HELPERS
    // =========================

    function scrollToBottom() {
        messages.scrollTop = messages.scrollHeight;
    }

    function createMessage(text, type) {
        const row = document.createElement("div");
        row.className = `chat-msg-row ${type}`;

        const avatar = document.createElement("div");
        avatar.className = `chat-avatar ${type}`;
        avatar.textContent = type === "user" ? "🧑" : "🤖";

        const bubble = document.createElement("div");
        bubble.className = `chat-bubble ${type}`;
        bubble.textContent = text;

        row.appendChild(avatar);
        row.appendChild(bubble);
        messages.appendChild(row);
        scrollToBottom();

        return bubble;
    }

    function createTypingIndicator() {
        const row = document.createElement("div");
        row.className = "chat-msg-row ai";
        row.id = "__chat-typing-row";

        const avatar = document.createElement("div");
        avatar.className = "chat-avatar ai";
        avatar.textContent = "🤖";

        const bubble = document.createElement("div");
        bubble.className = "chat-bubble ai";
        bubble.innerHTML = `<span class="chat-typing-dot"><span></span><span></span><span></span></span>`;

        row.appendChild(avatar);
        row.appendChild(bubble);
        messages.appendChild(row);
        scrollToBottom();

        return row;
    }

    function removeTypingIndicator() {
        const el = document.getElementById("__chat-typing-row");
        if (el) el.remove();
    }

    // =========================
    // INPUT ZONE SWITCHER
    // =========================
    function showZone(zone) {
        greetingBar.classList.remove("visible");
        nameRow.classList.remove("visible");
        inputRow.classList.add("hidden");

        // Show/hide idle splash
        if (zone === "idle") {
            idleScreen.classList.remove("hidden");
        } else {
            idleScreen.classList.add("hidden");
        }

        if (zone === "greeting") {
            greetingBar.classList.add("visible");
        } else if (zone === "naming") {
            nameRow.classList.add("visible");
            setTimeout(() => nameInput.focus(), 100);
        } else if (zone === "chatting") {
            inputRow.classList.remove("hidden");
            setTimeout(() => input.focus(), 100);
        }
    }

    function updateHeaderSubtitle(text) {
        const el = document.getElementById("__chat-header-subtitle");
        if (el) el.textContent = text;
    }

    // =========================
    // TOGGLE + GREETING
    // =========================
    function openChat() {
        chatBox.style.display = "flex";
    }
    function closeChat() {
        chatBox.style.display = "none";
    }

    // =========================
    // START CHAT (triggered by "Start Chat →" button)
    // =========================
    async function handleStartChat() {
        chatState = "greeting";
        showZone("greeting");
        updateHeaderSubtitle("Connecting...");

        const typingRow = createTypingIndicator();

        try {
            const res = await fetch(`${API_BASE}/public/greet`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agent_id: agentId })
            });

            const data = await res.json();
            removeTypingIndicator();

            // Update agent name from API response if available
            if (data.agentName && typeof data.agentName === "string" && data.agentName.trim()) {
                const resolvedName = data.agentName.trim();
                const nameEl = document.getElementById("__chat-header-name");
                if (nameEl) nameEl.textContent = resolvedName;
                const idleNameEl = document.getElementById("__chat-idle-name");
                if (idleNameEl) idleNameEl.textContent = resolvedName;
            }

            createMessage(data.greeting || "Hi! What's your name?", "ai");

        } catch {
            removeTypingIndicator();
            createMessage("Hi! What's your name?", "ai");
        }

        chatState = "naming";
        showZone("naming");
        updateHeaderSubtitle("Introduce yourself");
    }

    button.onclick = () => {
        const isOpen = chatBox.style.display === "flex";
        if (isOpen) {
            closeChat();
        } else {
            openChat();
            // If idle, just show the splash — user clicks "Start Chat →" to proceed
            if (chatState === "idle") {
                showZone("idle");
                updateHeaderSubtitle("Click to start");
            }
        }
    };

    // Wire "Start Chat →" button inside idle splash
    messages.addEventListener("click", (e) => {
        if (e.target && e.target.id === "__chat-start-btn") {
            handleStartChat();
        }
    });

    document.getElementById("__chat-close-btn").onclick = () => closeChat();

    // =========================
    // NAME SUBMIT
    // =========================
    function handleNameSubmit() {
        const name = nameInput.value.trim();
        if (!name) return;

        nameInput.value = "";
        userName = name;

        createMessage(name, "user");

        setTimeout(() => {
            createMessage(`Nice to meet you, ${userName}! How can I help you today?`, "ai");

            chatState = "chatting";
            showZone("chatting");
            updateHeaderSubtitle(`Chatting as ${userName}`);
            input.placeholder = `Ask me anything, ${userName}…`;
        }, 300);
    }

    nameInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleNameSubmit();
    });
    nameSendBtn.onclick = () => handleNameSubmit();

    // =========================
    // SEND CHAT MESSAGE
    // =========================
    async function handleSend() {
        const text = input.value.trim();
        if (!text) return;

        input.value = "";

        createMessage(text, "user");

        // =========================
        // STREAMING RESPONSE
        // =========================
        const typingRow = createTypingIndicator();
        let aiBubble = null;
        let aiText = "";

        try {
            console.log("🚀 Streaming:", text);

            const res = await fetch(`${API_BASE}/public/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agent_id: agentId,
                    message: text
                })
            });

            if (!res.body) throw new Error("No stream");

            const reader = res.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n\n");

                let isDone = false;

                for (let line of lines) {
                    line = line.trim();
                    if (!line.startsWith("data:")) continue;

                    const data = line.replace("data:", "").trim();

                    if (data === "[DONE]") {
                        isDone = true;
                        continue;
                    }

                    try {
                        const parsed = JSON.parse(data);

                        if (parsed.chunk) {
                            if (!aiBubble) {
                                removeTypingIndicator();
                                aiBubble = createMessage("", "ai");
                            }
                            aiText += parsed.chunk;
                            aiBubble.textContent = aiText;
                            scrollToBottom();
                        }

                    } catch (err) {
                        console.error("❌ Parse error:", err);
                    }
                }

                if (isDone) {
                    await reader.cancel();
                    return;
                }
            }

        } catch (error) {
            console.error("❌ Stream error:", error);
            removeTypingIndicator();
            createMessage("Something went wrong. Please try again.", "ai");
        }
    }

    input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") handleSend();
    });

    sendBtn.onclick = () => handleSend();

})();