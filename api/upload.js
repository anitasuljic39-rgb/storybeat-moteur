module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const getQuery = (r) => {
    if (r.query) return r.query;
    try { const u = new URL(r.url, 'http://x'); const o = {}; u.searchParams.forEach((v, k) => { o[k] = v; }); return o; }
    catch (e) { return {}; }
  };
  const q = getQuery(req);
  const password = req.headers['x-tool-password'] || q.password || '';
  if (!password || password !== process.env.TOOL_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;
  }
  const name = q.name || '';
  if (!name) { res.status(400).json({ error: 'Nom de fichier manquant (?name=).' }); return; }
  const PASS = process.env.BUNNY_STORAGE_PASSWORD;
  const ZONE = process.env.BUNNY_STORAGE_ZONE;
  const HOST = process.env.BUNNY_STORAGE_HOST;
  if (!PASS || !ZONE || !HOST) { res.status(500).json({ error: 'Configuration serveur incomplète (BUNNY_STORAGE_PASSWORD / BUNNY_STORAGE_ZONE / BUNNY_STORAGE_HOST).' }); return; }
  const chunks = [];
  try {
    for await (const chunk of req) { chunks.push(chunk); }
  } catch (e) {
    res.status(400).json({ error: 'Lecture du fichier impossible : ' + e.message }); return;
  }
  const buf = Buffer.concat(chunks);
  if (!buf.length) { res.status(400).json({ error: 'Fichier vide.' }); return; }
  const url = 'https://' + HOST + '/' + ZONE + '/' + name;
  try {
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'AccessKey': PASS, 'Content-Type': 'application/octet-stream' },
      body: buf
    });
    if (!r.ok) { const t = await r.text(); res.status(r.status).json({ error: 'Bunny ' + r.status + ' : ' + t }); return; }
  } catch (e) {
    res.status(500).json({ error: "Erreur lors de l'envoi sur Bunny : " + e.message }); return;
  }
  res.status(200).json({ ok: true, fichier: name });
};
module.exports.config = { api: { bodyParser: false } };
