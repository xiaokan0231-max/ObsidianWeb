#!/usr/bin/env python3
"""
build_interview_html.py — 把一份「面接準備」Markdown 转成手机可读的自包含 HTML。

设计给日本面接准备文档用，输出特点：
  - 振り仮名(ruby)：把 `漢字（かな）` 自动转成头顶注音 <ruby>漢字<rt>かな</rt></ruby>
  - 【あなた】/【面接官】对话框（绿/紫高亮）
  - ▷ 中文策略框、▶ 补充框、> tip 金框
  - 折叠不是默认——但 ##### / #### 想定問答可按需（见 --collapse-qa）
  - sticky 顶部导航（每个 ## 一个 chip）
  - 深色模式自动跟随、可打印
自包含单文件，iCloud 里手机 Safari 直接打开。

约定的 Markdown 输入格式（skill 生成内容时遵循）：
  ## 大节标题                → section + 顶部导航 chip
  ### 小节标题               → 蓝色小标题
  #### / ##### 更小标题       → 紫色小标题（想定問答的 Q 用这个）
  **整行加粗**               → 策略小标题
  【あなた】日本語話術…       → 绿框（你的话）
  【面接官】相手の想定発言…    → 紫框（对方的话）
  ▷ 中文策略/ポイント…        → 黄框（中文说明）
  ▶ 补充…                    → 蓝框
  > tip…                     → 金框
  - 列表項                   → <ul><li>
  [表示名](https://…)         → 可点击链接（新标签打开）
  ![[ノート]] / ![[ノート#節]] → vault から本文を取り込む（行頭に単独で置く）
  [[ノート]] / [[ノート#節]]   → 出典表示（プレーンテキスト。HTML では飛べないため）
  文中 `漢字（かな）`          → 自动 ruby 注音（--no-ruby 可关）

全社共通の固定資産（当日フレーズ集・単語文法帳・NG集・自己紹介音読台本・転職理由台本）は
vault 側が正本。各社の準備ノートは ![[…]] で埋め込むだけにして、コピーしない。
🔴 内外二層のノート（転職理由台本）は **必ず節を指定して埋め込む**。ノート全体を埋め込むと
   面接で絶対に言えない【内部】層まで当日の手元資料に載る。混入時はビルドが止まる。

用法：
  python build_interview_html.py --input prep.md --output prep.html \
      --title "MCT JAPAN 最終面接準備｜肖侃" \
      --subtitle "決裁者×本部長の2対1／対面・約1時間"
  # 埋め込み先の vault は $OBSIDIAN_VAULT_PATH（既定 ~/obsidian/xiaokan）／--vault で上書き
"""
import argparse, os, re, sys
from pathlib import Path

# 汉字后/拉丁字母后紧跟「纯假名括号」→ ruby。保守：括号内必须全是假名(含・ー)，
# 这样 "（約70%）" "（Azure）" 这类不会被误转。
RUBY_RE = re.compile(r'([一-龥々ヶ〆A-Za-z0-9]+)（([ぁ-んァ-ヶーゝゞ・]+)）')

def to_ruby(text):
    return RUBY_RE.sub(lambda m: f'<ruby>{m.group(1)}<rt>{m.group(2)}</rt></ruby>', text)

# ── Obsidian 埋め込み（![[ノート]] / ![[ノート#節]]）の展開 ────────────────────
# 全社共通の固定資産（フレーズ集・単語帳・NG集 等）は vault 側が正本で、各社の準備ノートは
# 埋め込みだけを書く。ここで展開しないと、面接当日に手元で開く HTML から章がまるごと消える。
EMBED_RE = re.compile(r'^(\s*)!\[\[([^\]|#]+?)(?:#([^\]|]+?))?(?:\|[^\]]*)?\]\]\s*$')
FRONTMATTER_RE = re.compile(r'^---\n.*?\n---\n', re.S)
HEADING_RE = re.compile(r'^(#{1,6})\s+(.*)$')

# 「言ってはいけない内容」が当日文書に混ざるのを機械で止める。
# 転職理由台本のような内外二層ノートを節指定なしで埋め込むと、【内部・言わない】列や
# 義悠の事業停止の背景まで面接直前の手元資料に載ってしまう。
# ⚠️「絶対に言わないこと」は NG集の見出し＝載せたい内容なので、マーカーにしない。
INTERNAL_MARKERS = ('【内部', '(内部:', '（内部:', '(内部：', '（内部：')

