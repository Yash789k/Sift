(function(root, factory) {
  const gate = factory();
  if (typeof module === 'object' && module.exports) module.exports = gate;
  else root.SiftIngestionGate = gate;
})(globalThis, function() {
  'use strict';
  function createIngestionGate(onChange) {
    let active = false;
    return {
      isActive: () => active,
      async run(task) {
        if (active) return { accepted: false };
        active = true;
        try {
          onChange?.(true);
          return { accepted: true, value: await task() };
        } finally {
          active = false;
          onChange?.(false);
        }
      },
    };
  }
  return { createIngestionGate };
});
