import cv2
import pytesseract
import requests
import json
from datetime import datetime

# link to ABA Fusion AI webhook (replace with your actual webhook URL)
FUSION_WEBHOOK_URL = "https://fusion-ai-api.medifus.dev/webhooks/webhook-e3isjhe8kzmvenaizr5evbqv"

def process_medicine_image(image_path):
    print("[1] جاري معالجة الصورة...")
    img = cv2.imread(image_path)
    
    # معالجة الصورة الطبية (لأن علب الأدوية غالباً لامعة)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # زيادة التباين لعزل الحروف السوداء
    processed_img = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    
    print("[2] جاري استخراج النص (OCR)...")
    extracted_text = pytesseract.image_to_string(processed_img).strip()
    
    if not extracted_text:
        return {"error": "لم يتم العثور على نص واضح في الصورة."}
    
    print(f"النص المستخرج: {extracted_text[:50]}...") # display the first 50 characters of the extracted text for verification
    
    print("[3] جاري الإرسال إلى ABA Fusion AI...")
    payload = {
        "event": "medicine_scan",
        "document_name": image_path,
        "extracted_content": extracted_text,
        "timestamp": datetime.now().isoformat()
    }
    
    headers = {"Content-Type": "application/json"}
    
    try:
        response = requests.post(FUSION_WEBHOOK_URL, data=json.dumps(payload), headers=headers)
        
        if response.status_code in [200, 201]:
            # جلب تحليل الذكاء الاصطناعي من رد Fusion (يجب التأكد من اسم المتغير في Fusion)
            fusion_data = response.json()
            # نفترض أن Fusion يرجع النتيجة في حقل اسمه 'ai_analysis' أو 'result'
            ai_result = fusion_data.get("ai_analysis", fusion_data.get("result", "تم التحليل بنجاح لكن بدون رد نصي."))
            
            return {
                "ocr_text": extracted_text,
                "ai_response": ai_result,
                "status": "success"
            }
        else:
            return {"error": f"خطأ في خادم Fusion: {response.status_code}"}
            
    except Exception as e:
        return {"error": f"فشل الاتصال: {str(e)}"}

# تجربة الكود
if __name__ == "__main__":
    # ضع مسار صورة الدواء هنا
    result = process_medicine_image("test_medicine.jpg")
    print("\n--- Result ---")
    print(json.dumps(result, indent=4, ensure_ascii=False))