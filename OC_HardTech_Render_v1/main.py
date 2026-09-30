from __future__ import annotations

import json, os, re
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "data" / "companies.min.json"

LLM_BASE_URL = os.getenv("LLM_BASE_URL", "").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "Qwen/Qwen3-4B-Instruct-2507")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT_SECONDS", "45"))
TOP_K = int(os.getenv("LLM_TOP_K", "10"))
MAX_CANDIDATES = 12

app = FastAPI(title="OC Hard Tech", version="1.0")

with DATA_PATH.open("r", encoding="utf-8") as f:
    COMPANIES: List[Dict[str, Any]] = json.load(f)

class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1200)
    filters: Optional[Dict[str, Optional[str]]] = None
    history: Optional[List[Dict[str, str]]] = None

def tokens(text: Any) -> List[str]:
    cleaned = re.sub(r"[^a-z0-9$&+./-]+", " ", str(text or "").lower())
    return [t for t in cleaned.split() if len(t) > 1]

def flatten_company(c: Dict[str, Any]) -> str:
    p = c.get("profile") or {}
    cl = c.get("classification") or {}
    loc = c.get("primary_location") or {}
    sig = c.get("signals") or {}
    evt = c.get("latest_event") or {}
    bits = [
        c.get("name"), loc.get("city"), cl.get("sector_group"), cl.get("primary_sector"),
        cl.get("maturity"), cl.get("ownership"), p.get("product_platform_summary"),
        p.get("capability_summary"), sig.get("government_contract_or_grant"),
        sig.get("commercial_customer"), sig.get("hiring"), evt.get("summary")
    ]
    bits += p.get("manufacturing_processes") or []
    bits += p.get("end_markets") or []
    bits += [x.get("tag") for x in (c.get("capabilities") or []) if x.get("tag")]
    bits += [x.get("name") for x in (c.get("products") or []) if x.get("name")]
    bits += [f"{x.get('type') or ''} {x.get('summary') or ''}" for x in (c.get("events") or [])]
    return " | ".join(str(x) for x in bits if x).lower()

SEARCH_TEXT = {c["id"]: flatten_company(c) for c in COMPANIES}

def score_company(c: Dict[str, Any], question: str, filters: Dict[str, Optional[str]]) -> float:
    q = question.lower()
    q_tokens = tokens(question)
    hay = SEARCH_TEXT[c["id"]]
    p = c.get("profile") or {}
    cl = c.get("classification") or {}
    loc = c.get("primary_location") or {}
    strong_parts = [
        c.get("name"), loc.get("city"), cl.get("sector_group"), cl.get("primary_sector"),
        *[x.get("tag") for x in (c.get("capabilities") or []) if x.get("tag")],
        *(p.get("manufacturing_processes") or []), *(p.get("end_markets") or [])
    ]
    strong = " | ".join(str(x) for x in strong_parts if x).lower()
    score = 0.0
    for token in q_tokens:
        score += 5 if token in strong else (2 if token in hay else 0)

    aliases = [
        ("robot", ["robotics","autonomy","physical ai"]),
        ("chip", ["semiconductor","microelectronics","rf"]),
        ("aerospace", ["aerospace","space"]),
        ("space", ["space","satellite","spacecraft"]),
        ("manufactur", ["manufacturing","machining","fabrication","assembly"]),
        ("fund", ["funding","financing","series","capital"]),
        ("government", ["government","dod","doe","nasa","nih","contract","grant"]),
        ("hire", ["hiring","careers","jobs"]),
        ("small", ["2-10","11-50"]),
        ("new", ["emerging","growth"]),
    ]
    for needle, values in aliases:
        if needle in q and any(v in hay for v in values):
            score += 3

    if filters.get("city") and loc.get("city") == filters["city"]: score += 3
    if filters.get("sector") and cl.get("sector_group") == filters["sector"]: score += 3
    if filters.get("maturity") and cl.get("maturity") == filters["maturity"]: score += 2
    if filters.get("ownership") and cl.get("ownership") == filters["ownership"]: score += 2
    if filters.get("capability") and any(x.get("tag") == filters["capability"] for x in (c.get("capabilities") or [])):
        score += 4
    return score

