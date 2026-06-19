export const buildPdfSrc = (file_path?: string, content?: string): string => {
  if (file_path) {
    const normalized = file_path.replace(/\\/g, '/');
    const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return `file://${encodeURI(withLeadingSlash)}`;
  }
  return content || '';
};
