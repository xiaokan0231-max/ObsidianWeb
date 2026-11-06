// 仅内存中的虚构测试数据；用 CAS 模拟多个 Worker 共享同一存储。
export class MemoryFeedbackBucket {
  records = new Map();
  counter = 0;
  gets = 0;
  lists = 0;
  puts = 0;
  fail = null;
  async get(key) {
    this.gets++;
    this.fail?.("get", key);
    const record = this.records.get(key);
    return record ? { key, etag: record.etag, json: async () => JSON.parse(record.body), text: async () => record.body } : null;
  }
  async put(key, body, options = {}) {
    this.puts++;
    this.fail?.("put", key);
    const current = this.records.get(key);
    if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
    if (options.onlyIf?.etagDoesNotMatch === "*" && current) return null;
    const etag = `test-etag-${++this.counter}`;
    this.records.set(key, { body: String(body), etag });
    return { key, etag };
  }
  async list({ prefix = "", cursor, limit = 1000 } = {}) {
    this.lists++;
    this.fail?.("list", prefix);
    const keys = [...this.records.keys()].filter(key => key.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0, end = start + limit;
    return { objects: keys.slice(start, end).map(key => ({ key })), truncated: end < keys.length, cursor: end < keys.length ? String(end) : undefined };
  }
  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) { this.fail?.("delete", key); this.records.delete(key); }
  }
}
