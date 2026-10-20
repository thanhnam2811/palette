#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"
gjs -m test/run.js
glib-compile-schemas --strict --dry-run extension/schemas
for script in scripts/*.sh scripts/dev/*.sh; do bash -n "$script"; done
python3 - <<'PY'
import ast, json, pathlib, re, xml.etree.ElementTree as ET
for p in pathlib.Path('scripts/dev').glob('*.py'): ast.parse(p.read_text(),filename=str(p))
for p in [*pathlib.Path('assets').rglob('*.svg'),*pathlib.Path('extension/icons').glob('*.svg')]:
    r=ET.parse(p).getroot()
    assert r.tag.endswith('svg') and 'viewBox' in r.attrib, p
    assert not any(e.tag.endswith('script') or e.tag.endswith('image') for e in r.iter()), p
assert json.loads(pathlib.Path('extension/metadata.json').read_text())['shell-version']==['46']
for p in [pathlib.Path('README.md'),pathlib.Path('CONTRIBUTING.md'),pathlib.Path('SECURITY.md'),*pathlib.Path('docs').rglob('*.md'),pathlib.Path('scripts/dev/README.md')]:
    for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
        if ':' in target or target.startswith('#'): continue
        assert (p.parent/target.split('#')[0]).exists(), f'{p}: broken link {target}'
print('Python, SVG, metadata and local Markdown link validation passed')
PY
if command -v node >/dev/null; then
    while IFS= read -r source; do node --check --input-type=module < "$source"; done < <(rg --files extension scripts/dev -g '*.js')
fi
scripts/pack.sh
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('palette@namtt.shell-extension.zip') as z:
    assert z.testzip() is None
    names=z.namelist()
    for name in ['LICENSE','data/UNICODE-LICENSE.txt','icons/palette-symbolic.svg','data/emoji.json','metadata.json','schemas/org.gnome.shell.extensions.palette.gschema.xml']:
        assert name in names,name
    assert not any(n.startswith(('dev/','scripts/','test/','.git/')) for n in names)
print('Release ZIP contents and CRC passed')
PY
