import { readFileSync, writeFileSync } from "fs";

let c = readFileSync("GeneratorPage.jsx", "utf8");

// Verify we're on the clean restored version
if (!c.includes('Playlist intent <span className="gen-label-optional"')) {
  console.log("file doesn't match expected restore state");
  process.exit(1);
}

// 1. Mood textarea: update label + placeholder
c = c.replace(
  'Describe your mood',
  'Describe your mood and intent'
);
c = c.replace(
  'e.g. calm, nostalgic, like driving at 2am with the windows down…',
  'e.g. I\'m feeling calm and a little nostalgic, just need something for a late night drive'
);

// 2. Remove the entire "Playlist intent" field block
c = c.replace(/            \{\/\* ── Playlist intent ── \*\/\}\r\n            <div className="gen-field">\r\n              <label className="gen-label">\r\n                Playlist intent <span className="gen-label-optional">\(optional\)<\/span>\r\n              <\/label>\r\n              <input\r\n                className="gen-input"\r\n                type="text"\r\n                placeholder="e\.g\. to feel better about myself, study session, late night drive…"\r\n                value=\{playlistIntent\}\r\n                onChange=\{e => setPlaylistIntent\(e\.target\.value\)\}\r\n              \/>\r\n              <p className="gen-field-hint">\r\n                Narrows the focus, combines your mood with a purpose\.\r\n              <\/p>\r\n            <\/div>/, '');

// 3. Remove movie name input, keep only film industry dropdown
c = c.replace(
  /                  <div className="gen-field">\r\n                    <label className="gen-label">\r\n                      Movie \/ album <span className="gen-label-optional">\(optional\)<\/span>\r\n                    <\/label>\r\n                    <input\r\n                      className="gen-input"\r\n                      type="text"\r\n                      placeholder="e\.g\. Pushpa, RRR, Jawan…"\r\n                      value=\{movieName\}\r\n                      onChange=\{e => setMovieName\(e\.target\.value\)\}\r\n                    \/>\r\n                  <\/div>/,
  ''
);

// 4. Update the film industry hint text
c = c.replace(
  'A movie name seeds the playlist with its soundtrack, then fills remaining slots mood-matched.',
  'Select a film industry to include soundtrack songs matched to your mood.'
);

// 5. Update the body sent to API, use combined mood+intent splitting, remove old playlistIntent state reference
// First fix: add intent splitting before the body
c = c.replace(
  '      const body = {\r\n        moodText: moodText.trim(),\r\n        playlistName: playlistName.trim() || \'Vædarth AI Playlist\',\r\n        trackCountRange,\r\n        playlistIntent: playlistIntent.trim() || null,\r\n        filmIndustry: filmIndustry || null,\r\n        movieName: movieName.trim() || null,',
  '      const moodWithIntent = moodText.trim();\r\n      const intentPart = moodWithIntent.includes(\', \') ? moodWithIntent.split(\', \')[1] : \'\';\r\n\r\n      const body = {\r\n        moodText: moodWithIntent.split(\', \')[0] || moodWithIntent,\r\n        playlistName: playlistName.trim() || \'MoodScape AI Playlist\',\r\n        trackCountRange,\r\n        playlistIntent: intentPart || null,\r\n        filmIndustry: filmIndustry || null,\r\n        movieName: null,'
);

// 6. Add token cleanup guards for stale undefined values
c = c.replace(
  'const appToken = localStorage.getItem("authToken") || sessionStorage.getItem("authToken");',
  'const appToken = (localStorage.getItem("authToken") || sessionStorage.getItem("authToken") || "").replace(/^undefined$/, "");'
);

c = c.replace(
  "const sessTok = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');",
  "const sessTok = (localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '').replace(/^undefined$/, '');"
);

writeFileSync("GeneratorPage.jsx", c);
console.log("all changes applied successfully");
