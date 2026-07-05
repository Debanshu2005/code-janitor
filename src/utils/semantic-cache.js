class SemanticCache {
  constructor({ maxSize = 100, ttlMs = 5 * 60 * 1000 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const cacheKey = String(key || "");
    const entry = this.entries.get(cacheKey);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.entries.delete(cacheKey);
      this.misses++;
      return null;
    }

    this.hits++;
    this.entries.delete(cacheKey);
    this.entries.set(cacheKey, entry);
    return entry.value;
  }

  set(key, value) {
    const cacheKey = String(key || "");
    if (!cacheKey) {
      return;
    }

    if (this.entries.has(cacheKey)) {
      this.entries.delete(cacheKey);
    }

    while (this.entries.size >= this.maxSize) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }

    this.entries.set(cacheKey, {
      value,
      timestamp: Date.now()
    });
  }

  clear() {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(2)}%` : "0%"
    };
  }
}

async function getOrSet(cache, key, producer) {
  const cached = cache.get(key);
  if (cached !== null) {
    return cached;
  }

  const value = await producer();
  cache.set(key, value);
  return value;
}

module.exports = {
  SemanticCache,
  getOrSet
};
