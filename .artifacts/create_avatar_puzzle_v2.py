from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT = Path(r"D:\Projects\puzzlebeyond\.artifacts\instagram")
SOURCE = OUT / "avatar-puzzle-bg.png"
DEST = OUT / "avatar-puzzle-v2.png"

INK = (21, 21, 21)
PAPER = (244, 240, 230)
CORAL = (255, 111, 97)

canvas = Image.open(SOURCE).convert("RGB").resize((1080, 1080), Image.Resampling.LANCZOS)
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype(r"C:\Windows\Fonts\ariblk.ttf", 500)

# Center the smaller mark by its visible glyph bounds, not its font baseline.
mark = "P"
bbox = draw.textbbox((0, 0), mark, font=font, stroke_width=0)
mark_w = bbox[2] - bbox[0]
mark_h = bbox[3] - bbox[1]
x = (1080 - mark_w) // 2 - bbox[0]
y = (1080 - mark_h) // 2 - bbox[1]

# Keep the same brand keyline while giving the puzzle pieces more visual space.
draw.text((x, y), mark, font=font, fill=INK, stroke_width=20, stroke_fill=CORAL)
draw.text((x, y), mark, font=font, fill=INK, stroke_width=8, stroke_fill=PAPER)

# No footer text: the circular Instagram crop should contain only the puzzle mark.
canvas.save(DEST, format="PNG", optimize=True)
print(f"saved {DEST} {canvas.size}")

