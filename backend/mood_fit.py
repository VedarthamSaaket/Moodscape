import json
import re
from concurrent.futures import ThreadPoolExecutor

import requests

import llm
from config import logger

OVERSAMPLE = 1.5
FEATURES_URL = "https://api.reccobeats.com/v1/audio-features"
_CENTRE = {"low": 0.2, "medium": 0.5, "high": 0.8}
_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)
_ID_RE = re.compile(r"(?:spotify:track:|open\.spotify\.com/track/)([A-Za-z0-9]{22})")
_UNKNOWN = 0.6


def track_id(uri: str) -> str:
    match = _ID_RE.search(uri or "")
    return match.group(1) if match else ""


def _feature_batch(ids: list) -> dict:
    try:
        res = requests.get(FEATURES_URL, params={"ids": ",".join(ids)}, timeout=6)
        if res.status_code != 200:
            return {}
        out = {}
        for row in res.json().get("content", []):
            tid = track_id(row.get("href", ""))
            if tid and row.get("valence") is not None and row.get("energy") is not None:
                out[tid] = (float(row["valence"]), float(row["energy"]))
        return out
    except Exception as exc:
        logger.warning(f"[MOOD_FIT] audio features failed: {exc}")
        return {}


def audio_features(ids: list) -> dict:
    ids = [i for i in dict.fromkeys(ids) if i]
    if not ids:
        return {}
    batches = [ids[i:i + 30] for i in range(0, len(ids), 30)]
    out = {}
    with ThreadPoolExecutor(max_workers=min(4, len(batches))) as pool:
        for part in pool.map(_feature_batch, batches):
            out.update(part)
    return out


def _llm_ratings(tracks: list) -> dict:
    listing = "\n".join(f"{i + 1}. {t.get('title', '')} - {t.get('artist', '')}" for i, t in enumerate(tracks))
    messages = [
        {
            "role": "system",
            "content": (
                "You rate songs for a mood playlist. For each numbered song, give its musical valence "
                "(how positive or happy it sounds) and energy (intensity, tempo, loudness) as low, medium or high, "
                "from your knowledge of the recording. Use unknown when you do not know the song.\n"
                'Reply with JSON only: {"r": [[1, "valence", "energy"], ...]}'
            ),
        },
        {"role": "user", "content": listing},
    ]

    def accept(content: str):
        match = _JSON_RE.search(content or "")
        if not match:
            return None
        try:
            rows = json.loads(match.group(0)).get("r")
        except Exception:
            return None
        if not isinstance(rows, list):
            return None
        out = {}
        for row in rows:
            if isinstance(row, list) and len(row) == 3 and isinstance(row[0], int):
                v, e = str(row[1]).lower(), str(row[2]).lower()
                if v in _CENTRE and e in _CENTRE:
                    out[row[0] - 1] = (_CENTRE[v], _CENTRE[e])
        return out or None

    result, _ = llm.chat(messages, max_tokens=2500, temperature=0, timeout=10, accept=accept, limit=2, json_mode=True)
    return result or {}


def rerank(tracks: list, uris: list, profile: dict, keep: int, protected: int = 0) -> tuple:
    if len(tracks) <= keep:
        return tracks[:keep], uris[:keep]
    target = (_CENTRE[profile["valence"]], _CENTRE[profile["energy"]])
    pool = list(range(protected, len(tracks)))
    measured = audio_features([track_id(uris[i]) for i in pool])
    points = {i: measured[track_id(uris[i])] for i in pool if track_id(uris[i]) in measured}
    missing = [i for i in pool if i not in points]
    if missing and llm.available():
        rated = _llm_ratings([tracks[i] for i in missing])
        points.update({missing[j]: p for j, p in rated.items() if j < len(missing)})
    logger.info(f"[MOOD_FIT] measured {len(measured)}/{len(pool)} candidates, rated {len(points) - len(measured)}")

    def distance(i: int) -> float:
        p = points.get(i)
        return abs(p[0] - target[0]) + abs(p[1] - target[1]) if p else _UNKNOWN

    best = sorted(pool, key=lambda i: (distance(i), i))[: max(0, keep - protected)]
    chosen = sorted(list(range(protected)) + best)
    return [tracks[i] for i in chosen], [uris[i] for i in chosen]
