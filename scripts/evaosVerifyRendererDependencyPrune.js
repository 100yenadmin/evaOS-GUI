#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rendererOnlyPackages = [
  '@arco-design/web-react',
  '@codemirror/commands',
  '@codemirror/lang-css',
  '@codemirror/lang-html',
  '@codemirror/lang-json',
  '@codemirror/lang-markdown',
  '@codemirror/view',
  '@dnd-kit/core',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',
  '@floating-ui/react',
  '@icon-park/react',
  '@monaco-editor/react',
  '@uiw/codemirror-extensions-langs',
  '@uiw/react-codemirror',
  'classnames',
  'dayjs',
  'diff',
  'diff2html',
  'eventemitter3',
  'katex',
  'mermaid',
  'qrcode.react',
  'react',
  'react-dom',
  'react-i18next',
  'react-markdown',
  'react-router-dom',
  'react-syntax-highlighter',
  'react-virtuoso',
  'rehype-katex',
  'rehype-raw',
  'remark-breaks',
  'remark-gfm',
  'remark-math',
  'streamdown',
  'swr',
];

function usage() {
  console.error('Usage: node scripts/evaosVerifyRendererDependencyPrune.js <path-to-unpacked-app>');
}

function readAsarHeader(archivePath) {
  const fd = fs.openSync(archivePath, 'r');
  try {
    const sizePickle = Buffer.alloc(8);
    fs.readSync(fd, sizePickle, 0, sizePickle.length, 0);
    const headerSize = sizePickle.readUInt32LE(4);
    const headerPickle = Buffer.alloc(headerSize);
    fs.readSync(fd, headerPickle, 0, headerPickle.length, 8);
    const jsonSize = headerPickle.readInt32LE(4);
    const json = headerPickle.slice(8, 8 + jsonSize).toString('utf8');
    return JSON.parse(json);
  } finally {
    fs.closeSync(fd);
  }
}

function collectPaths(files, prefix = '') {
  const paths = [];
  for (const [name, entry] of Object.entries(files || {})) {
    const entryPath = `${prefix}/${name}`;
    paths.push(entryPath);
    if (entry && entry.files) {
      paths.push(...collectPaths(entry.files, entryPath));
    }
  }
  return paths;
}

function packagePathExists(root, packageName) {
  return fs.existsSync(path.join(root, ...packageName.split('/')));
}

function verifyRendererDependencyPrune(appPath) {
  if (!appPath) {
    throw new Error('Missing path to unpacked app');
  }

  const appAsar = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const unpackedNodeModules = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules');

  if (!fs.existsSync(appAsar)) {
    throw new Error(`Missing packaged app.asar: ${appAsar}`);
  }

  const header = readAsarHeader(appAsar);
  const asarPaths = collectPaths(header.files);
  const leakedInAsar = rendererOnlyPackages.filter((packageName) => {
    const root = `/node_modules/${packageName}`;
    return asarPaths.some((entryPath) => entryPath === root || entryPath.startsWith(`${root}/`));
  });

  const leakedInUnpacked = rendererOnlyPackages.filter((packageName) =>
    packagePathExists(unpackedNodeModules, packageName)
  );

  if (leakedInAsar.length || leakedInUnpacked.length) {
    const errors = [];
    if (leakedInAsar.length) {
      errors.push(`Renderer-only packages leaked into app.asar: ${leakedInAsar.join(', ')}`);
    }
    if (leakedInUnpacked.length) {
      errors.push(`Renderer-only packages leaked into app.asar.unpacked/node_modules: ${leakedInUnpacked.join(', ')}`);
    }
    throw new Error(errors.join('\n'));
  }

  return { checkedPackages: rendererOnlyPackages.length };
}

function main() {
  try {
    const result = verifyRendererDependencyPrune(process.argv[2]);
    console.log(`Renderer dependency prune verified for ${result.checkedPackages} packages.`);
  } catch (error) {
    if (!process.argv[2]) {
      usage();
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  rendererOnlyPackages,
  verifyRendererDependencyPrune,
};
