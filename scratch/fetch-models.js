const fs = require('fs');
const path = require('path');
const settingsPath = path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');

if (fs.existsSync(settingsPath)) {
  const settings = fs.readFileSync(settingsPath, 'utf8');
  const match = settings.match(/"codeJanitor\.ai\.nvidiaApiKey"\s*:\s*"([^"]+)"/);
  if (match) {
    const key = match[1];
    fetch('https://integrate.api.nvidia.com/v1/models', { headers: { 'Authorization': 'Bearer ' + key } })
      .then(r => r.json())
      .then(d => {
        if(d.data) {
          console.log("MODELS:");
          console.log(d.data.map(m => m.id).join('\n'));
        } else {
          console.log('No data:', d);
        }
      })
      .catch(e => console.error(e));
  } else {
    console.log('No NVIDIA API key found in settings.');
  }
} else {
  console.log('No settings.json found.');
}
