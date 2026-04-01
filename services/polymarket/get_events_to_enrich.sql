SELECT DISTINCT
    e.slug AS event_slug
FROM {db:Identifier}.polymarket_events e
WHERE e.slug != ''
  AND e.slug NOT IN (
    SELECT slug FROM {db:Identifier}.polymarket_events_enriched FINAL
  )
ORDER BY e.slug
LIMIT 1000;
