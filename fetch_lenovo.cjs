const https = require('https');

https.get('https://psref.lenovo.com/l/Product/ThinkPad/ThinkPad_E16_Gen_4_Intel?tab=spec', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    const fs = require('fs');
    fs.writeFileSync('lenovo.html', data);
    console.log('Saved to lenovo.html');
  });
}).on('error', (err) => {
  console.log('Error: ' + err.message);
});
