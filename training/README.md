# Training

These scripts calibrate the style quiz classifier.
They are a reconstruction of the calibration that was done, written from the recorded method and results.
They have not been run, so their output has not been compared with the recorded results.

The classifier projects 21 scored answers onto 4 style axes and matches them to 9 archetypes with cosine similarity and a softmax.
Its archetype centroids are set by hand in quizData.js.
The tuned parameter is INTENSITY_SCALE in scoreQuiz.js, which decides how far a profile moves away from the neutral archetype.

The data is simulated.
Each simulated person answers with a softmax over how well each option fits their true archetype, and neutral people prefer low intensity options.
INTENSITY_SCALE is chosen by a grid search from 1.0 to 3.0 on 13500 people with seed 1111, using mean macro-F1 across noise levels 1, 2 and 3.
The chosen value and the 1.0 baseline are then scored on 27000 separate people with seed 777.
Silhouette, Davies-Bouldin, Calinski-Harabasz and a 9 cluster K-means comparison are reported at noise level 2.

Run node training/calibrate_quiz.mjs, then python training/quiz_metrics.py.
The second script needs the packages in training/requirements.txt.
Results go to training/runs, and scoreQuiz.js is not changed.

The mood and activity classifier runs on hosted models through Groq and has no training step.
The playlist reranker ranks by distance in valence and energy and has no training step.
