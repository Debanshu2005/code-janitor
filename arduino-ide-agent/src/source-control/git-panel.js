const vscode = require("vscode");
const path = require("path");
const fs = require("fs");

class GitPanel {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.refreshTimeout = null;
    this.isRefreshing = false;
    this.gitRoot = null;
  }

  show() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Two);
      this.refreshStatus();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "arduinoGitPanel",
      "Source Control",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.getHtmlContent();
    this.panel.onDidDispose(() => (this.panel = null));

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      await this.handleMessage(msg);
    });

    // Initial refresh
    this.refreshStatus();
    
    // Also refresh after a delay in case workspace just opened
    setTimeout(() => {
      this.refreshStatus();
    }, 1000);
  }

  async handleMessage(msg) {
    const { type } = msg;

    try {
      if (type === "ready") {
        await this.refreshStatus();
      } else if (type === "sync") {
        await this.gitSync();
      } else if (type === "more") {
        await this.showMoreMenu();
      } else if (type === "clone") {
        await this.cloneRepository();
      } else if (type === "init") {
        await this.initRepository();
      } else if (type === "pull") {
        await this.gitPull();
      } else if (type === "push") {
        await this.gitPush();
      } else if (type === "commit") {
        await this.gitCommit(msg.message);
      } else if (type === "stage") {
        await this.stageFile(msg.file);
      } else if (type === "unstage") {
        await this.unstageFile(msg.file);
      } else if (type === "stageAll") {
        await this.stageAll();
      } else if (type === "unstageAll") {
        await this.unstageAll();
      } else if (type === "refresh") {
        await this.refreshStatus();
      } else if (type === "openFile") {
        await this.openFile(msg.file);
      } else if (type === "discardChanges") {
        await this.discardChanges(msg.file);
      } else if (type === "viewDiff") {
        await this.viewDiff(msg.file);
      } else if (type === "fetch") {
        await this.gitFetch();
      } else if (type === "checkout") {
        await this.checkoutBranch();
      } else if (type === "createBranch") {
        await this.createBranch();
      } else if (type === "gitConfig") {
        await this.configureGit();
      } else if (type === "abortMerge") {
        await this.abortMerge();
      } else if (type === "resolveConflict") {
        await this.resolveConflict(msg.file);
      } else if (type === "acceptIncoming") {
        await this.acceptIncoming();
      } else if (type === "acceptCurrent") {
        await this.acceptCurrent();
      } else if (type === "acceptBoth") {
        await this.acceptBoth();
      } else if (type === "viewCommit") {
        await this.viewCommit(msg.hash);
      } else if (type === "openFolder") {
        await this.openFolder();
      }
    } catch (error) {
      this.sendMessage({
        type: "error",
        text: error.message,
      });
    }
  }

  async executeGit(args, cwd) {
    const { exec } = require("child_process");
    const workspaceFolder = cwd || this.gitRoot || this.getWorkspaceFolder();

    if (!workspaceFolder) {
      throw new Error("No workspace folder open");
    }

    return new Promise((resolve, reject) => {
      exec(`git ${args}`, { cwd: workspaceFolder }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  getWorkspaceFolder() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }
    return folders[0].uri.fsPath;
  }

  async cloneRepository() {
    const url = await vscode.window.showInputBox({
      prompt: "Enter repository URL",
      placeHolder: "https://github.com/user/repo.git",
    });

    if (!url) return;

    const folderUri = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Select Clone Location",
    });

    if (!folderUri || folderUri.length === 0) return;

    this.sendMessage({ type: "status", text: "Cloning repository..." });

    try {
      const repoName = url.split("/").pop().replace(".git", "");
      const repoPath = path.join(folderUri[0].fsPath, repoName);
      
      await this.executeGit(`clone "${url}" "${repoPath}"`, folderUri[0].fsPath);
      this.sendMessage({ type: "status", text: `✓ Repository cloned to ${repoPath}` });
      
      // Show message with option to open the cloned folder
      const openFolder = await vscode.window.showInformationMessage(
        `Repository cloned successfully to ${repoName}`,
        "Open Folder"
      );
      
      if (openFolder === "Open Folder") {
        await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(repoPath));
      } else {
        // If user doesn't want to open, just refresh to see if we can detect it
        await this.refreshStatus();
      }
    } catch (error) {
      this.sendMessage({ type: "error", text: `Clone failed: ${error.message}` });
    }
  }

  async initRepository() {
    this.sendMessage({ type: "status", text: "Initializing repository..." });

    try {
      await this.executeGit("init");
      this.sendMessage({ type: "status", text: "✓ Repository initialized" });
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Init failed: ${error.message}` });
    }
  }

  async gitSync() {
    this.sendMessage({ type: "status", text: "Syncing changes..." });

    try {
      await this.gitPull();
      await this.gitPush();
      this.sendMessage({ type: "status", text: "✓ Sync complete" });
    } catch (error) {
      this.sendMessage({ type: "error", text: `Sync failed: ${error.message}` });
    }
  }

  async showMoreMenu() {
    const options = [
      "Pull",
      "Push",
      "Fetch",
      "Sync",
      "---",
      "Open Folder",
      "Stash Changes",
      "Pop Stash",
      "---",
      "View History",
      "Configure Git"
    ];

    const selected = await vscode.window.showQuickPick(options.filter(o => o !== "---"), {
      placeHolder: "Select Git action"
    });

    if (!selected) return;

    switch (selected) {
      case "Pull": await this.gitPull(); break;
      case "Push": await this.gitPush(); break;
      case "Fetch": await this.gitFetch(); break;
      case "Sync": await this.gitSync(); break;
      case "Open Folder": await this.openFolder(); break;
      case "Stash Changes": await this.stashChanges(); break;
      case "Pop Stash": await this.popStash(); break;
      case "View History": await this.viewHistory(); break;
      case "Configure Git": await this.configureGit(); break;
    }
  }

  async openFolder() {
    const folderUri = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Open Folder",
    });

    if (folderUri && folderUri.length > 0) {
      await vscode.commands.executeCommand("vscode.openFolder", folderUri[0]);
    }
  }

  async stashChanges() {
    try {
      await this.executeGit("stash");
      this.sendMessage({ type: "status", text: "✓ Changes stashed" });
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Stash failed: ${error.message}` });
    }
  }

  async popStash() {
    try {
      await this.executeGit("stash pop");
      this.sendMessage({ type: "status", text: "✓ Stash applied" });
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Pop stash failed: ${error.message}` });
    }
  }

  async viewHistory() {
    try {
      const log = await this.executeGit("log --oneline -20");
      vscode.window.showInformationMessage("Recent commits:", { modal: true, detail: log });
    } catch (error) {
      this.sendMessage({ type: "error", text: `View history failed: ${error.message}` });
    }
  }

  async abortMerge() {
    try {
      await this.executeGit("merge --abort");
      this.sendMessage({ type: "status", text: "✓ Merge aborted" });
      vscode.window.showInformationMessage("Merge aborted successfully");
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Abort merge failed: ${error.message}` });
    }
  }

  async resolveConflict(file) {
    try {
      await this.executeGit(`add "${file}"`);
      this.sendMessage({ type: "status", text: `✓ Marked ${file} as resolved` });
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Resolve failed: ${error.message}` });
    }
  }

  async acceptIncoming() {
    try {
      const conflicts = await this.executeGit("diff --name-only --diff-filter=U");
      if (!conflicts.trim()) {
        vscode.window.showWarningMessage("No conflicts to resolve");
        return;
      }

      const files = conflicts.split("\n").filter(f => f.trim());
      for (const file of files) {
        await this.executeGit(`checkout --theirs "${file}"`);
        await this.executeGit(`add "${file}"`);
      }

      this.sendMessage({ type: "status", text: "✓ Accepted incoming changes" });
      vscode.window.showInformationMessage("Accepted all incoming changes");
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Accept incoming failed: ${error.message}` });
    }
  }

  async acceptCurrent() {
    try {
      const conflicts = await this.executeGit("diff --name-only --diff-filter=U");
      if (!conflicts.trim()) {
        vscode.window.showWarningMessage("No conflicts to resolve");
        return;
      }

      const files = conflicts.split("\n").filter(f => f.trim());
      for (const file of files) {
        await this.executeGit(`checkout --ours "${file}"`);
        await this.executeGit(`add "${file}"`);
      }

      this.sendMessage({ type: "status", text: "✓ Accepted current changes" });
      vscode.window.showInformationMessage("Accepted all current changes");
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Accept current failed: ${error.message}` });
    }
  }

  async acceptBoth() {
    vscode.window.showInformationMessage(
      "Accept Both requires manual editing. Open conflicted files and resolve manually.",
      "OK"
    );
  }

  async viewCommit(hash) {
    try {
      const details = await this.executeGit(`show ${hash} --stat`);
      const panel = vscode.window.createWebviewPanel(
        "commitDetails",
        `Commit ${hash}`,
        vscode.ViewColumn.Two,
        {}
      );
      panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: monospace; 
              padding: 20px; 
              background: #1e1e1e; 
              color: #cccccc; 
            }
            pre { 
              white-space: pre-wrap; 
              word-wrap: break-word; 
            }
          </style>
        </head>
        <body><pre>${details.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body>
        </html>
      `;
    } catch (error) {
      vscode.window.showErrorMessage(`View commit failed: ${error.message}`);
    }
  }

  async gitPull() {
    this.sendMessage({ type: "status", text: "Pulling changes..." });

    try {
      // Check if there are uncommitted changes
      const status = await this.executeGit("status --porcelain");
      if (status.trim()) {
        const proceed = await vscode.window.showWarningMessage(
          "You have uncommitted changes. Pull anyway?",
          "Stash and Pull",
          "Pull Anyway",
          "Cancel"
        );

        if (proceed === "Cancel" || !proceed) {
          this.sendMessage({ type: "status", text: "Pull cancelled" });
          return;
        }

        if (proceed === "Stash and Pull") {
          await this.executeGit("stash");
          this.sendMessage({ type: "status", text: "Changes stashed" });
        }
      }

      // Check if upstream is configured
      let hasUpstream = true;
      let currentBranch = "";
      try {
        await this.executeGit("rev-parse --abbrev-ref @{upstream}");
        currentBranch = await this.executeGit("rev-parse --abbrev-ref HEAD");
      } catch (e) {
        hasUpstream = false;
        currentBranch = await this.executeGit("rev-parse --abbrev-ref HEAD");
      }

      if (!hasUpstream) {
        this.sendMessage({ 
          type: "error", 
          text: `No upstream branch configured for '${currentBranch}'` 
        });
        vscode.window.showErrorMessage(
          `Branch '${currentBranch}' has no upstream branch. Push first to set upstream.`
        );
        return;
      }

      const result = await this.executeGit("pull");
      
      if (result.includes("Already up to date")) {
        this.sendMessage({ type: "status", text: "✓ Already up to date" });
        vscode.window.showInformationMessage("Already up to date");
      } else {
        this.sendMessage({ type: "status", text: "✓ Pull successful" });
        vscode.window.showInformationMessage("Changes pulled successfully");
      }
      
      await this.refreshStatus();
    } catch (error) {
      const errorMsg = error.message;
      
      // Check for merge conflicts
      if (errorMsg.includes("CONFLICT") || errorMsg.includes("Automatic merge failed")) {
        this.sendMessage({ 
          type: "error", 
          text: "Pull failed: Merge conflicts detected" 
        });
        
        const resolve = await vscode.window.showErrorMessage(
          "Pull resulted in merge conflicts. Resolve conflicts manually.",
          "Show Files",
          "Abort Merge"
        );

        if (resolve === "Abort Merge") {
          try {
            await this.executeGit("merge --abort");
            this.sendMessage({ type: "status", text: "Merge aborted" });
          } catch (e) {
            this.sendMessage({ type: "error", text: `Abort failed: ${e.message}` });
          }
        }
        
        await this.refreshStatus();
      } else if (errorMsg.includes("Authentication failed") || errorMsg.includes("could not read Username")) {
        this.sendMessage({ 
          type: "error", 
          text: "Pull failed: Authentication required" 
        });
        vscode.window.showErrorMessage("Git authentication failed. Check your credentials.");
      } else if (errorMsg.includes("There is no tracking information")) {
        this.sendMessage({ 
          type: "error", 
          text: "Pull failed: No upstream branch" 
        });
        vscode.window.showErrorMessage("No upstream branch configured. Push first to set upstream.");
      } else {
        this.sendMessage({ type: "error", text: `Pull failed: ${errorMsg}` });
        vscode.window.showErrorMessage(`Pull failed: ${errorMsg}`);
      }
    }
  }

  async gitPush() {
    this.sendMessage({ type: "status", text: "Pushing changes..." });

    try {
      // Check if there are commits to push
      let commitsToPush = "";
      try {
        commitsToPush = await this.executeGit("log @{u}.. --oneline");
      } catch (e) {
        // No upstream or no commits
      }

      if (!commitsToPush.trim()) {
        this.sendMessage({ 
          type: "status", 
          text: "⚠️ No commits to push. Everything is up to date." 
        });
        return;
      }

      // First check if there's an upstream branch
      let hasUpstream = true;
      let currentBranch = "";
      try {
        await this.executeGit("rev-parse --abbrev-ref @{upstream}");
        currentBranch = await this.executeGit("rev-parse --abbrev-ref HEAD");
      } catch (e) {
        hasUpstream = false;
        currentBranch = await this.executeGit("rev-parse --abbrev-ref HEAD");
      }

      if (!hasUpstream) {
        // Ask user if they want to set upstream
        const setUpstream = await vscode.window.showInformationMessage(
          `No upstream branch set for '${currentBranch}'. Set upstream and push?`,
          "Yes",
          "No"
        );

        if (setUpstream !== "Yes") {
          this.sendMessage({ type: "status", text: "Push cancelled" });
          return;
        }

        // Push with set-upstream
        const result = await this.executeGit(`push --set-upstream origin ${currentBranch}`);
        this.sendMessage({ type: "status", text: `✓ Pushed and set upstream to origin/${currentBranch}` });
        
        // Get remote URL to show user
        try {
          const remoteUrl = await this.executeGit("remote get-url origin");
          vscode.window.showInformationMessage(
            `Pushed to ${remoteUrl}`,
            "Open on GitHub"
          ).then(selection => {
            if (selection === "Open on GitHub") {
              const githubUrl = remoteUrl
                .replace(/\.git$/, "")
                .replace(/^git@github\.com:/, "https://github.com/");
              vscode.env.openExternal(vscode.Uri.parse(githubUrl));
            }
          });
        } catch (e) {
          // Ignore if can't get remote URL
        }
      } else {
        // Normal push
        const result = await this.executeGit("push");
        this.sendMessage({ type: "status", text: "✓ Changes pushed successfully" });
        
        // Show commit count
        const commitCount = commitsToPush.split('\n').length;
        this.sendMessage({ 
          type: "status", 
          text: `Pushed ${commitCount} commit(s) to origin/${currentBranch}` 
        });
      }
      
      await this.refreshStatus();
    } catch (error) {
      const errorMsg = error.message;
      
      // Check for common authentication errors
      if (errorMsg.includes("Authentication failed") || errorMsg.includes("could not read Username")) {
        this.sendMessage({ 
          type: "error", 
          text: "Push failed: Authentication required. Please configure Git credentials." 
        });
        
        const setupAuth = await vscode.window.showErrorMessage(
          "Git authentication failed. You need to set up credentials.",
          "Setup SSH Key",
          "Use Personal Access Token",
          "Cancel"
        );

        if (setupAuth === "Setup SSH Key") {
          vscode.env.openExternal(vscode.Uri.parse("https://docs.github.com/en/authentication/connecting-to-github-with-ssh"));
        } else if (setupAuth === "Use Personal Access Token") {
          vscode.env.openExternal(vscode.Uri.parse("https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token"));
        }
      } else if (errorMsg.includes("no upstream branch")) {
        this.sendMessage({ type: "error", text: "Push failed: No upstream branch configured" });
      } else if (errorMsg.includes("rejected")) {
        this.sendMessage({ 
          type: "error", 
          text: "Push rejected: Pull remote changes first or force push" 
        });
        
        const forcePush = await vscode.window.showWarningMessage(
          "Push was rejected. This usually means the remote has changes you don't have locally.",
          "Pull First",
          "Force Push (Dangerous)",
          "Cancel"
        );

        if (forcePush === "Pull First") {
          await this.gitPull();
        } else if (forcePush === "Force Push (Dangerous)") {
          try {
            await this.executeGit("push --force");
            this.sendMessage({ type: "status", text: "✓ Force pushed successfully" });
            await this.refreshStatus();
          } catch (e) {
            this.sendMessage({ type: "error", text: `Force push failed: ${e.message}` });
          }
        }
      } else {
        this.sendMessage({ type: "error", text: `Push failed: ${errorMsg}` });
      }
    }
  }

  async gitCommit(message) {
    console.log("[Git Panel] gitCommit called with message:", message);
    
    if (!message || !message.trim()) {
      console.log("[Git Panel] Commit failed: No message");
      this.sendMessage({ type: "error", text: "Commit message is required" });
      vscode.window.showErrorMessage("Please enter a commit message");
      return;
    }

    this.sendMessage({ type: "status", text: "Staging and committing changes..." });
    console.log("[Git Panel] Starting commit process...");

    try {
      // Check if we're in the middle of a merge
      const fs = require("fs");
      const gitRoot = this.gitRoot || this.getWorkspaceFolder();
      const mergeHeadPath = require("path").join(gitRoot, ".git", "MERGE_HEAD");
      const isMerging = fs.existsSync(mergeHeadPath);
      
      if (isMerging) {
        console.log("[Git Panel] In merge state, checking for conflicts...");
        // Check for unresolved conflicts
        const conflicts = await this.executeGit("diff --name-only --diff-filter=U");
        if (conflicts.trim()) {
          console.log("[Git Panel] Unresolved conflicts found:", conflicts);
          this.sendMessage({ type: "error", text: "Resolve conflicts before committing" });
          vscode.window.showErrorMessage(
            `Cannot commit: You have unresolved conflicts in:\n${conflicts}\n\nResolve conflicts, then stage and commit.`
          );
          return;
        }
        // If no conflicts, stage all and commit to complete the merge
        console.log("[Git Panel] No conflicts, completing merge commit...");
        await this.executeGit("add -A");
      } else {
        // Normal commit - stage all changes
        console.log("[Git Panel] Staging all changes...");
        await this.executeGit("add -A");
      }
      
      // Check if there are any changes to commit
      console.log("[Git Panel] Checking for changes...");
      const status = await this.executeGit("status --porcelain");
      console.log("[Git Panel] Status:", status);
      
      if (!status.trim() && !isMerging) {
        console.log("[Git Panel] No changes to commit");
        this.sendMessage({ type: "error", text: "No changes to commit" });
        vscode.window.showWarningMessage("No changes to commit. Modify files first.");
        return;
      }

      // Check if git user is configured
      console.log("[Git Panel] Checking git config...");
      try {
        const userName = await this.executeGit("config user.name");
        const userEmail = await this.executeGit("config user.email");
        console.log("[Git Panel] Git user configured:", userName, userEmail);
      } catch (e) {
        console.log("[Git Panel] Git user not configured:", e.message);
        this.sendMessage({ type: "error", text: "Git user not configured" });
        const configure = await vscode.window.showErrorMessage(
          "Git user.name and user.email are not configured. Configure now?",
          "Configure",
          "Cancel"
        );
        if (configure === "Configure") {
          await this.configureGit();
          return;
        }
        return;
      }

      console.log("[Git Panel] Executing git commit...");
      const result = await this.executeGit(`commit -m "${message.replace(/"/g, '\\"')}"`);
      console.log("[Git Panel] Commit result:", result);
      
      const commitMsg = isMerging ? "✓ Merge commit completed" : "✓ Changes committed";
      this.sendMessage({ type: "status", text: commitMsg });
      vscode.window.showInformationMessage(`Committed: ${message}`);
      
      console.log("[Git Panel] Refreshing status...");
      await this.refreshStatus();
      console.log("[Git Panel] Commit complete");
    } catch (error) {
      console.error("[Git Panel] Commit error:", error);
      this.sendMessage({ type: "error", text: `Commit failed: ${error.message}` });
      vscode.window.showErrorMessage(`Commit failed: ${error.message}`);
    }
  }

  async stageFile(file) {
    try {
      await this.executeGit(`add "${file}"`);
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Stage failed: ${error.message}` });
    }
  }

  async unstageFile(file) {
    try {
      await this.executeGit(`reset HEAD "${file}"`);
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Unstage failed: ${error.message}` });
    }
  }

  async stageAll() {
    try {
      await this.executeGit("add .");
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Stage all failed: ${error.message}` });
    }
  }

  async unstageAll() {
    try {
      await this.executeGit("reset HEAD");
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Unstage all failed: ${error.message}` });
    }
  }

  async discardChanges(file) {
    const confirm = await vscode.window.showWarningMessage(
      `Discard changes in ${file}?`,
      { modal: true },
      "Discard"
    );

    if (confirm !== "Discard") return;

    try {
      await this.executeGit(`checkout -- "${file}"`);
      this.sendMessage({ type: "status", text: "✓ Changes discarded" });
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Discard failed: ${error.message}` });
    }
  }

  async viewDiff(file) {
    const workspaceFolder = this.getWorkspaceFolder();
    if (!workspaceFolder) return;
    const filePath = path.join(workspaceFolder, file);
    
    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.commands.executeCommand("vscode.diff", 
        uri.with({ scheme: "git", query: "HEAD" }), 
        uri, 
        `${file} (Working Tree)`
      );
    } catch (error) {
      this.sendMessage({ type: "error", text: `Diff failed: ${error.message}` });
    }
  }

  async openFile(file) {
    const workspaceFolder = this.getWorkspaceFolder();
    if (!workspaceFolder) return;
    const filePath = path.join(workspaceFolder, file);
    const uri = vscode.Uri.file(filePath);
    await vscode.window.showTextDocument(uri);
  }

  async gitFetch() {
    this.sendMessage({ type: "status", text: "Fetching..." });

    try {
      await this.executeGit("fetch");
      this.sendMessage({ type: "status", text: "✓ Fetch complete" });
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Fetch failed: ${error.message}` });
    }
  }

  async checkoutBranch() {
    try {
      const branches = await this.executeGit("branch -a");
      const branchList = branches.split("\n").map(b => b.trim().replace(/^\*\s*/, ""));
      
      const selected = await vscode.window.showQuickPick(branchList, {
        placeHolder: "Select branch to checkout",
      });

      if (!selected) return;

      await this.executeGit(`checkout ${selected}`);
      this.sendMessage({ type: "status", text: `✓ Switched to ${selected}` });
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Checkout failed: ${error.message}` });
    }
  }

  async createBranch() {
    const branchName = await vscode.window.showInputBox({
      prompt: "Enter new branch name",
      placeHolder: "feature/my-feature",
    });

    if (!branchName) return;

    try {
      await this.executeGit(`checkout -b ${branchName}`);
      this.sendMessage({ type: "status", text: `✓ Created and switched to ${branchName}` });
      await this.refreshStatus();
    } catch (error) {
      this.sendMessage({ type: "error", text: `Create branch failed: ${error.message}` });
    }
  }

  async configureGit() {
    try {
      // Check if git config already exists
      let userName = "";
      let userEmail = "";
      
      try {
        userName = await this.executeGit("config user.name");
        userEmail = await this.executeGit("config user.email");
      } catch (e) {
        // Config doesn't exist yet
      }

      const name = await vscode.window.showInputBox({
        prompt: "Enter your Git username",
        placeHolder: "John Doe",
        value: userName,
      });

      if (!name) return;

      const email = await vscode.window.showInputBox({
        prompt: "Enter your Git email",
        placeHolder: "john@example.com",
        value: userEmail,
      });

      if (!email) return;

      // Set git config globally
      await this.executeGit(`config --global user.name "${name}"`);
      await this.executeGit(`config --global user.email "${email}"`);

      this.sendMessage({ 
        type: "status", 
        text: `✓ Git configured: ${name} <${email}>` 
      });
      
      vscode.window.showInformationMessage(
        `Git account configured successfully!\nName: ${name}\nEmail: ${email}`
      );
    } catch (error) {
      this.sendMessage({ type: "error", text: `Git config failed: ${error.message}` });
    }
  }

  async refreshStatus() {
    if (!this.panel) return;

    // Clear any pending timeout
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }

    // If already refreshing, wait for it to complete
    if (this.isRefreshing) {
      return;
    }

    this.isRefreshing = true;
    try {
      await this._doRefresh();
    } finally {
      this.isRefreshing = false;
    }
  }

  async _doRefresh() {
    if (!this.panel) return;

    const workspaceFolder = this.getWorkspaceFolder();
    
    console.log("[Git Panel] Refreshing status. Workspace:", workspaceFolder);
    
    if (!workspaceFolder) {
      console.log("[Git Panel] No workspace folder found");
      this.sendMessage({
        type: "noRepo",
        workspacePath: null,
      });
      return;
    }

    try {
      const fs = require("fs");
      
      // Search for .git folder in current directory and parent directories
      let gitRoot = workspaceFolder;
      let gitPath = path.join(gitRoot, ".git");
      let foundGit = false;
      
      console.log("[Git Panel] Searching for .git folder...");
      
      // Check current folder and up to 3 parent levels
      for (let i = 0; i < 4; i++) {
        console.log("[Git Panel] Checking:", gitPath);
        if (fs.existsSync(gitPath)) {
          foundGit = true;
          console.log("[Git Panel] Found .git at:", gitPath);
          break;
        }
        const parentDir = path.dirname(gitRoot);
        if (parentDir === gitRoot) {
          // Reached root directory
          break;
        }
        gitRoot = parentDir;
        gitPath = path.join(gitRoot, ".git");
      }
      
      if (!foundGit) {
        console.log("[Git Panel] .git folder not found in workspace or parent directories");
        this.sendMessage({
          type: "noRepo",
          workspacePath: workspaceFolder,
        });
        return;
      }

      console.log("[Git Panel] Using git root:", gitRoot);
      console.log("[Git Panel] Running git status");
      
      const status = await this.executeGit("status --porcelain", gitRoot);
      const branch = await this.executeGit("rev-parse --abbrev-ref HEAD", gitRoot);
      
      // Check for conflicts
      let conflicts = [];
      try {
        const conflictFiles = await this.executeGit("diff --name-only --diff-filter=U", gitRoot);
        if (conflictFiles.trim()) {
          conflicts = conflictFiles.split("\n").filter(f => f.trim());
        }
      } catch (e) {
        // No conflicts
      }
      
      console.log("[Git Panel] Git status successful. Branch:", branch);
      console.log("[Git Panel] Conflicts:", conflicts.length);
      
      const staged = [];
      const unstaged = [];

      status.split("\n").forEach((line) => {
        if (!line) return;
        const statusCode = line.substring(0, 2);
        const file = line.substring(3);

        if (statusCode[0] !== " " && statusCode[0] !== "?") {
          staged.push({ file, status: statusCode[0] });
        }
        if (statusCode[1] !== " " || statusCode[0] === "?") {
          unstaged.push({ file, status: statusCode[1] || "?" });
        }
      });

      console.log("[Git Panel] Staged:", staged.length, "Unstaged:", unstaged.length);

      // Get commit history
      let commits = [];
      try {
        const logOutput = await this.executeGit(
          'log --all --pretty=format:"%H|%an|%ar|%s|%D" -20',
          gitRoot
        );
        
        if (logOutput.trim()) {
          commits = logOutput.split("\n").map(line => {
            const [hash, author, time, message, refs] = line.split("|");
            const branches = refs ? refs.split(", ").filter(r => 
              r.includes("HEAD") || r.startsWith("origin/") || (!r.includes("tag:") && !r.includes("HEAD"))
            ).map(r => r.replace("HEAD -> ", "").replace("origin/", "").trim()) : [];
            
            return {
              hash: hash.substring(0, 7),
              author,
              time,
              message,
              branches: branches.filter(b => b)
            };
          });
        }
      } catch (e) {
        console.log("[Git Panel] Could not fetch commit history:", e.message);
      }

      console.log("[Git Panel] Commits:", commits.length);

      // Store the git root for future operations
      this.gitRoot = gitRoot;

      this.sendMessage({
        type: "updateStatus",
        branch,
        staged,
        unstaged,
        conflicts,
        commits,
        gitRoot: gitRoot,
      });
    } catch (error) {
      console.error("[Git Panel] Error during refresh:", error.message);
      if (error.message.includes("not a git repository")) {
        this.sendMessage({
          type: "noRepo",
          workspacePath: workspaceFolder,
        });
      } else {
        this.sendMessage({
          type: "error",
          text: `Git error: ${error.message}`,
        });
      }
    }
  }

  sendMessage(msg) {
    if (this.panel) {
      this.panel.webview.postMessage(msg);
    }
  }

  getHtmlContent() {
    return fs.readFileSync(
      path.join(__dirname, "git-panel.html"),
      "utf8"
    );
  }
}

module.exports = GitPanel;
