# Using Code Janitor for Current Affairs & News

## Quick Start
Code Janitor AI can now answer questions about current events, news, and time-sensitive topics by automatically fetching information from reliable news sources.

## How to Use

### Ask About Current Events
Simply ask your question naturally:
```
"How's the war with Iran going on?"
"What's the latest news about the election?"
"Tell me about current events in politics"
"What's happening in the Middle East?"
```

### What Happens
1. Code Janitor detects your news-related question
2. Automatically fetches latest information from Reuters or BBC News
3. Displays the fetched content
4. Provides a summary or discussion based on the information

## Example Conversation

**You:** How's the war with Iran going on?

**Code Janitor:** 
```
FETCH: https://www.reuters.com
[Fetching latest news from Reuters...]
[Content displayed: Latest headlines and articles about Iran]

Based on the latest news from Reuters, here's the current situation...
```

## Supported Topics
- **Current Events**: Breaking news, ongoing situations
- **Politics**: Elections, government actions, policy changes
- **Conflicts**: Wars, international tensions, diplomatic issues
- **General News**: Any time-sensitive information

## News Sources
Code Janitor fetches from trusted sources:
- **Reuters**: Global news coverage
- **BBC News**: International news and analysis

## Tips
1. **Be Specific**: "What's happening with the Ukraine conflict?" is better than "Tell me news"
2. **Ask Follow-ups**: You can ask for more details or clarification
3. **Combine with Coding**: You can switch between news questions and coding tasks seamlessly

## Limitations
- Fetches from public news sites (no paywalled content)
- Limited to 500KB per fetch (sufficient for news articles)
- 10-second timeout per request
- No authentication support (public sources only)

## Privacy
- All fetches are direct HTTP/HTTPS requests
- No data is stored or logged
- Fetched content is displayed to you immediately
- No tracking or analytics

## Troubleshooting

### "Request timeout"
- News site took too long to respond
- Try asking again or rephrase your question

### "Response too large"
- Fetched content exceeded 500KB limit
- This is rare for news articles
- Try asking for a specific topic instead of general news

### Still Getting "I Don't Know" Response
- Make sure you're using version 1.9.5 or later
- Check that your AI provider is properly configured
- Try being more explicit: "Fetch the latest news about..."

## Examples

### Politics
```
"What's the latest on the US election?"
"Tell me about recent political developments in Europe"
```

### International Affairs
```
"What's happening with the conflict in Gaza?"
"Give me an update on tensions between China and Taiwan"
```

### General News
```
"What are the top news stories today?"
"What's the latest breaking news?"
```

## Switching Back to Coding
After getting news updates, simply ask your coding questions:
```
"Now help me fix this Python error..."
"Can you review my JavaScript code?"
```

Code Janitor seamlessly switches between news and coding assistance!

## Version
This feature is available in Code Janitor version 1.9.5 and later.

## Feedback
If you encounter issues or have suggestions for improving news fetching, please report them on the GitHub repository.
