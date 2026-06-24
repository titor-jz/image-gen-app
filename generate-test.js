const net = require('net');
const https = require('https');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const proxyHost = '127.0.0.1';
const proxyPort = 7897;

function proxyRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const socket = net.connect({ host: proxyHost, port: proxyPort }, () => {
      socket.write(`CONNECT ${parsed.hostname}:${parsed.port || 443} HTTP/1.1\r\nHost: ${parsed.hostname}:${parsed.port || 443}\r\n\r\n`);
    });

    let buf = '';
    socket.on('data', (data) => {
      buf += data.toString();
      if (buf.includes('\r\n\r\n')) {
        if (buf.includes('200')) {
          const tlsSocket = tls.connect({ socket, servername: parsed.hostname, rejectUnauthorized: false }, () => {
            const req = https.request({
              createConnection: () => tlsSocket,
              hostname: parsed.hostname,
              port: parsed.port || 443,
              path: parsed.pathname + parsed.search,
              method: options.method || 'GET',
              headers: options.headers || {},
              rejectUnauthorized: false
            }, (res) => {
              const chunks = [];
              res.on('data', chunk => chunks.push(chunk));
              res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({ status: res.statusCode, buffer });
              });
            });
            req.on('error', reject);
            if (options.body) req.write(options.body);
            req.end();
          });
        } else {
          reject(new Error('Tunnel failed: ' + buf.split('\r\n')[0]));
        }
      }
    });
    socket.on('error', reject);
  });
}

async function main() {
  const genBody = JSON.stringify({
    model: 'gpt-image-2',
    prompt: 'a cute cat sitting on a windowsill, sunlight streaming in, photorealistic',
    size: '1024x1024',
    quality: 'medium',
    response_format: 'url'
  });

  console.log('Generating image...');
  const genRes = await proxyRequest('https://www.kuaiaiapi.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-s7J46W3kAnrsIbkgSDgrFy3ATmRpahkafekWoriQ4dRNx2OY',
      'Content-Length': String(Buffer.byteLength(genBody))
    },
    body: genBody
  });

  console.log('Status:', genRes.status);
  const data = JSON.parse(genRes.buffer.toString());
  
  if (data.data && data.data[0] && data.data[0].url) {
    console.log('Image URL:', data.data[0].url);
    
    console.log('Downloading image...');
    const imgRes = await proxyRequest(data.data[0].url);
    
    const outputPath = path.join('d:\\jz\\project\\image-gen-app', 'test-output.png');
    fs.writeFileSync(outputPath, imgRes.buffer);
    console.log('Image saved to:', outputPath);
    console.log('File size:', imgRes.buffer.length, 'bytes');
    
    const isPng = imgRes.buffer[0] === 0x89 && imgRes.buffer[1] === 0x50 && imgRes.buffer[2] === 0x4E && imgRes.buffer[3] === 0x47;
    console.log('Valid PNG:', isPng);
  } else {
    console.log('No image:', JSON.stringify(data).substring(0, 300));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