def grounding_record(c: Dict[str, Any]) -> Dict[str, Any]:
    p = c.get("profile") or {}
    return {
        "id": c.get("id"), "slug": c.get("slug"), "name": c.get("name"), "website": c.get("website"),
        "city": (c.get("primary_location") or {}).get("city"),
        "address": (c.get("primary_location") or {}).get("address"),
        "sector_group": (c.get("classification") or {}).get("sector_group"),
        "primary_sector": (c.get("classification") or {}).get("primary_sector"),
        "maturity": (c.get("classification") or {}).get("maturity"),
        "ownership": (c.get("classification") or {}).get("ownership"),
        "parent_or_successor": (c.get("classification") or {}).get("parent_or_successor"),
        "founded_year": p.get("founded_year"),
        "employee_band": (p.get("employees") or {}).get("label"),
        "leader": p.get("leader"),
        "product_summary": p.get("product_platform_summary"),
        "capability_summary": p.get("capability_summary"),
        "manufacturing_processes": p.get("manufacturing_processes") or [],
        "end_markets": p.get("end_markets") or [],
        "capabilities": [{"tag":x.get("tag"),"category":x.get("category"),"confidence":x.get("confidence"),"source_url":x.get("source_url")}
                         for x in (c.get("capabilities") or [])],
        "products": [{"name":x.get("name"),"category":x.get("category"),"source_url":x.get("source_url")}
                     for x in (c.get("products") or [])],
        "financials": c.get("financials") or {},
        "signals": c.get("signals") or {},
        "latest_event": c.get("latest_event"),
        "recent_events": (c.get("events") or [])[:5],
        "sources": [{"id":s.get("id"),"url":s.get("url"),"type":s.get("type"),
                     "facts_supported":s.get("facts_supported"),"priority":s.get("priority"),
                     "verified_as_of":s.get("verified_as_of")}
                    for s in (c.get("sources") or [])[:8]],
        "data_quality": c.get("completeness") or {}
    }

def retrieve(question: str, filters: Dict[str, Optional[str]]) -> List[Dict[str, Any]]:
    ranked = sorted(((score_company(c, question, filters), c) for c in COMPANIES),
                    key=lambda x: (-x[0], x[1]["name"].lower()))
    positive = [x for x in ranked if x[0] > 0]
    chosen = (positive if positive else ranked)[:min(TOP_K, MAX_CANDIDATES)]
    return [grounding_record(c) for _, c in chosen]

SYSTEM_PROMPT = """You answer questions about the Orange County Hard Tech Landscape.
Use ONLY GROUNDING_DATA for factual claims. Do not use outside knowledge to fill missing company facts.
Missing/null means unknown, never zero. The dataset is curated, not exhaustive.
City-centroid coordinates are not exact facilities.
Do not invent capabilities, rankings, estimates, customers, contracts, ownership, financial values, or locations.
Cite only URLs supplied in GROUNDING_DATA.
If evidence is insufficient, say the field is not currently verified.
Return valid JSON only:
{"answer":"1-4 short paragraphs","companies":["company-slug"],"citations":[{"url":"https://...","label":"Company · source type"}]}
"""

