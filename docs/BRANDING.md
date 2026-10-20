# Palette identity

Palette keeps useful fragments within reach. The identity uses two overlapping
cards: one saved item and one ready to use. All artwork is original SVG, under
the repository's MIT license. PNG exports are supplied alongside the SVG masters.

Three concepts are in [concepts.svg](../assets/branding/concepts.svg):

| Concept | Recognition at 16 px | Clipboard meaning | Distinctiveness |
| --- | --- | --- | --- |
| Layered cards (selected) | Strong | Strong: saved fragments | Good |
| Command lens | Strong | Weak: suggests search only | Moderate |
| Colour fan | Moderate | Weak: suggests a paint app | Good |

The layered cards best communicate history without implying a graphics editor.
The yellow dot adds the emoji/playful side at larger sizes; it is omitted from
the symbolic version to keep the panel silhouette readable.

| Role | Colour |
| --- | --- |
| Primary blue | `#3584e4` |
| Depth | `#1c71d8` |
| Highlight | `#62a0ea` |
| Emoji accent | `#f9f06b` |
| Ink/background | `#241f31` |
| Light canvas | `#f6f5f4` |

Use `assets/branding/palette.svg` / `.png` at 128 px or above, and
`extension/icons/palette-symbolic.svg` for the panel. The symbolic icon has a
16 × 16 canvas and is loaded via Gio.FileIcon, allowing St to recolour it with
the Shell theme. Do not use the colour logo as a panel icon. Banner artwork is
1280 × 640 and includes live SVG text; PNG is the portable social export.

The popup retains its established dark surface in both desktop colour schemes.
No global Shell theme or icon search path is modified.

References: [GNOME app icons](https://developer.gnome.org/hig/guidelines/app-icons.html),
[GNOME symbolic icons](https://developer.gnome.org/hig/guidelines/ui-icons.html).
Reviewed 2026-10-20. This is an extension mark, not a GNOME endorsement.
