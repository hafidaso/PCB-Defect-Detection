# 🏭 PCBScan - Documentation Officielle

**Créé par Hafida Belayd**

Bienvenue dans la documentation officielle de **PCBScan**, une application web intelligente conçue pour numériser, analyser et détecter les défauts sur les circuits imprimés (PCB) grâce à l'Intelligence Artificielle, la vision par ordinateur (Computer Vision) et le traitement d'images en temps réel.

---

## 🏗️ Architecture du Projet

Le projet est divisé en deux parties principales :
1. **Frontend (Dashboard)** : Construit avec React.js, Vite et TailwindCSS.
2. **Backend (API)** : Construit avec Python, FastAPI, OpenCV et EasyOCR.

---

## 🖥️ 1. Le Frontend : Le Dashboard (PCBScanDashboard)

Le tableau de bord est l'interface utilisateur (UI). Il a été conçu avec une approche **"Glassmorphism"** moderne, offrant des effets de flou (blur), des dégradés subtils, et des animations fluides.

### Fonctionnalités principales :
*   **Scanner en direct (Live Camera)** : 
    *   Utilise l'API du navigateur (`navigator.mediaDevices.getUserMedia`) pour accéder à la caméra (ordinateur ou smartphone).
    *   **Auto-Capture** : Le frontend envoie silencieusement une image au backend toutes les secondes. Si le backend détecte une carte PCB, l'image est capturée automatiquement.
    *   **Animation Laser** : Une animation visuelle de "scan" balaie l'écran pendant que la caméra cherche un circuit imprimé.
*   **Upload Manuel** : Possibilité de télécharger une image existante depuis l'appareil.
*   **Indicateurs Visuels & UX** :
    *   Barres de progression animées lors du traitement.
    *   Badge exclusif **"CACHE HIT ⚡"** lorsqu'un PCB est reconnu instantanément depuis la mémoire.
    *   Bouton pour copier rapidement le texte extrait.
*   **Design Responsive & Moderne** : Couleurs modernes, ombres douces et bordures élégantes.

---

## ⚙️ 2. Le Backend : Le Serveur (main.py)

Le backend est le cerveau de l'application. Il reçoit les images, les analyse, et communique avec l'agent IA externe.

### A. Endpoint `/detect-box` (Filtres d'Intelligence Visuelle)
Ce point d'accès est appelé en boucle par la caméra en direct pour décider s'il faut prendre une photo. Il utilise **OpenCV** avec 3 filtres stricts :
1.  **Filtre Anti-Personne (Face Rejection)** : Utilise `Haar Cascades` pour détecter les visages. Si un visage occupe plus de 10% de l'image (quelqu'un regarde la caméra), la capture est annulée.
2.  **Filtre Géométrique (Formes)** : Utilise `cv2.Canny` (détection de contours) pour repérer les plus grands objets ayant exactement 4 angles (rectangles ou carrés typiques des PCB).
3.  **Filtre de Densité de Composants (Anti-Vide)** : Une feuille blanche est rectangulaire, mais ce n'est pas un PCB. Le script calcule la densité des "arêtes" (composants/pistes/textes) dans le rectangle. Si la densité dépasse 3%, la présence de la carte est confirmée et validée !

### B. Endpoint `/process-image` (Le Moteur Principal)
Ce point d'accès gère l'analyse finale de la photo haute résolution.
1.  **Extraction d'Informations (EasyOCR & Vision)** : Utilise un modèle de Deep Learning pour identifier les références et caractéristiques du circuit imprimé.
2.  **Le Système de Cache Ultra-Rapide** : 
    *   Pour éviter d'attendre à chaque scan, l'analyse est comparée aux anciens scans stockés dans `cache.json`.
    *   Il utilise `difflib.SequenceMatcher`. Si la carte correspond à plus de 85% avec un ancien scan, le backend renvoie **instantanément** la réponse stockée sans contacter l'IA.
3.  **Analyse de Défauts IA (ABA Fusion)** : 
    *   S'il s'agit d'une nouvelle analyse, les données sont envoyées via un **Webhook** à *Fusion AI API*.
    *   L'agent IA analyse le contenu et retourne les éventuels défauts de fabrication, anomalies de soudure ou composants manquants.
    *   Le résultat est ensuite sauvegardé dans la mémoire (`cache.json`) pour les futures requêtes.

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
    # Le dashboard tournera sur http://localhost:5173 (ou selon Vite)
    ```

---
*Ce projet démontre une intégration parfaite entre la vision par ordinateur (Computer Vision), l'apprentissage profond (Deep Learning), et l'intelligence artificielle générative (LLM Webhooks) pour le contrôle qualité industriel.*
