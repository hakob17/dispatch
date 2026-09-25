"""Wrap marketing/dispatch.html (artifact body format) into a standalone page: public/product.html."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
body = (root / "marketing" / "dispatch.html").read_text()
page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        + body + '\n</html>\n')
(root / "public" / "product.html").write_text(page)
print("wrote public/product.html")
