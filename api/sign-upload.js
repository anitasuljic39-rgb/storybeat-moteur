// api/sign-upload.js — StoryBeat
// Fabrique un "pass temporaire" (presigned URL S3) pour envoyer un fichier
// DIRECTEMENT du navigateur vers Bunny, sans passer par Vercel (donc sans limite de taille)
// et sans jamais exposer la clé secrète. La clé reste côté serveur (BUNNY_S3_SECRET).
const crypto = require('crypto');

// ---- Config Bunny (non secret : nom de zone visible via le CDN) ----
const REGION   = 'de';                                // Frankfurt
const HOST      = 'de-s3.storage.bunnycdn.com';       // endpoint S3 de la zone
const BUCKET    = 'storybeat-media';                  // nom de la zone de stockage
const ACCESS_ID = 'storybeat-media';                  // = nom de la zone (Access Key ID S3)
const CDN_BASE  = 'https://storybeat.b-cdn.net';      // adresse publique de lecture
const EXPIRES   = 3600;                                // pass valable 1 heure

function hmac(key, str) { return crypto.createHmac('sha256', key).update(str, 'utf8').digest(); }
function sha256hex(str) { return crypto.createHash('sha256').update(str, 'utf8').digest('hex'); }
function awsUriEncode(str, encodeSlash) {
  let out = '';
  for (const b of Buffer.from(String(str), 'utf8')) {
    const c = String.fromCharCode(b);
    if ((b>=0x41&&b<=0x5A)||(b>=0x61&&b<=0x7A)||(b>=0x30&&b<=0x39)||c==='-'||c==='_'||c==='.'||c==='~') out += c;
    else if (c === '/' && !encodeSlash) out += '/';
    else out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}
function presignPut(key, secret) {
  const t = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const datestamp = `${t.getUTCFullYear()}${p(t.getUTCMonth()+1)}${p(t.getUTCDate())}`;
  const amz = `${datestamp}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`;
  const canonicalUri = '/' + awsUriEncode(BUCKET, true) + '/' + awsUriEncode(key, false);
  const scope = `${datestamp}/${REGION}/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${ACCESS_ID}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(EXPIRES),
    'X-Amz-SignedHeaders': 'host'
  };
  const canonicalQuery = Object.keys(params).sort()
    .map(k => awsUriEncode(k, true) + '=' + awsUriEncode(params[k], true)).join('&');
  const canonicalRequest = ['PUT', canonicalUri, canonicalQuery, `host:${HOST}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secret, datestamp), REGION), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return `https://${HOST}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

module.exports = async (req, res) => {
  const getQuery = (r) => {
    if (r.query) return r.query;
    try { const u = new URL(r.url, 'http://x'); const o = {}; u.searchParams.forEach((v,k)=>{o[k]=v;}); return o; }
    catch (e) { return {}; }
  };
  const q = getQuery(req);
  const password = req.headers['x-tool-password'] || q.password || '';
  if (!password || password !== process.env.TOOL_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;
  }
  let name = (q.name || '').replace(/^\/+/, '').trim();
  if (!name) { res.status(400).json({ error: 'Nom de fichier manquant (?name=).' }); return; }
  const secret = process.env.BUNNY_S3_SECRET;
  if (!secret) { res.status(500).json({ error: 'Configuration serveur incomplète (BUNNY_S3_SECRET).' }); return; }
  try {
    const uploadUrl = presignPut(name, secret);
    res.status(200).json({ ok: true, fichier: name, uploadUrl, publicUrl: `${CDN_BASE}/${name}`, expiresIn: EXPIRES });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la fabrication du pass : ' + e.message });
  }
};