def find_note(vault: Path, name: str):
    name = name.strip()
    stem = name[:-3] if name.endswith('.md') else name
    hits = [p for p in vault.rglob(f'{stem}.md') if '.obsidian' not in p.parts]
    if not hits:
        sys.exit(f'❌ 埋め込み先が見つかりません: [[{name}]]（vault={vault}）')
    if len(hits) > 1:
        rels = '\n     '.join(str(p.relative_to(vault)) for p in hits)
        sys.exit(f'❌ 埋め込み先が複数あります: [[{name}]]\n     {rels}')
    return hits[0]

def slice_section(body: str, heading: str, note_name: str):
    """指定見出しの節だけを取り出す。見出し行自体は含めない。"""
    want = heading.strip()
    lines = body.split('\n')
    start = level = None
    for i, ln in enumerate(lines):
        m = HEADING_RE.match(ln)
        if m and m.group(2).strip() == want:
            start, level = i + 1, len(m.group(1))
            break
    if start is None:
        avail = [m.group(2).strip() for m in (HEADING_RE.match(l) for l in lines) if m]
        sys.exit(f'❌ [[{note_name}#{want}]] の節が見つかりません。\n   その ノート の見出し: ' + ' / '.join(avail[:20]))
    end = len(lines)
    for j in range(start, len(lines)):
        m = HEADING_RE.match(lines[j])
        if m and len(m.group(1)) <= level:
            end = j
            break
    return '\n'.join(lines[start:end]).strip('\n'), level

def shift_headings(body: str, shift: int):
    if shift <= 0:
        return body
    out = []
    for ln in body.split('\n'):
        m = HEADING_RE.match(ln)
        if m:
            level = min(len(m.group(1)) + shift, 6)
            out.append('#' * level + ' ' + m.group(2))
        else:
            out.append(ln)
    return '\n'.join(out)

def expand_embeds(md: str, vault: Path, depth=0, seen=()):
    if depth > 3:
        sys.exit('❌ 埋め込みのネストが深すぎます（循環参照の可能性）')
    out, ctx_level, expanded = [], 1, []
    for ln in md.split('\n'):
        h = HEADING_RE.match(ln)
        if h:
            ctx_level = len(h.group(1))
        m = EMBED_RE.match(ln)
        if not m:
            # 行頭以外に混ざった埋め込みは展開されないまま露出するので警告して気づけるようにする
            # （`![[…]]` のようにコード span で囲まれた構文説明は対象外）
            if '![[' in re.sub(r'`[^`]*`', '', ln):
                print(f'  ⚠️ 行の途中の埋め込みは展開しません（行頭に単独で置く）: {ln.strip()[:60]}')
            out.append(ln)
            continue
        note_name, section = m.group(2), m.group(3)
        key = (note_name.strip(), (section or '').strip())
        if key in seen:
            sys.exit(f'❌ 埋め込みが循環しています: [[{note_name}]]')
        path = find_note(vault, note_name)
        body = FRONTMATTER_RE.sub('', path.read_text(encoding='utf-8')).strip('\n')
        if section:
            body, src_level = slice_section(body, section, note_name)
        else:
            # ノート全体を埋め込む時は H1（＝ノート名の再掲）を落とす
            body = re.sub(r'^#\s+.*\n?', '', body, count=1).strip('\n')
            src_level = 1
        # 埋め込み先の見出しの1つ下に収まるよう、取り込んだ側の見出しを下げる
        body = shift_headings(body, max(0, (ctx_level + 1) - (src_level + 1)))
        body = expand_embeds(body, vault, depth + 1, seen + (key,))
        out.append(body)
        expanded.append(f'{note_name}#{section}' if section else note_name)
    if depth == 0 and expanded:
        print(f'  埋め込み展開 {len(expanded)} 件: ' + ' / '.join(expanded))
    return '\n'.join(out)

