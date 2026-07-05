/**
 * fetch-github-context.js
 *
 * Fetch GitHub repository, issue, and pull request context for the current
 * workspace repository or an explicitly named owner/repo pair.
 */

const { execFile } = require("child_process");
const crypto = require("crypto");
const vscode = require("../../utils/vscode-shim");
const { SemanticCache, getOrSet } = require("../../utils/semantic-cache");

const DEFAULT_API_BASE_URL = "https://api.github.com";
const VALID_MODES = new Set(["repo", "issue", "pull_request"]);
const BODY_PREVIEW_LIMIT = 280;
const GITHUB_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const githubContextCache = new SemanticCache({
  maxSize: 100,
  ttlMs: GITHUB_CONTEXT_CACHE_TTL_MS
});

function validateGitHubContextRequest(request = {}) {
  const errors = [];
  const mode = request.mode || "repo";

  if (!VALID_MODES.has(mode)) {
    errors.push(
      `mode must be one of: ${Array.from(VALID_MODES).join(", ")}`
    );
  }

  if (
    (mode === "issue" || mode === "pull_request") &&
    (!Number.isInteger(request.number) || request.number < 1)
  ) {
    errors.push("number must be a positive integer for issue and pull_request modes");
  }

  if (request.owner !== undefined && typeof request.owner !== "string") {
    errors.push("owner must be a string when provided");
  }

  if (request.repo !== undefined && typeof request.repo !== "string") {
    errors.push("repo must be a string when provided");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function parseGitHubRemoteUrl(remoteUrl) {
  const raw = String(remoteUrl || "").trim();
  if (!raw) {
    return null;
  }

  const patterns = [
    /^git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/i,
    /^ssh:\/\/git@([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/i,
    /^https?:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match) {
      return {
        host: match[1],
        owner: match[2],
        repo: match[3]
      };
    }
  }

  return null;
}

function formatDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value || "");
  }
  return parsed.toISOString().slice(0, 10);
}

function truncateText(value, limit = BODY_PREVIEW_LIMIT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function formatRepoSummary(repoData, pulls = [], issues = [], latestCommit = null) {
  const lines = [];
  lines.push(`GitHub Repository: ${repoData.full_name}`);
  if (repoData.description) {
    lines.push(`Description: ${repoData.description}`);
  }
  lines.push(
    `Visibility: ${repoData.private ? "private" : "public"} | Default branch: ${repoData.default_branch}`
  );
  lines.push(
    `Stars: ${Number(repoData.stargazers_count || 0).toLocaleString()} | Forks: ${Number(repoData.forks_count || 0).toLocaleString()} | Open issues: ${Number(repoData.open_issues_count || 0).toLocaleString()}`
  );

  if (latestCommit?.sha) {
    lines.push("");
    lines.push(`Latest commit on ${repoData.default_branch}:`);
    lines.push(
      `- ${latestCommit.sha.slice(0, 7)} by ${latestCommit.commit?.author?.name || latestCommit.author?.login || "unknown"} on ${formatDate(latestCommit.commit?.author?.date)}`
    );
    if (latestCommit.commit?.message) {
      lines.push(`  ${truncateText(latestCommit.commit.message, 160)}`);
    }
  }

  if (pulls.length > 0) {
    lines.push("");
    lines.push("Open pull requests:");
    pulls.slice(0, 3).forEach((pull) => {
      lines.push(
        `- #${pull.number} ${pull.title} (${pull.user?.login || "unknown"}, ${pull.state})`
      );
    });
  }

  if (issues.length > 0) {
    lines.push("");
    lines.push("Open issues:");
    issues.slice(0, 3).forEach((issue) => {
      lines.push(
        `- #${issue.number} ${issue.title} (${issue.user?.login || "unknown"}, ${issue.state})`
      );
    });
  }

  lines.push("");
  lines.push(`URL: ${repoData.html_url}`);
  return lines.join("\n");
}

function formatIssueSummary(issueData, owner, repo) {
  const labels = Array.isArray(issueData.labels)
    ? issueData.labels.map((label) => label?.name).filter(Boolean)
    : [];
  const kind = issueData.pull_request ? "Issue (GitHub returned a pull request reference)" : "Issue";
  const lines = [
    `${kind}: ${owner}/${repo}#${issueData.number}`,
    `Title: ${issueData.title}`,
    `State: ${issueData.state} | Author: ${issueData.user?.login || "unknown"} | Created: ${formatDate(issueData.created_at)}`
  ];

  if (labels.length > 0) {
    lines.push(`Labels: ${labels.join(", ")}`);
  }
  if (issueData.body) {
    lines.push("");
    lines.push(truncateText(issueData.body));
  }
  lines.push("");
  lines.push(`URL: ${issueData.html_url}`);
  return lines.join("\n");
}

function formatPullRequestSummary(pullData, owner, repo) {
  const lines = [
    `Pull Request: ${owner}/${repo}#${pullData.number}`,
    `Title: ${pullData.title}`,
    `State: ${pullData.state}${pullData.merged_at ? " (merged)" : pullData.draft ? " (draft)" : ""} | Author: ${pullData.user?.login || "unknown"} | Created: ${formatDate(pullData.created_at)}`,
    `Branch: ${pullData.head?.ref || "unknown"} -> ${pullData.base?.ref || "unknown"}`,
    `Commits: ${pullData.commits ?? "?"} | Files changed: ${pullData.changed_files ?? "?"} | +${pullData.additions ?? 0} / -${pullData.deletions ?? 0}`
  ];

  if (pullData.body) {
    lines.push("");
    lines.push(truncateText(pullData.body));
  }
  lines.push("");
  lines.push(`URL: ${pullData.html_url}`);
  return lines.join("\n");
}

function runGitRemoteCommand(workspaceRoot) {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["remote", "get-url", "origin"],
      {
        cwd: workspaceRoot,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            output: String(stdout || "").trim(),
            error: String(stderr || error.message || "").trim()
          });
          return;
        }

        resolve({
          success: true,
          output: String(stdout || "").trim()
        });
      }
    );
  });
}

