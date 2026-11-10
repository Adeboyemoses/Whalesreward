# WO-core-7c print configuration

Use fictional card data. Earl manages staging configuration; this change does not apply a cloud spec.

1. With the layout configured, request `/api/health`. Expected: `cardPrint: "configured"`; no layout dimensions or raw configuration values appear. Existing database health status is unchanged.
2. Generate five cards, prepare PDF and prepare Excel. Expected: both formats contain the reserved codes; exports do not change batch state or inventory. Repeat prepare using the normal reviewed flow.
3. On a local production instance with layout absent or invalid, prepare PDF. Expected: JSON 409, code `print_layout_unconfigured`, `retryable: false`; message remains “The print layout is not configured. PDF preparation is unavailable. Excel register remains available.” No export or success receipt is created.
4. On that local instance, prepare Excel. Expected: it remains available. Health reports `cardPrint: "unconfigured"` while a successful database probe remains healthy.
5. Continue Earl's section d checks x1–x4 for the retained PR #97 changes. The staging layout is a placeholder pending Q-553, not approval of card stock.
