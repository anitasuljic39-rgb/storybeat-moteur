const OWNER = 'anitasuljic39-rgb';
const REPO  = 'storybeat-carnet';
const BRANCH = 'main';

function slug(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }

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

  const email = q.email || 'cliente-test@exemple.com';
  const commande = {
    email,
    formule: q.formule || 'Populaire',
    message: q.message || 'TEST message carte',
    signature: q.signature || 'TEST',
    style: q.style || 'Sombre',
    recu_le: new Date().toISOString(),
    source: 'carnet-test'
  };

  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const code = Math.random().toString(36).slice(2,6);
  const path = 'commandes/' + stamp + '-' + (slug(email) || 'commande') + '-' + code + '.json';

  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path;
  const body = {
    message: 'Commande test : ' + email,
    content: Buffer.from(JSON.stringify(commande, null, 2)).toString('base64'),
    branch: BRANCH
  };

  try {
    const r = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'storybeat-carnet',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(()=>({}));
    if (!r.ok) { res.status(r.status).json({ error: 'GitHub ' + r.status + ' : ' + (data.message || 'erreur') }); return; }
    res.status(200).json({ ok: true, fichier: path, commit: data.commit && data.commit.sha, lien: data.content && data.content.html_url });
  } catch (e) {
    res.status(500).json({ error: 'Erreur écriture carnet : ' + e.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
