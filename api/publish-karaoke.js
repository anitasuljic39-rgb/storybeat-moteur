// api/publish-karaoke.js — StoryBeat (Bloc 1 du tout-en-un)
// Ajoute UNIQUEMENT le champ "karaoke" à la fiche chansons/{id}.json de storybeat-ecoute.
// Même technique sûre que set-statut : lire la fiche, ajouter un seul champ, réécrire avec le sha.
// Protégé par TOOL_PASSWORD, écrit via GH_TOKEN/GH_REPO (déjà en place). Aucune clé exposée.
// Ne touche pas à publish.js ; l'ancien calage.html reste le filet de secours.

function readRaw(req){
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') return resolve(JSON.stringify(req.body));
    let d = '';
    try { req.on('data', c=>{ d+=c; }); req.on('end', ()=>resolve(d)); req.on('error', ()=>resolve(d)); }
    catch(e){ resolve(''); }
  });
}

// Nettoie/valide la liste karaoké : chaque ligne = { t: nombre (secondes), l: texte }
function cleanKaraoke(arr){
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const t = Number(it.t);
    if (!isFinite(t)) continue;
    const l = (it.l == null) ? '' : String(it.l);
    out.push({ t: Number(t.toFixed(2)), l: l });
  }
  return out;
}

module.exports = async (req, res) => {
  const getQuery = (r) => {
    if (r.query) return r.query;
    try { const u = new URL(r.url, 'http://x'); const o={}; u.searchParams.forEach((v,k)=>{o[k]=v;}); return o; }
    catch(e){ return {}; }
  };
  const q = getQuery(req);

  // Entrées : paramètres d'URL ET/OU corps JSON (le corps a priorité)
  const raw = await readRaw(req);
  let body = {}; try { body = raw ? (JSON.parse(raw) || {}) : {}; } catch(e){ body = {}; }
  const p = Object.assign({}, q, body);

  const password = req.headers['x-tool-password'] || p.password || '';
  if (!password || password !== process.env.TOOL_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;
  }

  // Identifiant nettoyé (anti-piège chemin : uniquement lettres/chiffres/tirets)
  let id = String(p.id || '').trim().toLowerCase().replace(/\.json$/,'');
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    res.status(400).json({ error: 'Identifiant manquant ou invalide.' }); return;
  }

  const karaoke = cleanKaraoke(p.karaoke);
  if (!karaoke || karaoke.length === 0) {
    res.status(400).json({ error: 'Données de karaoké manquantes ou invalides.' }); return;
  }

  const REPO  = process.env.GH_REPO;
  const TOKEN = process.env.GH_TOKEN;
  if (!REPO || !TOKEN) { res.status(500).json({ error: 'Configuration serveur incomplète (GH_REPO / GH_TOKEN).' }); return; }

  const path = 'chansons/' + id + '.json';
  const url = 'https://api.github.com/repos/' + REPO + '/contents/' + path;
  const H = {
    'Authorization': 'Bearer ' + TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'storybeat-moteur',
    'Content-Type': 'application/json'
  };

  try {
    // 1) lire la fiche existante (+ sha)
    const getR = await fetch(url + '?ref=main&t=' + Date.now(), { headers: H });
    if (getR.status === 404) { res.status(404).json({ error: 'Fiche chansons/' + id + '.json introuvable — crée-la d’abord.' }); return; }
    if (!getR.ok) { res.status(502).json({ error: 'Lecture GitHub ' + getR.status }); return; }
    const f = await getR.json();
    let fiche;
    try { fiche = JSON.parse(Buffer.from(f.content, f.encoding||'base64').toString('utf8')); }
    catch(e){ res.status(500).json({ error: 'Fiche illisible (JSON invalide).' }); return; }

    // 2) ajouter UNIQUEMENT le champ karaoke — tout le reste intact
    fiche.karaoke = karaoke;

    // 3) réécrire en place (avec sha → pas de doublon)
    const putR = await fetch(url, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({
        message: 'Karaoké ' + id + ' (' + karaoke.length + ' lignes)',
        content: Buffer.from(JSON.stringify(fiche, null, 2)).toString('base64'),
        sha: f.sha,
        branch: 'main'
      })
    });
    if (!putR.ok) { const e = await putR.json().catch(()=>({})); res.status(502).json({ error: 'Écriture GitHub ' + putR.status + ' : ' + (e.message||'') }); return; }

    res.status(200).json({ ok: true, id: id, lignes: karaoke.length });
  } catch (e) {
    res.status(500).json({ error: 'Erreur : ' + e.message });
  }
};
module.exports.config = { api: { bodyParser: false } };
