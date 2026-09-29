"""Generate the single, flat logo collection; Python standard library only."""
import json
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / 'concepts.json').read_text())
CONCEPTS = DATA['concepts']
assert len({c['id'] for c in CONCEPTS}) == len(CONCEPTS)
LATEST = max(c['batch'] for c in CONCEPTS)
ORDERED = sorted(CONCEPTS, key=lambda c: (-c['batch'], c['id']))
COLORS = {'mint': '#b2f8df', 'ink': '#0f1b2a', 'white': '#ffffff'}

def colored(geometry, color):
    return f'<g fill="{color}">{geometry.replace("COLOR", color)}</g>'

def svg(title, box, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" role="img" aria-labelledby="title"><title id="title">{escape(title)}</title>{body}</svg>\n'

cards = []
sheet_height = 180 + ((len(ORDERED) + 2) // 3) * 390
sheet = [f'<rect width="1440" height="{sheet_height}" fill="#080f18"/>', '<g fill="#f1f5fc" font-family="Arial,sans-serif"><text x="48" y="50" font-size="13" letter-spacing="3">NeoDEM / LOGO EXPLORATIONS</text><text x="48" y="108" font-size="42">One collection. Every direction.</text></g>']
for i, c in enumerate(ORDERED):
    slug, name, size = c['id'], c['name'], c['icon_size']
    assert size in (128, 160)
    wordmark = DATA['wordmarks'][c['wordmark']]
    transform, width = ('translate(155 35) scale(1.05)', 480) if size == 128 else ('translate(197 50)', 558)
    for variant, color in COLORS.items():
        icon = colored(c['geometry'], color)
        word_color = '#f1f5fc' if variant == 'mint' else color
        logo = icon + f'<g transform="{transform}">{colored(wordmark, word_color)}</g>'
        (ROOT / f'{slug}-icon-{variant}.svg').write_text(svg(f'NeoDEM — {name} symbol', f'0 0 {size} {size}', icon))
        (ROOT / f'{slug}-logo-{variant}.svg').write_text(svg(f'NeoDEM — {name}', f'0 0 {width} {size}', logo))
    badge = 'New' if c['batch'] == LATEST else f'Exploration {c["batch"]:02}'
    sizes = ''.join(f'<img data-file="{slug}-icon" src="{slug}-icon-mint.svg" width="{s}" height="{s}" alt="{escape(name)} at {s} pixels">' for s in (24,32,48))
    cards.append(f'''<article id="{slug}" data-family="{c['family']}" data-latest="{str(c['batch'] == LATEST).lower()}">
<div class="meta"><h2><span>{slug[:2]}</span> {escape(name)}</h2><span class="badge">{badge}</span></div>
<div class="hero"><img data-file="{slug}-icon" src="{slug}-icon-mint.svg" width="160" height="160" alt="{escape(name)} symbol"></div>
<div class="signature"><img data-file="{slug}-logo" src="{slug}-logo-mint.svg" width="335" height="96" alt="NeoDEM — {escape(name)}"></div>
<div class="details"><p>{escape(c['description'])}</p><div class="bottom"><div class="sizes">{sizes}</div><div class="downloads"><a data-file="{slug}-icon" href="{slug}-icon-mint.svg" download>Icon SVG ↗</a><a data-file="{slug}-logo" href="{slug}-logo-mint.svg" download>Logo SVG ↗</a></div></div></div></article>''')
    x, y = 48 + (i % 3) * 456, 152 + (i // 3) * 390
    sheet.append(f'''<g transform="translate({x} {y})"><rect width="432" height="366" rx="8" fill="#101d2c"/><text x="24" y="36" fill="#b2c3d5" font-family="Arial,sans-serif" font-size="15">{slug[:2]} / {escape(name)}</text><g transform="translate(146 66) scale({140 / size})">{colored(c['geometry'], '#b2f8df')}</g><g transform="translate(45 251) scale({342 / width})">{colored(c['geometry'], '#b2f8df')}<g transform="{transform}">{colored(wordmark, '#f1f5fc')}</g></g></g>''')
(ROOT / 'overview.svg').write_text(svg('NeoDEM — all logo explorations', f'0 0 1440 {sheet_height}', ''.join(sheet)))

HTML = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NeoDEM — Logo explorations</title><style>
*{box-sizing:border-box}body{margin:0;background:#080f18;color:#f1f5fc;font-family:Arial,sans-serif;--panel:#101d2c;--line:#243649;--muted:#b2c3d5;--accent:#b2f8df}main{max-width:1480px;padding:44px 40px;margin:auto}.eyebrow{font-size:12px;letter-spacing:2.5px;color:var(--accent)}h1{font-size:clamp(36px,5vw,64px);line-height:1.08;letter-spacing:-2px;font-weight:500;margin:24px 0 20px}header p{font-size:15px;line-height:1.6;max-width:650px;color:var(--muted)}.controls{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:24px 0 18px;border-bottom:1px solid var(--line)}.group{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;font-size:12px;padding:10px 15px;border-radius:5px;border:1px solid var(--line);background:transparent;color:inherit;cursor:pointer}button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#0a2225}button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:4px}#count{font-size:12px;color:var(--muted);margin:18px 0 24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}article{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}article[hidden]{display:none}.grid.focused{grid-template-columns:repeat(2,minmax(0,1fr))}.meta{padding:22px;display:flex;justify-content:space-between;align-items:center;gap:12px}h2{font-weight:500;font-size:16px;margin:0}h2 span{font-size:11px;color:var(--muted);margin-right:10px}.badge{font-size:10px;color:var(--muted)}article[data-latest=true] .badge{color:var(--accent)}.hero{height:205px;display:flex;align-items:center;justify-content:center}.signature{height:105px;padding:0 28px;display:flex;align-items:center;justify-content:center}.signature img{max-width:100%;height:auto}.details{padding:20px 22px;border-top:1px solid var(--line)}.details p{font-size:13px;line-height:1.65;color:var(--muted);margin:0;min-height:88px}.bottom{margin-top:18px;display:flex;justify-content:space-between;align-items:center;gap:12px}.sizes{display:flex;gap:10px;align-items:center}.downloads{display:flex;flex-direction:column;gap:12px;font-size:11px}a{color:var(--accent);text-underline-offset:4px}footer{font-size:12px;color:var(--muted);line-height:1.7;margin-top:30px}.light{background:#f5f7fa;color:#0f1b2a;--panel:#fff;--line:#d5dde6;--muted:#3a4b5e;--accent:#0f7a60}.light button[aria-pressed=true]{color:#fff}@media(max-width:1100px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){main{padding:28px 18px}.grid,.grid.focused{grid-template-columns:1fr}h1{letter-spacing:-1px}.details p{min-height:0}}@media print{.controls,.downloads{display:none}article{break-inside:avoid}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><main><header><div class="eyebrow">NeoDEM / LOGO EXPLORATIONS</div><h1>Less form.<br>More future.</h1><p>One growing collection. The newest directions use fewer parts, clean cuts, and simple geometry. Earlier ideas stay here for comparison.</p></header>
<div class="controls"><div class="group" aria-label="Filter concepts"><button data-filter="all" aria-pressed="true">All · TOTAL</button><button data-filter="latest" aria-pressed="false">Newest · RECENT</button><button data-filter="tree" aria-pressed="false">Trees · TREES</button><button data-filter="monogram" aria-pressed="false">Monograms · MONOGRAMS</button></div><div class="group" aria-label="Color variants"><button data-variant="mint" aria-pressed="true">Mint / dark</button><button data-variant="ink" aria-pressed="false">Ink / light</button><button data-variant="white" aria-pressed="false">White / dark</button></div></div>
<p id="count" aria-live="polite">Showing TOTAL concepts · newest first</p><section class="grid" aria-label="Logo alternatives">CARDS</section>
<footer>TOTAL concepts · ASSETS editable SVG assets · Transparent backgrounds · Vector lettering, no fonts needed.<br><a href="overview.svg">Comparison sheet</a> · <a href="README.md">Asset guide</a></footer></main><script>
document.querySelectorAll('[data-variant]').forEach(button=>button.addEventListener('click',()=>{const variant=button.dataset.variant;document.body.classList.toggle('light',variant==='ink');document.querySelectorAll('[data-variant]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-file]').forEach(el=>{const path=`${el.dataset.file}-${variant}.svg`;if(el.tagName==='IMG')el.src=path;else el.href=path;});}));
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{const filter=button.dataset.filter;document.querySelector('.grid').classList.toggle('focused',filter==='latest');document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));let count=0;document.querySelectorAll('article').forEach(card=>{const show=filter==='all'||(filter==='latest'&&card.dataset.latest==='true')||card.dataset.family===filter;card.hidden=!show;if(show)count++;});document.getElementById('count').textContent=`Showing ${count} concepts · newest first`;}));
</script></body></html>'''
for token, value in {'TOTAL':len(CONCEPTS), 'RECENT':sum(c['batch']==LATEST for c in CONCEPTS), 'TREES':sum(c['family']=='tree' for c in CONCEPTS), 'MONOGRAMS':sum(c['family']=='monogram' for c in CONCEPTS), 'ASSETS':len(CONCEPTS)*6, 'CARDS':''.join(cards)}.items():
    HTML = HTML.replace(token, str(value))
(ROOT / 'index.html').write_text(HTML)
print(f'Generated {len(CONCEPTS)} concepts / {len(CONCEPTS)*6} assets in one folder and one HTML gallery.')
