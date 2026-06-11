import os
import shutil
import json
import requests
import cv2
import numpy as np
import difflib
import base64
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import easyocr
import ssl

# Fix SSL Certificate Error on Mac
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Initializing EasyOCR models (this might take a few seconds on first startup)...")
reader = easyocr.Reader(['fr', 'en'])
print("EasyOCR initialized!")

FUSION_WEBHOOK_URL = "https://fusion-ai-api.medifus.dev/webhooks/webhook-f6425935-82ac-4d34-a7b0-9735d8cda314/process-image"
CACHE_FILE = "cache.json"

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_cache(cache_data):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache_data, f, ensure_ascii=False, indent=4)

def clean_text(text):
    return ''.join(e for e in text if e.isalnum()).lower()

@app.websocket("/ws/detect-box")
async def websocket_detect_box(websocket: WebSocket):
    """
    Detects if the frame contains a rectangular shape representing a PCB via WebSocket.
    Applies 3 filters: Face Rejection, Geometric Shape, and Edge Density.
    """
    await websocket.accept()
    try:
        while True:
            contents = await websocket.receive_bytes()
            nparr = np.frombuffer(contents, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                await websocket.send_json({"detected": False})
                continue
                
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # 1. Face Rejection Filter (Anti-Person)
            face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(100, 100))
            
            frame_area = img.shape[0] * img.shape[1]
            face_detected = False
            for (x, y, w, h) in faces:
                face_area = w * h
                # If the face takes up more than 10% of the frame -> Reject
                if face_area > frame_area * 0.10:
                    face_detected = True
                    break
            
            if face_detected:
                await websocket.send_json({"detected": False})
                continue
                    
            # 2. Geometric Filter (Shape)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            edged = cv2.Canny(blurred, 50, 150)
            
            contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            contours = sorted(contours, key=cv2.contourArea, reverse=True)
            
            detected_pcb = False
            for c in contours[:3]:  # Check the top 3 largest objects
                peri = cv2.arcLength(c, True)
                approx = cv2.approxPolyDP(c, 0.05 * peri, True)
                
                area = cv2.contourArea(approx)
                # If it's a large 4-point shape
                if len(approx) == 4 and area > 15000:
                    # 3. Edge Density Filter (Anti-Blank / Text Check)
                    x, y, w, h = cv2.boundingRect(approx)
                    roi = edged[y:y+h, x:x+w]
                    
                    if roi.size == 0:
                        continue
                        
                    edge_pixels = cv2.countNonZero(roi)
                    density = edge_pixels / float(w * h)
                    
                    # A PCB usually has an edge density > 3% due to components and text.
                    if density > 0.03:
                        detected_pcb = True
                        break
                        
            await websocket.send_json({"detected": detected_pcb})
    except WebSocketDisconnect:
        print("WebSocket client disconnected")
    except Exception as e:
        print(f"WebSocket detection error: {e}")

@app.post("/process-image")
async def process_image(file: UploadFile = File(...)):
    temp_file_path = f"temp_{file.filename}"
    with open(temp_file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        print("[1] Processing image and detecting text using EasyOCR (Horizontal & Vertical)...")
        # 1. Normal OCR
        result_h = reader.readtext(temp_file_path, detail=0, paragraph=True)
        text_h = "\n".join(result_h).strip()
        
        # 2. Vertical OCR
        img = cv2.imread(temp_file_path)
        if img is not None:
            rotated = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
            rotated_path = f"rotated_{temp_file_path}"
            cv2.imwrite(rotated_path, rotated)
            result_v = reader.readtext(rotated_path, detail=0, paragraph=True)
            text_v = "\n".join(result_v).strip()
            os.remove(rotated_path)
        else:
            text_v = ""
            
        extracted_text = f"{text_h}\n{text_v}".strip()
        
        if len(extracted_text) < 5:
            return {"error": "No clear text found in the image."}
            
        print(f"[2] Extracted Text (Combined):\n{extracted_text}\n")
        
        # --- CACHING LOGIC ---
        cache_data = load_cache()
        cleaned_extracted = clean_text(extracted_text)
        
        for key, cached_analysis in cache_data.items():
            similarity = difflib.SequenceMatcher(None, cleaned_extracted, key).ratio()
            if similarity > 0.85:
                print(f"[CACHE HIT] Found previous analysis with {similarity*100:.1f}% match!")
                return {
                    "ocr_text": extracted_text,
                    "ai_response": cached_analysis,
                    "status": "success",
                    "cached": True
                }
        
        print("[3] Sending to ABA Fusion AI (with Base64 Image)...")
        # Encode image to base64 for Multimodal Vision (Data URI format)
        with open(temp_file_path, "rb") as image_file:
            image_base64 = base64.b64encode(image_file.read()).decode('utf-8')
            image_data_uri = f"data:image/jpeg;base64,{image_base64}"
            
        payload = {
            "event": "pcb_scan",
            "document_name": file.filename,
            "extracted_content": extracted_text,
            "image_base64": image_data_uri,
            "timestamp": datetime.now().isoformat()
        }
        
        headers = {"Content-Type": "application/json"}
        
        # Configure retry strategy
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        
        session = requests.Session()
        retry_strategy = Retry(
            total=3,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["POST"],
            backoff_factor=1
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        
        try:
            response = session.post(FUSION_WEBHOOK_URL, data=json.dumps(payload), headers=headers, timeout=60)
        except requests.exceptions.RequestException as e:
            if "too many 504 error responses" in str(e) or "Gateway Timeout" in str(e):
                return {"error": "Le serveur d'IA (Fusion AI) est actuellement surchargé ou indisponible (Erreur 504). Veuillez réessayer plus tard."}
            if "too many 500 error responses" in str(e) or "Internal Server Error" in str(e):
                return {"error": "Le serveur Fusion a renvoyé une erreur 500 (Erreur Interne). Le payload contenant l'image Base64 est peut-être rejeté."}
            return {"error": f"Erreur de connexion au serveur Fusion : {str(e)}"}
        
        if response.status_code in [200, 201]:
            try:
                fusion_data = response.json()
            except ValueError:
                fusion_data = {"result": response.text}
                
            ai_result = fusion_data.get("ai_analysis", fusion_data.get("result", "Analysis completed but no text response was provided."))
            
            # Save to cache
            cache_data[cleaned_extracted] = ai_result
            save_cache(cache_data)
            
            return {
                "ocr_text": extracted_text,
                "ai_response": ai_result,
                "status": "success",
                "cached": False
            }
        else:
            return {"error": f"Fusion Server Error: {response.status_code} - {response.text}"}
            
    except Exception as e:
        return {"error": f"Connection or processing failed: {str(e)}"}
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
