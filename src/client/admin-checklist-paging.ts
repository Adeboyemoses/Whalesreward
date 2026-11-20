/** Visual browsing never replaces the complete, version-bound evidence set. */
export function evidenceWindow<T>(
  complete: readonly T[],
  requestedPage: number,
) {
  const pages = Math.max(1, Math.ceil(complete.length / 25));
  const page = Math.max(0, Math.min(pages - 1, requestedPage));
  const start = page * 25;
  return {
    items: complete.slice(start, start + 25),
    start,
    page,
    pages,
    previous: page > 0,
    next: page + 1 < pages,
  };
}
