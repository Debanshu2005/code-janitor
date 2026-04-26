// Test script to diagnose NVIDIA API 404 error
// Run with: node test-nvidia-api.js YOUR_API_KEY

const apiKey = process.argv[2];

if (!apiKey) {
  console.error('Usage: node test-nvidia-api.js YOUR_API_KEY');
  process.exit(1);
}

async function testNvidiaAPI() {
  console.log('Testing NVIDIA NIM API...\n');

  // Test 1: Original configuration
  console.log('Test 1: nvidia/minimax-m2.7');
  await testModel('https://integrate.api.nvidia.com/v1/chat/completions', 'nvidia/minimax-m2.7', apiKey);

  // Test 2: Without nvidia/ prefix
  console.log('\nTest 2: minimax-m2.7 (without prefix)');
  await testModel('https://integrate.api.nvidia.com/v1/chat/completions', 'minimax-m2.7', apiKey);

  // Test 3: Try meta-llama model
  console.log('\nTest 3: meta/llama-3.1-8b-instruct');
  await testModel('https://integrate.api.nvidia.com/v1/chat/completions', 'meta/llama-3.1-8b-instruct', apiKey);

  // Test 4: List available models
  console.log('\nTest 4: Listing available models');
  await listModels(apiKey);
}

async function testModel(url, model, apiKey) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say hello' }
        ],
        stream: false,
        max_tokens: 50
      })
    });

    console.log(`  Status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log(`  Error: ${errorText.substring(0, 200)}`);
    } else {
      const data = await response.json();
      console.log(`  Success! Response: ${JSON.stringify(data).substring(0, 100)}...`);
    }
  } catch (error) {
    console.log(`  Exception: ${error.message}`);
  }
}

async function listModels(apiKey) {
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    console.log(`  Status: ${response.status} ${response.statusText}`);
    
    if (response.ok) {
      const data = await response.json();
      console.log(`  Available models: ${JSON.stringify(data, null, 2)}`);
    } else {
      const errorText = await response.text();
      console.log(`  Error: ${errorText}`);
    }
  } catch (error) {
    console.log(`  Exception: ${error.message}`);
  }
}

testNvidiaAPI();
