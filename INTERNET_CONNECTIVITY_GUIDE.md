# Internet Connectivity - Quick Reference Guide

## 🌐 Overview

Code Janitor now has **internet connectivity**! The AI agent can fetch information from the web when you need current data, documentation, or external resources.

## 🚀 How to Use

### Simple Requests

Just ask naturally - the agent knows when to fetch from the web:

```
"What's the latest version of React?"
"Check if this API is working: https://api.example.com/status"
"Get the current npm package info for TypeScript"
"Is this URL accessible: https://example.com"
```

### What the Agent Can Fetch

✅ **Package Information**
- npm registry data
- Package versions
- Dependencies

✅ **API Endpoints**
- REST API responses
- Status checks
- Public APIs

✅ **Documentation**
- README files from GitHub
- API documentation
- Public web pages

✅ **Current Data**
- Latest versions
- Recent releases
- Public information

## 📋 Examples

### Check Package Version
```
You: "What's the latest Express.js version?"

Agent: Let me check the npm registry.
FETCH: https://registry.npmjs.org/express/latest

The latest version of Express.js is 4.18.2
```

### Test API Endpoint
```
You: "Is this API working? https://jsonplaceholder.typicode.com/posts/1"

Agent: Let me test that endpoint.
FETCH: https://jsonplaceholder.typicode.com/posts/1

Yes, the API is working! Here's the response: {...}
```

### Get Documentation
```
You: "Show me the README for axios on GitHub"

Agent: I'll fetch that for you.
FETCH: https://raw.githubusercontent.com/axios/axios/master/README.md

Here's the axios README: {...}
```

## 🔒 Safety Features

### Size Limits
- Maximum 500KB per request
- Prevents memory issues
- Large responses are truncated

### Timeout Protection
- 10-second timeout
- Prevents hanging requests
- Fast failure on slow servers

### URL Validation
- Only http:// and https:// allowed
- No file:// or other protocols
- Secure by default

### Error Handling
- Clear error messages
- No silent failures
- User-friendly feedback

## 💡 Tips

### When to Use
- ✅ Need current/latest information
- ✅ Checking package versions
- ✅ Testing API endpoints
- ✅ Verifying URLs
- ✅ Getting documentation

### When NOT to Use
- ❌ Information already in training data
- ❌ Private/authenticated APIs (no auth support yet)
- ❌ Large file downloads (500KB limit)
- ❌ Binary files (optimized for text)

## 🎯 Best Practices

### Be Specific
```
Good: "What's the latest version of React from npm?"
Better: "Check https://registry.npmjs.org/react/latest"
```

### Use Public APIs
```
✅ npm registry
✅ GitHub raw content
✅ Public REST APIs
✅ Documentation sites
```

### Expect Truncation
Large responses (>2000 chars) are truncated for readability in chat.

## 🔧 Technical Details

### Supported Protocols
- `http://` - HTTP requests
- `https://` - HTTPS requests (recommended)

### Request Method
- GET only (no POST/PUT/DELETE yet)

### Response Format
- Text content displayed in chat
- Size information shown
- Truncated to 2000 chars for display

### Limitations
- No authentication headers
- No custom headers
- No request body
- No redirect following
- No cookie handling

## 📊 Status Messages

### During Fetch
```
🔍 Fetching from web: https://example.com
```

### On Success
```
✅ Fetched https://example.com (1234 bytes):
{data preview...}
```

### On Error
```
❌ Failed to fetch https://example.com: HTTP 404: Not Found
```

## 🆘 Troubleshooting

### "Request timeout"
- Server is too slow (>10 seconds)
- Try a different endpoint
- Check if server is online

### "Response too large"
- Response exceeds 500KB
- Use a more specific endpoint
- Request summary instead of full data

### "HTTP 404"
- URL doesn't exist
- Check URL spelling
- Verify endpoint is public

### "HTTP 403/401"
- Authentication required
- Use public endpoints instead
- No auth support yet

## 🎓 Learning Examples

### Example 1: Check npm Package
```
User: "Is lodash still maintained? What's the latest version?"

Agent: FETCH: https://registry.npmjs.org/lodash/latest

Yes! Lodash is actively maintained. Latest version is 4.17.21
```

### Example 2: Test API
```
User: "Test this API: https://api.github.com/users/github"

Agent: FETCH: https://api.github.com/users/github

API is working! Response shows GitHub user data with 1000+ repos.
```

### Example 3: Get Documentation
```
User: "What does the Vite README say about getting started?"

Agent: FETCH: https://raw.githubusercontent.com/vitejs/vite/main/README.md

According to the README, you can get started with:
npm create vite@latest
```

## 🚦 Quick Status Check

To verify internet connectivity is working:

```
You: "Fetch https://httpbin.org/get"

Agent: FETCH: https://httpbin.org/get
✅ Fetched successfully - shows request details
```

---

## 📝 Summary

**Code Janitor can now access the internet!**

- 🌐 Fetch web content automatically
- 📦 Check package versions
- 🔍 Test API endpoints
- 📚 Get documentation
- 🔒 Safe and secure
- ⚡ Fast and efficient

Just ask naturally - the agent knows when to fetch from the web!
