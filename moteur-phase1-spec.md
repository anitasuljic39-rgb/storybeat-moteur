# StoryBeat — MOTEUR, Phase 1 (cahier des charges)

## Contexte

Petite application hébergée sur **Vercel**, dépôt GitHub **storybeat-moteur**. But de la Phase 1 : Anita remplit un formulaire (identifiant, prénom, titre(s), paroles, 1 ou 2 versions, audio/vidéo). En cliquant, l'appli :

1. **Génère toutes les fiches** (finales \+ fiche d'extrait) avec des noms **cohérents et auto-dérivés** de l'identifiant (plus aucune erreur de tiret / .mp3).  
2. **Les dépose automatiquement** dans le dépôt storybeat-ecoute (via l'API GitHub).  
3. Affiche un **récap** : les fichiers exacts à déposer sur Bunny (dossier par cliente, avec boutons « copier »), les liens des pages finales (pour vérif) et LE lien de validation à envoyer à la cliente.

⚠️ Phase 1 : l'appli **n'envoie PAS encore les fichiers audio sur Bunny** (ce sera la Phase 2). Elle dit juste à Anita comment les nommer. Elle ne fait transiter aucun gros fichier (uniquement du texte/JSON → aucun souci de limite de taille Vercel).

## Structure du projet (zéro framework, Vercel auto-détecte)

/

├── index.html         (le formulaire \+ le récap ; statique, servi à la racine)

├── api/

│   └── publish.js      (fonction serverless Node : génère les fiches \+ commit GitHub)

├── package.json        (minimal, sans dépendances)

└── README.md

## Variables d'environnement (coffre-fort Vercel — JAMAIS dans le code)

- TOOL\_PASSWORD : mot de passe d'accès à l'outil (choisi par Anita).  
- GH\_TOKEN : jeton GitHub « fine-grained », accès *Contents: Read and write* sur le seul dépôt storybeat-ecoute.  
- GH\_REPO : anitasuljic39-rgb/storybeat-ecoute  
- CDN\_BASE : https://storybeat.b-cdn.net  
- SITE\_BASE : https://ecoute.storybeat.fr

## Règles de nommage (auto-dérivées de l'identifiant id)

- id est « slugifié » (minuscules, sans accent, espaces → tirets).  
- ext \= mp4 si type vidéo, sinon mp3.  
- Dossier Bunny \= {id}/ (un dossier par cliente).  
- Fichiers attendus sur Bunny :  
  - Chanson A : {id}-a.{ext} ; Chanson B : {id}-b.{ext}  
  - Extrait A : {id}-a-extrait.{ext} ; Extrait B : {id}-b-extrait.{ext}  
- URL média \= {CDN\_BASE}/{id}/{nomfichier}

## Fiches générées (formats EXACTS, compatibles avec les pages existantes)

- chansons/{id}-a.json : { "prenom", "titre": titreA, "pour", "type", "media": CDN/{id}/{id}-a.{ext}, "cover": initiale, "paroles": \[{"label":"","texte":parolesA}\] }  
- chansons/{id}-b.json (seulement si 2 versions) : idem avec titreB, {id}-b, parolesB.  
- extraits/{id}-choix.json : { "prenom", "versions": \[ {"label":"Version A","media":CDN/{id}/{id}-a-extrait.{ext},"final":SITE/?id={id}-a}, {"label":"Version B", …} \] } (1 version → une seule entrée, label « Version unique », final ?id={id}-a.)  
- paroles : si la case « mêmes paroles A/B » est cochée, parolesB \= parolesA.  
- cover \= première lettre du prénom en majuscule.

---

## Fichier api/publish.js (créer VERBATIM ; retirer tout backslash markdown parasite)

module.exports \= async (req, res) \=\> {

  if (req.method \!== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  let body \= req.body;

  if (typeof body \=== 'string') { try { body \= JSON.parse(body); } catch (e) { body \= {}; } }

  body \= body || {};

  const { password, id, prenom, versions, type, titreA, titreB, pour, parolesA, parolesB } \= body;

  if (\!password || password \!== process.env.TOOL\_PASSWORD) {

    res.status(401).json({ error: 'Mot de passe incorrect.' }); return;

  }

  const slug \= (s) \=\> (s || '').toLowerCase().normalize('NFD').replace(/\[\\u0300-\\u036f\]/g, '')

    .replace(/\[^a-z0-9\]+/g, '-').replace(/^-+|-+$/g, '');

  const cleanId \= slug(id);

  if (\!cleanId) { res.status(400).json({ error: "Identifiant manquant ou invalide." }); return; }

  if (\!prenom || \!titreA) { res.status(400).json({ error: "Prénom et titre (Version A) obligatoires." }); return; }

  const two \= String(versions) \=== '2';

  const ext \= (type \=== 'video') ? 'mp4' : 'mp3';

  const CDN \= process.env.CDN\_BASE || 'https://storybeat.b-cdn.net';

  const SITE \= process.env.SITE\_BASE || 'https://ecoute.storybeat.fr';

  const REPO \= process.env.GH\_REPO;

  const TOKEN \= process.env.GH\_TOKEN;

  if (\!REPO || \!TOKEN) { res.status(500).json({ error: 'Configuration serveur incomplète (GH\_REPO / GH\_TOKEN).' }); return; }

  const cover \= (prenom || '').trim().charAt(0).toUpperCase() || '\\u266A';

  const mediaUrl \= (fn) \=\> CDN \+ '/' \+ cleanId \+ '/' \+ fn;

  const fA \= cleanId \+ '-a.' \+ ext, fB \= cleanId \+ '-b.' \+ ext;

  const eA \= cleanId \+ '-a-extrait.' \+ ext, eB \= cleanId \+ '-b-extrait.' \+ ext;

  const parA \= parolesA || '';

  const parB \= two ? ((parolesB && parolesB.trim()) ? parolesB : parA) : '';

  const fiches \= \[\];

  fiches.push({ path: 'chansons/' \+ cleanId \+ '-a.json', obj: {

    prenom: prenom, titre: titreA, pour: pour || '', type: (type || 'audio'),

    media: mediaUrl(fA), cover: cover, paroles: parA.trim() ? \[{ label: '', texte: parA }\] : \[\]

  }});

  if (two) fiches.push({ path: 'chansons/' \+ cleanId \+ '-b.json', obj: {

    prenom: prenom, titre: (titreB || titreA), pour: pour || '', type: (type || 'audio'),

    media: mediaUrl(fB), cover: cover, paroles: parB.trim() ? \[{ label: '', texte: parB }\] : \[\]

  }});

  const versionsArr \= \[{ label: two ? 'Version A' : 'Version unique', media: mediaUrl(eA), final: SITE \+ '/?id=' \+ cleanId \+ '-a' }\];

  if (two) versionsArr.push({ label: 'Version B', media: mediaUrl(eB), final: SITE \+ '/?id=' \+ cleanId \+ '-b' });

  fiches.push({ path: 'extraits/' \+ cleanId \+ '-choix.json', obj: { prenom: prenom, versions: versionsArr } });

  const ghHeaders \= {

    'Authorization': 'Bearer ' \+ TOKEN,

    'Accept': 'application/vnd.github+json',

    'User-Agent': 'storybeat-moteur',

    'Content-Type': 'application/json'

  };

  try {

    for (const f of fiches) {

      const url \= 'https://api.github.com/repos/' \+ REPO \+ '/contents/' \+ f.path;

      let sha;

      const getR \= await fetch(url, { headers: ghHeaders });

      if (getR.status \=== 200\) { const j \= await getR.json(); sha \= j.sha; }

      const content \= Buffer.from(JSON.stringify(f.obj, null, 2), 'utf8').toString('base64');

      const putBody \= { message: 'Moteur: ' \+ f.path, content: content };

      if (sha) putBody.sha \= sha;

      const putR \= await fetch(url, { method: 'PUT', headers: ghHeaders, body: JSON.stringify(putBody) });

      if (\!putR.ok) { const t \= await putR.text(); throw new Error('GitHub ' \+ putR.status \+ ' sur ' \+ f.path \+ ' : ' \+ t); }

    }

  } catch (e) {

    res.status(500).json({ error: 'Erreur lors du dépôt sur GitHub : ' \+ e.message }); return;

  }

  const filesToUpload \= \[fA, eA\];

  if (two) filesToUpload.push(fB, eB);

  const finalLinks \= \[{ label: two ? 'Version A' : 'Version unique', url: SITE \+ '/?id=' \+ cleanId \+ '-a' }\];

  if (two) finalLinks.push({ label: 'Version B', url: SITE \+ '/?id=' \+ cleanId \+ '-b' });

  const validationLink \= SITE \+ '/valider/?id=' \+ cleanId \+ '-choix';

  res.status(200).json({

    ok: true, folder: cleanId, ext: ext,

    filesToUpload: filesToUpload, finalLinks: finalLinks,

    validationLink: validationLink, committed: fiches.map(f \=\> f.path)

  });

};

## Fichier package.json

{

  "name": "storybeat-moteur",

  "version": "1.0.0",

  "private": true

}

## Fichier index.html (créer VERBATIM ; retirer tout backslash markdown parasite)

\<\!DOCTYPE html\>

\<html lang="fr"\>

\<head\>

\<meta charset="UTF-8"\>

\<meta name="viewport" content="width=device-width, initial-scale=1.0"\>

\<title\>StoryBeat — Moteur\</title\>

\<style\>

@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800\&family=Manrope:wght@400;500;600;700\&display=swap');

:root{--bg:\#0b0a10;--card:\#1c1926;--card2:\#26212f;--pink:\#ff3aa8;--violet:\#9b4dff;--cyan:\#1fd6ff;--white:\#fff;--muted:rgba(255,255,255,.62);--line:rgba(255,255,255,.14);--grad3:linear-gradient(90deg,\#ff3aa8,\#9b4dff,\#1fd6ff);--display:'Sora',sans-serif;--body:'Manrope',sans-serif;}

\*{margin:0;padding:0;box-sizing:border-box}

body{background:var(--bg);color:var(--white);font-family:var(--body);padding:30px 18px 70px;min-height:100vh}

.wrap{max-width:640px;margin:0 auto}

h1{font-family:var(--display);font-weight:800;font-size:26px;margin-bottom:4px}

.sub{color:var(--muted);font-size:14px;margin-bottom:24px}

.grp{margin-bottom:18px}

label.q{display:block;font-weight:600;font-size:14px;margin-bottom:7px}

label.q .hint{color:var(--muted);font-weight:400;font-size:12px}

input,textarea,select{width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;color:var(--white);font-family:var(--body);font-size:15px;padding:12px 14px}

textarea{min-height:300px;resize:vertical}

.row2{display:flex;gap:12px;flex-wrap:wrap}.row2\>div{flex:1 1 220px}

.radio{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}

.radio label{flex:1 1 160px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 14px;cursor:pointer;font-size:14px;display:flex;align-items:center;gap:8px}

.radio input{width:auto}

.check{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-top:10px;cursor:pointer;font-size:14px}

.check input{width:auto}

.btn{border:none;cursor:pointer;font-family:var(--display);font-weight:700;border-radius:12px;padding:14px 22px;font-size:16px;background:var(--grad3);color:\#fff;box-shadow:0 12px 30px \-10px rgba(155,77,255,.6)}

.btn:disabled{opacity:.5;cursor:wait}

.btn.copy{background:var(--card2);border:1px solid var(--line);font-family:var(--body);font-weight:600;font-size:12px;padding:6px 10px;box-shadow:none}

.err{color:\#ff6b8a;font-size:14px;margin-top:10px;display:none}.err.show{display:block}

.out{margin-top:26px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;display:none}.out.show{display:block}

.out h3{font-family:var(--display);font-size:17px;margin:16px 0 10px}.out h3:first-child{margin-top:0}

.out .file{display:flex;align-items:center;justify-content:space-between;gap:10px;background:\#000;border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:8px;font-size:13px;word-break:break-all}

.out a{color:var(--cyan);word-break:break-all}

.send{background:linear-gradient(var(--card2),var(--card2)) padding-box,var(--grad3) border-box;border:1.5px solid transparent;border-radius:12px;padding:14px;margin-top:8px}

.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:var(--card2);border:1px solid var(--line);padding:12px 20px;border-radius:12px;font-size:14px;opacity:0;pointer-events:none;transition:.3s}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

\</style\>

\</head\>

\<body\>

\<div class="wrap"\>

  \<h1\>🎛️ Moteur StoryBeat\</h1\>

  \<div class="sub"\>Remplis, clique : les fiches sont créées et déposées sur GitHub toutes seules. Il te restera juste à mettre les fichiers audio sur Bunny (noms fournis).\</div\>

  \<div class="grp"\>\<label class="q"\>Mot de passe de l'outil\</label\>\<input id="password" type="password" placeholder="•••••"\>\</div\>

  \<div class="row2"\>

    \<div class="grp"\>\<label class="q"\>Identifiant cliente \<span class="hint"\>(ex : clara)\</span\>\</label\>\<input id="id" placeholder="clara"\>\</div\>

    \<div class="grp"\>\<label class="q"\>Prénom\</label\>\<input id="prenom" placeholder="Clara"\>\</div\>

  \</div\>

  \<div class="grp"\>\<label class="q"\>Formule\</label\>

    \<div class="radio"\>

      \<label\>\<input type="radio" name="versions" value="1"\> 1 version (Essentielle)\</label\>

      \<label\>\<input type="radio" name="versions" value="2" checked\> 2 versions (Populaire / Premium)\</label\>

    \</div\>

  \</div\>

  \<div class="grp"\>\<label class="q"\>Type\</label\>

    \<div class="radio"\>

      \<label\>\<input type="radio" name="type" value="audio" checked\> 🎧 Audio (MP3)\</label\>

      \<label\>\<input type="radio" name="type" value="video"\> 🎬 Vidéo (MP4)\</label\>

    \</div\>

  \</div\>

  \<div class="grp"\>\<label class="q"\>Titre — Version A\</label\>\<input id="titreA" placeholder="Ex : Ma prière exaucée"\>\</div\>

  \<div class="grp" id="grpTitreB"\>\<label class="q"\>Titre — Version B\</label\>\<input id="titreB" placeholder="Ex : Mon miracle"\>\</div\>

  \<div class="grp"\>\<label class="q"\>Petit texte sous le titre\</label\>\<input id="pour" placeholder="Ex : Pour Clara, avec tout mon cœur ❤️"\>\</div\>

  \<div class="grp"\>\<label class="q"\>Paroles \<span class="hint"\>(colle depuis Suno)\</span\>\</label\>

    \<textarea id="parolesA" placeholder="Colle ici les paroles…"\>\</textarea\>

    \<label class="check" id="sameWrap"\>\<input type="checkbox" id="sameParoles" checked\> Mêmes paroles pour la Version A et la Version B\</label\>

  \</div\>

  \<div class="grp" id="grpParolesB" style="display:none"\>\<label class="q"\>Paroles — Version B\</label\>\<textarea id="parolesB" placeholder="Paroles différentes pour la version B…"\>\</textarea\>\</div\>

  \<button class="btn" id="go" type="button"\>🚀 Créer et publier les fiches\</button\>

  \<div class="err" id="err"\>\</div\>

  \<div class="out" id="out"\>

    \<h3\>📦 À déposer sur Bunny\</h3\>

    \<div style="font-size:13px;color:var(--muted);margin-bottom:10px"\>Crée un dossier \<b id="o-folder"\>\</b\> sur Bunny et mets-y ces fichiers (noms exacts) :\</div\>

    \<div id="o-files"\>\</div\>

    \<h3\>🔎 À vérifier (pour toi)\</h3\>

    \<div id="o-finals"\>\</div\>

    \<h3\>📩 À envoyer à la cliente\</h3\>

    \<div class="send"\>Le SEUL lien à transmettre :\<br\>\<a id="o-valid" href="\#" target="\_blank"\>\</a\> \<button class="btn copy" type="button" id="copyValid"\>Copier\</button\>\</div\>

  \</div\>

\</div\>

\<div class="toast" id="toast"\>\</div\>

\<script\>

function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=\>t.classList.remove('show'),1700);}

function val(id){return document.getElementById(id).value;}

function radio(n){const el=document.querySelector('input\[name="'+n+'"\]:checked');return el?el.value:'';}

document.querySelectorAll('input\[name="versions"\]').forEach(r=\>r.addEventListener('change',()=\>{

  const two=radio('versions')==='2';

  document.getElementById('grpTitreB').style.display=two?'block':'none';

  document.getElementById('sameWrap').style.display=two?'flex':'none';

  if(\!two) document.getElementById('grpParolesB').style.display='none';

  else document.getElementById('grpParolesB').style.display=document.getElementById('sameParoles').checked?'none':'block';

}));

document.getElementById('sameParoles').addEventListener('change',(e)=\>{

  document.getElementById('grpParolesB').style.display=e.target.checked?'none':'block';

});

document.getElementById('go').onclick=async()=\>{

  const err=document.getElementById('err');err.classList.remove('show');

  const btn=document.getElementById('go');

  const two=radio('versions')==='2';

  const payload={

    password:val('password'), id:val('id'), prenom:val('prenom'),

    versions:radio('versions'), type:radio('type'),

    titreA:val('titreA'), titreB:val('titreB'), pour:val('pour'),

    parolesA:val('parolesA'),

    parolesB:(two && \!document.getElementById('sameParoles').checked)?val('parolesB'):''

  };

  btn.disabled=true;btn.textContent='⏳ Publication en cours…';

  try{

    const r=await fetch('/api/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});

    const data=await r.json();

    if(\!r.ok){throw new Error(data.error||'Erreur inconnue');}

    document.getElementById('o-folder').textContent=data.folder+'/';

    document.getElementById('o-files').innerHTML=data.filesToUpload.map(f=\>

      '\<div class="file"\>\<span\>'+f+'\</span\>\<button class="btn copy" type="button" onclick="navigator.clipboard.writeText(\\''+f+'\\').then(()=\>toast(\\'Copié \!\\'))"\>copier\</button\>\</div\>').join('');

    document.getElementById('o-finals').innerHTML=data.finalLinks.map(l=\>

      '\<div style="margin-bottom:8px;font-size:14px"\>'+l.label+' : \<a href="'+l.url+'" target="\_blank"\>'+l.url+'\</a\>\</div\>').join('');

    const va=document.getElementById('o-valid');va.href=data.validationLink;va.textContent=data.validationLink;

    document.getElementById('copyValid').onclick=()=\>navigator.clipboard.writeText(data.validationLink).then(()=\>toast('Lien copié \!'));

    document.getElementById('out').classList.add('show');

    document.getElementById('out').scrollIntoView({behavior:'smooth'});

  }catch(e){

    err.textContent='❌ '+e.message;err.classList.add('show');

  }finally{

    btn.disabled=false;btn.textContent='🚀 Créer et publier les fiches';

  }

};

\</script\>

\</body\>

\</html\>

## Tests (logique, en local si possible)

1. Structure du projet correcte (index.html à la racine, api/publish.js, package.json).  
2. index.html : bascule 1/2 versions (affiche/masque Titre B), case « mêmes paroles » (affiche/masque la 2ᵉ zone), le formulaire s'affiche sans erreur JS.  
3. api/publish.js : logique de nommage correcte (fichiers {id}-a.mp3, dossier {id}/), fiches au format attendu (chansons/{id}-a.json, extraits/{id}-choix.json), rejet si mot de passe absent, gestion du cas 1 vs 2 versions et audio/vidéo (extension). NB : le test réel (commit GitHub) nécessite les variables d'environnement en ligne sur Vercel.

Puis commit et push sur main (dépôt storybeat-moteur).  
