export type GalleryKind = "custom" | "sunset" | "garden" | "city";

export type GalleryDefinition = {
  id: string;
  title: string;
  description: string;
  kind: GalleryKind;
  rows: number;
  cols: number;
  count: number;
  accent: string;
};

export const DEFAULT_GALLERY: GalleryDefinition[] = [
  {
    id: "sunset",
    title: "Gün batımı",
    description: "Sıcak renkler, uzun bir akşam.",
    kind: "sunset",
    rows: 3,
    cols: 4,
    count: 12,
    accent: "#ff6f61",
  },
  {
    id: "garden",
    title: "Çiçek bahçesi",
    description: "Renkli bir masa için kolay başlangıç.",
    kind: "garden",
    rows: 4,
    cols: 5,
    count: 20,
    accent: "#d3d3ff",
  },
  {
    id: "city",
    title: "Gece şehri",
    description: "Biraz daha sakin, biraz daha zor.",
    kind: "city",
    rows: 6,
    cols: 8,
    count: 48,
    accent: "#4864ff",
  },
];
