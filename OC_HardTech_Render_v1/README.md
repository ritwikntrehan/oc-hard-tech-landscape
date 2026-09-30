# OC Hard Tech Landscape — Render V1

Deployable Orange County hard-tech intelligence site with:
- 100 companies
- 107 map points
- 449 capability links
- 291 sources
- map, filters, company profiles and capability browser
- grounded Ask the Map
- FastAPI backend
- provider-agnostic open-weight LLM gateway
- Render Blueprint

## Local run

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

Open `http://127.0.0.1:8000`.

The site works even before an LLM endpoint is configured. See `DEPLOY_RENDER.md`.
