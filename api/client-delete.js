// api/client-delete.js — StoryBeat
// Supprime (CÔTÉ SERVEUR) UN fichier précis du dossier premium/{code}/ d'une cliente.
// Sécurité : même jeton HMAC que client-sign-upload.js. La clé Bunny reste au serveur.
// Le dossier est FORCÉ et le nom NETTOYÉ : impossible de sortir de premium/{code}/.
const crypto = require('crypto');

const REGION = 'de';
const HOST   = 'de-s3.storage.bunnycdn.com';
const BUCKET = 'storybeat-media';

// ---- Jeton cliente (identique à client-sign-upload.js) ----
function tokenFor(code, secret) {
  return crypto.createHmac('sha256', secret).update('premium/' + code, 'utf8').digest('hex').slice(0, 32);
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

// ---- Signature S3 ----
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
function presign(method, canonicalUri, secret) {
  const t = new Date(); const p = (n) => String(n).padStart(2, '0');
  const datestamp = `${t.getUTCFullYear()}${p(t.getUTCMonth()+1)}${p(t.getUTCDate())}`;
  const amz = `${datestamp}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`;
  const scope = `${datestamp}/${REGION}/s3/aws4_request`;
  const params = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${BUCKET}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': '120',
    'X-Amz-SignedHeaders': 'host'
  };
  const canonicalQuery = Object.keys(params).sort()
    .map(k => awsUriEncode(k, true) + '=' + awsUriEncode(params[k], true)).join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${HOST}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secret, datestamp), REGION), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return `https://${HOST}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ---- Nettoyage du nom (jamais de chemin, mêmes règles que l'upload) ----
function cleanName(name) {
  let n = String(name || '').split('/').pop().split('\\').pop();
  n = n.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[.-]+/, '');
  return n;
}

module.exports = async (req, res) => {
  const getQuery = (r) => {
    if (r.query) return r.query;
    try { const u = new URL(r.url, 'http://x'); const o = {}; u.searchParams.forEach((v,k)=>{o[k]=v;}); return o; }
    catch (e) { return {}; }
  };
  const q = getQuery(req);

  const clientSecret = process.env.CLIENT_UPLOAD_SECRET;
  const bunnySecret  = process.env.BUNNY_S3_SECRET;
  if (!clientSecret || !bunnySecret) {
    res.status(500).json({ error: 'Configuration serveur incomplète (CLIENT_UPLOAD_SECRET / BUNNY_S3_SECRET).' }); return;
  }

  const code  = String(q.c || '').trim().toLowerCase();
  const token = String(q.t || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(code)) { res.status(400).json({ error: 'Lien invalide.' }); return; }
  if (!safeEqual(token, tokenFor(code, clientSecret))) { res.status(403).json({ error: 'Lien invalide.' }); return; }

  const name = cleanName(q.name);
  if (!name || name === '.') { res.status(400).json({ error: 'Nom de fichier manquant.' }); return; }

  // On FORCE le dossier : suppression possible UNIQUEMENT dans premium/{code}/
  const key = 'premium/' + code + '/' + name;
  const canonicalUri = '/' + awsUriEncode(BUCKET, true) + '/' + awsUriEncode(key, false);
  const url = presign('DELETE', canonicalUri, bunnySecret);
  try {
    const r = await fetch(url, { method: 'DELETE' });
    // Bunny renvoie 204 (supprimé) ou 200. On considère 404 comme déjà supprimé = succès.
    if (r.status === 200 || r.status === 204 || r.status === 404) {
      res.status(200).json({ ok: true, deleted: name }); return;
    }
    const t = await r.text();
    res.status(502).json({ error: 'Bunny ' + r.status, detail: t.slice(0, 300) });
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression : ' + e.message });
  }
};
