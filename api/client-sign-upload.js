// api/client-sign-upload.js — StoryBeat
// Endpoint PUBLIC pour les clientes Premium : leur permet d'envoyer photos/vidéos
// DIRECTEMENT vers Bunny, UNIQUEMENT dans le dossier premium/{code}/ de LEUR commande.
// Sécurité : un jeton signé (HMAC) prouve que la cliente a le droit d'écrire dans ce dossier.
// N'utilise PAS TOOL_PASSWORD et ne touche PAS à sign-upload.js. La clé Bunny reste côté serveur.
const crypto = require('crypto');

// ---- Config Bunny (identique à sign-upload.js ; rien de secret ici) ----
const REGION    = 'de';
const HOST      = 'de-s3.storage.bunnycdn.com';
const BUCKET    = 'storybeat-media';
const ACCESS_ID = 'storybeat-media';
const CDN_BASE  = 'https://storybeat.b-cdn.net';
const EXPIRES   = 3600; // l'autorisation d'envoi dure 1h (refabriquée à chaque fichier)

// ---- Jeton cliente (HMAC) ----
// token = empreinte de ("premium/" + code) signée avec CLIENT_UPLOAD_SECRET, en hexa (32 caractères).
function tokenFor(code, secret) {
  return crypto.createHmac('sha256', secret).update('premium/' + code, 'utf8').digest('hex').slice(0, 32);
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (e) { return false; }
}

// ---- Présignature S3 (copie de sign-upload.js, pour NE PAS toucher l'existant) ----
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
  const t = new Date(); const p = (n) => String(n).padStart(2, '0');
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

// ---- Nettoyage du nom de fichier (empêche ../ et les caractères douteux) ----
function cleanName(name) {
  let n = String(name || '').split('/').pop().split('\\').pop(); // garde le nom seul, jamais un chemin
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

  const clientSecret = process.env.CLIENT_UPLOAD_SECRET; // sert à vérifier le jeton de la cliente
  const bunnySecret  = process.env.BUNNY_S3_SECRET;      // sert à signer l'envoi Bunny (déjà en place)
  if (!clientSecret || !bunnySecret) {
    res.status(500).json({ error: 'Configuration serveur incomplète (CLIENT_UPLOAD_SECRET / BUNNY_S3_SECRET).' }); return;
  }

  const code  = String(q.c || '').trim().toLowerCase();
  const token = String(q.t || '').trim();
  // le code doit être un identifiant simple (lettres/chiffres/tirets), sinon on refuse tout de suite
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(code)) { res.status(400).json({ error: 'Lien invalide.' }); return; }
  // le jeton doit correspondre EXACTEMENT à celui calculé pour ce code : sinon accès refusé
  if (!safeEqual(token, tokenFor(code, clientSecret))) { res.status(403).json({ error: 'Lien invalide.' }); return; }

  const name = cleanName(q.name);
  if (!name || name === '.') { res.status(400).json({ error: 'Nom de fichier manquant.' }); return; }

  // On FORCE le dossier : la cliente ne peut écrire QUE dans premium/{code}/
  // + petit suffixe aléatoire pour ne jamais écraser un fichier déjà envoyé.
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot) : '';
  const unique = Math.random().toString(36).slice(2, 6);
  const finalName = base + '-' + unique + ext;
  const key = 'premium/' + code + '/' + finalName;

  try {
    const uploadUrl = presignPut(key, bunnySecret);
    res.status(200).json({ ok: true, storedAs: finalName, uploadUrl, publicUrl: CDN_BASE + '/' + key, expiresIn: EXPIRES });
  } catch (e) {
    res.status(500).json({ error: "Erreur lors de la préparation de l'envoi : " + e.message });
  }
};
