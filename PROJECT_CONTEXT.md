# 🚀 AI Voice Agent SaaS Platform - Project Context

## 🎯 Goal

Build a scalable AI SaaS platform where users can create voice-enabled AI agents (like Snowie AI).

---

## 🧠 Tech Stack

Backend:

* Node.js
* Fastify

Database:

* PostgreSQL

AI:

* Gemini (LLM)
* Sarvam AI (STT + TTS + Marathi support)

---

## 📁 Project Structure

ai-agent-backend/
│
├── .env
├── package.json
├── src/
│   ├── app.js
│   ├── config/
│   │   ├── db.js
│   │   └── initDB.js
│   ├── services/
│   └── routes/

---

## ⚙️ Backend Setup (Completed)

* Fastify server created
* CORS enabled
* Environment variables configured
* PostgreSQL connected successfully
* `.env` issue fixed (root folder + correct execution)
* Server running on port 3000

---

## 🧠 Database Design

### Tables Created:

1. users 👤

* id (UUID)
* name
* email (unique)
* password
* created_at

2. agents 🤖

* id (UUID)
* user_id (FK)
* name
* description
* language (JSONB)
* is_active
* created_at

3. documents 📚

* id (UUID)
* agent_id (FK)
* content
* metadata (JSONB)
* source
* created_at

4. usage_logs 💰

* id (UUID)
* agent_id
* tokens_used
* audio_seconds
* cost
* model_used
* created_at

---

## 🚫 Design Decisions

* ❌ No conversation storage (to reduce cost)
* ✅ Use temporary memory (future: Redis)
* ✅ Focus on performance + scalability

---

## 🔄 Current Status

✅ Backend running
✅ DB connected
✅ Tables auto-created
✅ Clean production structure ready

---

## ⚠️ Important Learnings

* Always run server from root:
  node src/app.js

* `.env` must be in root folder

* One table stores multiple users (not multiple tables)

---

## 🚀 Next Steps

* Create Register User API
* Add password hashing (bcrypt)
* Create Login API
* Create Agent API
* Build RAG system
* Integrate Sarvam AI (voice)

---

## 🧠 System Flow (High Level)

User → Backend → RAG → LLM → Response
(No DB storage for chats)

---

## 👨‍💻 Developer

Om Vilas Shinde
