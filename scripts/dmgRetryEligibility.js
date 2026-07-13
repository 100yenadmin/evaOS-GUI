const fs = require('fs');
const path = require('path');

const AFTER_PACK_MARKER = '.evaos-after-pack-complete';
const AFTER_SIGN_MARKER = '.evaos-after-sign-complete';

function markerPath(appOutDir, marker) {
  return path.join(appOutDir, marker);
}

function clearCompletedAfterPack(appOutDir) {
  fs.rmSync(markerPath(appOutDir, AFTER_PACK_MARKER), { force: true });
}

function markCompletedAfterPack(appOutDir) {
  fs.writeFileSync(markerPath(appOutDir, AFTER_PACK_MARKER), 'verified\n', { encoding: 'utf8', mode: 0o600 });
}

function hasCompletedAfterPack(appOutDir) {
  return fs.existsSync(markerPath(appOutDir, AFTER_PACK_MARKER));
}

function clearCompletedAfterSign(appOutDir) {
  fs.rmSync(markerPath(appOutDir, AFTER_SIGN_MARKER), { force: true });
}

function markCompletedAfterSign(appOutDir) {
  fs.writeFileSync(markerPath(appOutDir, AFTER_SIGN_MARKER), 'verified\n', { encoding: 'utf8', mode: 0o600 });
}

function hasCompletedAfterSign(appOutDir) {
  return fs.existsSync(markerPath(appOutDir, AFTER_SIGN_MARKER));
}

function clearDmgRetryCompletionMarkers(appOutDir) {
  clearCompletedAfterPack(appOutDir);
  clearCompletedAfterSign(appOutDir);
}

function clearDmgRetryCompletionMarkersInDirectory(outDir) {
  if (!fs.existsSync(outDir)) return;

  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (entry.isDirectory() && /^mac(?:-|$)/.test(entry.name)) {
      clearDmgRetryCompletionMarkers(path.join(outDir, entry.name));
    }
  }
}

function isDmgRetryEligible(appOutDir, { multiArch = false } = {}) {
  if (multiArch) return false;
  return hasCompletedAfterPack(appOutDir) && hasCompletedAfterSign(appOutDir);
}

async function withAfterSignCompletion(appOutDir, operation) {
  clearCompletedAfterSign(appOutDir);
  const result = await operation();
  markCompletedAfterSign(appOutDir);
  return result;
}

module.exports = {
  AFTER_PACK_MARKER,
  AFTER_SIGN_MARKER,
  clearDmgRetryCompletionMarkers,
  clearDmgRetryCompletionMarkersInDirectory,
  clearCompletedAfterPack,
  clearCompletedAfterSign,
  hasCompletedAfterPack,
  hasCompletedAfterSign,
  isDmgRetryEligible,
  markCompletedAfterPack,
  markCompletedAfterSign,
  withAfterSignCompletion,
};
