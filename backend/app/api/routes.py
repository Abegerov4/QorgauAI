from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, UploadFile
from langfuse import propagate_attributes

from app.agents.graph import answer_question
from app.api.schemas import (
    ArticlePoint,
    ArticleResponse,
    AskRequest,
    AskResponse,
    DocumentResponse,
    PageInfo,
    HealthResponse,
    SearchRequest,
    SearchResponse,
    SourceChunk,
    VacationCalcRequest,
)
from app.ingestion.documents import DOCUMENTS, MAX_BYTES, UnsupportedDocument, ingest_document
from app.mcp_tools.vacation_calculator import calculate_annual_leave
from app.observability import langfuse
from app.retrieval.config import COLLECTION_NAME
from app.retrieval.search import CODE_NAMES, dense_only_search, get_article, hybrid_search

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    try:
        from app.retrieval.qdrant_setup import get_client

        client = get_client()
        exists = client.collection_exists(COLLECTION_NAME)
        return HealthResponse(status="ok", qdrant_connected=True, collection_exists=exists)
    except Exception:
        return HealthResponse(status="degraded", qdrant_connected=False, collection_exists=False)


@router.post("/search", response_model=SearchResponse)
def search(req: SearchRequest) -> SearchResponse:
    """Pipeline A (dense) or B (hybrid) retrieval -- doc section 9's
    A/B/C benchmark. Pipeline C (agentic, with planner/verifier) lives
    under /ask once the agent graph is wired up."""
    fn = dense_only_search if req.pipeline == "dense" else hybrid_search
    with langfuse.start_as_current_observation(
        as_type="span",
        name="search-request",
        input={"query": req.query, "pipeline": req.pipeline, "top_k": req.top_k},
    ) as root, propagate_attributes(trace_name="search-request", tags=["api", f"pipeline:{req.pipeline}"]):
        try:
            results = fn(req.query, top_k=req.top_k)
        except RuntimeError as e:
            # e.g. OPENAI_API_KEY not set -- surface clearly instead of a 500 trace.
            root.update(level="ERROR", status_message=str(e))
            raise HTTPException(status_code=503, detail=str(e)) from e
        root.update(output={"citations": [r.citation for r in results]})
    return SearchResponse(
        query=req.query,
        pipeline=req.pipeline,
        results=[SourceChunk(**vars(r)) for r in results],
    )


@router.get("/articles/{code}/{article_number}", response_model=ArticleResponse)
def article(code: str, article_number: str) -> ArticleResponse:
    """Full text of one article -- the frontend opens it from a citation card."""
    if code not in CODE_NAMES:
        raise HTTPException(status_code=404, detail=f"Неизвестный документ: {code}")
    chunks = get_article(code, article_number)
    if not chunks:
        raise HTTPException(status_code=404, detail=f"Статья {article_number} не найдена.")
    first = chunks[0]
    return ArticleResponse(
        code=first.code,
        chapter=first.chapter,
        article=first.article,
        article_number=first.article_number,
        points=[ArticlePoint(point=c.point, text=c.text) for c in chunks],
    )


@router.post("/tools/vacation-days")
def vacation_days(req: VacationCalcRequest) -> dict:
    result = calculate_annual_leave(
        hazardous_work=req.hazardous_work,
        disability_group_1_or_2=req.disability_group_1_or_2,
        employer_bonus_days=req.employer_bonus_days,
    )
    return {
        "base_days": result.base_days,
        "additional_days": result.additional_days,
        "total_days": result.total_days,
        "breakdown": result.breakdown,
        "citations": result.citations,
        "note": result.note,
    }


@router.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest, request: Request) -> AskResponse:
    """Pipeline C: guard_input -> research (MCP tools) -> generate -> verify
    -> (rewrite_query -> research, once) -> finalize."""
    graph = getattr(request.app.state, "graph", None)
    if graph is None:
        raise HTTPException(status_code=503, detail="Agent graph is not initialised (app started without lifespan).")
    document = None
    if req.document_id:
        document = DOCUMENTS.get(req.document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="Документ не найден: загрузите его заново через /documents.")
    state = await answer_question(graph, req.question, document=document, session_id=req.session_id, tags=["api"])
    return AskResponse(**state["final"], path=state["path"], attempts=state.get("attempt", 0) + 1)


@router.post("/documents", response_model=DocumentResponse)
async def upload_document(file: UploadFile) -> DocumentResponse:
    """Upload a contract (PDF / JPEG / PNG). Pages with a text layer are read
    directly, scans and photos go through the vision model; PII is masked
    before clauses are extracted. Use the returned id in /ask."""
    data = await file.read(MAX_BYTES + 1)
    try:
        doc = await ingest_document(data, file.filename or "document")
    except UnsupportedDocument as e:
        raise HTTPException(status_code=415, detail=str(e)) from e
    return DocumentResponse(
        document_id=doc.id,
        filename=doc.filename,
        document_type=doc.findings.document_type,
        pages=[PageInfo(page=p.page, method=p.method, chars=len(p.text)) for p in doc.pages],
        pii_found=doc.pii_found,
        clauses=doc.findings.clauses,
    )
