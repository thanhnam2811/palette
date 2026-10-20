#!/usr/bin/env python3
"""Rebuild PNGs from SVG masters. Dev dependencies: python3-gi, python3-cairo, librsvg."""
from pathlib import Path
import gi
import cairo
gi.require_version('Rsvg', '2.0')
from gi.repository import Rsvg
root = Path(__file__).resolve().parents[2]
brand = root/'assets/branding'
icon = (root/'extension/icons/palette-symbolic.svg').read_text()
parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240">',
         '<rect width="640" height="120" fill="#f6f5f4"/><rect y="120" width="640" height="120" fill="#241f31"/>']
for row, colour in [(0, '#241f31'), (1, '#eeeeec')]:
    for col, size in enumerate([16, 24, 32, 48]):
        x, y = 40+col*150, row*120+25
        content = icon.split('>', 1)[1].rsplit('</svg>', 1)[0].replace('#2e3436', colour)
        parts.append(f'<g transform="translate({x} {y}) scale({size/16})">{content}</g>')
        parts.append(f'<text x="{x}" y="{row*120+100}" font-family="sans-serif" font-size="14" fill="{colour}">{size} px</text>')
parts.append('</svg>')
(brand/'icon-qa.svg').write_text(''.join(parts))
for source in brand.glob('*.svg'):
    handle = Rsvg.Handle.new_from_file(str(source))
    _, width, height = handle.get_intrinsic_size_in_pixels()
    viewport = Rsvg.Rectangle()
    viewport.x = viewport.y = 0
    viewport.width, viewport.height = width, height
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, int(width), int(height))
    handle.render_document(cairo.Context(surface), viewport)
    surface.write_to_png(str(source.with_suffix('.png')))
    print(source.with_suffix('.png').relative_to(root))
