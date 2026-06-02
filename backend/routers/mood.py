import os
import requests
from fastapi import APIRouter

from security import sanitise_user_text
from config import HF_API_TOKEN, logger
from models import MoodRequest

router = APIRouter()


def get_emotion_from_text(text: str):
    API_URL = "https://api-inference.huggingface.co/models/michellejieli/emotion_text_classifier"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    response = requests.post(API_URL, headers=headers, json={"inputs": text})
    if response.status_code == 503:
        return {"error": "Model is loading"}
    if response.status_code == 200:
        data = response.json()
        if data and isinstance(data[0], list) and data[0]:
            top = sorted(data[0], key=lambda x: x.get("score", 0), reverse=True)[0]
            return {"emotion": top.get("label", "thoughtful")}
    return {"error": "Could not determine emotion"}


def get_images_from_unsplash(query: str, count: int = 4):
    headers = {"Authorization": f"Client-ID {os.getenv('UNSPLASH_ACCESS_KEY')}"}
    params  = {"query": query, "count": count, "orientation": "landscape"}
    res = requests.get(
        "https://api.unsplash.com/photos/random",
        headers=headers,
        params=params,
    )
    if res.status_code == 200:
        return [{"id": p["id"], "url": p["urls"]["regular"]} for p in res.json()]
    return []


@router.post("/api/get-mood-data")
def get_mood_data(request_body: MoodRequest):
    safe_text = sanitise_user_text(request_body.text, "text", max_len=500)

    emotion_result = get_emotion_from_text(safe_text)
    if "error" in emotion_result:
        return emotion_result
    emotion = emotion_result.get("emotion", "thoughtful")
    images  = get_images_from_unsplash(emotion)
    return {"detected_emotion": emotion, "images": images, "playlist": None}