import React, { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import PcbVisionRenderer from './PcbVisionRenderer';

const PCBScanDashboard = ({ onNavigate }) => {
  const parseAiResponse = (text) => {
    if (!text || text.length < 20) return null;
    
    // Updated regex to handle formats like "🔌 **Composant / Carte détecté(e) :** NANO ESP32"
    // It captures everything until the next line that contains a bold header "**" or end of string.
    const extractSection = (keywordRegex) => {
      const regex = new RegExp(`\\*\\*[^\\*]*?(?:${keywordRegex})[^\\*]*?\\*\\*[:\\s]*([\\s\\S]*?)(?=\\n[^\\n]*\\*\\*|$)`, 'i');
      const match = text.match(regex);
      return match ? match[1].trim() : null;
    };

    const component = extractSection('المكون|المنتج|Composant|Board|Product');
    const func = extractSection('الوظيفة|Fonction|Function');
    const status = extractSection('حالة التركيب|Statut|Status|Montage');
    const defects = extractSection('العيوب|Défauts|Defects');
    const anomalies = extractSection('Anomalies|Critiques|Rejet');
    const recommendations = extractSection('التوصيات|Recommandation|Recommendations');

    if (!component && !status && !defects) return null;
    
    return {
      component: component || 'Non spécifié',
      function: func || '',
      status: status || 'Inconnu',
      defects: defects || 'Aucun défaut détecté',
      anomalies: anomalies || '',
      recommendations: recommendations || ''
    };
  };
  
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [ocrDetails, setOcrDetails] = useState([]);
  const [processTime, setProcessTime] = useState(0);
  const [isZoomed, setIsZoomed] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 800, height: 600 });
  const [scanStats, setScanStats] = useState(() => {
    const saved = localStorage.getItem('pcbScanStats');
    return saved ? JSON.parse(saved) : { healthy: 0, defective: 0 };
  });
  const [isExporting, setIsExporting] = useState(false);
  const [arMode, setArMode] = useState(false);
  const [yoloPredictions, setYoloPredictions] = useState(null);
  
  const parsedData = parseAiResponse(aiResponse);
  const dashboardRef = useRef(null);
  const lastRecordedRef = useRef(null); // ✅ To prevent duplicate saves
  
  // Update stats when analysis succeeds
  useEffect(() => {
    if (aiResponse && parsedData && !loading && !errorMsg) {
      // Create a unique identifier for this specific scan result
      const currentResultId = `${imageFile ? imageFile.name : 'Unknown'}-${processTime}`;
      
      // ✅ Only record if we haven't recorded this exact result yet
      if (lastRecordedRef.current !== currentResultId) {
        lastRecordedRef.current = currentResultId;

        const isHealthy = parsedData.status.includes('صحيح') || parsedData.status.includes('جيد') || parsedData.status.includes('Correct');
        
        // Update stats
        setScanStats(prev => {
          const newStats = {
            healthy: prev.healthy + (isHealthy ? 1 : 0),
            defective: prev.defective + (!isHealthy ? 1 : 0)
          };
          localStorage.setItem('pcbScanStats', JSON.stringify(newStats));
          return newStats;
        });

        // Append to history
        const historyItem = {
          id: Date.now().toString(),
          date: new Date().toISOString(),
          filename: imageFile ? imageFile.name : 'Unknown',
          component: parsedData.component,
          function: parsedData.function,
          status: parsedData.status,
          defectsList: parsedData.defects,
          anomalies: parsedData.anomalies,
          recommendations: parsedData.recommendations,
          isHealthy: isHealthy,
          defects: yoloPredictions ? yoloPredictions.length : 0,
          processTime: processTime,
          cached: isCached
        };
        
        const existingHistory = JSON.parse(localStorage.getItem('pcbScanHistory') || '[]');
        localStorage.setItem('pcbScanHistory', JSON.stringify([historyItem, ...existingHistory]));
      }
    }
  }, [aiResponse, parsedData, loading, errorMsg, imageFile, yoloPredictions, processTime, isCached]); // Effect dependencies
  
  const handleExportPDF = async () => {
    if (!dashboardRef.current) return;
    setIsExporting(true);
    try {
      // Fix oklch colors: html2canvas doesn't support CSS oklch().
      // We clone the DOM and replace all oklch computed styles with safe hex equivalents.
      const canvas = await html2canvas(dashboardRef.current, {
        scale: 1.5,
        useCORS: true,
        logging: false,
        backgroundColor: '#f8fafc',
        onclone: (clonedDoc) => {
          // Walk every element in the cloned document and replace unsupported color functions
          const allEls = clonedDoc.querySelectorAll('*');
          const oklchRegex = /oklch\([^)]*\)/g;
          const safeColorMap = {
            // Map known tailwind oklch shades -> safe hex
            emerald: '#10b981', teal: '#14b8a6', slate: '#64748b',
            red: '#ef4444', blue: '#3b82f6', purple: '#a855f7',
            yellow: '#eab308', amber: '#f59e0b', orange: '#f97316',
          };
          allEls.forEach((el) => {
            const style = el.style;
            ['color', 'backgroundColor', 'borderColor', 'boxShadow'].forEach((prop) => {
              if (style[prop] && oklchRegex.test(style[prop])) {
                style[prop] = '#64748b'; // fallback slate
              }
            });
            // Also fix computed background via class scan
            const computed = window.getComputedStyle(el);
            ['backgroundColor', 'borderColor'].forEach((prop) => {
              const val = computed[prop];
              if (val && val.includes('oklch')) {
                el.style[prop] = '#f1f5f9';
              }
            });
          });
        }
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const pdf = new jsPDF('l', 'mm', 'a4'); // landscape for dashboard
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`PCB_Inspection_Report_${new Date().getTime()}.pdf`);
    } catch (err) {
      console.error('PDF Export Error:', err);
      // Fallback: capture just as screenshot
      alert('Export PDF échoué. Utilisez Ctrl+P (impression navigateur) comme alternative.');
    } finally {
      setIsExporting(false);
    }
  };
  
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
          setImageSize({ width: canvas.width, height: canvas.height });
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
    setCopied(false);
    setIsCached(false);
    setOcrDetails([]);
    setYoloPredictions(null);
    setProcessTime(0);
    setIsZoomed(false);
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
    isProcessingRef.current = false; // <-- FIX: Reset the lock when camera stops
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
        setImageSize({ width: canvas.width, height: canvas.height });
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
    // Vérification asynchrone (state) ET synchrone (ref) pour bloquer le double clic instantané
    if (loading || isProcessingRef.current) return; 
    isProcessingRef.current = true; // Verrouiller immédiatement et de façon synchrone
    
    const file = fileToProcess || imageFile;
    if (!file) {
      isProcessingRef.current = false;
      return;
    }
    
    setLoading(true);
    resetResults();
    setAiResponse('Traitement en cours via OpenCV et Fusion AI...');
    setOcrText('Extraction du texte...');
    const startTime = Date.now();
    
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await axios.post(`${API_URL}/process-image`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
          'ngrok-skip-browser-warning': '69420'
        }
      });
      
      const data = res.data;
      const endTime = Date.now();
      setProcessTime(((endTime - startTime) / 1000).toFixed(2));
      
      if (data.error) {
         setErrorMsg(`❌ Error: ${data.error}`);
         setAiResponse("L'analyse a échoué.");
         setOcrText('');
         setOcrDetails([]);
      }
      if (data.status === 'success') {
        setOcrText(data.ocr_text || '');
        setOcrDetails(data.ocr_details || []);
        setAiResponse(data.ai_response || '');
        setYoloPredictions(data.predictions || null);
        setIsCached(data.cached || false);
      }
      
    } catch (error) {
      console.error(error);
      setErrorMsg("❌ Connection failed to Backend server.");
      setAiResponse('');
      setOcrText('');
    } finally {
      setLoading(false);
      // Maintenir le verrou 500ms après la fin pour éviter les clics répétitifs
      setTimeout(() => {
        isProcessingRef.current = false; 
      }, 500);
    }
  };

  return (
    <div className="min-h-screen bg-dot-matrix bg-[conic-gradient(at_top_right,_var(--tw-gradient-stops))] from-slate-100 via-teal-50 to-emerald-100 p-8 font-sans flex text-slate-800 selection:bg-emerald-200">
      
      {/* 🌟 Premium Glassmorphism Sidebar */}
      <div className="w-72 bg-slate-900/80 backdrop-blur-2xl border border-white/10 text-white p-8 rounded-[2rem] mr-8 shadow-[0_20px_50px_rgba(8,_112,_184,_0.1)] flex flex-col relative overflow-hidden group">
        {/* Decorative background glow */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/20 rounded-full blur-[60px] group-hover:bg-emerald-400/30 transition-colors duration-700"></div>
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-teal-500/10 rounded-full blur-[60px]"></div>
        
        <div className="relative z-10 flex flex-col h-full">
          <div className="flex items-center mb-10">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/30 mr-3">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path></svg>
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
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-3 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
              PCBScan Studio
            </li>
            
            <li 
              onClick={() => onNavigate && onNavigate('history')}
              className="hover:text-white hover:bg-white/5 p-3 rounded-xl transform cursor-pointer transition-all duration-300 flex items-center mt-2 group"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500 mr-3 group-hover:bg-teal-400 transition-colors"></span>
              <span className="flex-1">Historique des Sessions</span>
              <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full group-hover:bg-teal-500 group-hover:text-white transition-colors">
                {scanStats.healthy + scanStats.defective}
              </span>
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
      <div className="flex-1 flex flex-col pt-2 relative">
        {/* Export Button */}
        <div className="flex justify-end mb-6 pr-2">
          <button 
            onClick={handleExportPDF}
            disabled={isExporting || (!imageFile && !parsedData)}
            className={`px-6 py-2.5 rounded-2xl font-bold text-sm shadow-sm transition-all duration-300 flex items-center ${isExporting || (!imageFile && !parsedData) ? 'bg-slate-200/50 text-slate-400 cursor-not-allowed border-transparent' : 'bg-white/80 backdrop-blur-md text-slate-700 hover:bg-white border border-slate-200 hover:border-slate-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] hover:-translate-y-0.5'}`}
          >
            {isExporting ? (
              <><svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Génération PDF...</>
            ) : (
              <><svg className="w-4 h-4 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg> Exporter Rapport PDF</>
            )}
          </button>
        </div>
        
        <div className="flex-1 grid grid-cols-12 gap-8" ref={dashboardRef}>
          
          {/* Left Column: Upload / Camera & Stats */}
          <div className="col-span-4 space-y-6">
            <div className="bg-white/80 backdrop-blur-2xl p-7 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white flex flex-col h-full relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-full h-1 ${loading ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-400 bg-[length:200%_auto] animate-[gradient_2s_linear_infinite]' : 'bg-slate-100'}`}></div>
              
              <h3 className="font-bold text-slate-800 mb-6 text-left flex justify-between items-center text-lg">
                <span className="flex items-center gap-3">
                  <span className="bg-slate-900 text-white w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-md">1</span> 
                  Source d'Image
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
                <div className={`mb-6 relative rounded-2xl overflow-hidden border-[3px] shadow-lg ${arMode ? 'border-red-500 shadow-red-500/30' : 'border-emerald-400 shadow-emerald-400/30'} bg-slate-900`}>
                  <video ref={videoRef} autoPlay playsInline className={`w-full h-56 object-cover ${arMode ? 'opacity-80 mix-blend-screen' : 'opacity-90'}`}></video>
                  {/* Scanning Animation Overlay */}
                  <div className={`absolute inset-0 border-[3px] border-dashed m-6 rounded-xl ${arMode ? 'border-red-500/50' : 'border-white/50'}`}></div>
                  <div className={`absolute top-0 left-0 w-full h-1 ${arMode ? 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,1)]' : 'bg-emerald-400/80 shadow-[0_0_15px_rgba(52,211,153,1)]'} animate-[scan_3s_ease-in-out_infinite]`}></div>
                  
                  {arMode && (
                    <>
                      <div className="absolute top-4 left-4 w-6 h-6 border-t-4 border-l-4 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]"></div>
                      <div className="absolute top-4 right-4 w-6 h-6 border-t-4 border-r-4 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]"></div>
                      <div className="absolute bottom-4 left-4 w-6 h-6 border-b-4 border-l-4 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]"></div>
                      <div className="absolute bottom-4 right-4 w-6 h-6 border-b-4 border-r-4 border-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)]"></div>
                      <div className="absolute top-6 right-10 text-amber-500 font-['JetBrains_Mono'] text-[10px] opacity-80 animate-pulse text-right">
                          SYS.TARGET: ACQUIRED<br/>
                          OFFSET: +{Math.floor(Math.random() * 100)}.{Math.floor(Math.random() * 99)}<br/>
                          AI.CONFIDENCE: {(Math.random() * 10 + 90).toFixed(2)}%
                      </div>
                    </>
                  )}
                  
                  <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                    <span className={`bg-slate-900/80 backdrop-blur-md font-mono text-xs px-4 py-1.5 rounded-full border flex items-center ${arMode ? 'text-amber-400 border-amber-500/50' : 'text-emerald-300 border-emerald-500/30'}`}>
                      <span className={`w-2 h-2 rounded-full mr-2 animate-pulse ${arMode ? 'bg-amber-500' : 'bg-emerald-400'}`}></span>
                      {arMode ? 'AR HUD TRACKING...' : 'Analyse IA en temps réel...'}
                    </span>
                  </div>
                  <canvas ref={canvasRef} className="hidden"></canvas>
                  <button onClick={() => captureFrame(true)} className="absolute top-3 right-3 bg-white/20 hover:bg-white/40 backdrop-blur-md text-white p-2 rounded-full transition border border-white/30 z-20" title="Capture manuelle">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                  </button>
                  <button onClick={stopCamera} className="absolute top-3 left-3 bg-red-500/80 hover:bg-red-500 text-white p-2 rounded-full transition shadow-lg z-20" title="Fermer">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                  </button>
                </div>
              ) : (
                <div className="mb-6">
                  <div className="grid grid-cols-2 gap-4 mb-4">
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
                        type="file" 
                        id="file-upload" 
                        accept="image/*" 
                        onChange={handleImageUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="bg-slate-50 p-3 rounded-full shadow-sm text-blue-500 group-hover:scale-110 transition-transform duration-300 mb-3">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
                      </div>
                      <span className="text-sm font-bold text-slate-600 group-hover:text-blue-700 transition-colors">Upload Image</span>
                    </div>
                  </div>
                  
                  {/* AR Toggle Button */}
                  <button 
                    onClick={() => { setArMode(!arMode); if(!isCameraActive) startCamera(); }} 
                    className={`w-full py-3.5 rounded-2xl font-bold flex justify-center items-center transition-all duration-300 transform hover:-translate-y-1 ${arMode ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white border border-amber-400 animate-pulse-ar' : 'bg-gradient-to-r from-slate-800 to-slate-900 text-slate-200 hover:text-white shadow-xl hover:shadow-[0_0_20px_rgba(56,189,248,0.3)] border border-slate-700'}`}
                  >
                    <svg className={`w-5 h-5 mr-2 ${arMode ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                    </svg>
                    {arMode ? 'Désactiver Mode AR' : 'Activer Mode AR (Simulation) 🥽'}
                  </button>
                </div>
              )}
              
              {errorMsg && (
                <div className="bg-red-50/80 backdrop-blur-sm border border-red-200 p-4 mb-6 rounded-2xl flex items-start text-left shadow-sm">
                  <svg className="w-5 h-5 text-red-500 mt-0.5 mr-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <p className="text-red-700 text-sm font-medium">{errorMsg}</p>
                </div>
              )}
              
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  if (isCameraActive) {
                    captureFrame(true);
                  } else {
                    processImage();
                  }
                }}
                className={`relative overflow-hidden w-full py-4 rounded-2xl font-bold text-lg transition-all duration-500 flex justify-center items-center mb-8 group ${
                  (!imageFile && !isCameraActive) || loading
                  ? 'bg-slate-100 text-slate-400 shadow-none cursor-not-allowed border border-slate-200/60' 
                  : 'bg-slate-900 text-white hover:bg-slate-800 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.3)] hover:-translate-y-1'
                }`}
                disabled={(!imageFile && !isCameraActive) || loading}
              >
                {((imageFile || isCameraActive) && !loading) && (
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                )}
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
              
              <div className="pt-4 border-t border-slate-100">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
                  Statistiques de Session
                </h4>
                
                {scanStats.healthy === 0 && scanStats.defective === 0 ? (
                  <div className="text-sm text-slate-400 italic bg-slate-50 p-4 rounded-xl border border-slate-100">Aucune donnée disponible pour cette session.</div>
                ) : (
                  <>
                    {(() => {
                      const rawHistory = JSON.parse(localStorage.getItem('pcbScanHistory') || '[]');
                      const defectCategories = { Soudure: 0, Composants: 0, Traces: 0, Alignement: 0 };
                      let hasDefects = false;
                      
                      rawHistory.forEach(item => {
                        if (item.isHealthy) return;
                        hasDefects = true;
                        const text = ((item.defectsList || '') + ' ' + (item.anomalies || '')).toLowerCase();
                        if (text.includes('soudure') || text.includes('bridge') || text.includes('pont')) defectCategories.Soudure++;
                        if (text.includes('composant') || text.includes('manquant') || text.includes('missing')) defectCategories.Composants++;
                        if (text.includes('trace') || text.includes('court') || text.includes('circuit')) defectCategories.Traces++;
                        if (text.includes('alignement') || text.includes('décalage') || text.includes('décalé')) defectCategories.Alignement++;
                      });
                      
                      let barData = [
                        { name: 'Soudure', défauts: defectCategories.Soudure },
                        { name: 'Composants', défauts: defectCategories.Composants },
                        { name: 'Traces', défauts: defectCategories.Traces },
                        { name: 'Alignement', défauts: defectCategories.Alignement }
                      ].filter(d => d.défauts > 0);
                      
                      if (barData.length === 0 && scanStats.defective > 0) {
                        barData.push({ name: 'Divers', défauts: scanStats.defective });
                      }

                      return (
                        <div className="w-full relative min-w-0 flex flex-col h-[200px]">
                          <div className="flex justify-between items-end mb-4">
                            <div>
                              <div className="text-3xl font-black font-['JetBrains_Mono'] text-slate-700 leading-none">{scanStats.healthy + scanStats.defective}</div>
                              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Total Scans</div>
                            </div>
                            <div className="flex gap-4 text-xs font-bold font-['JetBrains_Mono']">
                              <div className="flex items-center text-emerald-600"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5 shadow-sm shadow-emerald-500/50"></span> Sains ({scanStats.healthy})</div>
                              <div className="flex items-center text-amber-600"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-1.5 shadow-sm shadow-amber-500/50"></span> Défauts ({scanStats.defective})</div>
                            </div>
                          </div>
                          
                          {scanStats.defective > 0 ? (
                            <ResponsiveContainer width="100%" height="100%" minHeight={150}>
                              <BarChart data={barData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} />
                                <YAxis tick={{fontSize: 10, fill: '#94a3b8'}} axisLine={false} tickLine={false} allowDecimals={false} />
                                <Tooltip cursor={{fill: 'rgba(245, 158, 11, 0.05)'}} contentStyle={{ borderRadius: '12px', border: '1px solid #f1f5f9', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontFamily: 'JetBrains Mono' }} />
                                <Bar dataKey="défauts" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="flex-1 flex flex-col items-center justify-center bg-emerald-50/50 rounded-xl border border-emerald-100/50">
                              <span className="text-4xl mb-2">✨</span>
                              <span className="text-sm font-bold text-emerald-600">Aucun défaut détecté</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Previews & Results */}
          <div className="col-span-8 flex flex-col space-y-6">
            
            {/* Top Row: Vision & Metadata */}
            <div className="grid grid-cols-5 gap-6">
              
              {/* Visual Inspection (YOLO) Card - Spans 3 cols */}
              <div className="col-span-3 bg-white/80 backdrop-blur-2xl p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white flex flex-col group min-h-[380px]">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm font-bold text-slate-800 flex items-center">
                    <span className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mr-3">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                    </span>
                    Inspection Visuelle (YOLO)
                  </span>
                  {imageFile && <span className="bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1 rounded-lg text-xs">{(imageFile.size / 1024 / 1024).toFixed(2)} MB</span>}
                </div>
                <div 
                  className="flex-1 bg-gradient-to-b from-slate-50 to-slate-100 rounded-2xl flex items-center justify-center overflow-hidden border border-slate-200/50 shadow-inner relative group cursor-pointer"
                  onClick={() => setIsZoomed(!isZoomed)}
                  style={{ perspective: arMode ? '1000px' : 'none' }}
                >
                  {imagePreview ? (
                    <div className={`relative w-full h-full transition-all duration-700 origin-center flex items-center justify-center ${isZoomed ? 'scale-[2] z-50 cursor-zoom-out' : 'cursor-zoom-in'} ${arMode && !isZoomed ? 'ar-hud-image' : ''}`}>
                      {yoloPredictions && yoloPredictions.length > 0 ? (
                        <PcbVisionRenderer 
                          imageUrl={imagePreview}
                          predictions={yoloPredictions}
                        />
                      ) : (
                        <>
                          <img src={imagePreview} alt="Originale" className="absolute inset-0 w-full h-full object-contain p-2 drop-shadow-md" />
                          {/* SVG Bounding Boxes Overlay */}
                          {ocrDetails && ocrDetails.length > 0 && imageSize && (
                            <svg className="absolute inset-0 w-full h-full p-2 pointer-events-none" viewBox={`0 0 ${imageSize.width} ${imageSize.height}`} preserveAspectRatio="xMidYMid meet">
                               {ocrDetails.map((det, i) => {
                                  const [tl, tr, br, bl] = det.bbox;
                                  const pts = `${tl[0]},${tl[1]} ${tr[0]},${tr[1]} ${br[0]},${br[1]} ${bl[0]},${bl[1]}`;
                                  const isLowConfidence = det.prob < 0.6;
                                  const color = isLowConfidence ? '#f59e0b' : (arMode ? '#0ea5e9' : '#10b981');
                                  return (
                                     <g key={i}>
                                        <polygon points={pts} fill={color} fillOpacity={arMode ? "0.2" : "0.1"} stroke={color} strokeWidth={arMode ? "4" : "3"} className={arMode ? "ar-neon-polygon" : "drop-shadow-md"} />
                                        <text x={tl[0]} y={tl[1] - 5} fill={color} fontSize="16" fontWeight="bold" className="drop-shadow-md" style={{ textShadow: arMode ? `0 0 10px ${color}` : '1px 1px 2px black' }}>
                                          {det.text}
                                        </text>
                                     </g>
                                  );
                               })}
                            </svg>
                          )}
                        </>
                      )}
                    </div>
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
            {/* OCR Metadata Card - Spans 2 cols */}
              <div className="col-span-2 bg-white/80 backdrop-blur-2xl p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white flex flex-col min-h-[380px]">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-800 flex items-center text-sm">
                    <div className="bg-blue-100 text-blue-600 w-8 h-8 rounded-xl flex items-center justify-center mr-3 shadow-inner border border-blue-200">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h7"></path></svg>
                    </div>
                    Extraction de Métadonnées (OCR)
                  </h3>
                  {ocrText && (
                    <button onClick={handleCopyText} className="text-xs text-slate-500 hover:text-blue-600 font-semibold transition-colors flex items-center bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 px-3 py-1.5 rounded-xl shadow-sm">
                      {copied ? (
                        <><svg className="w-3 h-3 mr-1 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg> Copié !</>
                      ) : (
                        <><svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg> Copier</>
                      )}
                    </button>
                  )}
                </div>
                
                <div className="bg-slate-50/50 p-5 rounded-2xl flex-1 border border-slate-200/40 overflow-y-auto shadow-inner relative">
                  {loading ? (
                    <div className="animate-pulse flex flex-col space-y-3">
                      <div className="h-2.5 bg-slate-200 rounded-full w-3/4"></div>
                      <div className="h-2.5 bg-slate-200 rounded-full w-full"></div>
                      <div className="h-2.5 bg-slate-200 rounded-full w-5/6"></div>
                      <div className="h-2.5 bg-slate-200 rounded-full w-1/2"></div>
                    </div>
                  ) : (ocrDetails && ocrDetails.length > 0 ? (
                    <div className="text-xs font-['JetBrains_Mono'] leading-loose">
                      {ocrDetails.map((det, i) => (
                         <span key={i} className={`mr-2 px-1 rounded inline-block ${det.prob < 0.6 ? 'bg-amber-100 text-amber-700 underline decoration-amber-400 decoration-wavy' : 'text-slate-700'}`} title={`Confiance: ${(det.prob * 100).toFixed(0)}%`}>
                           {det.text}
                         </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600 font-mono whitespace-pre-wrap leading-relaxed">
                      {ocrText || "Le texte scanné sur le PCB apparaîtra ici."}
                    </p>
                  ))}
                </div>
              </div>
            </div>{/* End Top Row grid */}

            {/* Bottom Row: AI Synthesis Card */}
            <div className="bg-white/80 backdrop-blur-2xl p-7 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white flex flex-col relative overflow-hidden flex-1">
              {/* Magic glow effect in corner */}
              <div className="absolute -top-10 -right-10 w-48 h-48 bg-purple-400/5 blur-[50px] rounded-full pointer-events-none"></div>
              
              <div className="flex justify-between items-center mb-6 relative z-10">
                <h3 className="font-bold text-slate-800 flex items-center text-lg">
                  <div className="bg-gradient-to-br from-purple-500 to-indigo-600 text-white w-10 h-10 rounded-xl flex items-center justify-center mr-4 shadow-lg shadow-purple-500/30">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                  </div>
                  Rapport Synthétique Fusion AI
                </h3>
              </div>

              <div className={`p-6 flex-1 rounded-[1.5rem] border transition-all duration-500 overflow-y-auto max-h-[400px] shadow-sm relative z-10 ${
                aiResponse && !loading && !errorMsg 
                ? (isCached ? 'bg-gradient-to-br from-yellow-50/50 to-amber-50/50 border-yellow-200/50' : 'bg-gradient-to-br from-slate-50 to-white border-slate-200') 
                : 'bg-slate-50/50 border-transparent'
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
                  parsedData ? (
                    <div className="space-y-4">
                      {/* Mount Status Header */}
                      <div className={`p-3 rounded-xl border flex items-start ${parsedData.status.includes('صحيح') || parsedData.status.includes('جيد') || parsedData.status.includes('Correct') ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                        <div className={`mt-0.5 mr-3 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${parsedData.status.includes('صحيح') || parsedData.status.includes('جيد') || parsedData.status.includes('Correct') ? 'bg-emerald-200 text-emerald-700' : 'bg-amber-200 text-amber-700'}`}>
                          {parsedData.status.includes('صحيح') || parsedData.status.includes('جيد') || parsedData.status.includes('Correct') ? '✓' : '✗'}
                        </div>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider opacity-70 mb-0.5">Statut de Montage</p>
                          <p className="font-semibold text-sm">{parsedData.status}</p>
                        </div>
                      </div>
                      
                      {/* Component & Function */}
                      <div className="bg-white/50 p-3 rounded-xl border border-slate-200/60 shadow-sm">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Composant & Fonction</p>
                        <p className="text-sm text-slate-700 font-medium"><span className="text-blue-600 font-bold">{parsedData.component}</span> - {parsedData.function}</p>
                      </div>
                      
                      {/* Defects and Anomalies */}
                      {(parsedData.defects || parsedData.anomalies) && (
                        <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 text-amber-800 shadow-sm">
                          <p className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 flex items-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-2"></span> Défauts & Anomalies
                          </p>
                          {parsedData.defects && (
                            <div className="mb-2">
                              <span className="font-semibold text-amber-700 text-sm">Défauts fréquents :</span>
                              <p className="text-sm font-['JetBrains_Mono'] font-medium whitespace-pre-wrap mt-1">{parsedData.defects.replace(/^[-* ]+/gm, '• ')}</p>
                            </div>
                          )}
                          {parsedData.anomalies && (
                            <div className="mt-2 pt-2 border-t border-amber-200/50">
                              <span className="font-semibold text-amber-700 text-sm">Anomalies Critiques :</span>
                              <p className="text-sm font-['JetBrains_Mono'] font-medium whitespace-pre-wrap mt-1">{parsedData.anomalies.replace(/^[-* ]+/gm, '• ')}</p>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Recommendations */}
                      {parsedData.recommendations && (
                        <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 text-blue-800 shadow-sm mt-4">
                          <p className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-2 flex items-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-2"></span> Recommandation
                          </p>
                          <p className="text-sm font-['JetBrains_Mono'] font-medium whitespace-pre-wrap">{parsedData.recommendations.replace(/^[-* ]+/gm, '• ')}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap font-medium">
                      {aiResponse || "L'agent IA de ABA Fusion renverra les défauts détectés sur le PCB ici."}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>{/* End Right Column */}

        </div>{/* End 12-col grid */}
      </div>{/* End Main Content */}
    </div>
  );
};

export default PCBScanDashboard;
