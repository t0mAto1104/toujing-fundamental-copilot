"""Test the V3.10.0 additions shipped inside SKILL.md: §1.4 tencent_ticks (marker v310-tencent-ticks),
§13.7 futures_kline and the INE first-day check (inside v39-futures), and the Layer 1 renumbering.

Offline: python3 -m unittest discover -s tests -v
Live: ASTOCK_LIVE_V310=1 python3 -m unittest tests.test_v310_sources -v
"""

import ast
import json
import os
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_v39_sources import SKILL, Response, _block_defining, _marker_code, load_shipped_code  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
NEW_ENDPOINTS = ["tencent_ticks", "futures_kline"]
# 新编号 → 该节必须定义的函数（重排后 §1.x 引用靠它核对）
LAYER1 = {"1.1": ("腾讯财经", ["tencent_quote"]), "1.2": ("腾讯 K 线", ["tencent_kline"]),
          "1.3": ("通达信官网盘后包", ["tdx_daily_package"]), "1.4": ("腾讯逐笔", ["tencent_ticks"]),
          "1.5": ("百度股市通", ["baidu_kline_with_ma"]), "1.6": ("新浪复权因子", ["sina_adjust_factor", "apply_adjust"]),
          "1.7": ("mootdx", [])}


def load_v310():
    ns = load_shipped_code()
    exec(compile(_marker_code("v310-tencent-ticks"), "SKILL.md:v310-tencent-ticks", "exec"), ns)
    return ns


def layer1_sections():
    body = SKILL.split("## Layer 1:", 1)[1].split("\n## Layer 2:", 1)[0]
    parts = re.split(r"^### (1\.\d) ", body, flags=re.M)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


class ShapeTests(unittest.TestCase):
    def test_new_endpoints_defined_wrapped_and_routed(self):
        ns = load_v310()
        table = SKILL.split("## 端点路由速查", 1)[1].split("\n## ", 1)[0]
        for name in NEW_ENDPOINTS:
            with self.subTest(name=name):
                self.assertTrue(callable(ns.get(name)))
                self.assertRegex(_block_defining(name), rf"@_v39_contract\ndef {name}\(")
                self.assertIn(f"`{name}(", table)

    def test_python39_syntax(self):
        code = _marker_code("v310-tencent-ticks")
        self.assertIsNone(re.search(r"\w\s*\|\s*None\b", code), "PEP 604 union breaks Python 3.9")
        ast.parse(code, feature_version=(3, 9))

    def test_layer1_order_and_titles(self):
        sections = layer1_sections()
        self.assertEqual(list(sections), list(LAYER1))
        for num, (title, funcs) in LAYER1.items():
            with self.subTest(section=num):
                self.assertTrue(sections[num].startswith(title), sections[num][:30])
                for func in funcs:
                    self.assertRegex(sections[num], rf"\ndef {func}\(")

    def test_route_table_rows_match_sections(self):
        table = SKILL.split("## 端点路由速查", 1)[1].split("\n## ", 1)[0]
        rows = dict(re.findall(r"^\| (1\.\d) \| `(\w+)\(", table, re.M))
        self.assertEqual(rows, {"1.1": "tencent_quote", "1.2": "tencent_kline", "1.3": "tdx_daily_package",
                                "1.4": "tencent_ticks", "1.5": "baidu_kline_with_ma", "1.6": "sina_adjust_factor",
                                "1.7": "tdx_client"})

    def test_section_references_point_at_the_defining_section(self):
        """「§1.N `func(`」这类引用重排后最容易指错；文件开头的历史版本说明按约定保留旧编号，不查。"""
        where = {f: num for num, (_, funcs) in LAYER1.items() for f in funcs}
        where["tdx_client"] = "1.7"
        texts = {"SKILL.md": SKILL.split("**使用方式：**", 1)[1]}
        for name in ("README.md", "README_en.md"):
            texts[name] = (ROOT / name).read_text(encoding="utf-8")
        checked = 0
        for name, text in texts.items():
            for num, func in re.findall(r"§ ?(1\.\d)\s*`?(\w+)\(", text):
                if func in where:
                    checked += 1
                    with self.subTest(file=name, ref=f"§{num} {func}"):
                        self.assertEqual(num, where[func])
        self.assertGreater(checked, 15)


def qt_text(symbol="sz000001", stamp="20260922161451", amount="17555", fields=88):
    vals = ["1"] * fields
    vals[30] = stamp
    vals[35] = f"11.71/15/{amount}"
    return f'v_{symbol}="{"~".join(vals)}";\n'.encode("gbk")


def page_text(page, records, symbol="sz000001"):
    return f'v_detail_data_{symbol}=[{page},"{"|".join(records)}"];'.encode("gbk")


