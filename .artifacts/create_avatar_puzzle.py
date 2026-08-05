from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT = Path(r"D:\Projects\puzzlebeyond\.artifacts\instagram")
SOURCE = OUT / "avatar-puzzle-bg.png"
DEST = OUT / "avatar-puzzle.png"

INK = (21, 21, 21)
PAPER = (244, 240, 230)
CORAL = (255, 111, 97)

canvas = Image.open(SOURCE).convert("RGB").resize((1080, 1080), Image.Resampling.LANCZOS)
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype(r"C:\Windows\Fonts\ariblk.ttf", 610)

# Keep the mark comfortably inside Instagram's circular crop.
mark = "P"
bbox = draw.textbbox((0, 0), mark, font=font, stroke_width=0)
mark_w = bbox[2] - bbox[0]
mark_h = bbox[3] - bbox[1]
x = (1080 - mark_w) // 2 - bbox[0]
y = (1080 - mark_h) // 2 - bbox[1] - 24

# A coral outer edge and paper inner keyline make the black mark read on every tile.
draw.text((x, y), mark, font=font, fill=INK, stroke_width=24, stroke_fill=CORAL)
draw.text((x, y), mark, font=font, fill=INK, stroke_width=10, stroke_fill=PAPER)

# Small brand label, still within the circular safe area and readable in the profile header.
label_font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 34)
label = "PUZZLEBEYOND"
lb = draw.textbbox((0, 0), label, font=label_font)
lx = (1080 - (lb[2] - lb[0])) // 2
ly = 920
draw.rounded_rectangle((lx - 22, ly - 10, lx + (lb[2] - lb[0]) + 22, ly + 48), radius=16, fill=INK)
draw.text((lx, ly), label, font=label_font, fill=PAPER)

canvas.save(DEST, format="PNG", optimize=True)
print(f"saved {DEST} {canvas.size}")

