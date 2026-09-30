# Render deployment

This V1 is a single Render Web Service serving both the static site and `/api/ask`.
That keeps the frontend and API same-origin and avoids CORS/config complexity.

1. Create a GitHub repository and push this folder to `main`.
2. In Render choose **New → Blueprint** and connect that repository.
3. Render reads `render.yaml`.
4. The first deployment can leave `LLM_BASE_URL` and `LLM_API_KEY` blank. The entire site still works, and Ask the Map returns deterministic retrieval matches.
5. To add an open-weight LM, point `LLM_BASE_URL` at any OpenAI-compatible `/v1` endpoint and set `LLM_MODEL`. `LLM_API_KEY` is optional for self-hosted endpoints.

Recommended first model: `Qwen/Qwen3-4B-Instruct-2507`.

A llama.cpp or vLLM endpoint can be swapped in later without changing the website.

The backend performs retrieval server-side from the canonical frozen dataset, sends at most 12 company records to the model, and allow-lists returned company slugs and citation URLs.

Health check: `GET /healthz`
