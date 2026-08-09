import { DEFAULT_GALLERY, type GalleryKind } from "./gallery";

const generatedImages = new Map<GalleryKind, Promise<string>>();

function createGalleryImage(kind: Exclude<GalleryKind, "custom">) {
  const cached = generatedImages.get(kind);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const context = canvas.getContext("2d");
  if (!context) return "";
  if (kind === "sunset") {
    const sky = context.createLinearGradient(0, 0, 0, 800);
    sky.addColorStop(0, "#ff9f7f");
    sky.addColorStop(0.52, "#ff6f61");
    sky.addColorStop(1, "#4864ff");
    context.fillStyle = sky;
    context.fillRect(0, 0, 1200, 800);
    context.fillStyle = "#ffd84d";
    context.beginPath();
    context.arc(830, 300, 118, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#151515";
    context.beginPath();
    context.moveTo(0, 590);
    context.lineTo(230, 370);
    context.lineTo(430, 565);
    context.lineTo(650, 315);
    context.lineTo(910, 590);
    context.lineTo(1080, 430);
    context.lineTo(1200, 555);
    context.lineTo(1200, 800);
    context.lineTo(0, 800);
    context.closePath();
    context.fill();
    context.fillStyle = "#d3d3ff";
    context.fillRect(0, 650, 1200, 150);
    context.fillStyle = "#151515";
    context.font = "900 62px Arial";
    context.fillText("GÜN BATIMI", 58, 735);
  } else if (kind === "garden") {
    context.fillStyle = "#f4f0e6";
    context.fillRect(0, 0, 1200, 800);
    context.fillStyle = "#d3d3ff";
    context.fillRect(0, 0, 1200, 170);
    context.fillStyle = "#4864ff";
    context.fillRect(0, 570, 1200, 230);
    context.fillStyle = "#ff6f61";
    context.beginPath();
    context.arc(210, 300, 135, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffd84d";
    context.beginPath();
    context.arc(510, 245, 92, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#151515";
    context.fillRect(870, 250, 38, 390);
    context.fillStyle = "#40b866";
    context.beginPath();
    context.arc(890, 190, 110, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ff6f61";
    context.beginPath();
    context.arc(760, 400, 68, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fffdf7";
    context.beginPath();
    context.arc(760, 400, 24, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#151515";
    context.font = "900 62px Arial";
    context.fillText("ÇİÇEK BAHÇESİ", 58, 112);
  } else {
    const night = context.createLinearGradient(0, 0, 0, 800);
    night.addColorStop(0, "#151515");
    night.addColorStop(1, "#4864ff");
    context.fillStyle = night;
    context.fillRect(0, 0, 1200, 800);
    context.fillStyle = "#ffd84d";
    context.beginPath();
    context.arc(950, 150, 72, 0, Math.PI * 2);
    context.fill();
    const buildings = [[70, 300, 190, 500], [290, 230, 220, 570], [545, 350, 155, 450], [730, 180, 210, 620], [980, 290, 150, 510]];
    for (const [index, [x, y, width, height]] of buildings.entries()) {
      context.fillStyle = index % 2 ? "#d3d3ff" : "#ff6f61";
      context.fillRect(x, y, width, height);
      context.fillStyle = "#151515";
      for (let row = y + 32; row < y + height - 20; row += 52) {
        for (let col = x + 24; col < x + width - 18; col += 48) context.fillRect(col, row, 18, 24);
      }
    }
    context.fillStyle = "#fffdf7";
    context.font = "900 62px Arial";
    context.fillText("GECE ŞEHRİ", 58, 112);
  }
  const pending = new Promise<string>((resolve) => {
    canvas.toBlob((blob) => {
      const imageUrl = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/jpeg", 0.88);
      canvas.width = canvas.height = 1;
      resolve(imageUrl);
    }, "image/jpeg", 0.88);
  });
  generatedImages.set(kind, pending);
  return pending;
}

export async function hydrateGalleryImages<T extends { kind: GalleryKind; imageUrl: string }>(items: T[]) {
  return await Promise.all(items.map(async (item) => item.kind === "custom" || item.imageUrl
    ? item
    : { ...item, imageUrl: await createGalleryImage(item.kind) }));
}

export async function createFallbackGalleryItems() {
  return await Promise.all(DEFAULT_GALLERY.map(async (item) => ({
    ...item,
    imageUrl: item.kind === "custom" ? "" : await createGalleryImage(item.kind),
  })));
}
