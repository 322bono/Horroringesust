const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

function ensureCert() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
  }

  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  const attrs = [{ name: 'commonName', value: 'horror-tag.local' }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  });

  fs.writeFileSync(KEY_PATH, pems.private);
  fs.writeFileSync(CERT_PATH, pems.cert);

  return { key: pems.private, cert: pems.cert };
}

if (require.main === module) {
  ensureCert();
  console.log('인증서 생성 완료:', CERT_DIR);
}

module.exports = { ensureCert, KEY_PATH, CERT_PATH };
