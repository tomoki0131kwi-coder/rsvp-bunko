"""
JIS X 0213 の面区点 → Unicode の変換表（src/aozora/jisx0213.json）を作る。

青空文庫の外字注記（例: ※［＃「牛へん＋建」、第3水準1-87-71］）は JIS X 0213 の面区点で文字を指す。
Shift_JIS（JIS X 0208）で表せない第3水準・第4水準の文字だけを対象にする。
変換には Python 標準ライブラリの euc_jis_2004 コーデック（JIS X 0213:2004 の対応表にもとづく）を使う。

実行: python3 scripts/gen-jisx0213.py
"""
import json
import pathlib


def decode(men, ku, ten, codec):
    raw = (b"\x8f" if men == 2 else b"") + bytes([0xA0 + ku, 0xA0 + ten])
    try:
        return raw.decode(codec)
    except UnicodeDecodeError:
        return None


# 第2面で JIS X 0213 が使う区。euc_jis_2004 コーデックは互換のため 0x8F で始まる符号を
# JIS X 0212 としても読むので、JIS X 0212 の区（2, 6, 7, 9〜11, 16〜77 区）を除く必要がある
PLANE2_ROWS = {1, 3, 4, 5, 8, 12, 13, 14, 15, *range(78, 95)}

table = {}
for men in (1, 2):
    for ku in range(1, 95):
        if men == 2 and ku not in PLANE2_ROWS:
            continue
        for ten in range(1, 95):
            ch = decode(men, ku, ten, "euc_jis_2004")
            if not ch:
                continue
            # 第1・第2水準（JIS X 0208 にある文字）は Shift_JIS のテキストにそのまま書かれるので除く
            if men == 1 and decode(1, ku, ten, "euc_jp"):
                continue
            table[f"{men}-{ku}-{ten}"] = ch

out = pathlib.Path(__file__).resolve().parent.parent / "src" / "aozora" / "jisx0213.json"
out.write_text(json.dumps(table, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{len(table)} 文字 → {out}")