GOOD_PAGES = [["0/09:25:00/11.70/0.00/10/11700/S", "1/09:30:03/11.71/0.01/5/5855/B"]]


class TickTests(unittest.TestCase):
    def setUp(self):
        self.ns = load_v310()

    def run_ticks(self, pages, qts=None, code="000001", symbol="sz000001"):
        """pages: 每页记录列表（或原始 bytes）；翻过最后一页返回空内容。qts: 两次行情快照的原始 bytes。"""
        qts = list(qts or [qt_text(symbol), qt_text(symbol)])
        calls = []

        def fake(url, params=None, **_):
            calls.append((url, params))
            if "qt.gtimg.cn" in url:
                return Response(content=qts.pop(0))
            page = params["p"]
            if page >= len(pages):
                return Response(content=b"")
            body = pages[page]
            return Response(content=body if isinstance(body, bytes) else page_text(page, body, symbol))

        with patch.dict(self.ns, {"_v39_http": MagicMock(side_effect=fake)}), patch("time.sleep"):
            return self.ns["tencent_ticks"](code), calls

    def test_parses_rows_with_date_code_and_units(self):
        frame, calls = self.run_ticks(GOOD_PAGES)
        self.assertEqual(list(frame.columns[:9]), ["date", "code", "time", "seq", "price", "change",
                                                   "volume", "amount", "side"])
        self.assertEqual(frame.date.tolist(), ["2026-09-22"] * 2)
        self.assertEqual(frame.code[0], "sz000001")
        self.assertEqual((frame.volume.tolist(), frame.amount.tolist()), ([10.0, 5.0], [11700.0, 5855.0]))
        self.assertEqual(frame.side.tolist(), ["S", "B"])
        self.assertEqual(frame.attrs["missing_seq"], [])
        # 两页快照 + 第 0 页 + 第 1 页（空，结束）
        self.assertEqual([c[1]["p"] for c in calls if c[1]], [0, 1])
        frame, _ = self.run_ticks(GOOD_PAGES + [[]])       # 结束页也可能是 [1,""]
        self.assertEqual(len(frame), 2)

    def test_regular_session_gap_is_an_error(self):
        pages = [["0/09:25:00/11.70/0.00/10/11700/S", "2/09:30:06/11.71/0.01/5/5855/B"]]
        with self.assertRaisesRegex(RuntimeError, "缺序号 1–1"):
            self.run_ticks(pages)

    def test_after_hours_gap_is_recorded_not_raised(self):
        pages = [GOOD_PAGES[0] + ["5/15:20:00/11.71/0.00/1/1171/M"]]
        frame, _ = self.run_ticks(pages)
        self.assertEqual(frame.attrs["missing_seq"], [2, 3, 4])
        self.assertEqual(len(frame), 3)

    def test_first_record_must_be_seq_zero(self):
        with self.assertRaises(RuntimeError):
            self.run_ticks([["1/09:25:00/11.70/0.00/10/11700/S"]], [qt_text(amount="11700")] * 2)

    def test_seq_or_time_going_backwards_is_an_error(self):
        for records in (["0/09:25:00/11.70/0.00/10/11700/S", "0/09:30:03/11.71/0.01/5/5855/B"],
                        ["0/09:30:00/11.70/0.00/10/11700/S", "1/09:25:03/11.71/0.01/5/5855/B"]):
            with self.subTest(records=records), self.assertRaises(RuntimeError):
                self.run_ticks([records])

    def test_amount_witness_when_no_trading_during_fetch(self):
        """收盘后两次快照相同：连续竞价段成交额对不上说明逐笔不全；盘后定价的额不计入。"""
        with self.assertRaisesRegex(RuntimeError, "对不上"):
            self.run_ticks(GOOD_PAGES, [qt_text(amount="30000")] * 2)
        pages = [GOOD_PAGES[0] + ["2/15:05:00/11.71/0.00/100/117100/M"]]
        frame, _ = self.run_ticks(pages)                     # 17555 元只算连续竞价段，117100 元的盘后成交不参与
        self.assertEqual(len(frame), 3)

    def test_amount_witness_skipped_while_trading(self):
        frame, _ = self.run_ticks(GOOD_PAGES, [qt_text(amount="9000"), qt_text(amount="30000")])
        self.assertEqual(len(frame), 2)

    def test_trade_date_change_during_fetch_is_an_error(self):
        with self.assertRaisesRegex(RuntimeError, "交易日"):
            self.run_ticks(GOOD_PAGES, [qt_text(), qt_text(stamp="20260923092600")])

    def test_empty_ticks_despite_turnover(self):
        with self.assertRaises(RuntimeError):
            self.run_ticks([], [qt_text()])
        with self.assertRaises(ValueError):                  # 9:25 撮合前
            self.run_ticks([], [qt_text(stamp="20260923091800")])

    def test_no_data_cases_are_value_errors(self):
        for qt in (qt_text(amount="0"), b'v_pv_none_match="1";\n'):
            with self.subTest(qt=qt[:20]), self.assertRaises(ValueError):
                self.run_ticks(GOOD_PAGES, [qt])

    def test_bse_and_index_rejected_before_network(self):
        guard = MagicMock(side_effect=AssertionError("network"))
        with patch.dict(self.ns, {"_v39_http": guard}):
            for code in ("920185", "bj920982", "sh000001", "000300", "399006", "sz399001"):
                with self.subTest(code=code), self.assertRaises(ValueError):
                    self.ns["tencent_ticks"](code)

    def test_format_changes_are_runtime_errors(self):
        bad_pages = [
            [["0/09:25:00/11.70/0.00/10/11700"]],                       # 少一个字段
            [["0/09:25:00/11.70/0.00/10/11700/S/x"]],                   # 多一个字段
            [["0/09:25:00/11.70/0.00/10/11700/X"]],                     # 方向认不出
            [["a/09:25:00/11.70/0.00/10/11700/S"]],                     # 序号不是整数
            [["0/09:25/11.70/0.00/10/11700/S"]],                        # 时间格式
            [["0/09:25:00//0.00/10/11700/S"]],                          # 价格为空
            [page_text(1, ["0/09:25:00/11.70/0.00/10/11700/S"])],      # 页号对不上
            [b"<html>error</html>"],
        ]
        for pages in bad_pages:     # 快照成交额与记录一致，免得被完整性核对先抛错、遮住格式校验
            with self.subTest(pages=str(pages)[:60]), self.assertRaises(RuntimeError):
                self.run_ticks(pages, [qt_text(amount="11700")] * 2)
        for qt in (b'v_sz000001="1~2~3";\n', qt_text(stamp="2026-09-22"), b"<html></html>",
                   qt_text(amount="17555").replace(b"11.71/15/17555", b"11.71/15")):
            with self.subTest(qt=qt[:30]), self.assertRaises(RuntimeError):
                self.run_ticks(GOOD_PAGES, [qt])

    def test_page_limit(self):
        pages = [[f"{i}/09:{30 + i // 20:02d}:{i % 20 * 3:02d}/11.70/0.00/1/1170/S"] for i in range(5)]
        with patch.dict(self.ns, {"_TICK_MAX_PAGES": 3}), self.assertRaisesRegex(RuntimeError, "仍未结束"):
            self.run_ticks(pages)