async function resolveRepositoryReference(request, workspaceRoot, executionContext = {}) {
  if (request.owner && request.repo) {
    return {
      owner: request.owner.trim(),
      repo: request.repo.trim()
    };
  }

  if (!workspaceRoot) {
    throw new Error(
      "A workspace folder is required when owner and repo are not provided."
    );
  }

  const runner = executionContext.commandRunner;
  const result = runner
    ? await runner("git remote get-url origin", workspaceRoot)
    : await runGitRemoteCommand(workspaceRoot);

  if (!result?.success) {
    throw new Error(
      `Could not determine the GitHub repository from origin remote: ${result?.error || "git remote get-url origin failed"}`
    );
  }

  const parsed = parseGitHubRemoteUrl(result.output);
  if (!parsed?.owner || !parsed?.repo) {
    throw new Error(
      "Origin remote could not be parsed as a GitHub-style owner/repository URL."
    );
  }

  return {
    owner: parsed.owner,
    repo: parsed.repo
  };
}

async function getGitHubToken(executionContext = {}) {
  if (typeof executionContext.githubToken === "string" && executionContext.githubToken.trim()) {
    return executionContext.githubToken.trim();
  }

  const secretToken = await executionContext.context?.secrets?.get?.(
    "codeJanitor.github.apiToken"
  );
  if (secretToken && String(secretToken).trim()) {
    return String(secretToken).trim();
  }

  return String(process.env.GITHUB_TOKEN || "").trim();
}

function getApiBaseUrl() {
  const configured = String(
    vscode.workspace.getConfiguration("codeJanitor.github").get("apiBaseUrl", DEFAULT_API_BASE_URL) || ""
  ).trim();
  return configured || DEFAULT_API_BASE_URL;
}

