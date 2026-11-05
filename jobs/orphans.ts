/** Discovery/deletion is deliberately disabled until an approved retention policy
 * defines age, leases and retry grace. Finalizers may leave unreferenced final
 * objects after a failed commit; never delete pending assets or active holds.
 * Future work must use MaintenanceRun leases, bounded pages and audit manifests.
 */
console.info(
  "Orphan cleanup skeleton: deletion disabled; pending evidence preserved.",
);
