import { useState, useRef, useEffect, useCallback } from "react";
import { toJpeg } from "html-to-image";
import useStudioStore from "../store";
import { ALL_PALETTES, FP_PALETTES } from "./themes";
import STICKER_PACKS from "../sticker-manifest.json";
import "./StudioPage.css";

// Image-provider keys are not embedded in this bundle — Unsplash & Pexels
// requests go through the backend proxy at /api/images/search, which uses
// server-side credentials. NASA, Met Museum, and Wikipedia are open APIs
// and require no key on either side.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

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
const imgTabs = ["Photos", "Museum", "Space", "Stickers"];

const STICKER_LABELS = {
  "pack 1": { label: "Animals", color: "#7a9e7e" },
  "pack 2": { label: "Art", color: "#9b7fd4" },
  "pack 3": { label: "Astrology", color: "#8b7355" },
  "pack 4": { label: "Books", color: "#c4913a" },
  "pack 5": { label: "Botanical", color: "#7a9e7e" },
  "pack 6": { label: "Café", color: "#8b7355" },
  "pack 7": { label: "Cats", color: "#c9897a" },
  "pack 8": { label: "Celestial", color: "#9b7fd4" },
  "pack 9": { label: "Cottagecore", color: "#7a9e7e" },
  "pack 10": { label: "Academia", color: "#8b7355" },
  "pack 11": { label: "Dreams", color: "#9b7fd4" },
  "pack 12": { label: "Emotions", color: "#d4af37" },
  "pack 13": { label: "Fantasy", color: "#9b7fd4" },
  "pack 14": { label: "Floral", color: "#c9897a" },
  "pack 15": { label: "Food", color: "#c4913a" },
  "pack 16": { label: "Gothic", color: "#8b7355" },
  "pack 17": { label: "Hearts", color: "#c9897a" },
  "pack 18": { label: "Kawaii", color: "#c9897a" },
  "pack 19": { label: "Mindful", color: "#9b7fd4" },
  "pack 20": { label: "Music", color: "#d4af37" },
  "pack 21": { label: "Nature", color: "#7a9e7e" },
  "pack 22": { label: "Stars", color: "#d4af37" },
  "pack 23": { label: "Vintage", color: "#8b7355" },
};

