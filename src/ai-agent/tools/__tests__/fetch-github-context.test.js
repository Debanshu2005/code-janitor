/**
 * fetch-github-context.test.js
 *
 * Tests for the GitHub context integration tool.
 */

const {
  fetchGitHubContext,
  validateGitHubContextRequest,
  parseGitHubRemoteUrl
} = require("../fetch-github-context");

function createJsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}

describe("fetch-github-context", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  test("parses https remotes", () => {
    expect(
      parseGitHubRemoteUrl("https://github.com/octocat/Hello-World.git")
    ).toEqual({
      host: "github.com",
      owner: "octocat",
      repo: "Hello-World"
    });
  });

  test("parses ssh remotes", () => {
    expect(
      parseGitHubRemoteUrl("git@github.com:octocat/Hello-World.git")
    ).toEqual({
      host: "github.com",
      owner: "octocat",
      repo: "Hello-World"
    });
  });

  test("validates required number for issue mode", () => {
    const result = validateGitHubContextRequest({ mode: "issue" });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("number must be a positive integer");
  });

  test("fetches repository context from the workspace origin remote", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          full_name: "octocat/Hello-World",
          description: "Example repository",
          private: false,
          default_branch: "main",
          stargazers_count: 42,
          forks_count: 7,
          open_issues_count: 5,
          html_url: "https://github.com/octocat/Hello-World"
        })
      )
      .mockResolvedValueOnce(
        createJsonResponse([
          {
            number: 108,
            title: "Improve onboarding",
            state: "open",
            user: { login: "alice" }
          }
        ])
      )
      .mockResolvedValueOnce(
        createJsonResponse([
          {
            number: 42,
            title: "Bug in parser",
            state: "open",
            user: { login: "bob" }
          },
          {
            number: 109,
            title: "PR masquerading as issue",
            state: "open",
            user: { login: "carol" },
            pull_request: { url: "https://api.github.com/repos/octocat/Hello-World/pulls/109" }
          }
        ])
      )
      .mockResolvedValueOnce(
        createJsonResponse([
          {
            sha: "abc123456789",
            commit: {
              author: {
                name: "Alice",
                date: "2026-05-15T10:00:00Z"
              },
              message: "Tighten parser wiring"
            }
          }
        ])
      );

    const result = await fetchGitHubContext(
      { mode: "repo" },
      "/workspace",
      {
        commandRunner: jest.fn().mockResolvedValue({
          success: true,
          output: "git@github.com:octocat/Hello-World.git"
        })
      }
    );

    expect(result.success).toBe(true);
    expect(result.owner).toBe("octocat");
    expect(result.repo).toBe("Hello-World");
    expect(result.summary).toContain("GitHub Repository: octocat/Hello-World");
    expect(result.summary).toContain("Open pull requests:");
    expect(result.summary).toContain("Open issues:");
    expect(result.summary).toContain("Tighten parser wiring");
  });

  test("fetches a specific pull request", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createJsonResponse({
        number: 77,
        title: "Ship GitHub integration",
        state: "open",
        draft: false,
        user: { login: "deb" },
        created_at: "2026-05-16T10:00:00Z",
        head: { ref: "feature/github-context" },
        base: { ref: "main" },
        commits: 4,
        changed_files: 6,
        additions: 180,
        deletions: 24,
        body: "Adds a clean GitHub API integration path.",
        html_url: "https://github.com/octocat/Hello-World/pull/77"
      })
    );

    const result = await fetchGitHubContext(
      {
        mode: "pull_request",
        owner: "octocat",
        repo: "Hello-World",
        number: 77
      },
      null,
      {}
    );

    expect(result.success).toBe(true);
    expect(result.summary).toContain("Pull Request: octocat/Hello-World#77");
    expect(result.summary).toContain("feature/github-context -> main");
  });

  test("surfaces authentication guidance for private or rate-limited repos", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      createJsonResponse({ message: "Not Found" }, 404)
    );

    await expect(
      fetchGitHubContext(
        {
          mode: "repo",
          owner: "octocat",
          repo: "private-repo"
        },
        null,
        {}
      )
    ).rejects.toThrow("Configure codeJanitor.github.apiToken or GITHUB_TOKEN");
  });
});

// Made with Bob
