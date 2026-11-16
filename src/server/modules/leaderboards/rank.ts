/** Rank the complete selected category before paging. IDs order display only. */
export function rankSpend<T extends { customerId: string; amountKobo: string }>(
  rows: readonly T[],
) {
  const sorted = [...rows].sort((a, b) => {
    const left = BigInt(a.amountKobo),
      right = BigInt(b.amountKobo);
    return left === right
      ? a.customerId.localeCompare(b.customerId)
      : left > right
        ? -1
        : 1;
  });
  let rank = 0n;
  return sorted.map((row, index) => {
    const amount = BigInt(row.amountKobo);
    const previous = sorted[index - 1],
      next = sorted[index + 1];
    const matchesPrevious =
      previous !== undefined && BigInt(previous.amountKobo) === amount;
    if (!matchesPrevious) rank = BigInt(index) + 1n;
    return {
      ...row,
      rank: rank.toString(),
      sharedRank:
        matchesPrevious ||
        (next !== undefined && BigInt(next.amountKobo) === amount),
    };
  });
}
