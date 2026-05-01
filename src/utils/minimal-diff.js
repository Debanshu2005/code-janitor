// Shared helper for surgical, in-place edits.
//
// Given the current text of a document and the proposed replacement, return
// the smallest contiguous range that needs to change. The longest common
// prefix and suffix are trimmed; only the diverging middle is returned.
//
// Returns null when the two texts are identical, otherwise:
//   { startOffset, endOffset, replacement }
// where [startOffset, endOffset) describes the slice of the *current* text to
// replace, and `replacement` is what to substitute in its place.
function computeMinimalReplacement(currentCode, nextCode) {
  if (currentCode === nextCode) return null;

  const a = String(currentCode || "");
  const b = String(nextCode || "");

  let prefix = 0;
  const minLen = Math.min(a.length, b.length);
  while (prefix < minLen && a.charCodeAt(prefix) === b.charCodeAt(prefix)) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) {
    suffix++;
  }

  return {
    startOffset: prefix,
    endOffset: a.length - suffix,
    replacement: b.slice(prefix, b.length - suffix)
  };
}

module.exports = { computeMinimalReplacement };
