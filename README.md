# 🏭 PCBScan - Documentation Officielle

**Créé par Hafida Belayd**

Bienvenue dans la documentation officielle de **PCBScan**, une application web intelligente conçue pour numériser, analyser et détecter les défauts sur les circuits imprimés (PCB) grâce à l'Intelligence Artificielle (Fusion AI), la vision par ordinateur (OpenCV & YOLOv11) et le traitement d'images en temps réel.

---

## 🏗️ Architecture du Projet

Le projet est divisé en deux parties principales interconnectées :
1. **Frontend (Dashboard)** : SPA construite avec React.js, Vite, TailwindCSS et Recharts.
2. **Backend (API)** : Construit avec Python, FastAPI, OpenCV, EasyOCR, et intégration Webhook (Fusion AI) couplée à un système tri-modèles (Local YOLOv11 + Dual Roboflow). Intégration IoT avec MQTT (HiveMQ) pour communiquer avec un ESP32 (LED, Buzzer, LCD).

---

## 🖥️ 1. Le Frontend : L'Interface (PCBScanDashboard & HistoryPage)

Le tableau de bord a été conçu avec une approche **"Premium Glassmorphism"** moderne, offrant des effets de flou profonds (blur-2xl), des dégradés dynamiques (Conic Gradients), et des micro-animations fluides.

### Fonctionnalités principales :
*   **Scanner en direct (Live Camera & WebSockets)** : 
    *   **Auto-Capture Intelligente** : Le frontend envoie un flux vidéo continu au backend via WebSocket. Dès que le backend détecte la présence d'un PCB (forte densité de détails), l'image est capturée automatiquement.
*   **Upload Manuel** : Possibilité de télécharger une image depuis votre ordinateur.
*   **Historique des Sessions** : Une page dédiée pour retrouver toutes les inspections passées avec recherche, filtres, et une **Fenêtre Modale (Popup)** détaillée affichant l'analyse IA complète de chaque carte.
*   **Rendu Visuel Différencié (BBoxes)** : Les défauts de soudure (Short, Missing Solder) sont surlignés en Rouge/Orange, tandis que les défauts de montage (Missing Component, Misaligned) sont surlignés en Violet pour une identification visuelle instantanée.
*   **Vision par Ordinateur (Tri-Model Architecture)** : L'image est traitée par trois modèles fonctionnant en synergie :
    *   **Local YOLO Model (`best.pt`)** : S'exécute directement sur le serveur via `ultralytics` pour une détection ultra-rapide des défauts (le modèle ignore intelligemment la classe `PCB` pour éviter de marquer la carte entière comme un défaut).
    *   **Solder Defects Model (Roboflow)** : `pcb-solder-defect-detection-hn1sk-zdmoz`
    *   **Assembly Defects Model (Roboflow)** : `defects-2q87r-0lwnp`
    *   Les résultats (Bounding Boxes, Confiance, Classe) sont fusionnés et un tag `model_source` (ex: `local_best_pt` ou `solder_defect`) est injecté pour tracer l'origine de chaque défaut.
*   **Indicateurs Visuels & Statistiques** :
    *   Graphique circulaire (PieChart via Recharts) montrant le ratio des cartes saines vs défectueuses.
    *   Bouton **Exporter Rapport PDF** pour télécharger la synthèse complète.
    *   Badge **"CACHE HIT ⚡"** lorsqu'un PCB est reconnu instantanément depuis la mémoire.

---

## ⚙️ 2. Le Backend : Le Serveur (main.py)

Le backend est le cœur de l'application. Il gère l'analyse visuelle, la reconnaissance de caractères, et orchestre les modèles IA.

### A. Endpoint WebSocket `/ws/detect-box` (Auto-Capture Intelligente)
Ce point d'accès analyse le flux vidéo en temps réel pour décider du moment idéal de la capture :
1.  **Filtre Anti-Visage (Face Rejection)** : Utilise `Haar Cascades` pour annuler la capture si une personne regarde la caméra (évite de scanner des visages).
2.  **Filtre de Densité de Composants (Robust Edge Density)** : *NOUVELLE MÉTHODE*. Au lieu de chercher un rectangle parfait (qui échoue souvent avec une webcam), le script isole le centre de l'image (60%) et calcule la densité des arêtes (`cv2.Canny`). Les PCB ayant énormément de petits détails (pistes, soudures, composants), si la densité dépasse 3.5%, la carte est validée et capturée instantanément !