def kline_text(code, body):
    return f"/*<script>location.href='//sina.com';</script>*/\nvar _{code}=({body});".encode("gbk")


ROWS = ('[{"d":"2026-09-18","o":"3100.000","h":"3120.000","l":"3090.000","c":"3110.000","v":"500","p":"1500","s":"3105.000"},'
        '{"d":"2026-09-21","o":"3110.000","h":"3130.000","l":"3100.000","c":"3120.000","v":"600","p":"1600","s":"0.000"}]')


class FuturesKlineTests(unittest.TestCase):
    def setUp(self):
        self.ns = load_shipped_code()

    def kline(self, content, *args, **kwargs):
        http = MagicMock(return_value=Response(content=content))
        with patch.dict(self.ns, {"_v39_http": http}):
            return self.ns["futures_kline"](*args, **kwargs), http

    def test_parses_filters_and_zero_settle_is_none(self):
        frame, http = self.kline(kline_text("RB0", ROWS), "nf_rb0")
        self.assertIn("var%20_RB0=", http.call_args[0][0])
        self.assertEqual(http.call_args[1]["params"], {"symbol": "RB0"})
        self.assertEqual(frame.date.tolist(), ["2026-09-18", "2026-09-21"])
        self.assertEqual((frame.close.tolist(), frame.open_interest.tolist()), ([3110.0, 3120.0], [1500.0, 1600.0]))
        self.assertEqual(frame.settle[0], 3105.0)
        self.assertTrue(frame.settle.isna()[1])            # 新浪给 0 → None（DataFrame 里是 NaN）
        frame, _ = self.kline(kline_text("RB0", ROWS), "RB0", start="2026-09-19")
        self.assertEqual(frame.date.tolist(), ["2026-09-21"])
        frame, _ = self.kline(kline_text("RB0", ROWS), "RB0", end="20260918")
        self.assertEqual(frame.date.tolist(), ["2026-09-18"])
        frame, _ = self.kline(kline_text("RB0", json.dumps(json.loads(ROWS)[::-1])), "RB0")
        self.assertEqual(frame.date.tolist(), ["2026-09-18", "2026-09-21"])     # 新浪倒序也按日期排好

    def test_no_contract_or_empty_range_is_value_error(self):
        with self.assertRaisesRegex(ValueError, "老合约"):
            self.kline(kline_text("RB1501", "null"), "RB1501")
        with self.assertRaises(ValueError):
            self.kline(kline_text("RB0", ROWS), "RB0", start="2030-01-01")

    def test_bad_arguments_rejected_before_network(self):
        guard = MagicMock(side_effect=AssertionError("network"))
        with patch.dict(self.ns, {"_v39_http": guard}):
            for args, kwargs in ((("600519",), {}), (("RB",), {}), (("RB26011",), {}), (("",), {}),
                                 (("RB0",), {"start": "2026-09-10", "end": "2026-09-01"}),
                                 (("RB0",), {"start": "2026-13-01"})):
                with self.subTest(args=args, kwargs=kwargs), self.assertRaises(ValueError):
                    self.ns["futures_kline"](*args, **kwargs)

    def test_format_changes_are_runtime_errors(self):
        cases = [b"<html>404</html>",
                 kline_text("M0", ROWS),                                   # 变量名是别的合约
                 kline_text("RB0", "[{bad json"),
                 kline_text("RB0", '{"d":"2026-09-18"}'),                  # 不是列表
                 kline_text("RB0", ROWS.replace('"d":"2026-09-21"', '"d":"2026-09-18"')),   # 日期重复
                 kline_text("RB0", ROWS.replace(',"s":"3105.000"', "")),  # 缺结算价字段
                 kline_text("RB0", ROWS.replace('"2026-09-18"', '"20260918x"')),
                 kline_text("RB0", ROWS.replace('"c":"3110.000"', '"c":"abc"'))]
        for content in cases:
            with self.subTest(content=content[-60:]), self.assertRaises(RuntimeError):
                self.kline(content, "RB0")


