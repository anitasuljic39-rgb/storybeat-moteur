// api/client.js — StoryBeat
// Regroupe les 3 actions cliente en UNE fonction (économise 2 fonctions serverless Vercel) :
//   ?action=list         → liste les fichiers de premium/{code}/
//   ?action=sign-upload  → renvoie l'autorisation d'envoi présignée (upload direct Bunny)
//   ?action=delete       → supprime un fichier de premium/{code}/
// Logique et sécurité STRICTEMENT identiques aux anciens client-list / client-sign-upload /
// client-delete : même jeton HMAC, dossier premium/{code}/ forcé, noms nettoyés, clés côté serveur.
const crypto = require('crypto');

const REGION    = 'de';
const HOST      = 'de-s3.storage.bunnycdn.com';
const BUCKET    = 'storybeat-media';
const ACCESS_ID = 'storybeat-media';
const CDN_BASE  = 'https://storybeat.b-cdn.net';
const EXPIRES_UPLOAD = 3600; // l'autorisation d'envoi dure 1h
const EXPIRES_OP     = 120;  // list/delete : le serveur agit tout de suite

// ---- Jeton cliente (identique aux anciens endpoints) ----
function tokenFor(code, secret) {
  return crypto.createHmac('sha256', secret).update('premium/' + code, 'utf8').digest('hex').slice(0, 32);
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

// ---- Signature S3 (méthode quelconque + paramètres de requête en plus) ----
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
function presign(method, canonicalUri, extra, secret, expires) {
  const t = new Date(); const p = (n) => String(n).padStart(2, '0');
  const datestamp = `${t.getUTCFullYear()}${p(t.getUTCMonth()+1)}${p(t.getUTCDate())}`;
  const amz = `${datestamp}T${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`;
  const scope = `${datestamp}/${REGION}/s3/aws4_request`;
  const params = Object.assign({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${ACCESS_ID}/${scope}`,
    'X-Amz-Date': amz,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host'
  }, extra || {});
  const canonicalQuery = Object.keys(params).sort()
    .map(k => awsUriEncode(k, true) + '=' + awsUriEncode(params[k], true)).join('&');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, `host:${HOST}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + secret, datestamp), REGION), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return `https://${HOST}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ---- Nettoyage du nom de fichier (empêche ../ et les caractères douteux) ----
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

  // Validation commune aux 3 actions : code + jeton
  const code  = String(q.c || '').trim().toLowerCase();
  const token = String(q.t || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(code)) { res.status(400).json({ error: 'Lien invalide.' }); return; }
  if (!safeEqual(token, tokenFor(code, clientSecret))) { res.status(403).json({ error: 'Lien invalide.' }); return; }

  const action = String(q.action || '').trim();
  const prefix = 'premium/' + code + '/';

  try {
    // ---------- LISTER ----------
    if (action === 'list') {
      const url = presign('GET', '/' + awsUriEncode(BUCKET, true), { 'list-type': '2', 'prefix': prefix }, bunnySecret, EXPIRES_OP);
      const r = await fetch(url, { method: 'GET' });
      if (!r.ok) { const t = await r.text(); res.status(502).json({ error: 'Bunny ' + r.status, detail: t.slice(0, 300) }); return; }
      const xml = await r.text();
      const files = [];
      const blocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
      for (const b of blocks) {
        const km = b.match(/<Key>([\s\S]*?)<\/Key>/);
        const sm = b.match(/<Size>([\s\S]*?)<\/Size>/);
        if (!km) continue;
        const key = km[1];
        if (key === prefix) continue;
        const name = key.slice(prefix.length);
        if (!name || name.indexOf('/') !== -1) continue;
        files.push({ name: name, size: sm ? parseInt(sm[1], 10) : 0, url: CDN_BASE + '/' + prefix + name });
      }
      files.sort((a, b) => a.name < b.name ? -1 : (a.name > b.name ? 1 : 0));
      res.status(200).json({ ok: true, total: files.length, files: files });
      return;
    }

    // ---------- UPLOADER (autorisation présignée) ----------
    if (action === 'sign-upload') {
      const name = cleanName(q.name);
      if (!name || name === '.') { res.status(400).json({ error: 'Nom de fichier manquant.' }); return; }
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext  = dot > 0 ? name.slice(dot) : '';
      const unique = Math.random().toString(36).slice(2, 6);
      const finalName = base + '-' + unique + ext;
      const key = prefix + finalName;
      const uploadUrl = presign('PUT', '/' + awsUriEncode(BUCKET, true) + '/' + awsUriEncode(key, false), {}, bunnySecret, EXPIRES_UPLOAD);
      res.status(200).json({ ok: true, storedAs: finalName, uploadUrl: uploadUrl, publicUrl: CDN_BASE + '/' + key, expiresIn: EXPIRES_UPLOAD });
      return;
    }

    // ---------- SUPPRIMER ----------
    if (action === 'delete') {
      const name = cleanName(q.name);
      if (!name || name === '.') { res.status(400).json({ error: 'Nom de fichier manquant.' }); return; }
      const key = prefix + name;
      const url = presign('DELETE', '/' + awsUriEncode(BUCKET, true) + '/' + awsUriEncode(key, false), {}, bunnySecret, EXPIRES_OP);
      const r = await fetch(url, { method: 'DELETE' });
      if (r.status === 200 || r.status === 204 || r.status === 404) { res.status(200).json({ ok: true, deleted: name }); return; }
      const t = await r.text();
      res.status(502).json({ error: 'Bunny ' + r.status, detail: t.slice(0, 300) });
      return;
    }

    res.status(400).json({ error: 'Action inconnue (attendues : list / sign-upload / delete).' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur : ' + e.message });
  }
};
