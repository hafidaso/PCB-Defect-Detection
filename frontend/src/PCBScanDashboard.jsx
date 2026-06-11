import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';

const PCBScanDashboard = () => {
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [isCached, setIsCached] = useState(false);
  
  // Camera states
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [streamObj, setStreamObj] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectionInterval = useRef(null);
  const wsRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Upload image manually
  const handleImageUpload = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const scale = Math.min(MAX_WIDTH / img.width, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          const compressedFile = new File([blob], file.name, { type: "image/jpeg" });
          setImageFile(compressedFile);
          setImagePreview(URL.createObjectURL(compressedFile));
          resetResults();
          if (isCameraActive) stopCamera();
        }, 'image/jpeg', 0.8);
      };
      img.src = URL.createObjectURL(file);
    }
  };

  const resetResults = () => {
    setOcrText('');
    setAiResponse('');
    setErrorMsg('');
    setIsCached(false);
  };

  const handleClear = () => {
    setImageFile(null);
    setImagePreview(null);
    resetResults();
    const fileInput = document.getElementById('file-upload');
    if (fileInput) fileInput.value = '';
    if (isCameraActive) stopCamera();
  };

  const handleCopyText = () => {
    if (ocrText) {
      navigator.clipboard.writeText(ocrText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Camera Functions
  const startCamera = async () => {
    handleClear();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      setStreamObj(stream);
      setIsCameraActive(true);
      
      // Initialiser la connexion WebSocket
      isProcessingRef.current = false;
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const wsUrl = API_URL.replace(/^http/, 'ws') + "/ws/detect-box";
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.detected && !isProcessingRef.current) {
          isProcessingRef.current = true;
          // Si le backend détecte un PCB, capturer manuellement l'image et stopper
          captureFrame(true);
        }
      };
    } catch (err) {
      console.error(err);
      setErrorMsg("Impossible d'accéder à la caméra. Vérifiez les permissions.");
    }
  };

  useEffect(() => {
    if (isCameraActive && videoRef.current && streamObj) {
      videoRef.current.srcObject = streamObj;
    }
  }, [isCameraActive, streamObj]);

  const stopCamera = () => {
    if (streamObj) {
      const tracks = streamObj.getTracks();
      tracks.forEach(track => track.stop());
    }
    setStreamObj(null);
    setIsCameraActive(false);
    if (detectionInterval.current) {
      clearInterval(detectionInterval.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // Auto-capture frame extraction and check
  const captureFrame = useCallback(async (isManual = false) => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    const MAX_WIDTH = 800;
    const scale = Math.min(MAX_WIDTH / video.videoWidth, 1);
    
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      
      const file = new File([blob], "camera_capture.jpg", { type: "image/jpeg" });
      
      if (isManual) {
        stopCamera();
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
        processImage(file);
        return;
      }

      // Auto-detection via WebSocket
      try {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const arrayBuffer = await blob.arrayBuffer();
          wsRef.current.send(arrayBuffer);
        }
      } catch (err) {
        console.error("WebSocket frame send error", err);
      }
    }, 'image/jpeg', 0.8);
  }, []);

  // Set up auto-capture interval
  useEffect(() => {
    if (isCameraActive) {
      detectionInterval.current = setInterval(() => {
        captureFrame(false);
      }, 300); // Check every 300ms for faster real-time detection
    } else {
      if (detectionInterval.current) clearInterval(detectionInterval.current);
    }
    return () => {
      if (detectionInterval.current) clearInterval(detectionInterval.current);
    };
  }, [isCameraActive, captureFrame]);


  // Send image to backend
  const processImage = async (fileToProcess) => {
    if (loading) return; // Empêcher les appels multiples
    const file = fileToProcess || imageFile;
    if (!file) return;
    
    setLoading(true);
    resetResults();
    setAiResponse('Traitement en cours via OpenCV et Fusion AI...');
    setOcrText('Extraction du texte...');
    
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await axios.post(`${API_URL}/process-image`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      const data = res.data;
      
      if (data.error) {
         setErrorMsg(`❌ Error: ${data.error}`);
         setAiResponse("L'analyse a échoué.");
         setOcrText('');
      } else {
         setOcrText(data.ocr_text || "Aucun texte extrait.");
         setAiResponse(data.ai_response || "✅ Analyse terminée.");
         setIsCached(data.cached || false);
      }
      
    } catch (error) {
      console.error(error);
      setErrorMsg("❌ Connection failed to Backend server.");
      setAiResponse('');
      setOcrText('');
    } finally {
      setLoading(false);
      isProcessingRef.current = false; // Réinitialiser après traitement
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-emerald-50/50 p-8 font-sans flex text-slate-800">
      
      {/* 🌟 Glassmorphism Sidebar */}
      <div className="w-72 bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 text-white p-7 rounded-3xl mr-8 shadow-2xl shadow-emerald-900/20 flex flex-col relative overflow-hidden group">
        {/* Decorative background glow */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/20 rounded-full blur-3xl group-hover:bg-emerald-400/30 transition duration-700"></div>
        
        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center mb-10">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30 mr-3">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"></path></svg>
            </div>
            <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-teal-200 tracking-tight">PCBScan</h2>
          </div>

          <ul className="space-y-4 text-sm text-slate-300 flex-1 font-medium">
            <li className="hover:text-white hover:translate-x-2 transform cursor-pointer transition-all duration-300 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600 mr-3"></span> 1. Objectifs
            </li>
            <li className="hover:text-white hover:translate-x-2 transform cursor-pointer transition-all duration-300 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600 mr-3"></span> 2. Détection OpenCV
            </li>
            <li className="hover:text-white hover:translate-x-2 transform cursor-pointer transition-all duration-300 flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600 mr-3"></span> 3. Deep Learning OCR
            </li>
            
            <div className="h-px bg-gradient-to-r from-transparent via-slate-700 to-transparent my-6"></div>
            
            <li className="text-emerald-300 font-bold flex items-center bg-white/5 p-3 rounded-xl border border-white/10 shadow-inner">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-3 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
              PCBScan Studio
            </li>
          </ul>

          <div className="mt-auto border-t border-slate-700/50 pt-5">
            <div className="text-xs text-slate-400 flex items-center justify-center mb-1">
              <span>Créé par</span>
            </div>
            <div className="text-center font-bold text-sm text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
              Hafida Belayd
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 grid grid-cols-12 gap-8 pt-4">
        
        {/* Left Column: Upload / Camera */}
        <div className="col-span-4 space-y-6">
          <div className="bg-white/70 backdrop-blur-xl p-7 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 text-center relative overflow-hidden group">
            <div className={`absolute top-0 left-0 w-full h-1.5 ${loading ? 'bg-gradient-to-r from-emerald-400 to-teal-500 animate-[progress_2s_ease-in-out_infinite]' : 'bg-slate-100'}`}></div>
            
            <h3 className="font-bold text-slate-700 mb-6 text-left flex justify-between items-center text-lg">
              <span className="flex items-center">
                <span className="bg-teal-100 text-teal-700 w-8 h-8 rounded-lg flex items-center justify-center mr-3 text-sm">1</span> 
                Image Source
              </span>
              {imageFile && (
                <button onClick={handleClear} className="text-xs bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 px-3 py-1.5 rounded-xl transition-colors font-medium flex items-center border border-red-100">
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                  Effacer
                </button>
              )}
            </h3>

            {/* Camera View */}
            {isCameraActive ? (
              <div className="mb-6 relative rounded-2xl overflow-hidden border-[3px] border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.3)] bg-slate-900">
                <video ref={videoRef} autoPlay playsInline className="w-full h-56 object-cover opacity-90"></video>
                {/* Scanning Animation Overlay */}
                <div className="absolute inset-0 border-[3px] border-dashed border-white/50 m-6 rounded-xl"></div>
                <div className="absolute top-0 left-0 w-full h-1 bg-emerald-400/80 shadow-[0_0_15px_rgba(52,211,153,1)] animate-[scan_3s_ease-in-out_infinite]"></div>
                
                <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  <span className="bg-slate-900/80 backdrop-blur-md text-emerald-300 font-mono text-xs px-4 py-1.5 rounded-full border border-emerald-500/30 flex items-center">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse"></span>
                    Analyse IA en temps réel...
                  </span>
                </div>
                <canvas ref={canvasRef} className="hidden"></canvas>
                <button onClick={() => captureFrame(true)} className="absolute top-3 right-3 bg-white/20 hover:bg-white/40 backdrop-blur-md text-white p-2 rounded-full transition border border-white/30" title="Capture manuelle">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                </button>
                <button onClick={stopCamera} className="absolute top-3 left-3 bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-full transition shadow-lg" title="Fermer">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 mb-6">
                <button 
                  onClick={startCamera}
                  className="group relative flex flex-col items-center justify-center p-5 rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-dashed border-emerald-200 hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-100 transition-all duration-300"
                >
                  <div className="bg-white p-3 rounded-full shadow-sm text-emerald-500 group-hover:scale-110 transition-transform duration-300 mb-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                  </div>
                  <span className="text-sm font-bold text-emerald-700">Scanner Live</span>
                </button>
                
                <div className="group relative flex flex-col items-center justify-center p-5 rounded-2xl bg-white border-2 border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50 transition-all duration-300">
                  <input 
                    id="file-upload" type="file" accept="image/*" onChange={handleImageUpload} 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                  />
                  <div className="bg-slate-50 p-3 rounded-full shadow-sm text-slate-400 group-hover:text-blue-500 group-hover:bg-white group-hover:scale-110 transition-all duration-300 mb-3">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                  </div>
                  <span className="text-sm font-bold text-slate-600 group-hover:text-blue-600">Upload Image</span>
                </div>
              </div>
            )}
            
            {errorMsg && (
              <div className="bg-red-50/80 backdrop-blur-sm border border-red-200 p-4 mb-6 rounded-2xl flex items-start text-left shadow-sm">
                <svg className="w-5 h-5 text-red-500 mt-0.5 mr-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <p className="text-red-700 text-sm font-medium">{errorMsg}</p>
              </div>
            )}
            
            <button 
              onClick={() => processImage()}
              className={`relative overflow-hidden w-full py-4 rounded-2xl font-bold text-lg transition-all duration-300 flex justify-center items-center shadow-lg ${
                !imageFile || loading || isCameraActive
                ? 'bg-slate-100 text-slate-400 shadow-none cursor-not-allowed border border-slate-200' 
                : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-400 hover:to-teal-400 hover:shadow-emerald-500/30 hover:-translate-y-1 border border-emerald-400/50'
              }`}
              disabled={!imageFile || loading || isCameraActive}
            >
              {loading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                  Analyse IA en cours...
                </>
              ) : (
                <>
                  <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                  Lancer l'Analyse
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Column: Previews & Results */}
        <div className="col-span-8 flex flex-col space-y-6">
          
          {/* Images Row */}
          <div className="grid grid-cols-2 gap-6">
            {/* Original Image Card */}
            <div className="bg-white/70 backdrop-blur-xl p-5 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 h-64 flex flex-col group">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center">
                  <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  Source Visuelle
                </span>
                {imageFile && <span className="bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1 rounded-lg text-xs">{(imageFile.size / 1024 / 1024).toFixed(2)} MB</span>}
              </div>
              <div className="flex-1 bg-gradient-to-b from-slate-50 to-slate-100 rounded-2xl flex items-center justify-center overflow-hidden border border-slate-200/50 shadow-inner relative">
                {imagePreview ? (
                  <img src={imagePreview} alt="Originale" className="w-full h-full object-contain p-2 drop-shadow-md transition-transform duration-500 group-hover:scale-[1.03]" />
                ) : (
                  <div className="text-center">
                    <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm text-slate-200">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    </div>
                    <span className="text-slate-400 text-sm font-medium">Aucune image fournie</span>
                  </div>
                )}
              </div>
            </div>
            
            {/* Status Card */}
            <div className="bg-slate-900 p-5 rounded-3xl shadow-xl shadow-slate-900/10 border border-slate-800 h-64 flex flex-col relative overflow-hidden">
              {/* Background glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-emerald-500/10 blur-3xl rounded-full"></div>
              
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center z-10">
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"></path></svg>
                Statut du Serveur
              </span>
              
              <div className="flex-1 bg-slate-950/50 rounded-2xl flex items-center justify-center border border-slate-800 relative p-6 z-10 shadow-inner">
                {!imagePreview ? (
                  <span className="text-slate-500 flex items-center font-medium bg-slate-900 px-4 py-2 rounded-xl border border-slate-800">
                    <span className="w-2 h-2 bg-slate-600 rounded-full mr-3"></span>
                    En attente d'image...
                  </span>
                ) : (
                  loading ? (
                    <div className="w-full">
                      <div className="flex justify-between text-xs text-emerald-400 mb-2 font-mono bg-emerald-950/30 px-3 py-1.5 rounded-lg border border-emerald-900/50">
                        <span className="flex items-center"><span className="w-1.5 h-1.5 bg-emerald-400 rounded-full mr-2 animate-ping"></span>[OCR] Extraction texte</span>
                        <span>Traitement...</span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-2 mb-4 overflow-hidden border border-slate-700">
                        <div className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full animate-[progress_2s_ease-in-out_infinite] relative">
                          <div className="absolute inset-0 bg-white/20 w-full h-full animate-[progress_1s_linear_infinite]"></div>
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-purple-400 font-mono bg-purple-950/30 px-3 py-1.5 rounded-lg border border-purple-900/50 opacity-60">
                        <span>[AI] ABA Fusion Node</span>
                        <span>En attente...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-3 border border-emerald-500/20">
                        <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                      </div>
                      <span className="text-emerald-300 font-bold text-lg block">Opération Réussie</span>
                      {isCached && (
                        <span className="mt-3 inline-flex items-center bg-gradient-to-r from-amber-200 to-yellow-400 text-yellow-900 text-xs px-3 py-1.5 rounded-xl font-bold shadow-lg shadow-yellow-500/20 transform hover:scale-105 transition">
                          <svg className="w-3.5 h-3.5 mr-1" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd"></path></svg>
                          Chargé depuis le Cache
                        </span>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 flex-1">
            {/* OCR Result Card */}
            <div className="bg-white/70 backdrop-blur-xl p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-700 flex items-center">
                  <div className="bg-blue-100 text-blue-600 w-8 h-8 rounded-xl flex items-center justify-center mr-3 shadow-inner border border-blue-200">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7"></path></svg>
                  </div>
                  Texte Brut (OCR)
                </h3>
                {ocrText && (
                  <button onClick={handleCopyText} className="text-xs text-slate-500 hover:text-blue-600 font-semibold transition-colors flex items-center bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 px-3 py-1.5 rounded-xl shadow-sm">
                    {copied ? (
                      <><svg className="w-3.5 h-3.5 mr-1 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg> Copié !</>
                    ) : (
                      <><svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg> Copier</>
                    )}
                  </button>
                )}
              </div>
              
              <div className="bg-slate-50 p-5 rounded-2xl flex-1 border border-slate-200/60 overflow-y-auto max-h-56 shadow-inner relative">
                {loading ? (
                  <div className="animate-pulse flex flex-col space-y-3">
                    <div className="h-2.5 bg-slate-200 rounded-full w-3/4"></div>
                    <div className="h-2.5 bg-slate-200 rounded-full w-full"></div>
                    <div className="h-2.5 bg-slate-200 rounded-full w-5/6"></div>
                    <div className="h-2.5 bg-slate-200 rounded-full w-1/2"></div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600 font-mono whitespace-pre-wrap leading-relaxed">
                    {ocrText || "Le texte scanné sur le PCB apparaîtra ici."}
                  </p>
                )}
              </div>
            </div>

            {/* AI Response Card */}
            <div className="bg-white/70 backdrop-blur-xl p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 flex flex-col relative overflow-hidden">
              {/* Magic glow effect in corner */}
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-purple-400/10 blur-3xl rounded-full"></div>
              
              <div className="flex justify-between items-center mb-4 relative z-10">
                <h3 className="font-bold text-slate-700 flex items-center">
                  <div className="bg-gradient-to-br from-purple-100 to-fuchsia-100 text-purple-600 w-8 h-8 rounded-xl flex items-center justify-center mr-3 shadow-inner border border-purple-200">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                  </div>
                  Analyse de Défauts (IA)
                </h3>
              </div>

              <div className={`p-5 flex-1 rounded-2xl border transition-all duration-500 overflow-y-auto max-h-56 shadow-inner relative z-10 ${
                aiResponse && !loading && !errorMsg 
                ? (isCached ? 'bg-gradient-to-br from-yellow-50 to-amber-50 border-yellow-200' : 'bg-gradient-to-br from-purple-50 to-fuchsia-50 border-purple-200') 
                : 'bg-slate-50 border-slate-200/60'
              }`}>
                {loading ? (
                  <div className="flex flex-col items-center justify-center h-full text-purple-500/60">
                    <div className="relative mb-4">
                      <svg className="animate-spin h-10 w-10 text-purple-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      <svg className="w-4 h-4 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-purple-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"></path></svg>
                    </div>
                    <span className="text-sm font-bold tracking-wide animate-pulse">Consultation de Fusion AI...</span>
                  </div>
                ) : (
                  <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">
                    {aiResponse || "L'agent IA de ABA Fusion renverra les défauts détectés sur le PCB ici."}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(50%); }
          100% { transform: translateX(200%); }
        }
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        /* Custom scrollbar for text areas */
        ::-webkit-scrollbar {
          width: 6px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.5);
          border-radius: 20px;
        }
      `}} />
    </div>
  );
};

export default PCBScanDashboard;