const PANEL_SECTIONS = [
  { id: "add", label: "ADD CARDS" },
  { id: "images", label: "IMAGE SEARCH" },
  { id: "palette", label: "COLOUR PALETTES" },
  { id: "art", label: "ABSTRACT ART" },
  { id: "emoticons", label: "EMOTICONS" },
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

  const activeBoard = boards.find((b) => b.id === activeBoardId) || boards[0];
  const [layout, setLayout] = useState(activeBoard?.layout || "freeform");
  const [openSections, setOpenSections] = useState(["add"]);
  const [imgQuery, setImgQuery] = useState("");
  const [imgResults, setImgResults] = useState([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [metResults, setMetResults] = useState([]);
  const [metLoading, setMetLoading] = useState(false);
  const [nasaResults, setNasaResults] = useState([]);
  const [nasaLoading, setNasaLoading] = useState(false);
  const [imgTab, setImgTab] = useState("Photos");
  const [activeStickerPack, setActiveStickerPack] = useState(Object.keys(STICKER_PACKS)[0] || "pack 1");
  const [boardDropOpen, setBoardDropOpen] = useState(false);
  const [eraseDropOpen, setEraseDropOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [newBoardModal, setNewBoardModal] = useState(false);
  const [newBoardName, setNewBoardName] = useState("");
  const [eraseConfirmModal, setEraseConfirmModal] = useState(null);
  const [paletteSearch, setPaletteSearch] = useState("");
  const [activePalette, setActivePalette] = useState(null);
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [saveBoardModal, setSaveBoardModal] = useState(false);
  const [saveBoardName, setSaveBoardName] = useState("");
  const boardSavedRef = useRef(false);
  const zRef = useRef(10);
  const canvasRef = useRef(null);

  useEffect(() => {
    boardSavedRef.current = activeBoard?.name !== 'My First Board';
  }, [activeBoardId, activeBoard?.name]);

  const currentStyle = { bg: "#f5f0e8", text: "#2a2018" };

  const showToast = useCallback((msg) => {
    setToast(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2200);
  }, []);

  const downloadAsJpeg = useCallback(async () => {
    const el = canvasRef.current;
    if (!el) return;
    setSelectedCardId(null);
    // Brief delay to let the controls/selection to disappear
    await new Promise(r => setTimeout(r, 80));
    try {
      const dataUrl = await toJpeg(el, {
        quality: 0.95,
        backgroundColor: currentStyle.bg,
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `${activeBoard?.name || "moodboard"}.jpeg`;
      link.href = dataUrl;
      link.click();
      showToast("Downloaded as JPEG");
    } catch {
      showToast("Download failed");
    }
  }, [activeBoard?.name, currentStyle.bg]);

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

  const findEmptySpot = useCallback((w, h) => {
    const existing = activeBoard?.cards || [];
    const step = 40;
    const maxX = 1000, maxY = 700;
    for (let y = 60; y < maxY - h; y += step) {
      for (let x = 60; x < maxX - w; x += step) {
        const overlaps = existing.some(c => {
          if (c.type === 'sticker' || (c.type === 'image' && c.content?.attribution === 'Sticker')) return false;
          return x < c.x + c.w && x + w > c.x && y < c.y + c.h && y + h > c.y;
        });
        if (!overlaps) return { x, y };
      }
    }
    return { x: 60 + Math.random() * 120, y: 60 + Math.random() * 120 };
  }, [activeBoard]);

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

  const colorNamesFromPalette = (cols) => {
    return cols.map(c => {
      const r = parseInt(c.slice(1,3), 16), g = parseInt(c.slice(3,5), 16), b = parseInt(c.slice(5,7), 16);
      const max = Math.max(r,g,b), min = Math.min(r,g,b);
      if (max - min < 30) return '';
      if (r > g && r > b) return r > 180 ? 'pink' : 'red';
      if (g > r && g > b) return g > 180 ? 'mint' : 'green';
      if (b > r && b > g) return b > 180 ? 'sky' : 'blue';
      if (max < 80) return 'dark';
      if (min > 200) return 'cream';
      if (r > 150 && g > 120 && b < 100) return 'golden';
      return '';
    }).filter(Boolean).slice(0, 2).join(' ');
  };

  const searchImages = async (append = false) => {
    if (!imgQuery.trim()) return;
    setImgLoading(true);
    let query = imgQuery;
    const paletteColors = activePalette?.colours ? colorNamesFromPalette(activePalette.colours) : '';
    if (paletteColors) query = `${paletteColors} ${imgQuery}`;
    const currentResults = append ? imgResults : [];
    const page = append ? Math.floor(currentResults.length / 30) + 1 : 1;
    const results = append ? [...currentResults] : [];

    try {
      const res = await fetch(`${API_BASE}/api/images/search?query=${encodeURIComponent(query)}&source=unsplash&per_page=30&page=${page}&orientation=landscape`);
      if (res.ok) {
        const data = await res.json();
        results.push(...(data.results || []));
      }
    } catch {}
    try {
      const res = await fetch(`${API_BASE}/api/images/search?query=${encodeURIComponent(query)}&source=pexels&per_page=30&page=${page}`);
      if (res.ok) {
        const data = await res.json();
        results.push(...(data.results || []));
      }
    } catch {}

    if (!append) {
      try {
        const wikiQuery = paletteColors ? `${paletteColors} ${imgQuery} art` : `${imgQuery} art`;
        const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(wikiQuery)}&srnamespace=6&format=json&origin=*&srlimit=8`;
        const res = await fetch(url);
        const data = await res.json();
        const titles = (data.query?.search || []).map((r) => r.title);
        if (titles.length) {
          const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.slice(0, 6).join("|"))}&prop=imageinfo&iiprop=url|thumburl|extmetadata&iiurlwidth=400&format=json&origin=*`;
          const infoRes = await fetch(infoUrl);
          const infoData = await infoRes.json();
          const pages = Object.values(infoData.query?.pages || {});
          const wikiResults = pages.filter(p => p.imageinfo?.[0]?.thumburl).map(p => ({
            thumb: p.imageinfo[0].thumburl,
            full: p.imageinfo[0].url,
            alt: p.title?.replace("File:", "").replace(/\.[^.]+$/, "") || imgQuery,
            attribution: p.imageinfo[0].extmetadata?.Artist?.value?.replace(/<[^>]*>/g, "") || "Wikimedia Commons",
          }));
          results.push(...wikiResults);
        }
      } catch {}
    }

    if (!results.length) showToast("No results found");
    setImgResults(results.sort(() => Math.random() - 0.5));
    setImgLoading(false);
  };

  const searchMetImages = async (append = false) => {
    if (!imgQuery.trim()) return;
    setMetLoading(true);
    try {
      const currentResults = append ? metResults : [];
      const offset = append ? currentResults.length : 0;
      const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(imgQuery)}&hasImages=true`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();
      const objectIDs = (searchData.objectIDs || []).slice(offset, offset + 20);
      if (!objectIDs.length) { if (!append) setMetResults([]); setMetLoading(false); return; }

      const details = await Promise.all(
        objectIDs.map(id =>
          fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).then(r => r.json())
        )
      );
      const newResults = details
        .filter(d => d.primaryImageSmall)
        .map(d => ({
          thumb: d.primaryImageSmall,
          full: d.primaryImage,
          alt: d.title || imgQuery,
          attribution: d.artistDisplayName || "Metropolitan Museum of Art",
        }));
      setMetResults(append ? [...currentResults, ...newResults] : newResults);
      if (!newResults.length && !append) setMetResults([]);
    } catch {
      if (!append) setMetResults([]);
    }
    setMetLoading(false);
  };

  const searchNasaImages = async (append = false) => {
    if (!imgQuery.trim()) return;
    setNasaLoading(true);
    try {
      const currentResults = append ? nasaResults : [];
      const page = append ? Math.floor(currentResults.length / 30) + 1 : 1;
      const q = encodeURIComponent(imgQuery);
      const res = await fetch(`https://images-api.nasa.gov/search?q=${q}&media_type=image&page=${page}`);
      const data = await res.json();
      const items = data.collection?.items || [];
      const newResults = items.map(item => {
        const d = item.data?.[0] || {};
        const links = item.links || [];
        const thumb = links.find(l => l.rel === "preview")?.href || "";
        const full = links.find(l => l.rel === "preview")?.href?.replace("~thumb", "~orig") || thumb;
        return {
          thumb,
          full,
          alt: d.title || imgQuery,
          attribution: d.center || "NASA",
        };
      }).filter(r => r.thumb);
      setNasaResults(append ? [...currentResults, ...newResults] : newResults);
    } catch {
      if (!append) setNasaResults([]);
    }
    setNasaLoading(false);
  };

  const handleSearch = () => {
    if (imgTab === "Museum") searchMetImages();
    else if (imgTab === "Space") searchNasaImages();
    else searchImages();
  };

  const handleTabSwitch = (tab) => {
    setImgTab(tab);
    setImgResults([]);
    setMetResults([]);
    setNasaResults([]);
    setImgQuery("");
  };

  const addImageCard = (src, alt, attribution, size = 260) => {
    const isSticker = attribution === 'Sticker';
    const w = isSticker ? size : 260;
    const h = isSticker ? size : 200;
    const pos = findEmptySpot(w, h);
    addCard({
      id: uid(), type: "image",
      x: pos.x, y: pos.y,
      w, h, z: zRef.current++,
      content: { src, alt, attribution },
    });
    showToast("Image added");
  };

  const addTextCard = () => {
    const pos = findEmptySpot(240, 160);
    addCard({
      id: uid(), type: "text",
      x: pos.x, y: pos.y,
      w: 240, h: 160, z: zRef.current++,
      content: { text: "", author: "", textColor: "#2a2018" },
    });
  };

  const addPaletteCard = (colours, name) => {
    const pos = findEmptySpot(240, 110);
    addCard({
      id: uid(), type: "palette",
      x: pos.x, y: pos.y,
      w: 240, h: 110, z: zRef.current++,
      content: { colours, name },
    });
  };

  const addShapeCard = (type = "void") => {
    const seed = Math.floor(Math.random() * 32);
    const pos = findEmptySpot(320, 320);
    addCard({
      id: uid(), type: "shape",
      x: pos.x, y: pos.y,
      w: 320, h: 320, z: zRef.current++,
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

  const [orientation, setOrientation] = useState(() => {
    if (typeof window === 'undefined') return { isPhone: false, isPortrait: false };
    const w = window.innerWidth, h = window.innerHeight;
    const minDim = Math.min(w, h);
    return { isPhone: minDim < 600, isPortrait: h > w };
  });
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const minDim = Math.min(w, h);
      setOrientation({ isPhone: minDim < 600, isPortrait: h > w });
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  if (orientation.isPhone && orientation.isPortrait) {
    return (
      <div className="studio-rotate-prompt">
        <div className="studio-rotate-card">
          <div className="studio-rotate-icon" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="14" y="6" width="26" height="44" rx="4" />
              <path d="M27 44h0" />
              <path d="M44 30l8 8-8 8" />
              <path d="M52 38H30" />
            </svg>
          </div>
          <h2 className="studio-rotate-title">Rotate your phone</h2>
          <p className="studio-rotate-msg">
            The Moodboard canvas works best in <strong>landscape</strong> mode.
          </p>
          <p className="studio-rotate-hint">
            Turn your device sideways to start dragging cards. For the full studio experience, a tablet or laptop is recommended.
          </p>
        </div>
      </div>
    );
  }

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
        </div>

        <div className="studio-toolbar-right">
          <button
            className="studio-dropdown-btn"
            onClick={() => {
              if (!boardSavedRef.current) {
                setSaveBoardName('');
                setSaveBoardModal(true);
              } else {
                updateBoard({ ...activeBoard, updated_at: new Date().toISOString() });
                showToast('Board saved');
              }
            }}
            style={{ color: 'var(--rg)', borderColor: 'var(--rg)' }}
          >
            SAVE
          </button>
          <button className="studio-dropdown-btn" onClick={downloadAsJpeg}>
            DOWNLOAD
          </button>

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
        ref={canvasRef}
        className={isAbs ? "studio-canvas-wrapper" : gridStyleClass}
        style={isAbs ? { background: currentStyle.bg } : { minHeight: "100%", background: currentStyle.bg }}
        onClick={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('studio-canvas-wrapper')) setSelectedCardId(null); }}
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
              theme={currentStyle}
              isSelected={selectedCardId === card.id}
              onSelect={() => setSelectedCardId(card.id)}
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
                      {imgTabs.map((tab) => (
                        <button key={tab} className={`studio-img-tab ${imgTab === tab ? "active" : ""}`} onClick={() => handleTabSwitch(tab)}>
                          {tab}
                        </button>
                      ))}
                    </div>
                    {imgTab !== "Stickers" && (
                      <div className="studio-img-search-row">
                        <input className="studio-img-input" value={imgQuery} onChange={(e) => setImgQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} placeholder={`Search ${imgTab.toLowerCase()}...`} />
                        <button className="studio-img-search-btn" onClick={handleSearch}>&#9658;</button>
                      </div>
                    )}
                    {imgTab !== "Stickers" && (imgLoading || metLoading || nasaLoading) && <div className="studio-img-loading">Searching...</div>}
                    {imgTab !== "Stickers" && (
                      <div className="studio-img-results">
                        <div className="studio-img-grid">
                        {(imgTab === "Museum" ? metResults : imgTab === "Space" ? nasaResults : imgResults).map((r, i) => (
                          <div key={i} className="studio-img-card" onClick={() => addImageCard(r.full, r.alt, r.attribution)} style={{ background: '#f0e8d8' }}>
                            <img src={r.thumb} alt={r.alt} loading="lazy" style={{ objectFit: 'cover' }}
                              onError={(e) => {
                                if (e.target.src !== r.full) { e.target.src = r.full; } else { e.target.style.display = 'none'; }
                              }}
                            />
                          </div>
                        ))}
                      </div>
                      {((imgTab === "Photos" && imgResults.length > 0) || (imgTab === "Museum" && metResults.length > 0) || (imgTab === "Space" && nasaResults.length > 0)) && (
                        <button className="studio-img-load-more" onClick={() => { if (imgTab === "Museum") searchMetImages(true); else if (imgTab === "Space") searchNasaImages(true); else searchImages(true); }} disabled={imgLoading || metLoading || nasaLoading}>
                          {imgLoading || metLoading || nasaLoading ? "Loading..." : "Load more"}
                        </button>
                      )}
                      </div>
                    )}
                    {imgTab === "Stickers" && (
                      <div>
                        <div className="studio-shape-subtitle">STICKER PACKS</div>
                        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '0.6rem', maxHeight: '80px', overflowY: 'auto' }}>
                          {Object.keys(STICKER_PACKS).map((packKey) => {
                            const info = STICKER_LABELS[packKey] || { label: packKey, color: '#d4af37' };
                            return (
                              <button
                                key={packKey}
                                onClick={() => setActiveStickerPack(packKey)}
                                style={{
                                  padding: '3px 8px', borderRadius: '10px', cursor: 'pointer',
                                  fontFamily: 'var(--font-mono)', fontSize: '0.38rem', letterSpacing: '0.06em', textTransform: 'uppercase',
                                  background: activeStickerPack === packKey ? `${info.color}22` : 'transparent',
                                  border: activeStickerPack === packKey ? `1px solid ${info.color}45` : '1px solid rgba(0,0,0,0.08)',
                                  color: activeStickerPack === packKey ? info.color : 'rgba(0,0,0,0.35)',
                                  transition: 'all 0.12s',
                                }}
                              >
                                {info.label}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                          {(STICKER_PACKS[activeStickerPack] || []).map((stickerPath, i) => (
                            <div
                              key={i}
                              onClick={() => addImageCard(stickerPath, stickerPath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'sticker', 'Sticker', 80)}
                              style={{
                                aspectRatio: '1', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'transparent', border: 'none', padding: '4px',
                              }}
                            >
                              <img
                                src={stickerPath}
                                alt="sticker"
                                loading="lazy"
                                style={{
                                  maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                                  filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15)) drop-shadow(0 0 1px rgba(0,0,0,0.08))',
                                  transform: `rotate(${(Math.random() * 6 - 3).toFixed(1)}deg)`,
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {id === "palette" && (
                  <div>
                    <button
                      className="studio-fp-btn"
                      onClick={() => {
                        const fp = fingerprint;
                        if (fp && FP_PALETTES[fp.type]) {
                          const name = fp.type + " palette";
                          setActivePalette({ colours: FP_PALETTES[fp.type], name });
                          addPaletteCard(FP_PALETTES[fp.type], name);
                        } else showToast("Take The Mirror quiz first");
                      }}
                    >
                      <span>FINGERPRINT PALETTE</span><span>+</span>
                    </button>
                    <input className="studio-palette-input" value={paletteSearch} onChange={(e) => setPaletteSearch(e.target.value)} placeholder="Filter palettes..." />
                    <div className="studio-palette-list">
                      {filteredPalettes.map(([name, colours]) => (
                        <button key={name} className="studio-palette-item" onClick={() => { setActivePalette({ colours, name }); addPaletteCard(colours, name); }}>
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

                {id === "art" && (
                  <ArtPanel currentStyle={currentStyle} addCard={addCard} zRef={zRef} findEmptySpot={findEmptySpot} />
                )}

                {id === "emoticons" && (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '5px', marginBottom: '0.7rem' }}>
                      {EMOTICONS.map((emoji, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '0.5rem 0.3rem', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.08)',
                            textAlign: 'center', fontSize: '0.82rem', fontWeight: 500,
                            color: '#2a2018', background: '#ffffff',
                            userSelect: 'none', transition: 'border-color 0.2s, background 0.2s',
                            overflow: 'hidden', whiteSpace: 'nowrap',
                            fontFamily: 'var(--font-mono), monospace',
                            lineHeight: 1.2,
                          }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--rg)'}
                          onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)'}
                          title={emoji.name}
                          onClick={() => {
                            const pos = findEmptySpot(60, 40);
                            addCard({
                              id: uid(), type: "sticker",
                              x: pos.x, y: pos.y,
                              w: 60, h: 40, z: zRef.current++,
                              initW: 60, initH: 40,
                              content: { char: emoji.char, fontSize: '0.85rem', letterSpacing: '0' },
                            });
                          }}
                        >
                          {emoji.char}
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

      <Modal isOpen={saveBoardModal} title="Save Board" onClose={() => setSaveBoardModal(false)}>
        <div className="studio-modal-body">
          <label className="studio-modal-label">BOARD NAME</label>
          <input
            autoFocus
            className="studio-modal-input"
            value={saveBoardName}
            onChange={(e) => setSaveBoardName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && saveBoardName.trim()) {
                const existing = boards.find(b => b.id === activeBoardId);
                if (existing) {
                  updateBoard({ ...activeBoard, name: saveBoardName.trim() });
                } else {
                  addBoard({ ...activeBoard, name: saveBoardName.trim() });
                }
                setSaveBoardModal(false);
                showToast('Board saved');
              }
            }}
            placeholder="Name your board..."
          />
        </div>
        <div className="studio-modal-footer">
          <button className="studio-modal-cancel" onClick={() => setSaveBoardModal(false)}>CANCEL</button>
          <button
            className="studio-modal-confirm"
            onClick={() => {
              if (!saveBoardName.trim()) return;
              const existing = boards.find(b => b.id === activeBoardId);
              if (existing) {
                updateBoard({ ...activeBoard, name: saveBoardName.trim() });
              } else {
                addBoard({ ...activeBoard, name: saveBoardName.trim() });
              }
              setSaveBoardModal(false);
              showToast('Board saved');
            }}
          >
            SAVE
          </button>
        </div>
      </Modal>

      {/* ── Toast ── */}
      <div className={`studio-toast ${toastVisible ? "" : "hidden"}`}>{toast}</div>
    </div>
  );
}

/* ─── Art Panel ──────────────────────────────────────────────────────── */
const ART_TABS = ["Ornamental", "Borders", "Shapes", "Arrows"];

const ART_GLYPHS = {
  Ornamental: [
    { char: '✿', name: 'bloom' }, { char: '⚘', name: 'flower' }, { char: '❦', name: 'heart floral' },
    { char: '☙', name: 'reversed heart' }, { char: '♡', name: 'outline heart' }, { char: '❧', name: 'rotated heart' },
    { char: '⚬', name: 'small circle' }, { char: '◉', name: 'fisheye' }, { char: '◎', name: 'bullseye' },
    { char: '⬤', name: 'black circle' }, { char: '◐', name: 'half circle' }, { char: '◌', name: 'dotted circle' },
    { char: '✦', name: 'four-point star' }, { char: '✧', name: 'white star' }, { char: '★', name: 'black star' },
    { char: '☀', name: 'sun rays' }, { char: '☁', name: 'cloud' }, { char: '☂', name: 'umbrella' },
    { char: '☽', name: 'crescent moon' }, { char: '☾', name: 'moon' }, { char: '⚛', name: 'atom' },
    { char: '⬡', name: 'hexagon' }, { char: '⬢', name: 'hexagon black' }, { char: '◆', name: 'diamond' },
    { char: '◇', name: 'hollow diamond' }, { char: '◈', name: 'diamond inset' }, { char: '⬥', name: 'small diamond' },
    { char: '♫', name: 'beamed notes' }, { char: '♪', name: 'eighth note' }, { char: '♬', name: 'sixteenth notes' },
    { char: '♁', name: 'earth' }, { char: '☿', name: 'mercury' }, { char: '⚸', name: 'black moon' },
    { char: '⛧', name: 'pentagram' }, { char: '꩜', name: 'spiral' }, { char: '☯', name: 'yin yang' },
    { char: '⚔', name: 'crossed swords' }, { char: '♞', name: 'knight' }, { char: '♛', name: 'queen' },
    { char: '⚜', name: 'fleur-de-lis' }, { char: '☘', name: 'shamrock' }, { char: '❀', name: 'florette' },
    { char: '❁', name: 'outlined florette' }, { char: '❂', name: 'open centre star' }, { char: '❃', name: 'teardrop asterisk' },
    { char: '✾', name: 'six-petal' }, { char: '⚕', name: 'caduceus' }, { char: '♆', name: 'neptune' },
    { char: '▽', name: 'triangle down' }, { char: '△', name: 'triangle' }, { char: '□', name: 'square' },
    { char: '○', name: 'circle' }, { char: '⬠', name: 'pentagon' }, { char: '⬟', name: 'pentagon black' },
  ],
  Borders: [
    { char: '═══', name: 'double rule' }, { char: '───', name: 'rule' },
    { char: '╌╌╌', name: 'dotted rule' }, { char: '┄┄┄', name: 'dashed rule' },
    { char: '▁▁▁', name: 'lower block' }, { char: '▔▔▔', name: 'upper block' },
    { char: '▀▀▀', name: 'upper half' }, { char: '──', name: 'thin rule' },
    { char: '━', name: 'heavy rule' }, { char: '╍╍╍', name: 'heavy dotted' },
    { char: '┅┅┅', name: 'heavy dashed' }, { char: '⁘', name: 'four dots' },
  ],
  Shapes: [
    { char: '▚', name: 'quadrant' }, { char: '▞', name: 'quadrant rev' }, { char: '▙', name: 'quadrant bl' },
    { char: '▛', name: 'quadrant tr' }, { char: '▜', name: 'quadrant tl' }, { char: '▟', name: 'quadrant br' },
    { char: '▖', name: 'lower right' }, { char: '▗', name: 'lower left' }, { char: '▘', name: 'upper left' },
    { char: '▝', name: 'upper right' }, { char: '▀', name: 'upper half block' }, { char: '▄', name: 'lower half block' },
    { char: '█', name: 'full block' }, { char: '░', name: 'light shade' }, { char: '▒', name: 'medium shade' },
    { char: '▓', name: 'dark shade' }, { char: '▢', name: 'white square' }, { char: '■', name: 'black square' },
    { char: '▥', name: 'crosshatch' }, { char: '▦', name: 'crosshatch filled' }, { char: '▧', name: 'shade light' },
    { char: '▨', name: 'shade medium' }, { char: '▩', name: 'shade dark' }, { char: '◧', name: 'half circle' },
    { char: '◨', name: 'half circle rev' }, { char: '◩', name: 'quarter circle' }, { char: '◪', name: 'quarter rev' },
  ],
  Arrows: [
    { char: '→', name: 'right' }, { char: '←', name: 'left' }, { char: '↑', name: 'up' }, { char: '↓', name: 'down' },
    { char: '⇢', name: 'right dashed' }, { char: '⇠', name: 'left dashed' }, { char: '↗', name: 'up-right' },
    { char: '↘', name: 'down-right' }, { char: '↙', name: 'down-left' }, { char: '↖', name: 'up-left' },
    { char: '⟶', name: 'long right' }, { char: '⟵', name: 'long left' }, { char: '⇀', name: 'right harpoon' },
    { char: '⇁', name: 'right harpoon down' }, { char: '↺', name: 'circle arrow' }, { char: '↻', name: 'circle arrow rev' },
    { char: '⇝', name: 'right squiggle' }, { char: '↭', name: 'wave arrow' }, { char: '↯', name: 'zigzag' },
    { char: '⬈', name: 'ne arrow' }, { char: '⬋', name: 'sw arrow' }, { char: '⬀', name: 'nw arrow' },
    { char: '⬂', name: 'se arrow' }, { char: '⇄', name: 'right-left' }, { char: '⇅', name: 'up-down' },
    { char: '⇆', name: 'left-right' }, { char: '⇇', name: 'left paired' },
  ],
};

const TEXT_COLORS = [
  { name: 'Ink', hex: '#2a2018' },
  { name: 'Rust', hex: '#c4522a' },
  { name: 'Night', hex: '#1a2838' },
  { name: 'Moss', hex: '#3a5030' },
  { name: 'Berry', hex: '#5a2040' },
  { name: 'Gold', hex: '#8a6a18' },
  { name: 'Teal', hex: '#1a4a4a' },
  { name: 'Plum', hex: '#3a2a4a' },
];

const EMOTICONS = [
  { char: '(◕‿◕)', name: 'happy' }, { char: '(◡ ω ◡)', name: 'content' }, { char: '(•‿•)', name: 'smile' },
  { char: '(✿◠‿◠)', name: 'bloom smile' }, { char: '(｡◕‿◕｡)', name: 'sparkle' }, { char: '(◍•ᴗ•◍)', name: 'warm' },
  { char: '(ᵔ◡ᵔ)', name: 'gentle' }, { char: '(⌒‿⌒)', name: 'beam' }, { char: '(◕ᴗ◕✿)', name: 'floral' },
  { char: '(♡˙︶˙♡)', name: 'love' }, { char: '(｡♥‿♥｡)', name: 'heart eyes' }, { char: '(♥ω♥)', name: 'in love' },
  { char: '(♡°▽°♡)', name: 'head over heels' }, { char: '(⁀ᗢ⁀)', name: 'fae' }, { char: '(✿ヘᴥヘ)', name: 'bear' },
  { char: '(╥﹏╥)', name: 'cry' }, { char: '(｡•́︿•̀｡)', name: 'teary' }, { char: '(个_个)', name: 'sob' },
  { char: '(╥_╥)', name: 'bawling' }, { char: '(´;︵;`)', name: 'weep' }, { char: '(T_T)', name: 'frown' },
  { char: '(╬ Ò﹏Ó)', name: 'furious' }, { char: '(｀Д´)', name: 'rage' }, { char: '(ノಠ益ಠ)ノ', name: 'fuming' },
  { char: '(≖_≖)', name: 'unimpressed' }, { char: '(ಠ_ಠ)', name: 'disapproval' }, { char: '(¬_¬")', name: 'skeptical' },
  { char: '(⊙_⊙)', name: 'shock' }, { char: 'Σ(°△°|||)', name: 'panic' }, { char: 'w(°ｏ°)w', name: 'amazed' },
  { char: '(⁄ ⁄>⁄▽⁄<⁄ ⁄)', name: 'shy' }, { char: '(*/ω＼*)', name: 'blush' }, { char: '(⌒_⌒;)', name: 'awkward' },
  { char: 'm(_ _)m', name: 'bow' }, { char: '(シ_ _)シ', name: 'apology' }, { char: '(_ _;)', name: 'sweat' },
  { char: '(╯°□°）╯︵ ┻━┻', name: 'table flip' }, { char: '(ﾉ≧∇≦)ﾉ ﾐ ┻━┻', name: 'flip table cheer' },
  { char: '¯\\_(ツ)_/¯', name: 'shrug' }, { char: 'ヽ(ー_ー)ノ', name: 'whatever' }, { char: '╮(╯_╰)╭', name: 'meh' },
  { char: '(￣ω￣)', name: 'smirk' }, { char: '(≧▽≦)', name: 'excited' }, { char: '٩(◕‿◕｡)۶', name: 'cheer' },
  { char: 'ヽ(・∀・)ﾉ', name: 'wave' }, { char: '\\(^ヮ^)/', name: 'rejoice' }, { char: '乁( • ω •乁)', name: 'giddy' },
  { char: '(￣▽￣)ノ', name: 'peace' }, { char: 'v(￣∇￣)', name: 'v sign' }, { char: '(-_-)zzz', name: 'sleep' },
  { char: '(─‿‿─)', name: 'groove' }, { char: 'ヽ(〃･ω･)ﾉ', name: 'skippy' }, { char: '(¬‿¬)', name: 'mischief' },
];

function ArtPanel({ currentStyle, addCard, zRef, findEmptySpot }) {
  const [artTab, setArtTab] = useState("Ornamental");
  const fontSize = artTab === "Borders" ? "0.85rem" : artTab === "Arrows" ? "1.2rem" : artTab === "Shapes" ? "1.35rem" : "1.5rem";
  const isBorder = artTab === "Borders";
  const glyphs = ART_GLYPHS[artTab] || [];

  return (
    <div>
      <div className="studio-img-tabs">
        {ART_TABS.map((tab) => (
          <button key={tab} className={`studio-img-tab ${artTab === tab ? "active" : ""}`} onClick={() => setArtTab(tab)}>
            {tab}
          </button>
        ))}
      </div>
      <div className="studio-sticker-grid">
        {glyphs.map((glyph, i) => (
          <div
            key={i}
            className="studio-sticker"
            style={{ fontSize, color: currentStyle.text, userSelect: "none", letterSpacing: isBorder ? '0.03em' : '0' }}
            title={glyph.name}
            onClick={() => {
              const pos = findEmptySpot(36, 36);
              addCard({
                id: uid(), type: "sticker",
                x: pos.x, y: pos.y,
                w: 36, h: 36, z: zRef.current++,
                initW: 36, initH: 36,
                content: { char: glyph.char, fontSize, letterSpacing: isBorder ? '0.03em' : '0' },
              });
            }}
          >
            {glyph.char}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Card View ─────────────────────────────────────────────────────── */
function CardView({ card, isAbs, gridSpan, board, onUpdate, onDelete, zRef, theme, isSelected, onSelect }) {
  const cardBg = theme?.bg || '#f5f0e8';
  const cardText = theme?.text || '#2a2018';
  const isSticker = card.type === "sticker";
  const isImageSticker = card.type === "image" && card.content?.attribution === 'Sticker';
  const isDieCut = isSticker || isImageSticker;
  const isText = card.type === "text";

  const startDrag = (e) => {
    if (!isAbs) return;
    const target = e.target;
    if (isText && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
    if (target.closest(".studio-card-controls") || target.closest(".studio-card-resize")) return;
    e.preventDefault();
    const startX = e.clientX - card.x;
    const startY = e.clientY - card.y;
    const el = e.currentTarget;
    const newZ = ++zRef.current;
    el.style.zIndex = String(newZ);

    const parent = el.parentElement;
    const maxX = () => Math.max(0, (parent?.clientWidth  || 0) - el.offsetWidth);
    const maxY = () => Math.max(0, (parent?.clientHeight || 0) - el.offsetHeight);

    const onMove = (ev) => {
      const nx = Math.min(maxX(), Math.max(0, ev.clientX - startX));
      const ny = Math.min(maxY(), Math.max(0, ev.clientY - startY));
      el.style.left = nx + "px";
      el.style.top  = ny + "px";
    };
    const onUp = (ev) => {
      const nx = Math.min(maxX(), Math.max(0, ev.clientX - startX));
      const ny = Math.min(maxY(), Math.max(0, ev.clientY - startY));
      onUpdate({ ...board, cards: board.cards.map((c) => (c.id === card.id ? { ...c, x: nx, y: ny, z: newZ } : c)) });
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const startResize = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX,
      startY = e.clientY,
      sw = card.w,
      sh = card.h;
    const el = e.currentTarget.closest(".studio-card");

    const parent = el?.parentElement;
    const maxW = () => Math.max(40, (parent?.clientWidth  || 0) - (el?.offsetLeft || 0));
    const maxH = () => Math.max(40, (parent?.clientHeight || 0) - (el?.offsetTop  || 0));

    const onMove = (ev) => {
      const nw = Math.min(maxW(), Math.max(40, sw + ev.clientX - startX));
      const nh = Math.min(maxH(), Math.max(40, sh + ev.clientY - startY));
      el.style.width = nw + "px";
      el.style.height = nh + "px";
    };
    const onUp = (ev) => {
      const nw = Math.min(maxW(), Math.max(40, sw + ev.clientX - startX));
      const nh = Math.min(maxH(), Math.max(40, sh + ev.clientY - startY));
      onUpdate({ ...board, cards: board.cards.map((c) => (c.id === card.id ? { ...c, w: nw, h: nh } : c)) });
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const style = isAbs
    ? {
        position: "absolute",
        left: card.x, top: card.y,
        width: card.w, height: card.h,
        zIndex: card.z,
        transform: card.rotation ? `rotate(${card.rotation}deg)` : undefined,
        transformOrigin: 'center center',
      }
    : { position: "relative", ...gridSpan };

  // Rotation handle, lives next to the delete control.
  //   • Click  → rotate by +90° (4 clicks returns to original).
  //   • Drag   → free-rotate around the card centre (hold Shift to snap 15°).
  const startRotate = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget.closest('.studio-card');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
    const startRot = card.rotation || 0;
    const downX = e.clientX, downY = e.clientY;
    let dragged = false;
    let latestRot = startRot;

    const onMove = (ev) => {
      // Dead-zone so a click does not register as a 0px drag.
      if (!dragged && Math.hypot(ev.clientX - downX, ev.clientY - downY) < 4) return;
      dragged = true;
      const cur = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
      let next = startRot + (cur - startAngle);
      if (ev.shiftKey) next = Math.round(next / 15) * 15;
      next = ((next % 360) + 360) % 360;
      latestRot = next;
      el.style.transform = `rotate(${next}deg)`;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      const next = dragged ? latestRot : (((startRot + 90) % 360) + 360) % 360;
      el.style.transform = `rotate(${next}deg)`;
      onUpdate({
        ...board,
        cards: board.cards.map((c) =>
          c.id === card.id ? { ...c, rotation: next } : c),
      });
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  return (
    <div
      className={isDieCut ? 'studio-card studio-card--sticker' : 'studio-card'}
      style={{ ...style, background: isDieCut ? 'transparent' : theme ? cardBg : undefined }}
      onPointerDown={(e) => { onSelect(); startDrag(e); }}
    >
      {isSelected && (
        <div className="studio-card-controls" style={{ opacity: 1 }}>
          <button
            className="studio-card-rotate"
            onPointerDown={startRotate}
            title="Drag to rotate (hold Shift to snap)"
            style={{
              background: 'rgba(255,255,255,0.9)',
              border: '1px solid rgba(0,0,0,0.15)',
              borderRadius: '50%',
              width: 20, height: 20,
              fontSize: 11, lineHeight: 1,
              cursor: 'grab',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginRight: 4,
              color: '#2a2018',
              userSelect: 'none',
            }}
          >↻</button>
          <button className="studio-card-delete" onClick={() => onDelete(card.id)}>&#10005;</button>
        </div>
      )}

      {isImageSticker && (
        <img className="studio-card-sticker-image" src={card.content.src} alt={card.content.alt} crossOrigin="anonymous"
          style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'auto' }} />
      )}

      {isSticker && (
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: cardText,
          letterSpacing: card.content.letterSpacing || '0',
          pointerEvents: 'none', lineHeight: 1,
          overflow: 'hidden',
        }}>
          {/* Only the visible glyph catches clicks. The surrounding flex box
              stays pointer-events: none so it does not block neighbouring
              stickers placed in its blank corners. */}
          <span style={{
            pointerEvents: 'auto',
            display: 'inline-block',
            fontSize: (card.content.fontSize || '1.5rem').replace(/(\d+\.?\d*)/, (m) => {
              const scale = card.initW ? Math.min(card.w / card.initW, card.h / card.initH) : 1;
              return (parseFloat(m) * scale).toFixed(1);
            }),
            lineHeight: 1,
          }}>
            {card.content.char}
          </span>
        </div>
      )}

      {card.type === "image" && !isImageSticker && <img className="studio-card-image" src={card.content.src} alt={card.content.alt} crossOrigin="anonymous" />}

      {isText && (
        <div className="studio-card-text-wrap">
          <div className="studio-card-text-handle"><div className="studio-card-text-handle-bar" />
            {isSelected && (
              <div style={{ position: 'absolute', right: 30, top: 2, display: 'flex', gap: 4 }}>
                {TEXT_COLORS.map(tc => (
                  <button
                    key={tc.hex}
                    title={tc.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdate({ ...board, cards: board.cards.map((c) => (c.id === card.id ? { ...c, content: { ...c.content, textColor: tc.hex } } : c)) });
                    }}
                    style={{
                      width: 12, height: 12, border: card.content.textColor === tc.hex ? '2px solid ' + tc.hex : '1px solid rgba(0,0,0,0.15)',
                      borderRadius: '50%', background: tc.hex, cursor: 'pointer', padding: 0,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <textarea className="studio-card-textarea" defaultValue={card.content.text}
            style={{ color: card.content.textColor || cardText }}
            onChange={(e) => {
              onUpdate({ ...board, cards: board.cards.map((c) => (c.id === card.id ? { ...c, content: { ...c.content, text: e.target.value } } : c)) });
            }}
            placeholder="Write something..." />
        </div>
      )}

      {card.type === "palette" && (
        <div className="studio-card-palette" style={{ background: cardBg }}>
          <div className="studio-card-palette-strip">
            {card.content.colours.map((c, i) => (<div key={i} className="studio-card-palette-strip-color" style={{ background: c }} />))}
          </div>
          <div className="studio-card-palette-info" style={{ background: cardBg }}>
            <span className="studio-card-palette-name" style={{ color: cardText }}>{card.content.name}</span>
            {card.content.colours.map((c, i) => (
              <span key={i} className="studio-card-palette-hex" style={{ color: cardText, borderColor: cardText + '22' }} onClick={() => navigator.clipboard?.writeText(c)}>{c}</span>
            ))}
          </div>
        </div>
      )}

      {card.type === "shape" && (
        <div style={{ width: '100%', height: '100%', background: cardBg }}>
          <ShapeCanvas type={card.content.shapeType} seed={card.content.seed} width={card.w} height={card.h} />
        </div>
      )}

      {isAbs && isSelected && (
        <div className="studio-card-resize" onPointerDown={startResize}>
          <div className="studio-card-resize-line" />
        </div>
      )}
    </div>
  );
}
