SELECT DISTINCT
    e.slug AS event_slug
FROM {db:Identifier}.polymarket_events e
LEFT JOIN {db:Identifier}.polymarket_events_enriched pe ON e.slug = pe.slug
WHERE e.slug != ''
  AND pe.slug = ''
ORDER BY e.slug
LIMIT 1000;
