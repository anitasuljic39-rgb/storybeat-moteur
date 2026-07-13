// api/set-statut.js — StoryBeat
// Change UNIQUEMENT le champ "statut" d'une fiche commande (commandes/commande-{order_id}.json).
// Tout le reste de la fiche est laissé intact. Protégé par TOOL_PASSWORD, écrit via CARNET_GH_TOKEN.
// N'entre pas en conflit avec le parser : build-commandes ne réécrit jamais le statut.

const OWNER  = 'anitasuljic39-rgb';
const REPO   = 'storybeat-carnet';
const BRANCH = 'main';
const STATUTS = ['à traiter', 'en cours', 'livrée', 'remboursée'];

function readRaw(req){
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') return resolve(JSON.stringify(req.body));
    let d = '';
    try { req.on('data', c=>{ d+=c; }); req.on('end', ()=>resolve(d)); req.on('error', ()=>resolve(d)); }
    catch(e){ resolve(''); }
  });
}

module.exports = async (req, res) => {
  const getQuery = (r) => {
    if (r.query) return r.query;
    try { const u = new URL(r.url, 'http://x'); const o={}; u.searchParams.forEach((v,k)=>{o[k]=v;}); return o; }
    catch(e){ return {}; }
  };
  const q = getQuery(req);

  // Entrées possibles : paramètres d'URL ET/OU corps JSON (le corps a priorité s'il est présent).
  const raw = await readRaw(req);
  let body = {}; try { body = raw ? (JSON.parse(raw) || {}) : {}; } catch(e){ body = {}; }
  const p = Object.assign({}, q, body);

  const password = req.headers['x-tool-password'] || p.password || '';
  if (!password || password !== process.env.TOOL_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;
  }

  const orderRaw = String(p.order_id != null ? p.order_id : (p.order != null ? p.order : '')).trim();
  if (!orderRaw) { res.status(400).json({ error: 'Numéro de commande manquant (order_id).' }); return; }
  // anti-piège chemin : uniquement chiffres/lettres/tirets (couvre aussi les clés "sans-id-...")
  if (!/^[a-zA-Z0-9-]+$/.test(orderRaw)) { res.status(400).json({ error: 'Numéro de commande invalide.' }); return; }

  const statut = String(p.statut || '').trim();
  if (STATUTS.indexOf(statut) === -1) {
    res.status(400).json({ error: 'Statut invalide (attendus : ' + STATUTS.join(' / ') + ').' }); return;
  }

  const token = process.env.CARNET_GH_TOKEN;
  if (!token) { res.status(500).json({ error: 'Configuration serveur incomplète (CARNET_GH_TOKEN).' }); return; }

  const path = 'commandes/commande-' + orderRaw + '.json';
  const url = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/contents/' + path;
  const H = { 'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json', 'User-Agent':'storybeat-carnet' };

  try {
    // 1) lire la fiche existante (+ sha)
    const getR = await fetch(url + '?ref=' + BRANCH + '&t=' + Date.now(), { headers: H });
    if (getR.status === 404) { res.status(404).json({ error: 'Commande ' + orderRaw + ' introuvable.' }); return; }
    if (!getR.ok) { res.status(502).json({ error: 'Lecture GitHub ' + getR.status }); return; }
    const f = await getR.json();
    let fiche;
    try { fiche = JSON.parse(Buffer.from(f.content, f.encoding||'base64').toString('utf8')); }
    catch(e){ res.status(500).json({ error: 'Fiche commande illisible.' }); return; }

    const ancien = fiche.statut || null;
    // 2) modifier UNIQUEMENT le statut (+ horodatage dédié, sans toucher au _maj_le du parser)
    fiche.statut = statut;
    fiche._statut_maj_le = new Date().toISOString();

    // 3) réécrire en place (avec sha → pas de doublon)
    const putR = await fetch(url, {
      method: 'PUT',
      headers: Object.assign({}, H, {'Content-Type':'application/json'}),
      body: JSON.stringify({
        message: 'Statut ' + orderRaw + ' → ' + statut,
        content: Buffer.from(JSON.stringify(fiche, null, 2)).toString('base64'),
        sha: f.sha,
        branch: BRANCH
      })
    });
    if (!putR.ok) { const e = await putR.json().catch(()=>({})); res.status(502).json({ error: 'Écriture GitHub ' + putR.status + ' : ' + (e.message||'') }); return; }

    res.status(200).json({ ok: true, order_id: orderRaw, ancien_statut: ancien, nouveau_statut: statut });
  } catch (e) {
    res.status(500).json({ error: 'Erreur : ' + e.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