def check_internal(md: str, allow: bool):
    # 作業メモ（HTML コメント）は成果物に出ないので検査対象外。行番号は保つため改行だけ残す
    md = re.sub(r'<!--.*?-->', lambda m: '\n' * m.group(0).count('\n'), md, flags=re.S)
    hits = [(i + 1, ln.strip()) for i, ln in enumerate(md.split('\n'))
            if any(mk in ln for mk in INTERNAL_MARKERS)]
    if not hits:
        return
    label = '⚠️' if allow else '❌'
    print(f'{label} 対外に出せない【内部】層が {len(hits)} 行混ざっています:', file=sys.stderr)
    for line_no, text in hits[:10]:
        print(f'   L{line_no}: {text[:80]}', file=sys.stderr)
    if allow:
        return
    print('   → 埋め込みを節指定に変える（例: ![[転職理由台本#⭐ 音読用スクリプト（注音つき・面接直前に声出し）]]）。', file=sys.stderr)
    print('   → 意図的に含めるなら --allow-internal。', file=sys.stderr)
    sys.exit(1)

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def inline(t, ruby=True):
    # 先转义，再加粗/链接，最后 ruby（ruby 产出的 < > 不能被转义，所以放最后）
    t = esc(t)
    # vault 内部リンク [[ノート]] / [[ノート#節|表示名]] は HTML では飛べないので、
    # 「どこに出典があるか」だけ残して素のテキストにする（[[ ]] のまま出すと読めない）
    t = re.sub(r'\[\[([^\]|#]+)(?:#[^\]|]+)?\|([^\]]+)\]\]', r'<span class="ref">\2</span>', t)
    t = re.sub(r'\[\[([^\]|#]+)(?:#([^\]|]+))?\]\]',
               lambda m: f'<span class="ref">{m.group(2) or m.group(1)}</span>', t)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    # [表示名](http://...) → 可点击链接（新标签打开）
    t = re.sub(r'\[([^\]]+)\]\((https?://[^)\s]+)\)',
               r'<a href="\2" target="_blank" rel="noopener">\1</a>', t)
    if ruby:
        t = to_ruby(t)
    return t

def split_cells(line):
    """表のセルに分ける。`\\|` は区切りではなく文字としての `|`。
    素の split('|') だと、表の中の `[[ノート#節\\|表示名]]` が途中で切れてリンクが壊れる
    （Obsidian は表内の別名指定に `\\|` を要求するので、実際に頻出する）。"""
    inner = line.strip()
    if inner.startswith('|'):
        inner = inner[1:]
    if inner.endswith('|'):
        inner = inner[:-1]
    cells, buf, i = [], '', 0
    while i < len(inner):
        if inner[i] == '\\' and i + 1 < len(inner) and inner[i + 1] == '|':
            buf += '|'
            i += 2
            continue
        if inner[i] == '|':
            cells.append(buf)
            buf = ''
            i += 1
            continue
        buf += inner[i]
        i += 1
    cells.append(buf)
    return cells

def nav_label(title):
    # 去掉开头的序号/符号/顿号，取核心词做导航标签
    t = re.sub(r'^[⭐★●■\s　0-9０-９一二三四五六七八九十.．、。,，\-－）)（(]+', '', title).strip()
    t = re.sub(r'[（(].*', '', t)  # 去掉括号补充
    return t[:6] if t else title[:6]

def build(md, ruby=True):
    # HTML 注释块（<!-- ... -->）是模板の作業メモ。成果物には出さない
    md = re.sub(r'<!--.*?-->', '', md, flags=re.S)
    lines = md.split('\n')
    out, nav = [], []
    in_list = False
    in_table = False
    sec_open = False
    sec_i = 0

    def close_list():
        nonlocal in_list
        if in_list:
            out.append('</ul>'); in_list = False

    def close_table():
        nonlocal in_table
        if in_table:
            out.append('</table></div>'); in_table = False

    for ln in lines:
        s = ln.rstrip()
        # markdown 表格：| A | B | 行；分隔行 |---| 跳过
        if s.lstrip().startswith('|') and s.rstrip().endswith('|'):
            close_list()
            cells = [c.strip() for c in split_cells(s)]
            if all(re.match(r'^:?-{3,}:?$', c) for c in cells if c):
                continue  # 分隔行
            tag = 'th' if not in_table else 'td'
            if not in_table:
                out.append('<div class="tablewrap"><table>'); in_table = True
            out.append('<tr>' + ''.join(f'<{tag}>{inline(c, ruby)}</{tag}>' for c in cells) + '</tr>')
            continue
        close_table()
        if not s.strip():
            close_list(); continue
        if s.startswith('# ') and not s.startswith('## '):
            continue  # 顶层标题走 header，正文里跳过
        if s == '---':
            close_list(); continue
        if s.startswith('## '):
            close_list()
            if sec_open: out.append('</section>')
            title = s[3:].strip()
            sid = f'sec{sec_i}'; sec_i += 1
            nav.append((nav_label(title), sid))
            out.append(f'<section id="{sid}"><h2>{inline(title, ruby)}</h2>')
            sec_open = True
            continue
        if s.startswith('##### '):
            close_list(); out.append(f'<h4 class="q">{inline(s[6:], ruby)}</h4>'); continue
        if s.startswith('#### '):
            close_list(); out.append(f'<h4 class="q">{inline(s[5:], ruby)}</h4>'); continue
        if s.startswith('### '):
            close_list(); out.append(f'<h3 class="big">{inline(s[4:], ruby)}</h3>'); continue
        if s.startswith('【あなた】'):
            close_list()
            out.append(f'<div class="say you"><span class="tag you">あなた</span>{inline(s[5:], ruby)}</div>'); continue
        if s.startswith('【面接官】'):
            close_list()
            out.append(f'<div class="say q"><span class="tag q">面接官</span>{inline(s[5:], ruby)}</div>'); continue
        if s.startswith('▷'):
            close_list(); out.append(f'<div class="zh">{inline(s[1:].strip(), ruby)}</div>'); continue
        if s.startswith('▶'):
            close_list(); out.append(f'<div class="follow">{inline(s[1:].strip(), ruby)}</div>'); continue
        if s.startswith('> '):
            close_list(); out.append(f'<div class="tip">{inline(s[2:], ruby)}</div>'); continue
        if s.startswith('- '):
            if not in_list: out.append('<ul>'); in_list = True
            out.append(f'<li>{inline(s[2:], ruby)}</li>'); continue
        if re.match(r'^\*\*.+\*\*$', s):
            close_list(); out.append(f'<h4 class="strat">{inline(s, ruby)}</h4>'); continue
        close_list(); out.append(f'<p>{inline(s, ruby)}</p>')

    close_list()
    close_table()
    if sec_open: out.append('</section>')
    return '\n'.join(out), nav

