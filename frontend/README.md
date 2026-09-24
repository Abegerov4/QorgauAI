# QorgauAI — frontend

Next.js 16 (App Router) + Tailwind v4 + Motion. Talks directly to the FastAPI backend.

```bash
# 1. backend (from backend/): uvicorn app.main:app --port 8000
# 2. frontend:
cd frontend
cp .env.example .env.local   # NEXT_PUBLIC_API_URL, default http://localhost:8000
npm install
npm run dev                  # http://localhost:3000
```

- `components/QorgauApp.tsx` — shell: header, thread, composer, citation sheet.
- `components/AnswerCard.tsx` — Pipeline C answer: status, claims with citation chips, removed claims, graph path.
- `components/DocumentCard.tsx` — uploaded contract: pages, OCR, masked PII, extracted clauses.
- `components/Sheet.tsx` — draggable bottom sheet (momentum projection, spring close).
- `components/SearchCompare.tsx` — retrieval A (dense) vs B (hybrid) side by side.
- `lib/api.ts` — typed API client; `lib/citations.ts` — parses backend citation strings.
