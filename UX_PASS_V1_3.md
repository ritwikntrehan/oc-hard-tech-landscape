# SCHTMap UX pass v1.3

## Jobs-to-be-done used for this pass
1. Find manufacturers / suppliers.
2. Find companies in a capability or sector.
3. Identify newer / emerging companies.
4. Find government-linked companies.
5. Review recent company activity.
6. Understand one company quickly.
7. Find similar companies.
8. Ask a question about the exact view currently on screen.
9. Share a filtered analytical view with someone else.

## Implemented
- Common-task shortcut strip.
- Share-current-view control using URL state.
- Persistent current-view summary under filters.
- "Ask about this view" contextual query action.
- Keyboard shortcut `/` for search and `q` for Query.
- Related-company recommendations inside company dossiers.
- "Ask about company" action that primes the LLM with the company context.
- Better zero-result recovery.
- Existing city/sector/capability interactions continue to create navigable analytical paths.

## Deliberate behavior
The LLM remains subordinate to the structured product. Users can browse without chat, then invoke Query from a company or filtered view when synthesis is useful.

## Next
Data sharpening against the now-visible product surfaces:
- manufacturing/process coverage
- facility-level coordinates
- richer event history
- leadership/ownership where missing
- product/platform detail
- capital normalization
- capability taxonomy cleanup
