# Code Janitor Feature Roadmap

## Version 1.10.0 - Customizable Token Limits ✅ IMPLEMENTED

### Overview
Added user-configurable token limits for AI responses, allowing users to customize response length based on their needs and model capabilities.

### Implementation
- **Configuration Options** (package.json):
  - `codeJanitor.ai.maxTokens.fast`: Fast mode token limit (default: 2048, range: 512-4096)
  - `codeJanitor.ai.maxTokens.heavy`: Heavy mode token limit (default: 4096, range: 1024-8192)
  - `codeJanitor.ai.maxTokens.create`: Create mode token limit (default: 8192, range: 2048-16384)

- **Agent Updates** (agent.js):
  - Modified `getConfig()` to read and validate token limits
  - Updated `_buildRequestOptions()` to use configured limits
  - Maintained MiniMax M2.7 optimization (reduced tokens for slow model)

### Benefits
- Users can increase token limits for more detailed responses
- Users can decrease token limits to reduce costs or improve speed
- Flexibility for different use cases and model capabilities
- Maintains backward compatibility with default values

### Usage
```json
{
  "codeJanitor.ai.maxTokens.fast": 3072,
  "codeJanitor.ai.maxTokens.heavy": 6144,
  "codeJanitor.ai.maxTokens.create": 12288
}
```

---

## Planned Features

### Priority 1: High Impact, Quick Implementation

#### 1.1 Enhanced Code Analysis and Recommendations ⏳ PLANNED
**Status**: Not Started  
**Estimated Effort**: Medium (2-3 weeks)  
**Impact**: High

**Features**:
- Code smell detection (long methods, god classes, duplicate code)
- Security vulnerability scanning (SQL injection, XSS, CSRF)
- Performance optimization suggestions (N+1 queries, inefficient loops)
- Best practices recommendations (SOLID principles, design patterns)

**Implementation Plan**:
1. Integrate ESLint security plugins
2. Add custom code analysis rules
3. Implement pattern matching for common issues
4. Create actionable recommendations with fix suggestions

**Dependencies**: None

---

#### 1.2 Support for More Programming Languages ⏳ PLANNED
**Status**: Not Started  
**Estimated Effort**: Medium (2-3 weeks)  
**Impact**: High

**Current Support**: Python, JavaScript, Java, C/C++, Arduino, HTML, CSS, JSON, Markdown, SVG, Vue, Svelte

**Planned Additions**:
- **TypeScript**: Full syntax checking and formatting
- **Rust**: Cargo integration, rustfmt support
- **Go**: gofmt integration, syntax checking
- **Ruby**: RuboCop integration
- **PHP**: PHP-CS-Fixer integration
- **Kotlin**: ktlint integration
- **Swift**: SwiftLint integration
- **Scala**: Scalafmt integration

**Implementation Plan**:
1. Add language-specific formatters to `src/core/fixers/`
2. Update syntax checking in agent.js
3. Add language detection and routing
4. Create language-specific configuration options

**Dependencies**: Language-specific formatter binaries

---

#### 1.3 Improved Model Selection ⏳ PLANNED
**Status**: Not Started  
**Estimated Effort**: Small (1 week)  
**Impact**: Medium

**Features**:
- Dynamic model selection based on task complexity
- Model performance tracking and recommendations
- Automatic fallback to faster models on timeout
- Model capability matrix (which models support which features)

**Implementation Plan**:
1. Create model capability registry
2. Implement task complexity analyzer
3. Add model selection logic based on task type
4. Integrate with performance monitor

**Dependencies**: Performance monitor (already implemented)

---

### Priority 2: Medium Impact, Moderate Implementation

#### 2.1 Support for Multi-Language Projects ⏳ PLANNED
**Status**: Not Started  
**Estimated Effort**: Medium (2 weeks)  
**Impact**: Medium

**Features**:
- Detect and handle multiple languages in single project
- Language-specific context switching
- Cross-language dependency analysis
- Multi-language code generation

**Implementation Plan**:
1. Enhance workspace scanner to track language distribution
2. Update context builder to include multi-language awareness
3. Modify system instructions for multi-language projects
4. Add language-specific action routing

**Dependencies**: Enhanced workspace scanning

---

#### 2.2 Enhanced Error Handling ⏳ PLANNED
**Status**: Partially Implemented (Self-diagnosing error handler exists)  
**Estimated Effort**: Small (1 week)  
**Impact**: Medium

**Current State**: Self-diagnosing error handler for file operations

**Enhancements**:
- Network error recovery with exponential backoff
- API rate limit handling and queuing
- Graceful degradation on partial failures
- User-friendly error messages with actionable steps
- Error telemetry and analytics (opt-in)

**Implementation Plan**:
1. Extend error handler to cover network errors
2. Add retry logic with exponential backoff
3. Implement rate limit detection and queuing
4. Create error message templates
5. Add opt-in telemetry

**Dependencies**: None

---

#### 2.3 Improved User Interface and Experience ⏳ PLANNED
**Status**: Not Started  
**Estimated Effort**: Large (3-4 weeks)  
**Impact**: Medium

**Features**:
- Syntax highlighting in chat responses
- Code diff viewer for proposed changes
- Interactive code suggestions (accept/reject)
- Progress indicators for long operations
- Keyboard shortcuts for common actions
- Dark/light theme support
- Customizable chat panel layout

**Implementation Plan**:
1. Enhance chat panel HTML/CSS
2. Add Monaco editor integration for code display
3. Implement diff viewer component
4. Add interactive action buttons
5. Create theme system
6. Add keyboard shortcut manager

