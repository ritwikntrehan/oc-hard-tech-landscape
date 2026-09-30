# V1 architecture

Browser → Render FastAPI → deterministic retrieval → open-weight model endpoint → grounded JSON answer

The Render service:
- serves the website and frozen data
- reloads the canonical 100-company dataset itself
- retrieves candidate companies server-side
- sends <=12 records to the model
- validates returned company slugs
- validates returned citation URLs
- falls back to dataset-only retrieval if the model host is unavailable

The language model is replaceable. The curated dataset and retrieval layer are the durable asset.
