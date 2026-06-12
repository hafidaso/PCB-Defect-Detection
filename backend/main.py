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
import paho.mqtt.client as mqtt

try:
    from ultralytics import YOLO
    local_yolo_model = YOLO("best.pt")
    print("Local YOLO model 'best.pt' loaded successfully.")
except Exception as e:
    local_yolo_model = None
    print(f"Warning: Could not load local YOLO model 'best.pt': {e}")

def send_mqtt_status(has_defect):
    try:
        client = mqtt.Client(client_id="fastapi_backend_pcb", protocol=mqtt.MQTTv311)
        client.username_pw_set("hivemq.webclient.1775653497883", "1B%.CwaP:Kdr2I93k*Ap")
        client.tls_set(cert_reqs=ssl.CERT_NONE)
        client.connect("ac6ac8bb96e444b3b796a80e83455529.s1.eu.hivemq.cloud", 8883, 60)
        
        client.loop_start() # البدأ في حلقة الاتصال لإرسال البيانات فعلياً
        msg = "DEFECT" if has_defect else "OK"
        info = client.publish("hafida/robot/twin/command", msg, qos=1)
        info.wait_for_publish() # الانتظار حتى يتم إرسال الرسالة بنجاح
        client.disconnect()
        client.loop_stop()
        
        print(f"   -> [MQTT] Status '{msg}' sent to ESP32 successfully.")
    except Exception as e:
        print(f"   -> [MQTT] Failed to send status: {e}")

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