def local_fallback(candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    selected = candidates[:6]
    lines, citations, seen = [], [], set()
    for c in selected:
        descriptors = [c.get("city"), c.get("primary_sector")]
        descriptors += [x.get("tag") for x in (c.get("capabilities") or [])[:2] if x.get("tag")]
        lines.append(f"{c['name']}: " + " · ".join(str(x) for x in descriptors if x))
        for s in c.get("sources") or []:
            url = s.get("url")
            if not url or url in seen: continue
            seen.add(url)
            citations.append({"url":url,"label":f"{c['name']} · {s.get('type') or 'Source'}"})
            if len(citations) >= 6: break
    return {
        "answer":"The language-model endpoint is not configured. The closest matches in the frozen dataset are:\n\n" + "\n".join(lines),
        "companies":[c["slug"] for c in selected], "citations":citations,
        "model":"local-retrieval-only", "local_fallback":True
    }

def allowed_sources(candidates: List[Dict[str, Any]]) -> set[str]:
    urls = set()
    for c in candidates:
        for s in c.get("sources") or []:
            if s.get("url"): urls.add(s["url"])
        for s in c.get("capabilities") or []:
            if s.get("source_url"): urls.add(s["source_url"])
        for s in c.get("products") or []:
            if s.get("source_url"): urls.add(s["source_url"])
        for s in c.get("recent_events") or []:
            if s.get("source_url"): urls.add(s["source_url"])
    return urls

def extract_text(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if choices:
        content = (choices[0].get("message") or {}).get("content")
        if isinstance(content, str): return content
        if isinstance(content, list):
            return "".join(x.get("text","") for x in content if isinstance(x, dict))
    if isinstance(payload.get("output_text"), str): return payload["output_text"]
    raise ValueError("No text content returned")

@app.get("/healthz")
async def healthz():
    return {"ok":True,"companies":len(COMPANIES),"model_configured":bool(LLM_BASE_URL),
            "model":LLM_MODEL if LLM_BASE_URL else None}

@app.post("/api/ask")
async def ask(req: AskRequest):
    question = req.question.strip()
    filters = req.filters or {}
    candidates = retrieve(question, filters)
    if not candidates:
        return {"answer":"The frozen dataset does not contain enough matching evidence to answer that question.",
                "companies":[],"citations":[],"model":"dataset-only"}

    if not LLM_BASE_URL:
        return local_fallback(candidates)

    body = {
        "model": LLM_MODEL,
        "temperature": 0.1,
        "max_tokens": 900,
        "messages": [
            {"role":"system","content":SYSTEM_PROMPT},
            {"role":"user","content":f"QUESTION:\n{question}\n\nGROUNDING_DATA:\n" +
             json.dumps({"dataset_version":"oc-hardtech-web-v1.0-2026-09-30",
                         "dataset_scope":"Orange County, California",
                         "active_filters":filters,
                         "candidate_companies":candidates},
                        ensure_ascii=False,separators=(",",":"))}
        ]
    }
    headers = {"Content-Type":"application/json"}
    if LLM_API_KEY: headers["Authorization"] = f"Bearer {LLM_API_KEY}"

    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            r = await client.post(f"{LLM_BASE_URL}/chat/completions", headers=headers, json=body)
            r.raise_for_status()
            parsed = json.loads(extract_text(r.json()))
    except Exception as exc:
        fallback = local_fallback(candidates)
        fallback["warning"] = f"Model endpoint unavailable: {type(exc).__name__}"
        return JSONResponse(fallback)

    valid_slugs = {c["slug"] for c in candidates}
    valid_urls = allowed_sources(candidates)
    answer = str(parsed.get("answer") or "").strip()
    if not answer:
        raise HTTPException(status_code=502, detail="Model returned an empty answer")

    companies = [x for x in (parsed.get("companies") or []) if isinstance(x,str) and x in valid_slugs][:12]
    citations = [x for x in (parsed.get("citations") or [])
                 if isinstance(x,dict) and x.get("url") in valid_urls][:12]
    return {"answer":answer,"companies":companies,"citations":citations,"model":LLM_MODEL}

app.mount("/data", StaticFiles(directory=str(ROOT/"data")), name="data")

@app.get("/styles.css")
async def styles(): return FileResponse(ROOT/"styles.css", media_type="text/css")

@app.get("/app.js")
async def javascript(): return FileResponse(ROOT/"app.js", media_type="application/javascript")

@app.get("/manifest.json")
async def manifest(): return FileResponse(ROOT/"manifest.json", media_type="application/json")

@app.get("/{path:path}")
async def spa(path: str): return FileResponse(ROOT/"index.html")
