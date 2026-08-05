from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"C:\Users\ibatu\.codex\generated_images\019fcc28-ea39-7632-b7e4-83b217cd29c1")
OUT = Path(r"D:\Projects\puzzlebeyond\.artifacts\instagram")
OUT.mkdir(parents=True, exist_ok=True)

INK = "#151515"
PAPER = "#f4f0e6"
CORAL = "#ff6f61"
BLUE = "#4864ff"
LIME = "#d3d3ff"
FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"
FONT_REG = r"C:\Windows\Fonts\arial.ttf"


def font(size: int, bold: bool = True):
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def fit_square(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    side = min(im.width, im.height)
    left = (im.width - side) // 2
    top = (im.height - side) // 2
    return im.crop((left, top, left + side, top + side)).resize((1080, 1080), Image.Resampling.LANCZOS)


def text_block(draw, xy, lines, fill, size, box=None, box_fill=None, stroke=0, stroke_fill=INK, spacing=3):
    x, y = xy
    f = font(size)
    if box:
        bx, by, bw, bh = box
        draw.rectangle((bx, by, bx + bw, by + bh), fill=box_fill or PAPER)
        x, y = bx + 34, by + 25
    for line in lines:
        draw.text((x, y), line, font=f, fill=fill, spacing=spacing, stroke_width=stroke, stroke_fill=stroke_fill)
        y += size + spacing + 4


def footer(draw, label, fill=INK):
    draw.text((46, 1002), label, font=font(24), fill=fill)
    draw.text((812, 1002), "@puzzlebeyond", font=font(22, False), fill=fill)


specs = [
    ("exec-74b0ae79-1bae-41fd-9307-2fade7a584f9.png", "01-birlikte-daha-kolay.png", "BİRLİKTE", "DAHA KOLAY.", PAPER, (INK, 46, 600, 500, 232), "PUZZLEBEYOND · ORTAK PUZZLE"),
    ("exec-1d135f82-55dc-4ad2-90c9-e2b2baaf567c.png", "02-odani-kur.png", "ODANI KUR.", "KODU PAYLAŞ.", INK, (PAPER, 44, 70, 610, 250), "AYNI ODA · AYNI PUZZLE"),
    ("exec-5b85c804-de8f-4695-bdff-2fb44491d0a8.png", "03-parcalar-yerine.png", "PARÇALAR", "YERİNE OTURSUN.", PAPER, (INK, 48, 632, 720, 260), "UZAKTA OLSANIZ DA AYNI MASADASINIZ"),
]

for src, name, line1, line2, text_fill, (box_fill, bx, by, bw, bh), foot in specs:
    im = fit_square(ROOT / src)
    draw = ImageDraw.Draw(im)
    draw.rectangle((bx, by, bx + bw, by + bh), fill=box_fill)
    draw.rectangle((bx, by, bx + bw, by + 10), fill=CORAL)
    size = 62 if name == "01-birlikte-daha-kolay.png" else (64 if name == "03-parcalar-yerine.png" else 74)
    f1 = font(size)
    f2 = font(size)
    draw.text((bx + 34, by + 38), line1, font=f1, fill=text_fill)
    draw.text((bx + 34, by + 38 + size + 18), line2, font=f2, fill=text_fill)
    footer(draw, foot, fill=text_fill)
    im.save(OUT / name, quality=95, optimize=True)

# A simple, high-contrast avatar built from the same palette.
avatar = Image.new("RGB", (1080, 1080), PAPER)
ad = ImageDraw.Draw(avatar)
ad.rectangle((0, 0, 1080, 1080), fill=LIME)
ad.rectangle((88, 88, 992, 992), fill=PAPER, outline=INK, width=18)
ad.rectangle((128, 128, 952, 952), fill=CORAL)
ad.text((270, 175), "P", font=font(700), fill=INK, stroke_width=8, stroke_fill=PAPER)
ad.rectangle((190, 820, 890, 888), fill=INK)
ad.text((256, 832), "puzzlebeyond", font=font(38), fill=PAPER)
avatar.save(OUT / "avatar.png", quality=95, optimize=True)
