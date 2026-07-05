/* eslint-env jest */

jest.mock("dns", () => ({
  promises: {
    lookup: jest.fn()
  }
}));

const dns = require("dns").promises;
const {
  assertSafeFetchUrl,
  isBlockedHostname,
  isBlockedIp
} = require("../safe-url");

describe("safe-url", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("blocks localhost hostnames", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("api.localhost")).toBe(true);
  });

  test("blocks private and metadata IP ranges", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("192.168.1.10")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  test("rejects hostnames resolving to private addresses", async () => {
    dns.lookup.mockResolvedValue([{ address: "10.0.0.8", family: 4 }]);

    await expect(assertSafeFetchUrl("https://example.com")).rejects.toThrow(
      "blocked internal address"
    );
  });

  test("allows public http and https URLs without embedded credentials", async () => {
    dns.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    await expect(assertSafeFetchUrl("https://example.com/docs")).resolves.toMatchObject({
      protocol: "https:",
      hostname: "example.com"
    });
  });

  test("rejects unsupported protocols and embedded credentials", async () => {
    await expect(assertSafeFetchUrl("file:///etc/passwd")).rejects.toThrow(
      "Only http and https"
    );
    await expect(assertSafeFetchUrl("https://user:pass@example.com")).rejects.toThrow(
      "embedded credentials"
    );
  });
});
