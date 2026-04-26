# Self-Healing Quick Reference

## TL;DR

Code Janitor **automatically optimizes AI settings** when it detects slow responses. It **cannot** auto-redeploy to marketplace due to VS Code security restrictions.

## What Happens Automatically

1. **Monitors** every AI request
2. **Detects** slow responses (>30s)
3. **Analyzes** performance patterns
4. **Notifies** you with optimization options
5. **Applies** fixes when you approve
6. **Logs** all changes

## Quick Actions

### View Performance
```
Ctrl+Shift+P → Code Janitor: Show AI Performance Report
```

### Disable Self-Healing
```json
// settings.json
{
  "codeJanitor.ai.selfHealing.enabled": false
}
```

### Adjust Sensitivity
```json
{
  "codeJanitor.ai.selfHealing.slowThreshold": 45000  // 45 seconds
}
```

## Common Optimizations

| Issue | Auto-Fix |
|-------|----------|
| MiniMax M2.7 slow | Switch to llama-3.1-8b-instruct |
| High timeout rate | Increase timeout by 50% |
| Consistent failures | Switch provider |

## What Self-Healing CAN'T Do

❌ Auto-publish to VS Code Marketplace
❌ Modify extension source code
❌ Repackage VSIX automatically
❌ Execute arbitrary system commands

**Why?** VS Code security model prevents extensions from self-modifying.

## What Self-Healing CAN Do

✅ Monitor AI performance
✅ Switch to faster models
✅ Adjust timeout settings
✅ Optimize token limits
✅ Log all changes
✅ Show performance reports

## Files Created

```
~/.vscode/extensions/[extension-id]/globalStorage/
├── performance-metrics.json  (response times)
└── auto-heal-log.json        (optimization history)
```

## Example Flow

```
User: "Fix my code"
↓
AI: Takes 45 seconds (MiniMax M2.7)
↓
Notification: "Auto-optimize settings?"
↓
User: Clicks "Auto-Fix Now"
↓
Model switched to llama-3.1-8b-instruct
↓
Next request: 8 seconds ✅
```

## Troubleshooting

**Not working?**
1. Check: `codeJanitor.ai.selfHealing.enabled`
2. Verify threshold: `codeJanitor.ai.selfHealing.slowThreshold`
3. View logs: Developer Console

**Reset history?**
Delete: `~/.vscode/extensions/.../globalStorage/performance-metrics.json`

## Learn More

- [Full Documentation](./SELF_HEALING.md)
- [Technical Limits](./SELF_MODIFICATION_LIMITS.md)
- [GitHub Issues](https://github.com/Debanshu2005/code-janitor/issues)
