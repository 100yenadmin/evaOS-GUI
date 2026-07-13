const fs = require('fs');
const path = require('path');

const AFTER_PACK_MARKER = '.evaos-after-pack-complete';

function markerPath(appOutDir) {
  return path.join(appOutDir, AFTER_PACK_MARKER);
}

function clearCompletedAfterPack(appOutDir) {
  fs.rmSync(markerPath(appOutDir), { force: true });
}

function markCompletedAfterPack(appOutDir) {
  fs.writeFileSync(markerPath(appOutDir), 'verified\n', { encoding: 'utf8', mode: 0o600 });
}

function hasCompletedAfterPack(appOutDir) {
  return fs.existsSync(markerPath(appOutDir));
}

module.exports = {
  AFTER_PACK_MARKER,
  clearCompletedAfterPack,
  hasCompletedAfterPack,
  markCompletedAfterPack,
};
