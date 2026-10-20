"""Contact sheet of QA captures for review.
Usage: python3 docs/qa/mobile/scripts/sheet.py <out.png> <height> <img> [<img> ...]"""
import sys
from PIL import Image, ImageDraw

out, height, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = []
for f in files:
    im = Image.open(f).convert('RGB')
    im = im.resize((max(1, int(im.width * height / im.height)), height))
    ims.append((f.rsplit('/', 1)[-1].replace('.png', ''), im))
pad, label = 8, 18
W = sum(i.width for _, i in ims) + pad * (len(ims) + 1)
sheet = Image.new('RGB', (W, height + label + pad * 2), (128, 128, 128))
d = ImageDraw.Draw(sheet)
x = pad
for name, im in ims:
    sheet.paste(im, (x, pad + label))
    d.text((x, pad), name[-34:], fill=(255, 255, 255))
    x += im.width + pad
sheet.save(out)
