# Self-Healing AI Performance System

## Overview

Code Janitor includes an **automatic self-healing system** that monitors AI performance and optimizes settings when slow responses are detected.

## How It Works

### 1. Performance Monitoring
- Tracks every AI request (provider, model, duration, success/failure)
- Maintains rolling history of last 20 responses
- Calculates average response time and failure rate

### 2. Automatic Detection
When a response takes longer than **30 seconds** (configurable):
- Analyzes recent performance history
- Identifies patterns (slow model, high failure rate)
- Generates optimization recommendations

### 3. Auto-Optimization
Shows notification with options:
- **Auto-Fix Now**: Automatically applies optimizations
- **Show Details**: View detailed performance report
- **Disable Auto-Heal**: Turn off automatic optimization

### 4. Applied Optimizations

**Model Switching:**
- `minimaxai/minimax-m2.7` → `meta/llama-3.1-8b-instruct`
- `meta/llama-3.1-70b-instruct` → `meta/llama-3.1-8b-instruct`
- `llama-3.1-70b-versatile` → `llama-3.1-8b-instant`

**Timeout Adjustment:**
- Increases timeout by 50% (max 10 minutes)
- Only when high failure rate detected

## Configuration

```json
{
  "codeJanitor.ai.selfHealing.enabled": true,
  "codeJanitor.ai.selfHealing.slowThreshold": 30000
}
```

## Commands

**View Performance Report:**
- Command Palette → `Code Janitor: Show AI Performance Report`
- Shows detailed metrics and recommendations

## What Gets Logged

All auto-heal events are logged to:
```
~/.vscode/extensions/[extension-id]/globalStorage/auto-heal-log.json
```

Log includes:
- Timestamp
- Changes applied
- Model switches
- Timeout adjustments

## Limitations

### What Self-Healing CAN Do ✅
- Monitor response times
- Detect slow models
- Auto-switch to faster models
- Adjust timeout settings
- Log performance metrics
- Show performance reports

### What Self-Healing CANNOT Do ❌
- **Auto-redeploy to VS Code Marketplace** (requires manual publishing)
- **Self-modify extension code** (VS Code security restriction)
- **Auto-package VSIX** (requires elevated permissions)
- **Bypass VS Code security model** (intentional limitation)

## Why No Auto-Redeployment?

For security reasons, VS Code extensions **cannot**:
1. Modify their own code while running
2. Repackage themselves as VSIX
3. Publish to marketplace without human approval
4. Execute arbitrary system commands with elevated permissions

This is by design to prevent malicious extensions from:
- Self-replicating
- Escalating privileges
- Bypassing security checks
- Installing backdoors

## Manual Update Process

When self-healing detects issues that require code changes:

1. **Developer receives telemetry** (if enabled)
2. **Developer fixes code** in repository
3. **Developer publishes update** to marketplace
4. **VS Code auto-updates** extension for users

## Performance Metrics

View current performance:
```
Command Palette → Code Janitor: Show AI Performance Report
```

Metrics shown:
- Average response time
- Slow response count
- Failure rate
- Detected issues
- Recommendations

## Example Auto-Heal Flow

```
User sends request → MiniMax M2.7 takes 45 seconds
↓
Performance Monitor detects slow response
↓
Analyzes last 10 requests (avg: 38 seconds)
↓
Shows notification: "Auto-optimize settings?"
↓
User clicks "Auto-Fix Now"
↓
Switches to meta/llama-3.1-8b-instruct
↓
Logs change to auto-heal-log.json
↓
Shows confirmation: "Model switched"
```

## Disabling Self-Healing

**Temporarily:**
- Click "Disable Auto-Heal" in notification

**Permanently:**
```json
{
  "codeJanitor.ai.selfHealing.enabled": false
}
```

## Advanced: Custom Thresholds

Adjust sensitivity:
```json
{
  "codeJanitor.ai.selfHealing.slowThreshold": 45000  // 45 seconds
}
```

Lower = more aggressive optimization
Higher = more tolerant of slow responses

## Future Enhancements

Planned features:
- Machine learning for model selection
- A/B testing different models
- Predictive optimization
- Cloud-based telemetry (opt-in)
- Community performance benchmarks

## Privacy

All performance data is stored **locally only**:
- No data sent to external servers
- No telemetry by default
- Logs stored in VS Code global storage
- User has full control

## Troubleshooting

**Self-healing not working?**
1. Check setting: `codeJanitor.ai.selfHealing.enabled`
2. Verify threshold: `codeJanitor.ai.selfHealing.slowThreshold`
3. View logs: Command Palette → `Developer: Open Extension Logs Folder`

**Want to reset performance history?**
Delete: `~/.vscode/extensions/[extension-id]/globalStorage/performance-metrics.json`

## Contributing

Help improve self-healing:
1. Report slow models in GitHub issues
2. Suggest optimization strategies
3. Contribute model benchmarks
4. Test auto-heal on different systems
