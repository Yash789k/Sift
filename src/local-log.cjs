'use strict';
const fs = require('node:fs'), path = require('node:path');
function createLocalLog(directory) {
  const file = path.join(directory, 'sift.log');
  function log(event, details = {}) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) {
        fs.copyFileSync(file, `${file}.previous`); fs.truncateSync(file);
      }
      fs.appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`);
    } catch (error) { console.error('Unable to write Sift log:', error.message); }
  }
  return { log, path: file };
}
module.exports = { createLocalLog };
