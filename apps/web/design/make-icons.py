"""
Builds every logo and icon the web app ships from one source: shmorkiz-logo.png.

    python3 apps/web/design/make-icons.py      (needs Pillow)

The wordmark is the source pill with its transparent margin trimmed. Square
places (favicon, home-screen icons, the collapsed sidebar) cannot fit a 3:1
pill, so they get a round mark in the same colours: the pill's yellow inside its
dark ring, with the pill's own "S" cut out of the source. That keeps the letter
in the logo's typeface without needing the font.

The S is only ~150px tall in the source, so it is upscaled, thresholded and
scaled back down. That gives clean edges at 512px instead of a blurry blow-up.
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
WEB = HERE.parent
SOURCE = HERE / "shmorkiz-logo.png"

YELLOW = (255, 204, 2, 255)
DARK = (51, 53, 58, 255)
WHITE = (255, 255, 255, 255)

WORK = 4096  # the mark is drawn this big, then scaled down to each size
RING = 0.085  # ring thickness / diameter: the pill's ring is 40px of 481
LETTER = 0.50  # the S's height / diameter


def wordmark(src: Image.Image) -> Image.Image:
    return src.crop(src.getchannel("A").getbbox())


def letter_s(src: Image.Image) -> Image.Image:
    """The S as a coverage mask: 0 on the yellow, 255 on the dark ink."""
    box = src.crop((270, 170, 395, 350)).convert("RGB")
    yr, dr = YELLOW[0], DARK[0]
    cov = box.getchannel("R").point(lambda r: max(0, min(255, round((yr - r) * 255 / (yr - dr)))))
    return cov.crop(cov.getbbox())


def mark(s: Image.Image, diameter: int) -> Image.Image:
    """The round mark on a transparent WORK×WORK canvas, `diameter` across."""
    img = Image.new("RGBA", (WORK, WORK), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    o = (WORK - diameter) // 2
    d.ellipse((o, o, o + diameter, o + diameter), fill=DARK)
    ring = round(diameter * RING)
    d.ellipse((o + ring, o + ring, o + diameter - ring, o + diameter - ring), fill=YELLOW)

    h = round(diameter * LETTER)
    w = round(s.width * h / s.height)
    glyph = s.resize((w, h), Image.LANCZOS).point(lambda v: 255 if v >= 128 else 0)
    ink = Image.new("RGBA", (w, h), DARK)
    img.paste(ink, ((WORK - w) // 2, (WORK - h) // 2), glyph)
    return img


def on(bg, img: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", img.size, bg)
    canvas.alpha_composite(img)
    return canvas


def size(img: Image.Image, px: int) -> Image.Image:
    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    src = Image.open(SOURCE).convert("RGBA")
    s = letter_s(src)

    wordmark(src).save(WEB / "components/brand/wordmark.png", optimize=True)

    # "any" icons: the mark edge to edge, transparent around it.
    full = mark(s, round(WORK * 0.96))
    size(full, 512).save(WEB / "app/icon.png", optimize=True)
    size(full, 512).save(WEB / "public/icons/icon-512.png", optimize=True)
    size(full, 192).save(WEB / "public/icons/icon-192.png", optimize=True)
    size(full, 48).save(
        WEB / "app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )

    # iOS fills transparency with black and rounds the corners itself, so the
    # apple icon is opaque white with the mark inset from the corner cut.
    apple = on(WHITE, mark(s, round(WORK * 0.84))).convert("RGB")
    size(apple, 180).save(WEB / "app/apple-icon.png", optimize=True)
    size(apple, 180).save(WEB / "public/icons/icon-180.png", optimize=True)

    # Maskable: opaque, the mark at two thirds of the width so any launcher
    # shape (inside the 80% safe circle) keeps all of it.
    maskable = on(WHITE, mark(s, round(WORK * 2 / 3))).convert("RGB")
    size(maskable, 512).save(WEB / "public/icons/icon-512-maskable.png", optimize=True)


if __name__ == "__main__":
    main()