CSS = '''
:root{--bg:#f7f8fa;--card:#fff;--ink:#1c2330;--sub:#5a6475;--line:#e3e7ee;--accent:#2563eb;--accent-soft:#eaf1fe;--warn:#b45309;--warn-soft:#fef3e2;--ok:#15803d;--ok-soft:#e8f6ec;--gold:#8a6d1d;--gold-soft:#fdf6e0;--q:#7c3aed;--q-soft:#f0e9fd;}
@media(prefers-color-scheme:dark){:root{--bg:#0f141c;--card:#171e29;--ink:#e8ecf3;--sub:#9aa5b5;--line:#2a3342;--accent:#6ea8ff;--accent-soft:#1b2a44;--warn:#f5b04c;--warn-soft:#3a2c14;--ok:#5fd08a;--ok-soft:#14301e;--gold:#e5c465;--gold-soft:#33290f;--q:#b794f6;--q-soft:#2a2140;}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","PingFang SC","Noto Sans CJK JP",sans-serif;line-height:1.75;font-size:16px}
.wrap{max-width:840px;margin:0 auto;padding:0 16px 80px}
header.hero{padding:26px 16px 12px;max-width:840px;margin:0 auto}
header.hero h1{font-size:1.4rem;line-height:1.4}
header.hero .meta{color:var(--sub);font-size:.9rem;margin-top:6px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:3px 12px;font-size:.82rem;font-weight:600}
nav.toc{position:sticky;top:0;z-index:50;background:var(--bg);border-bottom:1px solid var(--line);overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;padding:10px 12px}
nav.toc a{display:inline-block;margin-right:6px;padding:5px 14px;border-radius:999px;background:var(--card);border:1px solid var(--line);color:var(--ink);text-decoration:none;font-size:.86rem;font-weight:600;cursor:pointer;transition:background .15s}
nav.toc a.active{background:var(--accent);color:#fff;border-color:var(--accent)}
section{margin-top:20px}
body.tabs section{display:none;animation:fade .25s ease}
body.tabs section.active{display:block}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
h2{font-size:1.22rem;padding-bottom:8px;border-bottom:2px solid var(--accent);margin-bottom:14px}
h3.big{font-size:1.08rem;color:var(--accent);margin:22px 0 10px;padding-top:6px}
h4.q{font-size:1rem;margin:16px 0 8px;color:var(--q);font-weight:700}
h4.strat{font-size:.98rem;margin:16px 0 6px}
p{margin:8px 0}
ul{padding-left:1.3em;margin:8px 0}
li{margin:5px 0}
.say{border-radius:10px;padding:11px 14px;margin:9px 0;font-size:1.02rem}
.say.you{background:var(--ok-soft);border-left:4px solid var(--ok)}
.say.q{background:var(--q-soft);border-left:4px solid var(--q)}
.tag{display:inline-block;font-size:.72rem;font-weight:700;border-radius:6px;padding:1px 8px;margin-right:8px;vertical-align:1px}
.tag.you{background:var(--ok);color:#fff}
.tag.q{background:var(--q);color:#fff}
.zh{background:var(--warn-soft);border-radius:8px;padding:9px 13px;margin:8px 0 14px;font-size:.92rem}
.zh::before{content:"📌 ";font-weight:700}
.follow{background:var(--accent-soft);border-radius:8px;padding:9px 13px;margin:8px 0;font-size:.96rem}
.tip{background:var(--gold-soft);border-left:4px solid var(--gold);border-radius:0 10px 10px 0;padding:11px 14px;margin:12px 0;font-size:.95rem}
.tablewrap{overflow-x:auto;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:.92rem}
th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}
th{background:var(--accent-soft);font-weight:700}
ruby rt{font-size:.55em;color:var(--accent);font-weight:400}
.ref{color:var(--sub);font-size:.9em;border-bottom:1px dotted var(--line)}
strong{font-weight:700}
a{color:var(--accent);text-decoration:underline;text-underline-offset:3px;word-break:break-all}
.pager{display:none;gap:12px;margin-top:36px;padding-top:18px;border-top:1px solid var(--line)}
body.tabs .pager{display:flex}
.pager button{flex:1;padding:12px 10px;border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--accent);font-weight:700;font-size:.95rem;cursor:pointer;font-family:inherit}
.pager button:active:not(:disabled){background:var(--accent-soft)}
.pager button:disabled{opacity:.3;cursor:default}
.pageind{display:none;text-align:center;font-size:.82rem;color:var(--sub);margin-top:12px;font-weight:600}
body.tabs .pageind{display:block}
@media print{nav.toc,.pager,.pageind{display:none}body.tabs section{display:block!important}body{font-size:12px}}
'''

