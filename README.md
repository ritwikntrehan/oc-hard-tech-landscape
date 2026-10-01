# OC Hard Tech Landscape — Atlas v1.2

Public-facing Orange County hard-tech intelligence site.

## Surfaces
- Landscape
- Companies
- Capabilities
- Activity / Capital
- Company dossiers
- Grounded Ask the Landscape query panel

## Dataset
- 100 companies
- 107 locations
- 449 company-capability links
- 291 sources
- 35 tracked public events

## Backend
FastAPI on Render with server-side deterministic retrieval and a provider-agnostic OpenAI-compatible small-model gateway.

## Local run

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

Open `http://127.0.0.1:8000`.
