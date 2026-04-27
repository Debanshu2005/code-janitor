const vscode = require("vscode")
const ChatPanel = require("./ai-agent/chat-panel")
const GitPanel = require("./source-control/git-panel")
const GraphifyPanel = require("./graphify/graphify-panel")

function registerLegacyAlias(context, alias, handler) {
  const disposable = vscode.commands.registerCommand(alias, async () => {
    console.log(`[Code Janitor Arduino] Legacy command triggered: ${alias}`)
    return handler()
  })

  context.subscriptions.push(disposable)
  console.log(`[Code Janitor Arduino] Legacy alias registered: ${alias}`)
}

function activate(context) {
  console.log("[Code Janitor Arduino] Extension activation started...")

  const chatPanel = new ChatPanel(context)
  const gitPanel = new GitPanel(context)
  const graphifyPanel = new GraphifyPanel(context)

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "codeJanitorArduino.welcomeSidebar",
      chatPanel,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  )

  console.log("[Code Janitor Arduino] Registering commands...")

  const openWelcomeCommand = vscode.commands.registerCommand(
    "codeJanitorArduino.openWelcome",
    () => {
      console.log("[Code Janitor Arduino] openWelcome command triggered")
      chatPanel.showWelcome()
    }
  )

  const openChatCommand = vscode.commands.registerCommand(
    "codeJanitorArduino.openChat",
    () => {
      console.log("[Code Janitor Arduino] openChat command triggered")
      chatPanel.show()
    }
  )

  const openGitCommand = vscode.commands.registerCommand(
    "codeJanitorArduino.openSourceControl",
    () => {
      console.log("[Code Janitor Arduino] openSourceControl command triggered")
      gitPanel.show()
    }
  )

  const openGraphifyCommand = vscode.commands.registerCommand(
    "codeJanitorArduino.openGraphify",
    () => {
      console.log("[Code Janitor Arduino] openGraphify command triggered")
      graphifyPanel.show()
    }
  )

  context.subscriptions.push(openWelcomeCommand)
  context.subscriptions.push(openChatCommand)
  context.subscriptions.push(openGitCommand)
  context.subscriptions.push(openGraphifyCommand)

  // Keep older command ids working so stale keybindings or UI actions in VS Code
  // continue to open the Arduino panels after the command namespace change.
  registerLegacyAlias(context, "codeJanitor.openChat", () => chatPanel.show())
  registerLegacyAlias(context, "codeJanitor.openSourceControl", () =>
    gitPanel.show()
  )
  registerLegacyAlias(context, "codeJanitor.openGraphify", () =>
    graphifyPanel.show()
  )

  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri) {
      console.log("[Code Janitor Arduino] URI handler triggered:", uri.path)
      if (uri.path === "/open-welcome") {
        chatPanel.showWelcome()
      } else if (uri.path === "/open-chat") {
        chatPanel.show()
      } else if (uri.path === "/open-git") {
        gitPanel.show()
      } else if (uri.path === "/open-graphify") {
        graphifyPanel.show()
      }
    }
  })

  context.subscriptions.push(uriHandler)

  // Show welcome screen on first install
  const hasSeenWelcome = context.globalState.get("codeJanitorArduino.seenWelcome", false)
  if (!hasSeenWelcome) {
    context.globalState.update("codeJanitorArduino.seenWelcome", true)
    chatPanel.showWelcome()
  }

  console.log("[Code Janitor Arduino] Extension activated successfully!")
  console.log("[Code Janitor Arduino] Commands registered:")
  console.log("  - codeJanitorArduino.openWelcome")
  console.log("  - codeJanitorArduino.openChat")
  console.log("  - codeJanitorArduino.openSourceControl")
  console.log("  - codeJanitorArduino.openGraphify")
  console.log("  - codeJanitor.openChat (legacy alias)")
  console.log("  - codeJanitor.openSourceControl (legacy alias)")
  console.log("  - codeJanitor.openGraphify (legacy alias)")
  console.log("[Code Janitor Arduino] Use Ctrl+Alt+A to open the welcome screen")
}

function deactivate() {}

module.exports = { activate, deactivate }