class IneFirstDayTests(unittest.TestCase):
    def setUp(self):
        self.ns = load_shipped_code()

    def test_before_first_day_is_no_data_without_network(self):
        guard = MagicMock(side_effect=AssertionError("network"))
        with patch.dict(self.ns, {"_v39_http": guard}):
            for path, day in (("future/dailydata/kx", "20180323"), ("future/dailydata/pm", "20200702"),
                              ("option/dailydata/kx", "20210618")):
                with self.subTest(path=path):
                    with self.assertRaisesRegex(ValueError, "起才有"):
                        self.ns["_shfe_json"]("INE", path, day, "o_curinstrument")
                    payload, url = self.ns["_shfe_json"]("INE", path, day, "o_curinstrument", allow_missing=True)
                    self.assertIsNone(payload)
                    self.assertIn(day, url)

    def test_first_day_and_shfe_still_fetch(self):
        body = b'{"o_curinstrument": [{"PRODUCTID": "sc_f"}], "report_date": "%s"}'
        for exchange, path, day in (("INE", "option/dailydata/kx", "20210621"), ("INE", "future/dailydata/kx", "20180326"),
                                    ("SHFE", "future/dailydata/kx", "20020107")):
            http = MagicMock(return_value=Response(content=body % day.encode()))
            with self.subTest(exchange=exchange, day=day), patch.dict(self.ns, {"_v39_http": http}):
                payload, _ = self.ns["_shfe_json"](exchange, path, day, "o_curinstrument")
                self.assertEqual(payload["o_curinstrument"], [{"PRODUCTID": "sc_f"}])
                http.assert_called_once()

    def test_dce_hint_points_at_futures_kline(self):
        with self.assertRaises(ValueError) as caught:
            self.ns["futures_daily"]("2026-09-18", "DCE")
        self.assertIn("futures_kline", str(caught.exception))


@unittest.skipUnless(os.environ.get("ASTOCK_LIVE_V310"), "set ASTOCK_LIVE_V310=1 to hit real endpoints")
class LiveV310Tests(unittest.TestCase):
    def test_endpoints_return_rows_with_provenance(self):
        ns = load_v310()
        for name, fetch in (("tencent_ticks", lambda: ns["tencent_ticks"]("000001")),
                            ("futures_kline RB0", lambda: ns["futures_kline"]("RB0", start="2026-01-01")),
                            ("futures_kline M0", lambda: ns["futures_kline"]("M0", start="2026-01-01"))):
            with self.subTest(name=name):
                frame = fetch()
                self.assertGreater(len(frame), 0)
                self.assertTrue({"source", "source_url", "fetched_at"} <= set(frame.columns))
        with self.assertRaises(ValueError):
            ns["futures_daily"]("2018-03-23", "INE")


if __name__ == "__main__":
    unittest.main()
