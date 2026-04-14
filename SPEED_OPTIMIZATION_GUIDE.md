# Speed Optimization Guide

## Current Optimizations (v1.4.4)

### Applied Settings:
- **Temperature**: 0.7 (faster generation)
- **Context Window**: 2048 tokens (reduced from 4096)
- **top_k**: 3 (fewer candidates to evaluate)
- **top_p**: 0.95 (diverse sampling)
- **repeat_penalty**: 1.1 (prevents loops)
- **Timeout**: 2 minutes (fails faster if stuck)

### Smart Token Limits:
- **Code tasks** (create/edit/debug/refactor): 2048 (fast), 4096 (heavy)
- **Chat/explain**: 512 (fast), 2048 (heavy)

## Further Speed Improvements

### 1. Use GPU Acceleration (Fastest)
If you have NVIDIA GPU:
```bash
# Check if GPU is being used
ollama ps

# If not using GPU, reinstall Ollama with CUDA support
# Download from: https://ollama.com/download
```

### 2. Switch to Faster Models
Current: `qwen2.5-coder:1.5b` (1.5B parameters)

Even faster options:
```bash
# Tiny but fast (500M params)
ollama pull phi:latest

# Balanced (1B params)
ollama pull tinyllama:latest
```

### 3. Preload Model (Eliminates First-Request Delay)
```bash
# Keep model in memory
ollama run qwen2.5-coder:1.5b
# Press Ctrl+D to exit but keep loaded
```

### 4. Increase Ollama Concurrency
Edit Ollama config to use more CPU cores:
```bash
# Windows: Set environment variable
OLLAMA_NUM_PARALLEL=4
OLLAMA_MAX_LOADED_MODELS=1
```

### 5. Use Cloud Providers (Instant Responses)
Switch provider in Code Janitor settings:
- **Groq** (free, very fast): llama-3.1-8b-instant
- **OpenRouter** (free tier): qwen/qwen3-coder:free
- **NVIDIA NIM** (free): nvidia/minimax-m2.7

## Benchmark Results

| Model | Hardware | Speed |
|-------|----------|-------|
| qwen2.5-coder:1.5b | CPU only | 5-10 tokens/sec |
| qwen2.5-coder:1.5b | GPU (RTX 3060) | 40-60 tokens/sec |
| Groq (cloud) | N/A | 200+ tokens/sec |

## Troubleshooting Slow Responses

1. **Check if model is loaded**:
   ```bash
   ollama ps
   ```

2. **Test connection**:
   Type `/ping` in Code Janitor AI chat

3. **Monitor resource usage**:
   - Task Manager → Performance
   - If CPU at 100%, model is working
   - If idle, connection issue

4. **Restart Ollama**:
   ```bash
   # Windows
   taskkill /F /IM ollama.exe
   ollama serve
   ```

## Recommended Setup for Best Speed

1. **Hardware**: GPU with 4GB+ VRAM
2. **Model**: qwen2.5-coder:1.5b (preloaded)
3. **Settings**: Fast mode (default)
4. **Alternative**: Groq cloud provider (instant)