**Dependencies**: Monaco editor library

---

### Priority 3: Advanced Features, Longer Implementation

#### 3.1 Integration with Other Tools and Services ⏳ PLANNED
**Status**: Not Started  
**Estimated Effort**: Large (4-6 weeks)  
**Impact**: High

**Planned Integrations**:
- **GitHub**: PR review, issue creation, commit suggestions
- **GitLab**: Similar to GitHub integration
- **Jira**: Issue tracking, task creation
- **Slack**: Notifications, bot commands
- **Discord**: Similar to Slack integration
- **Jenkins/CircleCI**: CI/CD pipeline integration
- **Docker**: Container management, Dockerfile generation
- **Kubernetes**: Deployment configuration

**Implementation Plan**:
1. Create integration framework
2. Implement OAuth/API key management
3. Add per-integration modules
4. Create unified action system
5. Add configuration UI

**Dependencies**: OAuth library, API clients

---

#### 3.2 Continuous Integration and Deployment (CI/CD) Integration ⏳ PLANNED
**Status**: Not Started  
**Estimated Effort**: Large (3-4 weeks)  
**Impact**: Medium

**Features**:
- Automatic code quality checks in CI pipeline
- Pre-commit hooks for formatting and linting
- Automated test generation and execution
- Deployment configuration generation
- Build optimization suggestions

**Implementation Plan**:
1. Create CI/CD configuration templates
2. Add pre-commit hook installer
3. Implement test generation logic
4. Add deployment config generator
5. Create CI/CD action commands

**Dependencies**: Git hooks, CI/CD platform APIs

---

#### 3.3 Enhanced Collaboration Features ⏳ PLANNED
**Status**: Not Started  
**Estimated Effort**: Large (4-5 weeks)  
**Impact**: Medium

**Features**:
- Real-time code sharing (Live Share integration)
- Code review comments and annotations
- @mentions for team members
- Shared AI chat sessions
- Team knowledge base integration
- Code snippet library

**Implementation Plan**:
1. Integrate with VS Code Live Share API
2. Create comment/annotation system
3. Add user management
4. Implement shared session protocol
5. Create knowledge base storage
6. Add snippet library UI

**Dependencies**: VS Code Live Share API, database for shared data

---

## Completed Features

### Version 1.9.5 - Current Affairs Awareness ✅
- AI can fetch and discuss current events and news
- Automatic detection of news-related queries
- Integration with reliable news sources (Reuters, BBC)

### Version 1.9.4 - Performance Optimization ✅
- Restored original token limits for all models except MiniMax M2.7
- Fixed performance slowdown issue

### Version 1.9.3 - Internet Connectivity ✅
- Full internet access via FETCH action
- HTTP/HTTPS support with size limits and timeout protection

### Version 1.9.2 - Auto-Heal Improvements ✅
- Prevented auto-heal notifications from interrupting LLM responses
- Added duplicate prevention for auto-heal triggers

### Version 1.9.1 - Auto-Heal Provider Switching ✅
- Fixed auto-optimization to properly switch both provider and model
- Improved provider detection and configuration updates

### Version 1.9.0 - Performance Monitor ✅
- Fixed model name mapping for NVIDIA models
- Improved performance tracking and optimization

### Version 1.8.0 - Post-Edit Verification ✅
- Language-specific syntax checking
- Optimized lint execution for changed files only

### Version 1.7.5 - NVIDIA 404 Fix ✅
- Fixed incorrect default NVIDIA model names
- Corrected model configuration across all locations

---

## Feature Request Process

### How to Request Features
1. Open an issue on GitHub: https://github.com/Debanshu2005/code-janitor/issues
2. Use the "Feature Request" template
3. Provide detailed description and use cases
4. Include examples if applicable

### Prioritization Criteria
1. **User Impact**: How many users will benefit?
2. **Implementation Effort**: How long will it take?
3. **Alignment**: Does it fit Code Janitor's mission?
4. **Dependencies**: Are there blockers?
5. **Community Interest**: How many upvotes/comments?

### Development Timeline
- **Priority 1 Features**: 1-3 months
- **Priority 2 Features**: 3-6 months
- **Priority 3 Features**: 6-12 months

---

## Contributing

We welcome contributions! Here's how you can help:

1. **Code Contributions**: Pick a feature from the roadmap and submit a PR
2. **Testing**: Test new features and report bugs
3. **Documentation**: Improve docs and create tutorials
4. **Feature Requests**: Suggest new features with detailed use cases
5. **Community Support**: Help other users in issues and discussions

### Development Setup
```bash
git clone https://github.com/Debanshu2005/code-janitor.git
cd code-janitor
npm install
code .
```

Press F5 to launch extension in debug mode.

---

## Version History

| Version | Release Date | Key Features |
|---------|-------------|--------------|
| 1.10.0  | TBD         | Customizable token limits |
| 1.9.5   | 2024        | Current affairs awareness |
| 1.9.4   | 2024        | Performance optimization |
| 1.9.3   | 2024        | Internet connectivity |
| 1.9.2   | 2024        | Auto-heal improvements |
| 1.9.1   | 2024        | Auto-heal provider switching |
| 1.9.0   | 2024        | Performance monitor fixes |
| 1.8.0   | 2024        | Post-edit verification |
| 1.7.5   | 2024        | NVIDIA 404 fix |

---

## Feedback and Support

- **GitHub Issues**: https://github.com/Debanshu2005/code-janitor/issues
- **Website**: https://code-janitor-web.vercel.app/
- **Email**: support@code-janitor.dev (if available)

---

## License

MIT License - See LICENSE file for details
