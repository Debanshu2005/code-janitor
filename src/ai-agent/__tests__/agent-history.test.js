/* eslint-env jest */

jest.mock(
  "vscode",
  () => ({
    window: {
      activeTextEditor: null,
      onDidChangeActiveTextEditor: jest.fn()
    },
    workspace: {
      workspaceFolders: [],
      textDocuments: [],
      getWorkspaceFolder: jest.fn()
    }
  }),
  { virtual: true }
);

const vscode = require("vscode");
const AIAgent = require("../agent");

describe("AIAgent History", () => {
  let agent;

  beforeEach(() => {
    agent = new AIAgent({
      globalState: {
        get: jest.fn(),
        update: jest.fn()
      }
    });
  });

  test("recalls details from turn 2 in turn 5 by keeping a large enough raw window", () => {
    agent._appendConversationEntry("user", "Turn 1: hello");
    agent._appendConversationEntry("assistant", "Hi");
    agent._appendConversationEntry("user", "Turn 2: I have a secret token 12345");
    agent._appendConversationEntry("assistant", "Got it");
    agent._appendConversationEntry("user", "Turn 3: What is the weather");
    agent._appendConversationEntry("assistant", "Sunny");
    agent._appendConversationEntry("user", "Turn 4: Random question");
    agent._appendConversationEntry("assistant", "Random answer");
    
    // Now simulating turn 5 request
    // _buildPromptHistoryContext(false) will be called to build context
    const historyContext = agent._buildPromptHistoryContext(false);
    expect(historyContext).toContain("secret token 12345");
  });

  test("does not silently truncate long history entries mid-sentence at 300 chars", () => {
    const longText = "A".repeat(290) + " THIS IS THE CRITICAL PART AT THE END OF THE LONG MESSAGE " + "B".repeat(100);
    agent._appendConversationEntry("user", longText);
    agent._appendConversationEntry("assistant", "Ok");
    
    const historyContext = agent._buildPromptHistoryContext(false);
    expect(historyContext).toContain("THIS IS THE CRITICAL PART AT THE END OF THE LONG MESSAGE");
  });

  test("compacts history into session summary once raw window is exceeded without gaps", () => {
    // Fill up history past the raw window size
    // MAX_SESSION_RECENT_ENTRIES is 8 (4 exchanges). We need to exceed this to trigger compaction.
    for (let i = 1; i <= 6; i++) {
      agent._appendConversationEntry("user", `Message user ${i}`);
      agent._appendConversationEntry("assistant", `Message assistant ${i}`);
    }

    const session = agent._getCurrentSession();
    // 6 turns = 12 entries. Compaction should have triggered since 12 > 8
    expect(session.summary).toBeDefined();
    // The first few messages should now be in the summary since they fell out of the recent 8
    expect(session.summary).toContain("Message user 1");
    expect(session.summary).toContain("Message assistant 1");
    expect(session.summary).toContain("Message user 2");
    
    // Recent messages should be in the raw window
    const historyContext = agent._buildPromptHistoryContext(false);
    expect(historyContext).toContain("Message user 6");
  });
});