function fingerprintToken(token) {
  const raw = String(token || "");
  if (!raw) {
    return "none";
  }

  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function buildGitHubContextCacheKey({
  apiBaseUrl,
  token,
  mode,
  owner,
  repo,
  number
}) {
  return JSON.stringify({
    apiBaseUrl,
    token: fingerprintToken(token),
    mode,
    owner,
    repo,
    number: Number.isInteger(number) ? number : null
  });
}

async function githubRequest(apiPath, executionContext = {}, requestOptions = {}) {
  const token =
    typeof requestOptions.token === "string"
      ? requestOptions.token
      : await getGitHubToken(executionContext);
  const apiBaseUrl = requestOptions.apiBaseUrl || getApiBaseUrl();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Code-Janitor/1.0",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${apiBaseUrl}${apiPath}`, { headers });
  if (!response.ok) {
    let details = "";
    try {
      const data = await response.json();
      details = data?.message ? ` ${data.message}` : "";
    } catch {
      details = "";
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error(
        `GitHub API request failed with ${response.status}.${details} Configure the GitHub token in SecretStorage or GITHUB_TOKEN if the repository is private or rate-limited.`
      );
    }

    throw new Error(`GitHub API request failed with ${response.status}.${details}`);
  }

  return response.json();
}

async function fetchGitHubContext(request = {}, workspaceRoot, executionContext = {}) {
  const validation = validateGitHubContextRequest(request);
  if (!validation.valid) {
    throw new Error(`Invalid GitHub context request: ${validation.errors.join("; ")}`);
  }

  const mode = request.mode || "repo";
  const { owner, repo } = await resolveRepositoryReference(
    request,
    workspaceRoot,
    executionContext
  );
  const apiBaseUrl = getApiBaseUrl();
  const token = await getGitHubToken(executionContext);
  const requestOptions = { apiBaseUrl, token };
  const cacheKey = buildGitHubContextCacheKey({
    apiBaseUrl,
    token,
    mode,
    owner,
    repo,
    number: request.number
  });

  if (executionContext.cache !== false) {
    return getOrSet(githubContextCache, cacheKey, () =>
      fetchGitHubContextUncached(
        { ...request, mode },
        owner,
        repo,
        executionContext,
        requestOptions
      )
    );
  }

  return fetchGitHubContextUncached(
    { ...request, mode },
    owner,
    repo,
    executionContext,
    requestOptions
  );
}

async function fetchGitHubContextUncached(
  request,
  owner,
  repo,
  executionContext,
  requestOptions
) {
  const mode = request.mode || "repo";
  if (mode === "repo") {
    const repoData = await githubRequest(
      `/repos/${owner}/${repo}`,
      executionContext,
      requestOptions
    );
    const [pulls, issueList, commits] = await Promise.all([
      githubRequest(
        `/repos/${owner}/${repo}/pulls?state=open&per_page=5`,
        executionContext,
        requestOptions
      ),
      githubRequest(
        `/repos/${owner}/${repo}/issues?state=open&per_page=10`,
        executionContext,
        requestOptions
      ),
      githubRequest(
        `/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(repoData.default_branch)}&per_page=1`,
        executionContext,
        requestOptions
      )
    ]);

    const issues = Array.isArray(issueList)
      ? issueList.filter((issue) => !issue?.pull_request).slice(0, 5)
      : [];
    const latestCommit = Array.isArray(commits) ? commits[0] : null;
    const summary = formatRepoSummary(repoData, pulls, issues, latestCommit);

    return {
      success: true,
      mode,
      owner,
      repo,
      summary,
      repository: repoData,
      pulls,
      issues,
      latestCommit
    };
  }

  if (mode === "issue") {
    const issueData = await githubRequest(
      `/repos/${owner}/${repo}/issues/${request.number}`,
      executionContext,
      requestOptions
    );
    return {
      success: true,
      mode,
      owner,
      repo,
      issue: issueData,
      summary: formatIssueSummary(issueData, owner, repo)
    };
  }

  const pullData = await githubRequest(
    `/repos/${owner}/${repo}/pulls/${request.number}`,
    executionContext,
    requestOptions
  );
  return {
    success: true,
    mode,
    owner,
    repo,
    pullRequest: pullData,
    summary: formatPullRequestSummary(pullData, owner, repo)
  };
}

module.exports = {
  fetchGitHubContext,
  validateGitHubContextRequest,
  parseGitHubRemoteUrl,
  githubContextCache,
  DEFAULT_API_BASE_URL,
  VALID_MODES
};

// Made with Bob
