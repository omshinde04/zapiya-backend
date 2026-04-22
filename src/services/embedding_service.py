"""
Production-grade Embedding Service (FastAPI)
-------------------------------------------
Features:
- Health check endpoint
- Input validation
- Batch support
- Query / Passage mode (important for RAG 🔥)
- Performance logging
- Safe error handling
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import time

# =========================
# INIT APP
# =========================
app = FastAPI(title="Embedding Service", version="1.0")

# =========================
# LOAD MODEL (ON STARTUP)
# =========================
print("🔄 Loading embedding model...")
model = SentenceTransformer("intfloat/multilingual-e5-small")
print("✅ Model loaded successfully")

# =========================
# REQUEST SCHEMA
# =========================
class EmbedRequest(BaseModel):
    text: str
    type: str = "query"  # "query" or "passage"


class BatchEmbedRequest(BaseModel):
    texts: list[str]
    type: str = "query"


# =========================
# HEALTH CHECK (IMPORTANT)
# =========================
@app.get("/health")
def health():
    return {"status": "ok"}


# =========================
# SINGLE EMBEDDING
# =========================
@app.post("/embed")
async def embed(data: EmbedRequest):
    try:
        start = time.time()

        text = data.text.strip()

        if not text:
            raise HTTPException(status_code=400, detail="Text cannot be empty")

        # 🔥 IMPORTANT FOR E5 MODEL
        prefix = "query:" if data.type == "query" else "passage:"
        formatted_text = f"{prefix} {text}"

        embedding = model.encode(formatted_text).tolist()

        print({
            "type": "embedding_success",
            "mode": data.type,
            "length": len(embedding),
            "time_ms": int((time.time() - start) * 1000)
        })

        return {"embedding": embedding}

    except Exception as e:
        print("❌ Embedding error:", str(e))
        raise HTTPException(status_code=500, detail="Embedding failed")


# =========================
# BATCH EMBEDDING (HIGH PERFORMANCE 🔥)
# =========================
@app.post("/embed/batch")
async def embed_batch(data: BatchEmbedRequest):
    try:
        start = time.time()

        if not data.texts or not isinstance(data.texts, list):
            raise HTTPException(status_code=400, detail="Invalid input")

        prefix = "query:" if data.type == "query" else "passage:"

        formatted = [f"{prefix} {t.strip()}" for t in data.texts if t.strip()]

        embeddings = model.encode(formatted).tolist()

        print({
            "type": "batch_embedding_success",
            "count": len(embeddings),
            "time_ms": int((time.time() - start) * 1000)
        })

        return {"embeddings": embeddings}

    except Exception as e:
        print("❌ Batch embedding error:", str(e))
        raise HTTPException(status_code=500, detail="Batch embedding failed")