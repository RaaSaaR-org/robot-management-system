# Research

Read-only internal publication browser at `/research` and `/research/:id`.
The server owns authentication, attribution, tenant scope and immutable publication.
Corrections are new records with `supersedesId`; there is no edit or delete action.
Keep queries cancellable and avoid persisting research bodies in a cross-session cache.
Render report Markdown without raw HTML. Artifact checksums are publisher attestations;
the browser must not label them as independently verified measurements.
