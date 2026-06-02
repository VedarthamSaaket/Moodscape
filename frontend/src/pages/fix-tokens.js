const fs = require("fs");
let c = fs.readFileSync("GeneratorPage.jsx", "utf8");

// Fix similar-tracks - add X-Session-Token header
c = c.replace(
  "      const res = await fetch(`${API_BASE}/api/similar-tracks`, {\r\n        method: 'POST',\r\n        headers: {\r\n          'Content-Type': 'application/json',\r\n          Authorization: `Bearer ${token}`,\r\n        },",
  "      const appToken2 = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');\r\n      const res = await fetch(`${API_BASE}/api/similar-tracks`, {\r\n        method: 'POST',\r\n        headers: {\r\n          'Content-Type': 'application/json',\r\n          Authorization: `Bearer ${token}`,\r\n          'X-Session-Token': appToken2 || '',\r\n        },"
);

fs.writeFileSync("GeneratorPage.jsx", c);
console.log("done");