TEMPLATE = '''<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title><style>{css}</style></head><body>
<header class="hero"><h1>{title_html}</h1>
{subtitle_html}{chips_html}</header>
<nav class="toc">{nav}</nav>
<div class="wrap">
{body}
<div class="pager"><button id="pgPrev" type="button">← 前へ</button><button id="pgNext" type="button">次へ →</button></div>
<div class="pageind" id="pageind"></div>
<p class="meta" style="margin-top:24px;font-size:.82rem;color:var(--sub)">{footer}</p>
</div>{script}</body></html>'''

# タブ切替（漸進的強化）：JSが無ければ全節を縦に表示（従来通り）、有れば1節ずつのタブUIに。
# 現在地はナビのハイライト＋「n / 全」表示＋前へ/次へで分かる。長い文書をスマホで見る負担を下げる。
SCRIPT_JS = '''<script>
(function(){
var S=[].slice.call(document.querySelectorAll('section'));
var L=[].slice.call(document.querySelectorAll('nav.toc a'));
if(!S.length)return;
document.body.classList.add('tabs');
var ind=document.getElementById('pageind');
var pv=document.getElementById('pgPrev'),nx=document.getElementById('pgNext');
var cur=0;
function show(i){
 if(i<0||i>=S.length)return;
 cur=i;
 for(var j=0;j<S.length;j++)S[j].classList.toggle('active',j===i);
 for(var k=0;k<L.length;k++)L[k].classList.toggle('active',k===i);
 if(ind)ind.textContent=(i+1)+' / '+S.length;
 if(pv)pv.disabled=(i===0);
 if(nx)nx.disabled=(i===S.length-1);
 var nav=document.querySelector('nav.toc');
 if(nav&&L[i])nav.scrollTo({left:Math.max(0,L[i].offsetLeft-(nav.clientWidth-L[i].offsetWidth)/2)});
 window.scrollTo(0,0);
 if(S[i].id)history.replaceState(null,'','#'+S[i].id);
}
for(var i=0;i<L.length;i++)(function(idx){L[idx].addEventListener('click',function(e){e.preventDefault();show(idx);});})(i);
if(pv)pv.addEventListener('click',function(){show(cur-1);});
if(nx)nx.addEventListener('click',function(){show(cur+1);});
var start=0;
if(location.hash){var h=location.hash.slice(1);for(var m=0;m<S.length;m++)if(S[m].id===h){start=m;break;}}
show(start);
})();
</script>'''

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True)
    ap.add_argument('--output', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--subtitle', default='')
    ap.add_argument('--chips', default='', help='顶部小标签，用 | 分隔，如 "性質＝技術面|年収OK済"')
    ap.add_argument('--footer', default='丸暗記より要点を自分の言葉で。日本語話術は読み仮名付き。')
    ap.add_argument('--no-ruby', action='store_true', help='关闭 漢字（かな）→ruby 自动转换')
    ap.add_argument('--vault', default=os.environ.get('OBSIDIAN_VAULT_PATH', str(Path.home() / 'obsidian/xiaokan')),
                    help='![[ノート]] 埋め込みの解決先 vault（既定: $OBSIDIAN_VAULT_PATH）')
    ap.add_argument('--allow-internal', action='store_true',
                    help='【内部】層が混ざっていても中断しない（既定は中断）')
    a = ap.parse_args()

    md = open(a.input, encoding='utf-8').read()
    ruby = not a.no_ruby

    # 入力は vault ノート（type: interview-prep）なので frontmatter を落とす。
    # 残すと `type: interview-prep` 等が本文の段落として成果物に出る
    md = FRONTMATTER_RE.sub('', md, count=1)

    # 作業メモ（HTML コメント）は展開より先に落とす。
    # 後回しにすると、テンプレートの改修マップに書いた ![[…]] の例まで本文に展開されてしまう
    md = re.sub(r'<!--.*?-->', '', md, flags=re.S)

    # 埋め込みを先に展開してから HTML 化する。展開しないと章がまるごと欠ける
    vault = Path(a.vault).expanduser()
    if '![[' in md:
        if not vault.is_dir():
            sys.exit(f'❌ vault が見つかりません: {vault}（--vault か $OBSIDIAN_VAULT_PATH で指定）')
        md = expand_embeds(md, vault)
    check_internal(md, a.allow_internal)
    body, nav = build(md, ruby=ruby)
    navchips = ''.join(f'<a href="#{sid}">{esc(lbl)}</a>' for lbl, sid in nav)
    subtitle_html = f'<div class="meta">{esc(a.subtitle)}</div>' if a.subtitle else ''
    chips_html = ''
    if a.chips:
        items = ''.join(f'<span class="chip">{esc(c.strip())}</span>' for c in a.chips.split('|') if c.strip())
        chips_html = f'<div class="chips">{items}</div>'
    html = TEMPLATE.format(
        title=esc(a.title), css=CSS, title_html=inline(a.title, ruby),
        subtitle_html=subtitle_html, chips_html=chips_html,
        nav=navchips, body=body, footer=esc(a.footer), script=SCRIPT_JS)
    open(a.output, 'w', encoding='utf-8').write(html)

    # 标签平衡自检
    ok = all(html.count('<'+t) == html.count('</'+t+'>') for t in ['section','div','ul','li','h2','h3','h4'])
    print(f'✓ 生成 {a.output}（{len(html)} bytes, {len(nav)} sections, ruby={"on" if ruby else "off"}）')
    print('  标签平衡:', 'OK' if ok else '⚠️ 不平衡，请检查输入格式')

    # 注音健全性チェック：漢字（かな）の括弧内に仮名以外(空白/〜/·/半角括弧等)が混入していると
    # ruby 正則が失配してルビが出ず「漢字（…）」がそのまま露出する。生成側のよくあるバグを警告。
    if ruby:
        bad = re.compile(r'[一-龥々ヶ〆A-Za-z0-9]（([^）\n]{1,24})）')
        hits = []
        for m in bad.finditer(md):
            inner = m.group(1)
            has_kana = any('ぁ' <= c <= 'ん' or 'ァ' <= c <= 'ヶ' for c in inner)
            has_kanji = any('一' <= c <= '龥' for c in inner)
            has_latin = any(('A' <= c <= 'Z') or ('a' <= c <= 'z') for c in inner)
            has_junk = any(c in ' 　〜~·()' for c in inner)  # 半/全角空白・波ダッシュ・中黒(U+00B7)・半角括弧
            # ルビ注音の特徴＝括弧内は仮名のみのはず。仮名＋異物、かつ漢字/英字を含まない(＝補足説明ではない)ものだけ警告。
            if has_kana and has_junk and not has_kanji and not has_latin:
                hits.append(m.group(0))
        if hits:
            print(f'  ⚠️ ルビ注音の疑い {len(hits)} 件（括弧内に仮名以外が混入→ルビ化されず露出）:')
            for h in hits[:20]:
                print(f'     {h}')

    if not ok:
        sys.exit(1)

if __name__ == '__main__':
    main()
