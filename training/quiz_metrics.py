import json
import os

import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import (
    adjusted_rand_score,
    calinski_harabasz_score,
    davies_bouldin_score,
    silhouette_score,
)

HERE = os.path.dirname(os.path.abspath(__file__))
IN_FILE = os.path.join(HERE, "runs", "quiz_holdout.json")
OUT_FILE = os.path.join(HERE, "runs", "quiz_metrics.json")
REPORT_NOISE = "2"


def cluster_metrics(rows):
    profiles = np.array([r["profile"] for r in rows])
    truth = np.array([r["truth"] for r in rows])
    pred = np.array([r["pred"] for r in rows])
    kmeans = KMeans(n_clusters=len(set(truth)), n_init=10, random_state=42).fit_predict(profiles)
    return {
        "n": len(rows),
        "silhouette": round(float(silhouette_score(profiles, pred)), 3),
        "davies_bouldin": round(float(davies_bouldin_score(profiles, pred)), 3),
        "calinski_harabasz": round(float(calinski_harabasz_score(profiles, pred)), 3),
        "kmeans_silhouette": round(float(silhouette_score(profiles, kmeans)), 3),
        "kmeans_davies_bouldin": round(float(davies_bouldin_score(profiles, kmeans)), 3),
        "ari_quiz_vs_kmeans": round(float(adjusted_rand_score(pred, kmeans)), 3),
        "ari_kmeans_vs_truth": round(float(adjusted_rand_score(truth, kmeans)), 3),
    }


def main():
    with open(IN_FILE, encoding="utf-8") as fh:
        data = json.load(fh)
    report = {}
    for scale, levels in data["runs"].items():
        level = levels[REPORT_NOISE]
        report[scale] = {**level["metrics"], **cluster_metrics(level["rows"])}
        print(scale, report[scale])
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)


if __name__ == "__main__":
    main()
