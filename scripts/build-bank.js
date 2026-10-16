// Parses the raw exam text in data/raw (never committed) and writes bank.enc,
// an AES-256-GCM encrypted copy the server decrypts with BANK_KEY.
//   node scripts/build-bank.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const P = require('../lib/parse');

const ROOT = path.join(__dirname, '..');
require('../lib/env')(path.join(ROOT, '.env'));

const SOURCES = [
  { id: 'icdc2010', label: 'ICDC 2010', file: 'icdc2010.layout.txt' },
  { id: 'icdc2011', label: 'ICDC 2011', file: 'paste1.txt' },
  { id: 'icdc2012', label: 'ICDC 2012', file: 'icdc2012.layout.txt' },
  { id: 'set2015', label: 'Exam 2015', file: 'paste3.txt' },
  { id: 'set2016', label: 'Exam 2016', file: 'paste2.txt' },
  { id: 's1121', label: 'Sample 2016', file: '1121.layout.txt' },
  { id: 's1141', label: 'Sample 2017', file: '1141.layout.txt' },
  { id: 's1161', label: 'Sample 2018 A', file: '1161.layout.txt' },
  { id: 's1177', label: 'Sample 2018 B', file: '1177.layout.txt' },
  { id: 's1221', label: 'Sample 2020', file: '1221.layout.txt' },
  { id: 's1245', label: 'Sample 2022', file: '1245.layout.txt' }
];

const exams = [];
for (const s of SOURCES) {
  const r = P.parseExam(fs.readFileSync(path.join(ROOT, 'data/raw', s.file), 'utf8'), s);
  exams.push({ id: s.id, label: s.label, items: r.items });
  console.log(`${s.id.padEnd(9)} found ${String(r.found).padStart(3)}  parsed ${String(r.items.length).padStart(3)}  errors ${r.errors.length}` +
    (r.errors.length ? '  ' + r.errors.slice(0, 3).join(' | ') : ''));
}

const bank = P.buildBank(exams);
const areas = {};
bank.questions.forEach((q) => { areas[q.ar] = (areas[q.ar] || 0) + 1; });
console.log(`unique questions ${bank.questions.length}, key terms ${bank.terms.length}`);
console.log('areas', JSON.stringify(areas));
fs.writeFileSync(path.join(ROOT, 'data/exams.json'), JSON.stringify(exams));

const key = Buffer.from(process.env.BANK_KEY || '', 'base64');
if (key.length !== 32) throw new Error('BANK_KEY must be 32 bytes, base64');
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const data = Buffer.concat([cipher.update(zlib.gzipSync(JSON.stringify(exams))), cipher.final()]);
fs.writeFileSync(path.join(ROOT, 'bank.enc'), JSON.stringify({
  iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')
}));
console.log('wrote bank.enc', Math.round(data.length / 1024) + ' KB');
