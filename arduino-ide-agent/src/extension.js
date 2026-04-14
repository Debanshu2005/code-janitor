const vscode = require("vscode")
const ChatPanel = require("./ai-agent/chat-panel")
const GitPanel = require("./source-control/git-panel")
const GraphifyPanel = require("./graphify/graphify-panel")

function activate(context) {
  const chatPanel = new ChatPanel(context)
  const gitPanel = new GitPanel(context)
  const graphifyPanel = new GraphifyPanel(context)

  const openChatCommand = vscode.commands.registerCommand(
    "codeJanitorArduino.openChat",
    () => chatPanel.show()
  )

  const openGitCommand = vscode.commands.registerCommand(
    "codeJanitorArduino.openSourceControl",
    () => gitPanel.show()
  )

  const openGraphifyCommand = vscode.commands.registerCommand(
    "codeJanitorArduino.openGraphify",
    () => graphifyPanel.show()
  )

  context.subscriptions.push(openChatCommand)
  context.subscriptions.push(openGitCommand)
  context.subscriptions.push(openGraphifyCommand)

  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri) {
      if (uri.path === "/open-chat") {
        chatPanel.show()
      } else if (uri.path === "/open-git") {
        gitPanel.show()
      } else if (uri.path === "/open-graphify") {
        graphifyPanel.show()
      }
    }
  })

  context.subscriptions.push(uriHandler)
  console.log("Code Janitor Arduino AI Agent activated")
}

function deactivate() {}

module.exports = { activate, deactivate }