import React, { useState, useRef, useEffect, useCallback } from 'react';

const DEFECT_COLORS = {
  excessive: { hex: '#ef4444', label: 'border-red-500', text: 'text-red-600', bg: 'bg-red-500/10' },
  short:     { hex: '#ef4444', label: 'border-red-500', text: 'text-red-600', bg: 'bg-red-500/10' },
  insufficient: { hex: '#f97316', label: 'border-orange-500', text: 'text-orange-600', bg: 'bg-orange-500/10' },
  assembly:  { hex: '#8b5cf6', label: 'border-violet-500', text: 'text-violet-600', bg: 'bg-violet-500/10' },
  default:   { hex: '#eab308', label: 'border-yellow-500', text: 'text-yellow-600', bg: 'bg-yellow-500/10' },
};

const getDefectStyle = (pred) => {
  if (pred.model_source === 'assembly_defect') return DEFECT_COLORS.assembly;

  const lower = (pred.class || '').toLowerCase();
  if (lower.includes('excessive') || lower.includes('short')) return DEFECT_COLORS.excessive;
  if (lower.includes('insufficient') || lower.includes('missing')) return DEFECT_COLORS.insufficient;
  return DEFECT_COLORS.default;
};

const PcbVisionRenderer = ({ imageUrl, predictions }) => {
  const imgRef = useRef(null);
  const [scale, setScale] = useState({ x: 1, y: 1 });
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const calculateScale = useCallback(() => {
    if (imgRef.current) {
      const { naturalWidth, naturalHeight, clientWidth, clientHeight } = imgRef.current;
      if (naturalWidth > 0 && naturalHeight > 0) {
        setScale({ x: clientWidth / naturalWidth, y: clientHeight / naturalHeight });
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('resize', calculateScale);
    return () => window.removeEventListener('resize', calculateScale);
  }, [calculateScale]);

  // Download: burn YOLO boxes onto the original image via Canvas
  const handleDownload = useCallback(async () => {
    if (!imageUrl || !predictions) return;
    setIsDownloading(true);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = imageUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      // Draw base image
      ctx.drawImage(img, 0, 0);

      // Draw each YOLO prediction
      predictions.forEach((pred) => {
        const style = getDefectStyle(pred);
        const x = pred.x - pred.width / 2;
        const y = pred.y - pred.height / 2;
        const w = pred.width;
        const h = pred.height;
        const conf = (pred.confidence * 100).toFixed(0);
        const label = `${pred.class.replace(/_/g, ' ').toUpperCase()} ${conf}%`;

        // Bounding box
        ctx.lineWidth = 3;
        ctx.strokeStyle = style.hex;
        ctx.fillStyle = style.hex + '22';
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);

        // Label background
        const fontSize = Math.max(12, Math.min(16, img.naturalWidth / 40));
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textWidth = ctx.measureText(label).width;
        const labelH = fontSize + 8;
        ctx.fillStyle = style.hex;
        ctx.fillRect(x - 1.5, y - labelH - 2, textWidth + 12, labelH + 2);

        // Label text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + 4, y - 6);
      });

      // Watermark: "YOLOv11 | PCBScan Studio"
      const wm = `YOLOv11 · PCBScan Studio · ${new Date().toLocaleDateString('fr-FR')}`;
      const wmSize = Math.max(10, img.naturalWidth / 60);
      ctx.font = `${wmSize}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(4, img.naturalHeight - wmSize - 10, ctx.measureText(wm).width + 12, wmSize + 8);
      ctx.fillStyle = '#1e293b';
      ctx.fillText(wm, 8, img.naturalHeight - 8);

      // Download
      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PCB_YOLO_Analysis_${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 2500);
      }, 'image/png');
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsDownloading(false);
    }
  }, [imageUrl, predictions]);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-1 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Dual YOLOv11 Active
          </span>
          {predictions && predictions.length > 0 && (
            <span className="bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold px-2 py-1 rounded-lg">
              {predictions.length} défaut{predictions.length > 1 ? 's' : ''} détecté{predictions.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Download button */}
        {predictions && predictions.length > 0 && (
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all duration-200 border shadow-sm ${
              downloaded
                ? 'bg-emerald-500 text-white border-emerald-400'
                : isDownloading
                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait'
                : 'bg-slate-800 text-white border-slate-700 hover:bg-slate-700 hover:-translate-y-0.5 hover:shadow-md'
            }`}
            title="Télécharger l'image avec les annotations YOLO"
          >
            {downloaded ? (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/>
                </svg>
                Téléchargé !
              </>
            ) : isDownloading ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Préparation...
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                Télécharger avec YOLO
              </>
            )}
          </button>
        )}
      </div>

      {/* Image + overlay boxes */}
      <div className="relative flex-1 rounded-xl overflow-hidden border border-slate-200/50 shadow-inner bg-gradient-to-b from-slate-50 to-slate-100 min-h-0">
        <img
          ref={imgRef}
          src={imageUrl}
          alt="PCB Scan"
          onLoad={calculateScale}
          className="w-full h-full object-contain block"
        />

        {/* YOLO Bounding Boxes */}
        {predictions && predictions.map((pred, idx) => {
          const style = getDefectStyle(pred);
          const left = (pred.x - pred.width / 2) * scale.x;
          const top  = (pred.y - pred.height / 2) * scale.y;
          const w    = pred.width  * scale.x;
          const h    = pred.height * scale.y;

          return (
            <div
              key={idx}
              className={`absolute border-[3px] ${style.label} ${style.bg} z-10 cursor-crosshair group transition-all duration-200 hover:brightness-110 bbox-animate`}
              style={{ left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, animationDelay: `${idx * 0.15}s` }}
            >
              {/* Corner accents */}
              <div className={`absolute -top-0.5 -left-0.5 w-2.5 h-2.5 border-t-[3px] border-l-[3px] ${style.label}`}/>
              <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 border-t-[3px] border-r-[3px] ${style.label}`}/>
              <div className={`absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 border-b-[3px] border-l-[3px] ${style.label}`}/>
              <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border-b-[3px] border-r-[3px] ${style.label}`}/>

              {/* Label */}
              <span className={`absolute -top-7 left-[-3px] bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-t-lg shadow-sm border-t-2 border-x-2 ${style.label} ${style.text} whitespace-nowrap z-20 flex items-center gap-1`}>
                <span className={`w-1.5 h-1.5 rounded-full inline-block`} style={{ backgroundColor: style.hex }}></span>
                {pred.class.replace(/_/g, ' ')} {(pred.confidence * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PcbVisionRenderer;
