import re

with open('d:/CityGrid/my-project/code-janitor/src/extension.js', 'r', encoding='utf-8') as f:
    content = f.read()

new_command = '''  // 1. Manual Fix Command - Opens AI Chat with Fix Action
  const fixDisposable = vscode.commands.registerCommand(
    "codeJanitor.fixCode",
    async () => {
      // Open AI chat panel
      await vscode.commands.executeCommand("codeJanitor.openAIChat");
      
      // Wait for panel to initialize
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Trigger the fix action
      if (global.aiChatPanel) {
        global.aiChatPanel.panel.webview.postMessage({ type: "triggerFix" });
      }
    }
  )
  context.subscriptions.push(fixDisposable)'''

pattern = r'  // 1\. Manual Fix Command with Syntax Check.*?context\.subscriptions\.push\(fixDisposable\)'
content = re.sub(pattern, new_command, content, flags=re.DOTALL)

with open('d:/CityGrid/my-project/code-janitor/src/extension.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Replacement complete")