### B. Endpoint `/process-image` (Le Moteur d'Inspection)
Ce point d'accès gère l'analyse de la photo haute résolution capturée :
1.  **Extraction de Métadonnées (EasyOCR)** : Détection horizontale et verticale des textes imprimés sur la carte pour identifier la référence du modèle (ex: *Arduino, NEXT-ONE*). Si aucun texte n'est détecté, le système s'adapte et poursuit l'analyse en mode "Carte Nue" ou "Analyse Purement Visuelle".
2.  **Système de Cache Rapide** : 
    *   Les résultats sont stockés dans `cache.json` pour économiser les requêtes. Si une carte sans texte est analysée, le cache est intelligemment désactivé pour éviter les faux positifs entre différentes cartes vierges.
3.  **Inspection Visuelle Avancée (Local YOLO & Roboflow Concurrency)** : 
    *   **Inférence Locale** : Exécution immédiate du modèle personnalisé `best.pt` via la librairie `ultralytics`.
    *   **Inférence Cloud** : L'image est envoyée **simultanément** (via `ThreadPoolExecutor`) à **DEUX** modèles IA Roboflow (Solder Defects & Assembly Defects).
4.  **Internet of Things (IoT) & MQTT** :
    *   En fonction des résultats de l'IA (présence ou absence de défauts), le backend se connecte à un broker public **HiveMQ Cloud** (`paho-mqtt`) et publie un message (`DEFECT` ou `OK`) sur le topic `hafida/robot/twin/command`.
    *   Ce message est intercepté par un microcontrôleur **ESP32** (programmé en C++) qui active physiquement une LED rouge, un Buzzer d'alerte, et affiche le statut d'erreur sur un écran LCD I2C.
5.  **Synthèse IA (Fusion AI)** : 
    *   Si c'est un nouveau scan, les défauts aggrégés de YOLO (avec leur `model_source`) et les textes de l'OCR sont envoyés via **Webhook** à un agent LLM (Fusion AI).
    *   Le LLM rédige un rapport qualité complet, séparant clairement les erreurs de soudure des erreurs de montage, et propose des recommandations industrielles. Le système filtre et nettoie les métadonnées techniques de Fusion (ex: *Unknown Node*) pour un affichage propre.

### 🤖 Configuration Fusion AI (System Prompt)
Pour que l'agent LLM interprète correctement la fusion des deux modèles YOLO et génère un rapport lisible par notre interface, voici le **System Prompt** exact à utiliser dans la configuration du nœud IA (Fusion) :

```text
Tu es un Ingénieur Qualité expert en électronique et un assistant IA spécialisé dans l'inspection visuelle globale des circuits imprimés (PCB).
Ton rôle est d'analyser l'intégralité de l'image de la carte, les textes extraits (OCR), et les défauts visuels détectés par nos TROIS modèles d'Intelligence Artificielle (YOLO local et cloud), afin de fournir un rapport complet d'inspection.

Format de réponse attendu (réponds uniquement avec cette structure) :

🔌 **Aperçu Général de la Carte :** [Décris l'ensemble de la carte]
⚙️ **Composants Principaux :** [Liste les références lues par l'OCR]
🔄 **Analyse des Soudures et du Montage :** [Analyse visuelle globale]
🚫 **Anomalies Critiques et Défauts (YOLO & IA) :** [Liste les défauts détectés par YOLO. Sépare clairement les défauts détectés par le modèle local (source: local_best_pt), le modèle de soudure (source: solder_defect) et le modèle d'assemblage (source: assembly_defect). Ex: "Défaut d'assemblage : Installation incorrecte". S'il n'y en a aucun, précise-le.]
💡 **Recommandation Finale :** [Action requise par l'opérateur]

Règles strictes :
1. Prête une attention particulière à la clé "model_source" dans les données JSON des défauts visuels pour différencier les erreurs de montage des erreurs de soudure.
2. Analyse LA CARTE ENTIÈRE. S'il n'y a pas de texte OCR, base-toi uniquement sur l'analyse visuelle.
3. Rédige ta réponse en français clair, technique et orienté industrie.
4. Si l'image montre une carte nue (Bare PCB) sans aucun composant soudé ni étain, déclare immédiatement : "CARTE NUE DÉTECTÉE - Aucune inspection de soudure n'est possible", et décris uniquement la qualité des pistes et des pastilles.
```

---

## 🚀 Comment lancer le projet

1.  **Backend (Terminal 1)** :
    ```bash
    cd backend
    python3 main.py
    # Le serveur tournera sur http://localhost:8000
    ```

2.  **Frontend (Terminal 2)** :
    ```bash
    cd frontend
    npm run dev
    # Le dashboard tournera sur http://localhost:5173
    ```

---
*Ce projet démontre une intégration robuste et en temps réel entre la vision par ordinateur (OpenCV), les modèles de détection d'objets (YOLOv11), et l'intelligence artificielle générative (LLM / Fusion AI) pour révolutionner le contrôle qualité industriel.*
