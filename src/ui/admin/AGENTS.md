# Admin navigation

Keep portal session/list state in memory above route-keyed editors. Admin links must use client navigation, and focus/visibility checks run in the background without clearing healthy content. Definitive server denial or account/permission change clears prior-account data and fences stale responses; never persist admin state or credentials in browser storage or the attendant service worker.
