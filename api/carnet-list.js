const OWNER = 'anitasuljic39-rgb';
const REPO  = 'storybeat-carnet';
const BRANCH = 'main';
const DIR   = 'commandes';

module.exports = async (req, res) => {
  const getQuery = (r) => {
    if (r.query) return r.query;
    try { const u = new URL(r.url, 'http://x'); const o={}; u.searchParams.forEach((v,k)=>{o[k]=v;}); return o; }
    catch(e){ return {}; }
  };
  const q = getQuery(req);
  const password = req.headers['x-tool-password'] || q.password || '';
  if (!password || password !== process.env.TOOL_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;
  }
  const token = process.env.CARNET_GH_TOKEN;
  if (!token) { res.status(500).json({ error: 'Configuration serveur incomplète (CARNET_GH_TOKEN).' }); return; }

  const base = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/';
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'storybeat-carnet' };

  try {
    const listRes = await fetch(base + DIR + '?ref=' + BRANCH, { headers });
    if (listRes.status === 404) { res.status(200).json({ ok: true, total: 0, commandes: [] }); return; }
    if (!listRes.ok) { const e = await listRes.json().catch(()=>({})); res.status(listRes.status).json({ error: 'GitHub ' + listRes.status + ' : ' + (e.message||'erreur') }); return; }
    let items = await listRes.json();
    if (!Array.isArray(items)) items = [];
    items = items.filter(f => f.type === 'file' && f.name.endsWith('.json'));
    // nom = timestamp ISO en tête -> tri décroissant = plus récent en premier
    items.sort((a,b) => a.name < b.name ? 1 : (a.name > b.name ? -1 : 0));
    items = items.slice(0, 200);

    const commandes = [];
    for (const it of items) {
      try {
        const fRes = await fetch(base + it.path + '?ref=' + BRANCH, { headers });
        if (!fRes.ok) continue;
        const f = await fRes.json();
        let data = {};
        if (f.content) data = JSON.parse(Buffer.from(f.content, f.encoding || 'base64').toString('utf8'));
        commandes.push(Object.assign({ fichier: it.name, path: it.path, sha: it.sha }, data));
      } catch (e) { /* fichier illisible ignoré */ }
    }
    res.status(200).json({ ok: true, total: commandes.length, commandes });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lecture carnet : ' + e.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
