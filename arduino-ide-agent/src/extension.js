const vscode = require("vscode")
const ChatPanel = require("./ai-agent/chat-panel")

function activate(context) {
  const chatPanel = new ChatPanel(context)

  const openChatCommand = vscode.commands.registerCommand(
    "codeJanitorArduino.openChat",
    () => chatPanel.show()
  )

  context.subscriptions.push(openChatCommand)

  const uriHandler = vscode.window.registerUriHandler({
    handleUri(uri) {
      if (uri.path === "/open-chat") {
        chatPanel.show()
      }
    }
  })

  context.subscriptions.push(uriHandler)
  console.log("Code Janitor Arduino AI Agent activated")
}

function deactivate() {}

module.exports = { activate, deactivate }