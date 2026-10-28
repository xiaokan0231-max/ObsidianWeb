const DEFAULT_PAGE_SIZE = 6;

function positiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

export function consultationPage<T>(items: T[], page: number, pageSize = DEFAULT_PAGE_SIZE) {
  const size = positiveInteger(pageSize, DEFAULT_PAGE_SIZE);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pageCount, positiveInteger(page, 1));
  const offset = (current - 1) * size;
  return {
    items: items.slice(offset, offset + size), page: current, pageCount, total,
    start: total ? offset + 1 : 0, end: Math.min(offset + size, total),
  };
}

export function paginationPageNumbers(page: number, pageCount: number): number[] {
  const count = positiveInteger(pageCount, 1);
  const current = Math.min(count, positiveInteger(page, 1));
  const length = Math.min(5, count);
  const start = Math.max(1, Math.min(current - 2, count - length + 1));
  return Array.from({ length }, (_, index) => start + index);
}
