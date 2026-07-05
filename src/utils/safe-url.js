const dns = require("dns").promises;
const net = require("net");

function isBlockedHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal"
  );
}

function parseIpv4(address) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
    return null;
  }

  const octets = address.split(".").map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return octets;
}

function isBlockedIpv4(address) {
  const octets = parseIpv4(address);
  if (!octets) {
    return false;
  }

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address) {
  const normalized = String(address || "").toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    if (net.isIP(mappedIpv4) === 4) {
      return isBlockedIpv4(mappedIpv4);
    }
  }

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isBlockedIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    return isBlockedIpv4(address);
  }
  if (family === 6) {
    return isBlockedIpv6(address);
  }
  return false;
}

async function assertSafeFetchUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ""));
  } catch (error) {
    throw new Error("Invalid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be fetched.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with embedded credentials cannot be fetched.");
  }

  const hostname = parsed.hostname;
  if (!hostname || isBlockedHostname(hostname)) {
    throw new Error("URL hostname is blocked for security.");
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("URL resolves to a blocked internal address.");
    }
    return parsed;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`Could not resolve URL hostname: ${error.message}`);
  }

  if (!records.length) {
    throw new Error("URL hostname did not resolve to an address.");
  }

  const blockedRecord = records.find((record) => isBlockedIp(record.address));
  if (blockedRecord) {
    throw new Error("URL resolves to a blocked internal address.");
  }

  return parsed;
}

module.exports = {
  assertSafeFetchUrl,
  isBlockedHostname,
  isBlockedIp
};
