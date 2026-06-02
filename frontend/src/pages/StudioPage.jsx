import { useState, useRef, useEffect, useCallback, useContext } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AuthContext } from "../AuthContext";
import useStudioStore from "../store";
import { ALL_PALETTES, FP_PALETTES } from "./themes";
import "./StudioPage.css";

const UNSPLASH_KEY = import.meta.env.VITE_UNSPLASH_KEY || "";
const PEXELS_KEY = import.meta.env.VITE_PEXELS_KEY || "";

const ABSTRACT_SOURCES = [
  { thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Vassily_Kandinsky%2C_1913_-_Composition_7.jpg/400px-Vassily_Kandinsky%2C_1913_-_Composition_7.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/a/a4/Vassily_Kandinsky%2C_1913_-_Composition_7.jpg", alt: "Kandinsky – Composition VII", attribution: "Kandinsky, Wikimedia Commons" },
  { thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Hilma_af_Klint_-_Group_IV%2C_The_Ten_Largest%2C_No._2%2C_Childhood_%281907%29.jpg/400px-Hilma_af_Klint_-_Group_IV%2C_The_Ten_Largest%2C_No._2%2C_Childhood_%281907%29.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/3/3e/Hilma_af_Klint_-_Group_IV%2C_The_Ten_Largest%2C_No._2%2C_Childhood_%281907%29.jpg", alt: "Hilma af Klint – The Ten Largest No.2", attribution: "Hilma af Klint, Wikimedia Commons" },
  { thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Vassily_Kandinsky_1925_-_Several_Circles.jpg/400px-Vassily_Kandinsky_1925_-_Several_Circles.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/5/55/Vassily_Kandinsky_1925_-_Several_Circles.jpg", alt: "Kandinsky – Several Circles", attribution: "Kandinsky, Wikimedia Commons" },
  { thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Piet_Mondriaan%2C_1930_-_Mondrian_Composition_II_in_Red%2C_Blue%2C_and_Yellow.jpg/400px-Piet_Mondriaan%2C_1930_-_Mondrian_Composition_II_in_Red%2C_Blue%2C_and_Yellow.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/9/9d/Piet_Mondriaan%2C_1930_-_Mondrian_Composition_II_in_Red%2C_Blue%2C_and_Yellow.jpg", alt: "Mondrian – Composition II", attribution: "Mondrian, Wikimedia Commons" },
  { thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Paul_Klee%2C_1922%2C_Twittering_Machine_%28Die_Zwitscher-Maschine%29%2C_watercolor_and_pen_and_ink_on_oil_transfer_drawing_on_paper%2C_mounted_on_cardboard%2C_41.3_x_30.5_cm%2C_MoMA.jpg/400px-Paul_Klee%2C_1922%2C_Twittering_Machine_%28Die_Zwitscher-Maschine%29%2C_watercolor_and_pen_and_ink_on_oil_transfer_drawing_on_paper%2C_mounted_on_cardboard%2C_41.3_x_30.5_cm%2C_MoMA.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/b/b4/Paul_Klee%2C_1922%2C_Twittering_Machine_%28Die_Zwitscher-Maschine%29%2C_watercolor_and_pen_and_ink_on_oil_transfer_drawing_on_paper%2C_mounted_on_cardboard%2C_41.3_x_30.5_cm%2C_MoMA.jpg", alt: "Paul Klee – Twittering Machine", attribution: "Paul Klee, Wikimedia Commons" },
  { thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/400px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg", alt: "Van Gogh – Starry Night", attribution: "Van Gogh, Wikimedia Commons" },
  { thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg/400px-Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/0/00/Claude_Monet_-_Water_Lilies_-_1906%2C_Ryerson.jpg", alt: "Monet – Water Lilies", attribution: "Monet, Wikimedia Commons" },
  { thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/A_Sunday_on_La_Grande_Jatte%2C_Georges_Seurat%2C_1884.jpg/400px-A_Sunday_on_La_Grande_Jatte%2C_Georges_Seurat%2C_1884.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/4/45/A_Sunday_on_La_Grande_Jatte%2C_Georges_Seurat%2C_1884.jpg", alt: "Seurat – La Grande Jatte", attribution: "Seurat, Wikimedia Commons" },
];

// Genre → overall studio style (canvas background, text color)
const GENRE_STYLES = {
  "Dark Romantic":       { bg: "#1a1410", text: "#f0ebe0" },
  "Electric Tension":    { bg: "#0a0805", text: "#e8e2d4" },
  "Drift State":         { bg: "#1a1410", text: "#f0ebe0" },
  "Warmth Ritual":       { bg: "#3d1f0e", text: "#f0ebe0" },
  "Void":                { bg: "#0a0805", text: "#f0ebe0" },
  "Incandescent":        { bg: "#c8a832", text: "#0a0805" },
  "Dark Academia":       { bg: "#2c1e0f", text: "#f0e6d0" },
  "Cottagecore":         { bg: "#f5f0e8", text: "#2c3e1a" },
  "Old Money":           { bg: "#1a1a2e", text: "#f5f0e8" },
  "Wabi-Sabi":           { bg: "#e8ddd0", text: "#3c2c20" },
  "Coastal":             { bg: "#1a3a4a", text: "#f0f4f0" },
  "Gorpcore":            { bg: "#2d4a1e", text: "#f0ece0" },
  "Y2K":                 { bg: "#302040", text: "#f0c030" },
  "Baroque":             { bg: "#1a1000", text: "#f0e0a0" },
  "Japandi":             { bg: "#f5f0e8", text: "#1a1810" },
  "Cyberpunk":           { bg: "#0a0015", text: "#00e0f0" },
  "Soft Grunge":         { bg: "#302020", text: "#e8d8d8" },
  "Maximalist Floral":   { bg: "#1a0a18", text: "#f0d0e0" },
  "Brutalist":           { bg: "#f0f0f0", text: "#101010" },
  "Art Deco":            { bg: "#0a0a08", text: "#c0a000" },
  "Moody Botanical":     { bg: "#0c1a0a", text: "#a0c090" },
  "Desert Nomad":        { bg: "#2a1800", text: "#f0e0c0" },
  "Ice Queen":           { bg: "#e8f0f8", text: "#1a2838" },
  "Vampire":             { bg: "#0a0005", text: "#c04080" },
  "Golden Hour":         { bg: "#1a0800", text: "#f0c060" },
  "Monochrome Ink":      { bg: "#f0f0f0", text: "#101010" },
  "Terra Cotta":         { bg: "#3a1808", text: "#f0d0b8" },
  "Creme Mist":          { bg: "#f5f0e8", text: "#2a2018" },
  "Steeped Cream":       { bg: "#faf7f0", text: "#2a2018" },
  "Blue Vein":           { bg: "#f5f0e8", text: "#2a2018" },
  "Morning Fog":         { bg: "#ede6d8", text: "#2a2018" },
  "Parchment Blue":      { bg: "#f0ebe0", text: "#2a2018" },
  "Drift Cream":         { bg: "#f8f2e8", text: "#2a2018" },
  "Warm Stone":          { bg: "#e8ddd0", text: "#2a2018" },
  "Quiet Luxury":        { bg: "#f5f0e8", text: "#2a2018" },
  "Silver Lining":       { bg: "#f8f4f0", text: "#2a2018" },
  "Misty Morning":       { bg: "#f0ece0", text: "#2a2018" },
  "Cream & Steel":       { bg: "#f5f0e8", text: "#2a2018" },
  "Linen Blue":          { bg: "#faf7f2", text: "#2a2018" },
  "Stonewash":           { bg: "#ede6d8", text: "#2a2018" },
  "Latte":               { bg: "#f0e8d8", text: "#2a2018" },
  "Vanilla Sky":         { bg: "#faf5eb", text: "#2a2018" },
  "Chalk & Steel":       { bg: "#f7f2ea", text: "#2a2018" },
  "Blue Cream":          { bg: "#f5f0e8", text: "#2a2018" },
  "Paperwhite":          { bg: "#fafaf5", text: "#2a2018" },
  "Oatmeal":             { bg: "#f0e8d8", text: "#2a2018" },
  "Dusk":                { bg: "#e8e0d0", text: "#2a2018" },
  "Pearl":               { bg: "#f8f4ec", text: "#2a2018" },
  "Bone":                { bg: "#f2ece0", text: "#2a2018" },
  "Marble":              { bg: "#f5f0e8", text: "#2a2018" },
};

const SHAPE_TYPES = ["void", "frequency", "grid", "silhouette", "editorial"];
const IMG_TABS = ["Photos", "Art"];

const LAYOUTS = [
  { id: "freeform", icon: "▣" },
  { id: "magazine", icon: "▦" },
  { id: "lookbook", icon: "▤" },
  { id: "editorial", icon: "▥" },
  { id: "collage", icon: "▲" },
];

const PANEL_SECTIONS = [
  { id: "add", label: "ADD CARDS" },
  { id: "images", label: "IMAGE SEARCH" },
  { id: "genre", label: "GENRE" },
  { id: "palette", label: "COLOUR PALETTES" },
  { id: "shapes", label: "QUIZ SHAPES" },
  { id: "stickers", label: "STICKERS" },
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ─── Shape Canvas ──────────────────────────────────────────────────── */
function ShapeCanvas({ type, seed, width, height }) {
  const ref = useRef(null);
  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const dpr = window.devicePixelRatio || 1;
    cvs.width = width * dpr;
    cvs.height = height * dpr;
    cvs.style.width = `${width}px`;
    cvs.style.height = `${height}px`;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const pals = [
      ["#f5f0e8", "#9ab8cc", "#4e7a96", "#dce8f0"],
      ["#e8ddd0", "#8e9fc4", "#5a7080", "#f0ebe0"],
      ["#f0e8d8", "#8fa3b0", "#4a6a80", "#c2d9e8"],
      ["#f5f0e8", "#b8c6e0", "#4e7a96", "#e0d8c0"],
      ["#ede6d8", "#9ab8cc", "#3d5a70", "#d0ccc0"],
      ["#faf7f0", "#8e9fc4", "#485868", "#dce8f0"],
    ];
    const [c1, c2, c3, c4] = pals[seed % pals.length];
    const offX = ((seed * 37) % 30) / 100;
    const offY = ((seed * 53) % 30) / 100;
    const w = width,
      h = height;
    ctx.fillStyle = c1;
    ctx.fillRect(0, 0, w, h);

    if (type === "void") {
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.arc(w * (0.55 + offX), h * (0.45 + offY), Math.min(w, h) * (0.5 + offX * 0.1), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c4;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h * (0.65 + offY));
      ctx.lineTo(w, h * (0.65 + offY));
      ctx.stroke();
      ctx.fillStyle = c3;
      const sq = Math.min(w, h) * (0.15 + offX * 0.1);
      ctx.fillRect(w * (0.1 + offX), h * (0.5 + offY), sq, sq);
      if (seed > 3) {
        ctx.fillStyle = c4;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(w * 0.6, h * 0.1, w * 0.25, h * 0.25);
        ctx.globalAlpha = 1;
      }
    } else if (type === "frequency") {
      const numBands = 6 + (seed % 4);
      const bandH = h / numBands;
      for (let i = 0; i < numBands; i++) {
        ctx.fillStyle = i % 3 === 0 ? c2 : i % 3 === 1 ? c3 : c4;
        ctx.globalAlpha = i % 2 === 0 ? 1 : 0.3 + offX * 0.3;
        ctx.fillRect(0, i * bandH, w * (0.5 + offX + ((i * seed) % 5) / 10), bandH);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * (0.25 + offX), 0);
      ctx.lineTo(w * (0.25 + offX), h);
      ctx.stroke();
    } else if (type === "grid") {
      const cols = 5 + (seed % 4),
        rows = 5 + (seed % 3);
      ctx.strokeStyle = c3;
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.25;
      for (let i = 1; i < cols; i++) {
        const x = (w / cols) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let j = 1; j < rows; j++) {
        const y = (h / rows) * j;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = c2;
      ctx.fillRect(w * (0.4 + offX * 0.2), 0, w * (0.6 - offX * 0.2), h * (0.4 + offY * 0.2));
      ctx.fillStyle = c3;
      ctx.fillRect(0, h * (0.65 + offY * 0.15), w * (0.3 + offX * 0.2), h * (0.35 - offY * 0.1));
      ctx.fillStyle = c4;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(w * (0.1 + offX), h * (0.2 + offY), w * 0.12, h * 0.12);
      ctx.globalAlpha = 1;
    } else if (type === "silhouette") {
      ctx.fillStyle = c2;
      ctx.beginPath();
      ctx.moveTo(0, h * (0.55 + offY));
      ctx.quadraticCurveTo(w * (0.3 + offX), h * (0.15 + offY), w, h * (0.4 + offY));
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c3;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(0, h * (0.5 + offY));
      ctx.quadraticCurveTo(w * (0.5 + offX), h * (0.25 + offY), w, h * (0.5 + offY));
      ctx.lineTo(w, h * (0.58 + offY));
      ctx.quadraticCurveTo(w * (0.5 + offX), h * (0.33 + offY), 0, h * (0.58 + offY));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c4;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w * (0.08 + offX), h * (0.12 + offY));
      ctx.lineTo(w * (0.5 + offX), h * (0.12 + offY));
      ctx.stroke();
      if (seed > 2) {
        ctx.fillStyle = c4;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(w * (0.8 + offX * 0.1), h * (0.25 + offY * 0.2), w * 0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    } else {
      const split = 0.35 + offX * 0.15;
      ctx.fillStyle = c2;
      ctx.fillRect(0, 0, w * split, h);
      const numRules = 3 + (seed % 3);
      for (let i = 0; i < numRules; i++) {
        const y = h * (0.2 + i * 0.22 + offY * 0.05);
        ctx.strokeStyle = c3;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(w * (split + 0.04), y);
        ctx.lineTo(w * 0.95, y);
        ctx.stroke();
      }
      ctx.fillStyle = c2;
      ctx.fillRect(w * (split + 0.06), h * (0.1 + offY * 0.1), w * (0.2 + offX * 0.05), h * (0.2 + offY * 0.05));
      ctx.fillStyle = c4;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(w * (split + 0.06), h * (0.45 + offY * 0.1), w * 0.15, h * 0.08);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c3;
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(w * split, 0);
      ctx.lineTo(w * split, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }, [type, seed, width, height]);
  return <canvas ref={ref} style={{ display: "block", width: "100%", height: "100%" }} />;
}

/* ─── Modal ─────────────────────────────────────────────────────────── */
function Modal({ isOpen, title, onClose, children }) {
  if (!isOpen) return null;
  return (
    <div className="studio-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="studio-modal">
        <div className="studio-modal-header">
          <span className="studio-modal-title">{title}</span>
          <button className="studio-modal-close" onClick={onClose}>&#10005;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─── Main Studio Page ──────────────────────────────────────────────── */
export default function StudioPage() {
  const {
    boards, activeBoardId, setActiveBoardId, addBoard, updateBoard,
    fingerprint, savedShapes, setFingerprint, addSavedShape,
  } = useStudioStore();

  const { isLoggedIn, setIsLoggedIn } = useContext(AuthContext);
  const navigate = useNavigate();

  const activeBoard = boards.find((b) => b.id === activeBoardId) || boards[0];
  const [layout, setLayout] = useState(activeBoard?.layout || "freeform");
  const [openSections, setOpenSections] = useState(["add"]);
  const [imgQuery, setImgQuery] = useState("");
  const [imgResults, setImgResults] = useState([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgTab, setImgTab] = useState("Photos");
  const [boardDropOpen, setBoardDropOpen] = useState(false);
  const [eraseDropOpen, setEraseDropOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [newBoardModal, setNewBoardModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [eraseConfirmModal, setEraseConfirmModal] = useState(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [selectedGenre, setSelectedGenre] = useState(null);
  const zRef = useRef(10);

  const currentStyle = selectedGenre && GENRE_STYLES[selectedGenre]
    ? GENRE_STYLES[selectedGenre]
    : { bg: "#f5f0e8", text: "#2a2018" };

  const showToast = useCallback((msg) => {
    setToast(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  }, []);

  const saveBoard = useCallback(
    (board) => {
      updateBoard(board);
    },
    [updateBoard]
  );

  const addCard = useCallback(
    (card) => {
      if (!activeBoard) return;
      saveBoard({ ...activeBoard, cards: [...activeBoard.cards, card] });
    },
    [activeBoard, saveBoard]
  );

  const deleteCard = useCallback(
    (id) => {
      if (!activeBoard) return;
      saveBoard({ ...activeBoard, cards: activeBoard.cards.filter((c) => c.id !== id) });
    },
    [activeBoard, saveBoard]
  );

  const clearCards = useCallback(
    (type) => {
      if (!activeBoard) return;
      saveBoard({ ...activeBoard, cards: type ? activeBoard.cards.filter((c) => c.type !== type) : [] });
      showToast(type ? `${type} cards removed` : "Board cleared");
      setEraseConfirmModal(null);
      setEraseDropOpen(false);
    },
    [activeBoard, saveBoard, showToast]
  );

  const searchImages = async () => {
    if (!imgQuery.trim()) return;
    setImgLoading(true);
    const results = [];
    try {
      if (UNSPLASH_KEY) {
        const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(imgQuery)}&per_page=12&orientation=landscape`, { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}`, "Accept-Version": "v1" } });
        const data = await res.json();
        results.push(...(data.results || []).map((p) => ({ thumb: p.urls.small, full: p.urls.regular, alt: p.alt_description || imgQuery, attribution: `${p.user.name}, Unsplash` })));
      }
    } catch {}
    try {
      if (PEXELS_KEY) {
        const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(imgQuery)}&per_page=12`, { headers: { Authorization: PEXELS_KEY } });
        const data = await res.json();
        results.push(...(data.photos || []).map((p) => ({ thumb: p.src.medium, full: p.src.large, alt: p.alt || imgQuery, attribution: `${p.photographer}, Pexels` })));
      }
    } catch {}
    if (!results.length) showToast("Add API keys in .env");
    setImgResults(results.sort(() => Math.random() - 0.5));
    setImgLoading(false);
  };

  const searchArtImages = async () => {
    if (!imgQuery.trim()) {
      setImgResults(ABSTRACT_SOURCES);
      return;
    }
    setImgLoading(true);
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(imgQuery + " painting art")}&srnamespace=6&format=json&origin=*&srlimit=20`;
      const res = await fetch(url);
      const data = await res.json();
      const titles = (data.query?.search || []).map((r) => r.title);
      if (!titles.length) {
        setImgResults(ABSTRACT_SOURCES.filter((s) => s.alt.toLowerCase().includes(imgQuery.toLowerCase())));
        setImgLoading(false);
        return;
      }
      const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.slice(0, 10).join("|"))}&prop=imageinfo&iiprop=url|thumburl|extmetadata&iiurlwidth=400&format=json&origin=*`;
      const infoRes = await fetch(infoUrl);
      const infoData = await infoRes.json();
      const pages = Object.values(infoData.query?.pages || {});
      const mapped = pages
        .filter((p) => p.imageinfo?.[0]?.thumburl)
        .map((p) => ({
          thumb: p.imageinfo[0].thumburl,
          full: p.imageinfo[0].url,
          alt: p.title?.replace("File:", "").replace(/\.[^.]+$/, "") || imgQuery,
          attribution: p.imageinfo[0].extmetadata?.Artist?.value?.replace(/<[^>]*>/g, "") || "Wikimedia Commons",
        }));
      setImgResults(mapped.length ? mapped : ABSTRACT_SOURCES);
    } catch {
      setImgResults(ABSTRACT_SOURCES);
    }
    setImgLoading(false);
  };

  const handleSearch = () => {
    if (imgTab === "Photos") searchImages();
    else searchArtImages();
  };

  const handleTabSwitch = (tab) => {
    setImgTab(tab);
    setImgResults([]);
    if (tab === "Art") setImgResults(ABSTRACT_SOURCES);
  };

  const addImageCard = (src, alt, attribution) => {
    addCard({
      id: uid(), type: "image",
      x: 60 + Math.random() * 120, y: 60 + Math.random() * 120,
      w: 260, h: 200, z: zRef.current++,
      content: { src, alt, attribution },
    });
    showToast("Image added");
  };

  const addTextCard = () => {
    addCard({
      id: uid(), type: "text",
      x: 80 + Math.random() * 120, y: 80 + Math.random() * 120,
      w: 240, h: 140, z: zRef.current++,
      content: { text: "", author: "" },
    });
  };

  const addPaletteCard = (colours, name) => {
    addCard({
      id: uid(), type: "palette",
      x: 80 + Math.random() * 120, y: 80 + Math.random() * 120,
      w: 240, h: 110, z: zRef.current++,
      content: { colours, name },
    });
  };

  const addShapeCard = (type = "void") => {
    const seed = Math.floor(Math.random() * 32);
    addCard({
      id: uid(), type: "shape",
      x: 80 + Math.random() * 120, y: 80 + Math.random() * 120,
      w: 220, h: 220, z: zRef.current++,
      content: { shapeType: type, seed },
    });
  };

  const toggleSection = (id) => {
    setOpenSections((p) => (p.includes(id) ? p.filter((s) => s !== id) : [...p, id]));
  };

  const filteredPalettes = Object.entries(ALL_PALETTES).filter(
    ([name]) => !paletteSearch || name.toLowerCase().includes(paletteSearch.toLowerCase())
  );

  const gridStyleClass = layout !== "freeform" ? `studio-canvas-grid-${layout}` : "";
  const isAbs = layout === "freeform";

  if (!activeBoard) {
    return (
      <div className="studio-canvas-wrapper">
        <div className="studio-canvas-empty">
          <div className="studio-canvas-empty-text">Your moodboard awaits</div>
          <div className="studio-canvas-empty-sub">ADD CARDS FROM THE PANEL</div>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-layout" style={{ background: currentStyle.bg }}>
      {/* ── Toolbar ── */}
      <div className="studio-toolbar">
        <div className="studio-toolbar-left">
          <input
            className="studio-board-name"
            value={activeBoard?.name || ""}
            onChange={(e) => saveBoard({ ...activeBoard, name: e.target.value })}
          />
          <div className="studio-layout-btns">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                className={`studio-layout-btn ${layout === l.id ? "active" : ""}`}
                onClick={() => {
                  setLayout(l.id);
                  saveBoard({ ...activeBoard, layout: l.id });
                }}
              >
                {l.icon}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-toolbar-right">
          <Link
            to="/generator"
            className="studio-dropdown-btn"
            style={{ textDecoration: "none" }}
          >
            GENERATOR
          </Link>
          <div style={{ position: "relative" }}>
            <button
              className="studio-dropdown-btn"
              onClick={() => { setIsLoggedIn(false); navigate("/"); }}
            >
              LOG OUT
            </button>
          </div>

          <div style={{ position: "relative" }}>
            <button
              className="studio-dropdown-btn"
              onClick={() => {
                setBoardDropOpen(!boardDropOpen);
                setEraseDropOpen(false);
              }}
            >
              BOARDS &#9660;
            </button>
            {boardDropOpen && (
              <div className="studio-dropdown">
                {boards.map((b) => (
                  <div
                    key={b.id}
                    className={`studio-dropdown-item ${b.id === activeBoardId ? "active" : ""}`}
                    onClick={() => {
                      setActiveBoardId(b.id);
                      setLayout(b.layout);
                      setBoardDropOpen(false);
                    }}
                  >
                    {b.name}
                  </div>
                ))}
                <div
                  className="studio-dropdown-action"
                  onClick={() => {
                    setBoardDropOpen(false);
                    setNewBoardName("");
                    setNewBoardModal(true);
                  }}
                >
                  + New Board
                </div>
              </div>
            )}
          </div>

          <div style={{ position: "relative" }}>
            <button
              className="studio-dropdown-btn"
              onClick={() => {
                setEraseDropOpen(!eraseDropOpen);
                setBoardDropOpen(false);
              }}
            >
              ERASE &#9660;
            </button>
            {eraseDropOpen && (
              <div className="studio-dropdown">
                {[
                  ["Clear all cards", null],
                  ["Remove image cards", "image"],
                  ["Remove text cards", "text"],
                  ["Remove palette cards", "palette"],
                  ["Remove shape cards", "shape"],
                ].map(([label, type]) => (
                  <div
                    key={label}
                    className="studio-erase-item"
                    onClick={() => setEraseConfirmModal({ label, type })}
                  >
                    {label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        className={isAbs ? "studio-canvas-wrapper" : gridStyleClass}
        style={isAbs ? { background: currentStyle.bg } : { minHeight: "100%", background: currentStyle.bg }}
      >
        {activeBoard.cards.length === 0 && (
          <div className="studio-canvas-empty">
            <div className="studio-canvas-empty-text">Your moodboard awaits</div>
            <div className="studio-canvas-empty-sub">ADD CARDS FROM THE PANEL</div>
          </div>
        )}
        {activeBoard.cards.map((card) => {
          const gridSpan =
            layout === "magazine"
              ? { gridColumn: card.type === "image" ? "span 4" : "span 3", gridRow: card.type === "image" ? "span 3" : "span 2" }
              : {};
          return (
            <CardView
              key={card.id}
              card={card}
              isAbs={isAbs}
              gridSpan={gridSpan}
              board={activeBoard}
              onUpdate={saveBoard}
              onDelete={deleteCard}
              zRef={zRef}
            />
          );
        })}
      </div>

      {/* ── Sidebar ── */}
      <div className="studio-sidebar">
        {PANEL_SECTIONS.map(({ id, label }) => (
          <div key={id} className="studio-section">
            <div className="studio-section-header" onClick={() => toggleSection(id)}>
              <span className="studio-section-label">{label}</span>
              <span className={`studio-section-arrow ${openSections.includes(id) ? "open" : ""}`}>&#9660;</span>
            </div>
            {openSections.includes(id) && (
              <div className="studio-section-body">
                {id === "add" && (
                  <div className="studio-add-grid">
                    {[
                      ["T", "Text/Quote", addTextCard],
                      ["◎", "Palette", () => addPaletteCard(ALL_PALETTES["Dark Romantic"], "Dark Romantic")],
                      ["◫", "Shape", () => addShapeCard()],
                      ["↑", "Upload", () => document.getElementById("upload-input")?.click()],
                    ].map(([icon, lbl, fn]) => (
                      <button key={lbl} className="studio-add-btn" onClick={fn}>
                        <span className="studio-add-btn-icon">{icon}</span>
                        <span className="studio-add-btn-label">{lbl}</span>
                      </button>
                    ))}
                    <input type="file" id="upload-input" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = (ev) => addImageCard(ev.target?.result, f.name, ""); r.readAsDataURL(f); }} />
                  </div>
                )}

                {id === "images" && (
                  <div>
                    <div className="studio-img-tabs">
                      {IMG_TABS.map((tab) => (
                        <button key={tab} className={`studio-img-tab ${imgTab === tab ? "active" : ""}`} onClick={() => handleTabSwitch(tab)}>
                          {tab}
                        </button>
                      ))}
                    </div>
                    <div className="studio-img-search-row">
                      <input className="studio-img-input" value={imgQuery} onChange={(e) => setImgQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder={imgTab === "Photos" ? "Search photos..." : "Search art..."} />
                      <button className="studio-img-search-btn" onClick={handleSearch}>&#9658;</button>
                    </div>
                    {imgLoading && <div className="studio-img-loading">Searching...</div>}
                    <div className="studio-img-grid">
                      {imgResults.map((r, i) => (
                        <div key={i} className="studio-img-card" onClick={() => addImageCard(r.full, r.alt, r.attribution)}>
                          <img src={r.thumb} alt={r.alt} loading="lazy" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {id === "genre" && (
                  <div className="studio-genre-list">
                    {Object.entries(GENRE_STYLES).map(([name, style]) => (
                      <button
                        key={name}
                        className={`studio-genre-item ${selectedGenre === name ? "active" : ""}`}
                        onClick={() => setSelectedGenre(selectedGenre === name ? null : name)}
                        style={{ borderLeftColor: selectedGenre === name ? style.text : "transparent" }}
                      >
                        <span className="studio-genre-name">{name}</span>
                        <span className="studio-genre-dot" style={{ background: style.text }} />
                      </button>
                    ))}
                  </div>
                )}

                {id === "palette" && (
                  <div>
                    <button
                      className="studio-fp-btn"
                      onClick={() => {
                        const fp = fingerprint;
                        if (fp && FP_PALETTES[fp.type]) addPaletteCard(FP_PALETTES[fp.type], fp.type + " palette");
                        else showToast("Take The Mirror quiz first");
                      }}
                    >
                      <span>FINGERPRINT PALETTE</span><span>+</span>
                    </button>
                    <input className="studio-palette-input" value={paletteSearch} onChange={(e) => setPaletteSearch(e.target.value)} placeholder="Filter palettes..." />
                    <div className="studio-palette-list">
                      {filteredPalettes.map(([name, colours]) => (
                        <button key={name} className="studio-palette-item" onClick={() => addPaletteCard(colours, name)}>
                          <div className="studio-palette-swatches">
                            {colours.slice(0, 5).map((c, i) => (
                              <div key={i} className="studio-palette-swatch" style={{ background: c }} />
                            ))}
                          </div>
                          <span className="studio-palette-name">{name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {id === "shapes" && (
                  <div>
                    <div className="studio-shape-subtitle">ADD NEW SHAPE</div>
                    <div className="studio-shape-grid">
                      {SHAPE_TYPES.map((t) => (
                        <button key={t} className="studio-shape-btn" onClick={() => addShapeCard(t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                    {savedShapes.length > 0 && (
                      <>
                        <div className="studio-shape-subtitle" style={{ marginBottom: "0.4rem" }}>FROM QUIZ</div>
                        <div className="studio-saved-shapes-grid">
                          {savedShapes.slice(0, 9).map((s) => (
                            <div
                              key={s.id}
                              className="studio-saved-shape"
                              onClick={() =>
                                addCard({
                                  id: uid(), type: "shape",
                                  x: 80 + Math.random() * 120, y: 80 + Math.random() * 120,
                                  w: 220, h: 220, z: zRef.current++,
                                  content: { shapeType: s.type, seed: s.seed },
                                })
                              }
                            >
                              <ShapeCanvas type={s.type} seed={s.seed} width={60} height={60} />
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {id === "stickers" && (
                  <div>
                    <div className="studio-shape-subtitle">BUILT-IN STICKERS</div>
                    <div className="studio-sticker-grid">
                      {["✦", "☽", "♢", "◆", "◈", "✧", "♁", "⬡", "▿"].map((glyph, i) => (
                        <div
                          key={i}
                          className="studio-sticker"
                          style={{ fontSize: "1.6rem", color: currentStyle.text, userSelect: "none" }}
                          onClick={() =>
                            addCard({
                              id: uid(), type: "text",
                              x: 80 + Math.random() * 120, y: 80 + Math.random() * 120,
                              w: 120, h: 120, z: zRef.current++,
                              content: { text: glyph, author: "" },
                            })
                          }
                        >
                          {glyph}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Modals ── */}
      <Modal isOpen={newBoardModal} title="New Board" onClose={() => setNewBoardModal(false)}>
        <div className="studio-modal-body">
          <label className="studio-modal-label">BOARD NAME</label>
          <input
            autoFocus
            className="studio-modal-input"
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newBoardName.trim()) {
                const nb = { id: uid(), name: newBoardName.trim(), layout: "freeform", cards: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
                addBoard(nb);
                setNewBoardModal(false);
              }
            }}
            placeholder="Name your board..."
          />
        </div>
        <div className="studio-modal-footer">
          <button className="studio-modal-cancel" onClick={() => setNewBoardModal(false)}>CANCEL</button>
          <button
            className="studio-modal-confirm"
            onClick={() => {
              if (!newBoardName.trim()) return;
              const nb = { id: uid(), name: newBoardName.trim(), layout: "freeform", cards: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
              addBoard(nb);
              setNewBoardModal(false);
            }}
          >
            CREATE
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!eraseConfirmModal} title={eraseConfirmModal?.type ? `Remove ${eraseConfirmModal.type} cards?` : "Clear board?"} onClose={() => setEraseConfirmModal(null)}>
        <div className="studio-modal-body">
          <p className="studio-modal-text">
            {eraseConfirmModal?.type ? `All ${eraseConfirmModal.type} cards will be removed from this board.` : "All cards will be removed from this board. This cannot be undone."}
          </p>
        </div>
        <div className="studio-modal-footer">
          <button className="studio-modal-cancel" onClick={() => setEraseConfirmModal(null)}>CANCEL</button>
          <button className="studio-modal-confirm" onClick={() => clearCards(eraseConfirmModal?.type)}>CONFIRM</button>
        </div>
      </Modal>

      {/* ── Toast ── */}
      <div className={`studio-toast ${toastVisible ? "" : "hidden"}`}>{toast}</div>
    </div>
  );
}

/* ─── Card View ─────────────────────────────────────────────────────── */
function CardView({ card, isAbs, gridSpan, board, onUpdate, onDelete, zRef }) {
  const startDrag = (e) => {
    if (!isAbs) return;
    const target = e.target;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.closest(".studio-card-controls") || target.closest(".studio-card-resize")) return;
    e.preventDefault();
    const startX = e.clientX - card.x;
    const startY = e.clientY - card.y;
    const el = e.currentTarget;
    const newZ = ++zRef.current;
    el.style.zIndex = String(newZ);
    const onMove = (ev) => {
      el.style.left = Math.max(0, ev.clientX - startX) + "px";
      el.style.top = Math.max(0, ev.clientY - startY) + "px";
    };
    const onUp = (ev) => {
      const nx = Math.max(0, ev.clientX - startX);
      const ny = Math.max(0, ev.clientY - startY);
      onUpdate({ ...board, cards: board.cards.map((c) => (c.id === card.id ? { ...c, x: nx, y: ny, z: newZ } : c)) });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const startResize = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX,
      startY = e.clientY,
      sw = card.w,
      sh = card.h;
    const el = e.currentTarget.closest(".studio-card");
    const onMove = (ev) => {
      const nw = Math.max(120, sw + ev.clientX - startX);
      const nh = Math.max(80, sh + ev.clientY - startY);
      el.style.width = nw + "px";
      el.style.height = nh + "px";
    };
    const onUp = (ev) => {
      const nw = Math.max(120, sw + ev.clientX - startX);
      const nh = Math.max(80, sh + ev.clientY - startY);
      onUpdate({ ...board, cards: board.cards.map((c) => (c.id === card.id ? { ...c, w: nw, h: nh } : c)) });
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const style = isAbs
    ? { position: "absolute", left: card.x, top: card.y, width: card.w, height: card.h, zIndex: card.z }
    : { position: "relative", ...gridSpan };

  return (
    <div className="studio-card" style={style} onMouseDown={startDrag}>
      <div className="studio-card-controls">
        <button className="studio-card-delete" onClick={() => onDelete(card.id)}>&#10005;</button>
      </div>

      {card.type === "image" && <img className="studio-card-image" src={card.content.src} alt={card.content.alt} />}

      {card.type === "text" && (
        <div className="studio-card-text-wrap">
          <div className="studio-card-text-handle">
            <div className="studio-card-text-handle-bar" />
          </div>
          <textarea
            className="studio-card-textarea"
            defaultValue={card.content.text}
            onChange={(e) => {
              onUpdate({ ...board, cards: board.cards.map((c) => (c.id === card.id ? { ...c, content: { ...c.content, text: e.target.value } } : c)) });
            }}
            placeholder="Write something..."
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {card.type === "palette" && (
        <div className="studio-card-palette">
          <div className="studio-card-palette-strip">
            {card.content.colours.map((c, i) => (
              <div key={i} className="studio-card-palette-strip-color" style={{ background: c }} />
            ))}
          </div>
          <div className="studio-card-palette-info">
            <span className="studio-card-palette-name">{card.content.name}</span>
            {card.content.colours.map((c, i) => (
              <span key={i} className="studio-card-palette-hex" onClick={() => navigator.clipboard?.writeText(c)}>
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {card.type === "shape" && <ShapeCanvas type={card.content.shapeType} seed={card.content.seed} width={card.w} height={card.h} />}

      {isAbs && (
        <div className="studio-card-resize" onMouseDown={startResize}>
          <div className="studio-card-resize-line" />
        </div>
      )}
    </div>
  );
}
