const URL_REGEX = /https?:\/\/[^\s<>"'`)\]}]+/gi;

const HTML_ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": "\"",
  "&#39;": "'",
  "&nbsp;": " "
};

function extractUrls(text, maxUrls = 2) {
  const input = String(text || "");
  const matches = input.match(URL_REGEX) || [];
  const urls = [];
  const seen = new Set();

  for (const match of matches) {
    const normalized = normalizeUrlToken(match);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    urls.push(normalized);
    if (urls.length >= maxUrls) {
      break;
    }
  }

  return urls;
}

function normalizeUrlToken(token) {
  return String(token || "")
    .trim()
    .replace(/[),.;!?]+$/g, "");
}

function isUrlOnlyMessage(text) {
  const input = String(text || "").trim();
  if (!input) {
    return false;
  }

  const urls = extractUrls(input, 10);
  if (urls.length === 0) {
    return false;
  }

  const stripped = input.replace(URL_REGEX, " ").trim();
  return stripped.length === 0;
}

function extractReadableContent(raw, contentType = "", maxChars = 4000) {
  const text = String(raw || "");
  const normalizedType = String(contentType || "").toLowerCase();

  if (/application\/json|\+json/.test(normalizedType)) {
    return {
      title: "",
      text: clipText(formatJsonLike(text), maxChars)
    };
  }

  if (/text\/html|application\/xhtml\+xml|application\/xml|text\/xml/.test(normalizedType) || /<html[\s>]/i.test(text)) {
    return extractReadableHtml(text, maxChars);
  }

  return {
    title: "",
    text: clipText(normalizeWhitespace(decodeHtmlEntities(text)), maxChars)
  };
}

function formatFetchedPreview(url, fetchResult, maxChars = 2000) {
  const readable = extractReadableContent(
    fetchResult.data,
    fetchResult.contentType,
    maxChars
  );
  const lines = [];

  lines.push(`Fetched ${fetchResult.finalUrl || url}`);
  if (fetchResult.redirected && fetchResult.finalUrl) {
    lines.push(`Redirected from: ${url}`);
  }
  if (fetchResult.contentType) {
    lines.push(`Content-Type: ${fetchResult.contentType}`);
  }
  if (readable.title) {
    lines.push(`Title: ${readable.title}`);
  }
  if (readable.text) {
    lines.push("");
    lines.push(readable.text);
  }

  return lines.join("\n");
}

function extractReadableHtml(html, maxChars) {
  const title = cleanupInlineText(
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  );
  const metaDescription = cleanupInlineText(
    firstMatch(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i
    ) || firstMatch(
      html,
      /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i
    )
  );

  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/section|\/article|\/li|\/tr|\/h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  body = normalizeWhitespace(decodeHtmlEntities(body));

  const sections = [];
  if (metaDescription) {
    sections.push(metaDescription);
  }
  if (body) {
    sections.push(body);
  }

  return {
    title,
    text: clipText(sections.join("\n\n"), maxChars)
  };
}

function decodeHtmlEntities(text) {
  let output = String(text || "");
  Object.keys(HTML_ENTITY_MAP).forEach((entity) => {
    output = output.split(entity).join(HTML_ENTITY_MAP[entity]);
  });

  output = output.replace(/&#(\d+);/g, (_, num) =>
    String.fromCharCode(Number(num))
  );
  output = output.replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return output;
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

function cleanupInlineText(text) {
  return normalizeWhitespace(decodeHtmlEntities(String(text || "").replace(/\s+/g, " ")));
}

function clipText(text, maxChars) {
  const normalized = String(text || "").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(maxChars - 20, 0)).trim()}\n...[truncated]`;
}

function formatJsonLike(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch (_) {
    return normalizeWhitespace(text);
  }
}

function firstMatch(text, regex) {
  return String(text || "").match(regex)?.[1] || "";
}

module.exports = {
  extractReadableContent,
  extractUrls,
  formatFetchedPreview,
  isUrlOnlyMessage
};
