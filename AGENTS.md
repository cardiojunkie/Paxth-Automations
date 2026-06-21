# Project Rules

- Keep this redesign UI-only unless explicitly asked otherwise.
- Preserve backend routes, API contracts, scraper calls, queue polling, LLM job execution, retry behavior, JSON output editing, and XLSX export.
- Preserve Excel upload, SKU normalization, `attributes__` detection, SAP/PDF/scraped source handling, and current `sap_data` storage behavior.
- Do not add fake/mock data or new dependencies.
- Use the existing light, warm B2B SaaS design language: white cards, soft borders, slate text, restrained blue actions, green success, amber warning, red danger.
- Keep dark styling only for JSON, markdown, logs, and other raw technical viewers.
- Keep changes scoped to the active prompt.
