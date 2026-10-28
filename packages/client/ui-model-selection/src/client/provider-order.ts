/** Shared provider display order for the composer and command model pickers. */

/**
 * Preserve the provider catalog order without favoring a supplier.
 * @param groups - Provider groups in catalog order.
 * @returns a detached copy; model order within each group is unchanged.
 */
export function orderModelProviders<T extends { readonly id: string }>(groups: readonly T[]): T[] {
  return [...groups]
}
