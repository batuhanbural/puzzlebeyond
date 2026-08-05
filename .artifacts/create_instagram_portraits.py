from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


OUT = Path(r"D:\Projects\puzzlebeyond\.artifacts\instagram")
SIZE = (1080, 1350)
SQUARE_SIZE = 1080
TOP = (SIZE[1] - SQUARE_SIZE) // 2
CORAL = (255, 111, 97)


def cover(im: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize and center-crop an image to fill size without distortion."""
    scale = max(size[0] / im.width, size[1] / im.height)
    resized = im.resize((round(im.width * scale), round(im.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def make_portrait(source: Path, destination: Path) -> None:
    square = Image.open(source).convert("RGB")

    # Use a blurred, full-bleed version of the artwork for the extra 270 px.
    # The original square is then placed intact, so no copy or text is cropped.
    background = cover(square, SIZE).filter(ImageFilter.GaussianBlur(34))
    canvas = background.copy()
    canvas.paste(square.resize((SQUARE_SIZE, SQUARE_SIZE), Image.Resampling.LANCZOS), (0, TOP))

    # A restrained brand-colored keyline makes the reframe feel intentional.
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((3, TOP + 3, SIZE[0] - 4, TOP + SQUARE_SIZE - 4), outline=CORAL, width=6)
    canvas.save(destination, format="PNG", optimize=True)


for stem in ("01-birlikte-daha-kolay", "02-odani-kur", "03-parcalar-yerine"):
    make_portrait(OUT / f"{stem}.png", OUT / f"{stem}-4x5.png")