print("Initializing EasyOCR...")
reader = easyocr.Reader(['en', 'fr'], gpu=False)

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
                    
            # 2. Robust Edge Density Filter (Center of the frame)
            # Webcams have noise and perspective distortion, so contours often fail.
            # We will just check if the center of the camera sees a lot of complex edges.
            h_img, w_img = gray.shape
            
            # Extract the center 60% of the image
            roi_w, roi_h = int(w_img * 0.6), int(h_img * 0.6)
            cx, cy = w_img // 2, h_img // 2
            
            roi = gray[cy - roi_h//2 : cy + roi_h//2, cx - roi_w//2 : cx + roi_w//2]
            
            # Slight blur to remove camera noise, then detect edges
            blurred = cv2.GaussianBlur(roi, (5, 5), 0)
            edged = cv2.Canny(blurred, 30, 100) # Lowered threshold for better sensitivity
            
            edge_pixels = cv2.countNonZero(edged)
            density = edge_pixels / float(roi_w * roi_h)
            
            # If the center area has > 3.5% edge pixels, it's very likely a PCB 
            # (PCBs have extreme edge density compared to blank backgrounds or hands)
            detected_pcb = density > 0.035
                        
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
        ocr_details = []
        
        if reader:
            result_h = reader.readtext(temp_file_path, detail=1, paragraph=False)
        else:
            result_h = []
        text_h_parts = []
        for bbox, text, prob in result_h:
            text_h_parts.append(text)
            clean_bbox = [[int(pt[0]), int(pt[1])] for pt in bbox]
            ocr_details.append({
                "text": text,
                "prob": float(prob),
                "bbox": clean_bbox,
                "orientation": "horizontal"
            })
        text_h = "\n".join(text_h_parts).strip()
        
        # 2. Vertical OCR
        img = cv2.imread(temp_file_path)
        text_v = ""
        if img is not None:
            orig_h, orig_w = img.shape[:2]
            rotated = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
            rotated_path = f"rotated_{temp_file_path}"
            cv2.imwrite(rotated_path, rotated)
            
            if reader:
                result_v = reader.readtext(rotated_path, detail=1, paragraph=False)
            else:
                result_v = []
            text_v_parts = []
            for bbox, text, prob in result_v:
                text_v_parts.append(text)
                
                unrotated_bbox = []
                for pt in bbox:
                    x_rot, y_rot = pt
                    orig_x = int(y_rot)
                    orig_y = orig_h - 1 - int(x_rot)
                    unrotated_bbox.append([orig_x, orig_y])
                    
                ocr_details.append({
                    "text": text,
                    "prob": float(prob),
                    "bbox": unrotated_bbox,
                    "orientation": "vertical"
                })
            
            text_v = "\n".join(text_v_parts).strip()
            os.remove(rotated_path)
            
        extracted_text = f"{text_h}\n{text_v}".strip()
        
        if len(extracted_text) < 5:
            extracted_text = "[Aucun texte lisible détecté par l'OCR]"
            
        print(f"[2] Extracted Text (Combined):\n{extracted_text}\n")
        
        # --- CACHING LOGIC ---
        cache_data = load_cache()
        cleaned_extracted = clean_text(extracted_text)
        
        # Skip cache if there's no real text (prevents false cache hits for different textless PCBs)
        if len(cleaned_extracted) >= 5 and "Aucun texte lisible" not in extracted_text:
            for key, cached_analysis in cache_data.items():
                if len(key) >= 5:
                    similarity = difflib.SequenceMatcher(None, cleaned_extracted, key).ratio()
                    if similarity > 0.85:
                        print(f"[CACHE HIT] Found previous analysis with {similarity*100:.1f}% match!")
                        
                        # Support old string cache format and new dict format
                        ai_response = cached_analysis.get("ai_analysis", "") if isinstance(cached_analysis, dict) else cached_analysis
                        predictions = cached_analysis.get("predictions", []) if isinstance(cached_analysis, dict) else []
                        
                        send_mqtt_status(len(predictions) > 0)
                        return {
                            "ocr_text": extracted_text,
                            "ocr_details": ocr_details,
                            "ai_response": ai_response,
                            "predictions": predictions,
                            "status": "success",
                            "cached": True
                        }
        
        print("[3] Calling Roboflow Models and Local YOLO Model concurrently...")
        roboflow_predictions = []
        ROBOFLOW_API_KEY = os.environ.get("ROBOFLOW_API_KEY", "ETd6Ky2lUXN8CmqrVr3B")
        
        # --- LOCAL YOLO MODEL INFERENCE ---
        if local_yolo_model:
            try:
                print("   -> Running Local YOLO Model...")
                results = local_yolo_model(temp_file_path)
                for r in results:
                    for box in r.boxes:
                        x, y, w, h = box.xywh[0].tolist()
                        conf = float(box.conf[0])
                        cls_id = int(box.cls[0])
                        class_name = local_yolo_model.names[cls_id]
                        
                        # تجاهل الكلاس "PCB" لأنه يمثل اللوحة نفسها وليس عيباً
                        if class_name.lower() == "pcb":
                            continue
                            
                        roboflow_predictions.append({
                            "x": x,
                            "y": y,
                            "width": w,
                            "height": h,
                            "class": class_name,
                            "confidence": conf,
                            "model_source": "local_best_pt"
                        })
                print(f"   -> Local YOLO found defects.")
            except Exception as e:
                print(f"   -> Error running local YOLO model: {e}")

        
        if ROBOFLOW_API_KEY:
            try:
                with open(temp_file_path, "rb") as image_file:
                    image_data = base64.b64encode(image_file.read()).decode('utf-8')
                
                # Model 1: Original Solder Defects
                url_model1 = f"https://detect.roboflow.com/pcb-solder-defect-detection-hn1sk-zdmoz/1?api_key={ROBOFLOW_API_KEY}"
                # Model 2: Assembly Defects (Missing, Misaligned, etc.)
                url_model2 = f"https://detect.roboflow.com/defects-2q87r-0lwnp/1?api_key={ROBOFLOW_API_KEY}"
                
                headers = {"Content-Type": "application/x-www-form-urlencoded"}
                
                import concurrent.futures
                
                def fetch_roboflow(url, source_name):
                    try:
                        res = requests.post(url, data=image_data, headers=headers, timeout=15)
                        if res.status_code == 200:
                            preds = res.json().get("predictions", [])
                            # Add a source tag so the frontend/AI knows where the defect came from
                            for p in preds:
                                p["model_source"] = source_name
                            return preds
                        else:
                            print(f"   -> Roboflow API Error ({source_name}): {res.status_code}")
                            return []
                    except Exception as e:
                        print(f"   -> Error calling Roboflow ({source_name}): {str(e)}")
                        return []

                # Execute both requests at the exact same time (Concurrency) to save time
                with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                    future1 = executor.submit(fetch_roboflow, url_model1, "solder_defect")
                    future2 = executor.submit(fetch_roboflow, url_model2, "assembly_defect")
                    
                    roboflow_predictions.extend(future1.result())
                    roboflow_predictions.extend(future2.result())
                    
                print(f"   -> Found {len(roboflow_predictions)} combined defects visually.")
            except Exception as e:
                print(f"   -> Error in Roboflow processing: {str(e)}")
        else:
            print("   -> Missing ROBOFLOW_API_KEY. Skipping visual defect detection.")

        print("[4] Sending OCR + YOLO data to Fusion AI...")

        payload = {
            "event": "pcb_scan",
            "document_name": file.filename,
            "extracted_content": extracted_text,
            "visual_defects": roboflow_predictions,  # YOLO bounding boxes
            "timestamp": datetime.now().isoformat()
        }

        headers = {"Content-Type": "application/json"}

        import time
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry

        # Stratégie : 1 tentative principale + 1 seule retry si 504
        # (évite de gaspiller des tokens LLM en relançant plusieurs fois)
        MAX_ATTEMPTS = 2        # 1 essai + 1 retry max
        RETRY_WAIT_SECONDS = 30  # attendre 30s pour que le LLM finisse côté Fusion
        attempt = 0
        response = None

        while attempt < MAX_ATTEMPTS:
            attempt += 1
            session = requests.Session()
            adapter = HTTPAdapter(max_retries=Retry(total=0, allowed_methods=["POST"]))
            session.mount("https://", adapter)
            session.mount("http://", adapter)

            try:
                print(f"   -> Fusion AI tentative {attempt}/{MAX_ATTEMPTS} (timeout client désactivé)...")
                # timeout=None → pas de timeout côté client
                response = session.post(
                    FUSION_WEBHOOK_URL,
                    data=json.dumps(payload),
                    headers=headers,
                    timeout=None
                )

                if response.status_code in [200, 201]:
                    print(f"   -> Fusion AI succès à la tentative {attempt}.")
                    break  # ✅ Réponse valide

                elif response.status_code in [502, 503, 504] and attempt < MAX_ATTEMPTS:
                    # Gateway Timeout — on attend et on réessaie UNE seule fois
                    print(f"   -> Fusion AI {response.status_code}. "
                          f"Attente {RETRY_WAIT_SECONDS}s puis dernière tentative...")
                    time.sleep(RETRY_WAIT_SECONDS)

                else:
                    # Erreur non-récupérable ou max attempts atteint
                    print(f"   -> Fusion AI erreur finale : {response.status_code}")
                    break

            except requests.exceptions.RequestException as e:
                print(f"   -> Erreur réseau Fusion AI (tentative {attempt}): {str(e)}")
                partial_msg = (
                    "⚠️ **Fusion AI indisponible (Erreur réseau)**\n\n"
                    f"✅ **YOLOv11 a détecté {len(roboflow_predictions)} défaut(s) visuels** sur cette carte.\n\n"
                    f"Erreur technique : `{str(e)[:120]}`\n\n"
                    "💡 Réessayez dans quelques instants."
                )
                send_mqtt_status(len(roboflow_predictions) > 0)
                return {
                    "ocr_text": extracted_text,
                    "ocr_details": ocr_details,
                    "ai_response": partial_msg,
                    "predictions": roboflow_predictions,
                    "status": "success",
                    "cached": False,
                    "fusion_unavailable": True
                }

        if response.status_code in [200, 201]:
            try:
                fusion_data = response.json()
            except ValueError:
                fusion_data = {"result": response.text}

            ai_result = fusion_data.get(
                "ai_analysis",
                fusion_data.get("result", "Analysis completed but no text response was provided.")
            )

            # --- CLEANUP FUSION AI METADATA ---
            if isinstance(ai_result, str):
                import re
                # Remove random JSON/Node metadata injected by Fusion webhook
                ai_result = re.sub(r'\{\s*"success":\s*true\s*\}', '', ai_result)
                ai_result = re.sub(r'Unknown Node', '', ai_result)
                ai_result = re.sub(r'^success$', '', ai_result, flags=re.MULTILINE)
                ai_result = re.sub(r'^\d{1,2}/\d{1,2}/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$', '', ai_result, flags=re.MULTILINE)
                ai_result = re.sub(r'^Node ID:\s*[a-f0-9\-]+$', '', ai_result, flags=re.MULTILINE)
                
                # Split by duplicated blocks if Fusion repeats the same output
                if '🔌 **Composant' in ai_result:
                    parts = ai_result.split('🔌 **Composant')
                    if len(parts) > 2:
                        # Keep only the first occurrence
                        ai_result = parts[0] + '🔌 **Composant' + parts[1]
                
                ai_result = re.sub(r'\n{3,}', '\n\n', ai_result).strip()

            predictions = roboflow_predictions

            # Save to cache only if text is meaningful
            if len(cleaned_extracted) >= 5 and "Aucun texte lisible" not in extracted_text:
                cache_data[cleaned_extracted] = {"ai_analysis": ai_result, "predictions": predictions}
                save_cache(cache_data)

            send_mqtt_status(len(predictions) > 0)
            return {
                "ocr_text": extracted_text,
                "ocr_details": ocr_details,
                "ai_response": ai_result,
                "predictions": predictions,
                "status": "success",
                "cached": False
            }
        else:
            print(f"   -> Fusion AI HTTP error: {response.status_code}")
            partial_msg = (
                f"⚠️ **Fusion AI a retourné une erreur ({response.status_code})**\n\n"
                f"✅ **YOLOv11 a détecté {len(roboflow_predictions)} défaut(s) visuels** sur cette carte.\n\n"
                "L'analyse textuelle de Fusion AI est temporairement indisponible. "
                "Les annotations visuelles YOLO restent valides.\n\n"
                "💡 Réessayez dans quelques instants pour l'analyse complète."
            )
            send_mqtt_status(len(roboflow_predictions) > 0)
            return {
                "ocr_text": extracted_text,
                "ocr_details": ocr_details,
                "ai_response": partial_msg,
                "predictions": roboflow_predictions,
                "status": "success",
                "cached": False,
                "fusion_unavailable": True
            }
            
    except Exception as e:
        return {"error": f"Connection or processing failed: {str(e)}"}
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

import os
from fastapi.staticfiles import StaticFiles
if os.path.exists("dist"):
    app.mount("/", StaticFiles(directory="dist", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
