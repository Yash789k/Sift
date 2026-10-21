(function(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.SiftDropPolicy = policy;
})(globalThis, function() {
  'use strict';
  const copyEffects = new Set(['uninitialized', 'all', 'copy', 'copyLink', 'copyMove', '', undefined]);
  function acceptFileDrag(event, busy = false) {
    // Always suppress Chromium's default file navigation. Explicit COPY is
    // essential: Shift can otherwise negotiate MOVE with the Windows source.
    event.preventDefault();
    const transfer = event.dataTransfer;
    if (!transfer) return false;
    const hasFiles = Array.from(transfer.types || []).includes('Files') ||
      (event.type === 'drop' && transfer.files?.length > 0);
    const accepted = hasFiles && !busy && copyEffects.has(transfer.effectAllowed);
    transfer.dropEffect = accepted ? 'copy' : 'none';
    return Boolean(accepted);
  }
  return { acceptFileDrag };
});
