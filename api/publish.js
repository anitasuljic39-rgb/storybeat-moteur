module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  const { password, id, prenom, versions, type, titreA, titreB, pour, parolesA, parolesB } = body;
  if (!password || password !== process.env.TOOL_PASSWORD) {
    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;
  }
  const slug = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const cleanId = slug(id);
  if (!cleanId) { res.status(400).json({ error: "Identifiant manquant ou invalide." }); return; }
  if (!prenom || !titreA) { res.status(400).json({ error: "Prénom et titre (Version A) obligatoires." }); return; }
  const two = String(versions) === '2';
  const ext = (type === 'video') ? 'mp4' : 'mp3';
  const CDN = process.env.CDN_BASE || 'https://storybeat.b-cdn.net';
  const SITE = process.env.SITE_BASE || 'https://ecoute.storybeat.fr';
  const REPO = process.env.GH_REPO;
  const TOKEN = process.env.GH_TOKEN;
  if (!REPO || !TOKEN) { res.status(500).json({ error: 'Configuration serveur incomplète (GH_REPO / GH_TOKEN).' }); return; }
  const cover = (prenom || '').trim().charAt(0).toUpperCase() || '♪';
  const mediaUrl = (fn) => CDN + '/' + cleanId + '/' + fn;
  const fA = cleanId + '-a.' + ext, fB = cleanId + '-b.' + ext;
  const eA = cleanId + '-a-extrait.' + ext, eB = cleanId + '-b-extrait.' + ext;
  const parA = parolesA || '';
  const parB = two ? ((parolesB && parolesB.trim()) ? parolesB : parA) : '';
  const fiches = [];
  fiches.push({ path: 'chansons/' + cleanId + '-a.json', obj: {
    prenom: prenom, titre: titreA, pour: pour || '', type: (type || 'audio'),
    media: mediaUrl(fA), cover: cover, paroles: parA.trim() ? [{ label: '', texte: parA }] : []
  }});
  if (two) fiches.push({ path: 'chansons/' + cleanId + '-b.json', obj: {
    prenom: prenom, titre: (titreB || titreA), pour: pour || '', type: (type || 'audio'),
    media: mediaUrl(fB), cover: cover, paroles: parB.trim() ? [{ label: '', texte: parB }] : []
  }});
  const versionsArr = [{ label: two ? 'Version A' : 'Version unique', media: mediaUrl(eA), final: SITE + '/?id=' + cleanId + '-a' }];
  if (two) versionsArr.push({ label: 'Version B', media: mediaUrl(eB), final: SITE + '/?id=' + cleanId + '-b' });
  fiches.push({ path: 'extraits/' + cleanId + '-choix.json', obj: { prenom: prenom, versions: versionsArr } });
  const ghHeaders = {
    'Authorization': 'Bearer ' + TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'storybeat-moteur',
    'Content-Type': 'application/json'
  };
  try {
    for (const f of fiches) {
      const url = 'https://api.github.com/repos/' + REPO + '/contents/' + f.path;
      let sha;
      const getR = await fetch(url, { headers: ghHeaders });
      if (getR.status === 200) { const j = await getR.json(); sha = j.sha; }
      const content = Buffer.from(JSON.stringify(f.obj, null, 2), 'utf8').toString('base64');
      const putBody = { message: 'Moteur: ' + f.path, content: content };
      if (sha) putBody.sha = sha;
      const putR = await fetch(url, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(putBody) });
      if (!putR.ok) { const t = await putR.text(); throw new Error('GitHub ' + putR.status + ' sur ' + f.path + ' : ' + t); }
    }
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors du dépôt sur GitHub : ' + e.message }); return;
  }
  const filesToUpload = [fA, eA];
  if (two) filesToUpload.push(fB, eB);
  const finalLinks = [{ label: two ? 'Version A' : 'Version unique', url: SITE + '/?id=' + cleanId + '-a' }];
  if (two) finalLinks.push({ label: 'Version B', url: SITE + '/?id=' + cleanId + '-b' });
  const validationLink = SITE + '/valider/?id=' + cleanId + '-choix';
  res.status(200).json({
    ok: true, folder: cleanId, ext: ext,
    filesToUpload: filesToUpload, finalLinks: finalLinks,
    validationLink: validationLink, committed: fiches.map(f => f.path)
  });
};
