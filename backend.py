#!/usr/bin/env python3
"""Extrai MOVIMENTAÇÃO, mantém um snapshot atômico e serve o dashboard."""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import signal
import subprocess
import threading
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT / "data" / "CONTROLE DATAS DE PRODUÇÃO NOVA V3.xlsx"
DEFAULT_CACHE = ROOT / ".cache" / "dashboard.json"
SHEET_NAME = "MOVIMENTAÇÃO"
TIMEZONE = ZoneInfo("America/Sao_Paulo")
XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

STAGES = (
    ("Corte", 5, 6, 8),
    ("Bordado", 9, 10, 12),
    ("Silk", 13, 14, 16),
    ("Costura Externa", 17, 18, 20),
    ("Costura Interna", 21, 22, 24),
    ("Expedição", 25, 26, 28),
)
STAGE_ORDER = {name: index for index, (name, *_rest) in enumerate(STAGES)}
STAGE_KEYS = {
    "Corte": "corte", "Bordado": "bordado", "Silk": "silk",
    "Costura Externa": "costuraExterna", "Costura Interna": "costuraInterna",
    "Expedição": "expedicao",
}
MONTHS_PT = ("Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez")
EXPECTED_HEADERS = {
    1: "DATA ENTRADA", 2: "QUANTIDADE", 3: "Nº FICHA", 4: "PRODUTO",
    25: "PREV. EXP", 29: "VALOR VENDA UNIT.", 30: "VALOR VENDA TOTAL",
    36: "CUSTO TOTAL", 41: "MARGEM DE CONTRIBUIÇÃO",
    43: "CLASSIFICAÇÃO DAS URGENCIAS", 50: "DATA ENTREGUE",
    51: "UNIDADE", 52: "VENDEDOR", 53: "ETAPA ATUAL",
}


class SourceValidationError(RuntimeError):
    pass


def normalized_text(value: object) -> str:
    return "" if value is None else " ".join(str(value).strip().split())


def header_key(value: object) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", normalized_text(value).upper())
    return "".join(char for char in text if not unicodedata.combining(char))


def number(value: object) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = normalized_text(value)
    if not text or text.upper() in {"N/A", "#N/A", "-"}:
        return None
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def excel_date(value: object) -> date | None:
    numeric = number(value)
    if numeric is not None:
        if not 30_000 <= numeric <= 70_000:
            return None
        return date(1899, 12, 30) + timedelta(days=int(numeric))
    text = normalized_text(value)
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            pass
    return None


def iso(value: date | None) -> str:
    return value.isoformat() if value else ""


def column_index(reference: str) -> int:
    result = 0
    for char in reference:
        if not char.isalpha():
            break
        result = result * 26 + ord(char.upper()) - 64
    return result


def month_start(value: date) -> date:
    return value.replace(day=1)


def shift_month(value: date, offset: int) -> date:
    index = value.year * 12 + value.month - 1 + offset
    return date(index // 12, index % 12 + 1, 1)


def month_label(value: date) -> str:
    return f"{MONTHS_PT[value.month - 1]}/{str(value.year)[2:]}"


def average(values: list[float]) -> float:
    return round(sum(values) / len(values), 1) if values else 0.0


def money(value: float) -> float:
    return round(value + 0.000000001, 2)


def xlsx_rows(content: bytes) -> tuple[list[dict[int, object]], dict[int, str]]:
    try:
        workbook = ZipFile(BytesIO(content))
    except BadZipFile as exc:
        raise SourceValidationError("O arquivo ainda não é um XLSX íntegro; será tentado novamente.") from exc
    with workbook:
        names = set(workbook.namelist())
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            shared_strings = [
                "".join(node.text or "" for node in item.iter(f"{{{XML_NS}}}t"))
                for item in root.findall(f"{{{XML_NS}}}si")
            ]
        wb_root = ET.fromstring(workbook.read("xl/workbook.xml"))
        rel_root = ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]: item.attrib["Target"] for item in rel_root}
        sheet_path = None
        sheets_node = wb_root.find(f"{{{XML_NS}}}sheets")
        for sheet in (() if sheets_node is None else sheets_node):
            if sheet.attrib.get("name") == SHEET_NAME:
                target = targets[sheet.attrib[f"{{{REL_NS}}}id"]].lstrip("/")
                sheet_path = target if target.startswith("xl/") else f"xl/{target}"
                break
        if not sheet_path:
            raise SourceValidationError(f"A aba {SHEET_NAME!r} não foi encontrada.")
        max_row = None
        for table_path in (name for name in names if name.startswith("xl/tables/table")):
            table = ET.fromstring(workbook.read(table_path))
            if table.attrib.get("displayName") == "MOV" or table.attrib.get("name") == "MOV":
                tail = table.attrib["ref"].split(":")[-1]
                max_row = int("".join(char for char in tail if char.isdigit()))
                break

        def cell_value(cell: ET.Element) -> object:
            cell_type = cell.attrib.get("t")
            if cell_type == "inlineStr":
                inline = cell.find(f"{{{XML_NS}}}is")
                return "" if inline is None else "".join(
                    node.text or "" for node in inline.iter(f"{{{XML_NS}}}t")
                )
            value_node = cell.find(f"{{{XML_NS}}}v")
            if value_node is None:
                return None
            raw = value_node.text or ""
            if cell_type == "s":
                try:
                    return shared_strings[int(raw)]
                except (ValueError, IndexError):
                    return None
            if cell_type == "b":
                return raw == "1"
            return raw

        rows: list[dict[int, object]] = []
        headers: dict[int, str] = {}
        with workbook.open(sheet_path) as stream:
            for _event, element in ET.iterparse(stream, events=("end",)):
                if element.tag != f"{{{XML_NS}}}row":
                    continue
                row_number = int(element.attrib.get("r", "0"))
                if max_row and row_number > max_row:
                    element.clear()
                    break
                values = {
                    column_index(cell.attrib["r"]): cell_value(cell)
                    for cell in element if cell.tag == f"{{{XML_NS}}}c"
                }
                if row_number == 2:
                    headers = {column: normalized_text(value) for column, value in values.items()}
                elif row_number >= 3 and any(values.get(column) not in (None, "") for column in (1, 2, 3, 4)):
                    values[0] = row_number
                    rows.append(values)
                element.clear()
    for column, expected in EXPECTED_HEADERS.items():
        if header_key(headers.get(column)) != header_key(expected):
            raise SourceValidationError(
                f"Coluna {column} inválida: esperado {expected!r}, encontrado {headers.get(column)!r}."
            )
    return rows, headers


def stage_for_row(row: dict[int, object]) -> str:
    for name, planned_column, actual_column, _duration_column in STAGES:
        if excel_date(row.get(planned_column)) and not excel_date(row.get(actual_column)):
            return name
    return "Concluído"


def row_financials(row: dict[int, object]) -> dict[str, float]:
    quantity = max(number(row.get(2)) or 0.0, 0.0)
    unit_sale = number(row.get(29))
    revenue = number(row.get(30))
    if revenue is None and unit_sale is not None:
        revenue = unit_sale * quantity
    revenue = revenue or 0.0
    # Composição idêntica à aba DRE do Excel:
    # matéria-prima é valor por linha; os demais custos unitários são
    # multiplicados pela QUANTIDADE; percentuais incidem sobre o valor vendido.
    material = number(row.get(31)) or 0.0
    labor = (number(row.get(32)) or 0.0) * quantity
    notions = (number(row.get(33)) or 0.0) * quantity
    decoration = (number(row.get(34)) or 0.0) * quantity
    freight = (number(row.get(35)) or 0.0) * quantity
    production_cost = material + labor + notions + decoration + freight
    def rate_value(column: int) -> float:
        rate = number(row.get(column)) or 0.0
        rate = rate / 100 if rate > 1 else rate
        return revenue * rate
    taxes = rate_value(37)       # IMPOSTOS
    commission = rate_value(38)  # COMISSÃO
    losses = rate_value(39)      # PERDA
    fees = rate_value(40)        # TAXA MAQUININHA
    total_cost = production_cost + taxes + commission + losses + fees
    return {
        "faturamento": revenue, "materiaPrima": material, "maoDeObra": labor,
        "aviamentos": notions, "silkBordado": decoration, "frete": freight,
        "impostos": taxes, "comissao": commission, "perdas": losses, "taxas": fees,
        "custoProducao": production_cost, "custoTotal": total_cost,
        "margem": revenue - total_cost,
    }


def urgency(code: int, delayed_days: int) -> str:
    del delayed_days
    if code >= 5:
        return "critica"
    if code >= 3:
        return "alta"
    return "normal"


def stage_group(rows: list[dict[int, object]]) -> str:
    active = [stage_for_row(row) for row in rows if stage_for_row(row) != "Concluído"]
    return min(active, key=STAGE_ORDER.__getitem__) if active else "Concluído"


def stage_delay(row: dict[int, object], stage_name: str) -> int:
    """Replica as colunas DIAS ATRASO da planilha: data real - data prevista."""
    for name, planned_column, actual_column, _duration_column in STAGES:
        if name != stage_name:
            continue
        planned = excel_date(row.get(planned_column))
        actual = excel_date(row.get(actual_column))
        return (actual - planned).days if planned and actual else 0
    return 0


def aggregate_orders(rows: list[dict[int, object]], today: date):
    grouped: dict[str, list[dict[int, object]]] = defaultdict(list)
    for row in rows:
        ficha = normalized_text(row.get(3))
        if ficha:
            grouped[ficha].append(row)
    orders = []
    for ficha, items in grouped.items():
        stage = stage_group(items)
        active_items = [item for item in items if stage_for_row(item) != "Concluído"]
        relevant = active_items or items
        quantity = sum(max(number(item.get(2)) or 0.0, 0.0) for item in relevant)
        products = list(dict.fromkeys(normalized_text(item.get(4)) for item in relevant if normalized_text(item.get(4))))
        product_label = ", ".join(products[:2]) + (f" +{len(products) - 2}" if len(products) > 2 else "")
        planned_dates = [excel_date(item.get(25)) for item in relevant]
        planned_dates = [value for value in planned_dates if value]
        planned = min(planned_dates) if planned_dates else None
        # O atraso do pedido segue a etapa atual e a mesma regra da planilha:
        # DATA REAL DA ETAPA - DATA PREVISTA DA ETAPA. Sem data real, o Excel retorna 0.
        delay = max((stage_delay(item, stage) for item in relevant), default=0) if stage != "Concluído" else 0
        urgency_code = max((int(number(item.get(43)) or 0) for item in relevant), default=0)
        urgency_label = urgency(urgency_code, delay)
        status = "concluido" if stage == "Concluído" else "atrasado" if delay > 0 else "urgente" if urgency_label == "critica" else "producao"
        units = list(dict.fromkeys(normalized_text(item.get(51)).upper() for item in relevant if normalized_text(item.get(51))))
        sellers = list(dict.fromkeys(normalized_text(item.get(52)) for item in relevant if normalized_text(item.get(52))))
        revenue = sum(row_financials(item)["faturamento"] for item in relevant)
        orders.append({
            "id": f"#{ficha}", "cliente": "Não disponível",
            "produto": product_label or "Não informado",
            "quantidade": int(quantity) if quantity.is_integer() else round(quantity, 2),
            "etapa": stage, "urgencia": urgency_label, "dataPrevista": iso(planned),
            "diasAtraso": delay, "responsavel": "Não disponível", "status": status,
            "vendedor": sellers[0] if len(sellers) == 1 else "Não disponível",
            "unidade": ", ".join(units) if units else "Não informado",
            "valor": money(revenue), "classificacaoUrgencia": urgency_code or None,
        })
    orders.sort(key=lambda order: (-order["diasAtraso"], order["dataPrevista"] or "9999-12-31", order["id"]))
    return orders, grouped


def monthly_production(grouped, reference: date) -> list[dict]:
    result = []
    for offset in range(-5, 1):
        month = shift_month(month_start(reference), offset)
        next_month = shift_month(month, 1)
        entered = delivered = delayed = 0
        for items in grouped.values():
            entries = [excel_date(item.get(1)) for item in items]
            entries = [value for value in entries if value]
            if entries and month <= min(entries) < next_month:
                entered += 1
            actual = [excel_date(item.get(26)) for item in items]
            actual = [value for value in actual if value]
            planned = [excel_date(item.get(25)) for item in items]
            planned = [value for value in planned if value]
            if actual and month <= max(actual) < next_month:
                delivered += 1
                delayed += int(bool(planned) and max(actual) > max(planned))
        result.append({"mes": month_label(month), "pedidos": entered, "entregas": delivered, "atrasados": delayed})
    return result


def sector_metrics(rows, orders, reference: date):
    start, end = month_start(reference), shift_month(month_start(reference), 1)
    metrics, delays = {}, []
    for stage_name, planned_column, actual_column, duration_column in STAGES:
        stage_orders = [order for order in orders if order["etapa"] == stage_name]
        completed_fichas, durations = set(), []
        completed_pieces = 0.0
        on_time = completion_rows = 0
        trend_dates = [reference - timedelta(days=offset) for offset in range(6, -1, -1)]
        trend = {value: 0.0 for value in trend_dates}
        for row in rows:
            actual = excel_date(row.get(actual_column))
            if actual and start <= actual < end:
                completed_fichas.add(normalized_text(row.get(3)))
                duration = number(row.get(duration_column))
                if duration is not None and duration > 0:
                    durations.append(duration)
                    completed_pieces += max(number(row.get(2)) or 0.0, 0.0)
                planned = excel_date(row.get(planned_column))
                completion_rows += 1
                on_time += int(bool(planned) and actual <= planned)
            if actual in trend:
                trend[actual] += max(number(row.get(2)) or 0.0, 0.0)
        delayed_count = sum(order["diasAtraso"] > 0 for order in stage_orders)
        metrics[STAGE_KEYS[stage_name]] = {
            "aguardando": 0, "producao": len(stage_orders),
            "concluido": len(completed_fichas - {""}),
            "pecas": int(sum(float(order["quantidade"]) for order in stage_orders)),
            "atrasados": delayed_count,
            "urgentes": sum(order["urgencia"] == "critica" for order in stage_orders),
            "tempoMedio": average(durations),
            "produtividade": round(completed_pieces / sum(durations), 1) if durations and sum(durations) > 0 else None,
            "taxaPrazo": round(on_time * 100 / completion_rows, 1) if completion_rows else None,
            "tendencia": [int(trend[value]) for value in trend_dates],
        }
        delays.append({"setor": stage_name.replace("Costura ", "Cost. "), "atrasos": delayed_count})
    return metrics, delays


def dre_for_period(rows, start: date, end: date, units: set[str] | None = None) -> dict[str, float]:
    totals = defaultdict(float)
    for row in rows:
        completed = excel_date(row.get(26))
        if not completed or not start <= completed < end:
            continue
        if units and normalized_text(row.get(51)).upper() not in units:
            continue
        for key, value in row_financials(row).items():
            totals[key] += value
    revenue = totals["faturamento"]
    result = {key: money(totals[key]) for key in (
        "faturamento", "materiaPrima", "maoDeObra", "aviamentos", "silkBordado",
        "frete", "impostos", "comissao", "perdas", "taxas", "custoTotal", "margem",
    )}
    result["deducoes"] = result["impostos"]
    result["receitaLiquida"] = money(revenue - totals["impostos"])
    result["margemPerc"] = round(totals["margem"] * 100 / revenue, 1) if revenue else 0.0
    return result


def dre_series_for_period(rows, start: date, end: date, units: set[str] | None = None) -> list[dict]:
    """Série temporal do intervalo: mês para intervalos longos, semana ou dia nos curtos."""
    days = (end - start).days
    if days > 93:
        cursor = month_start(start)
        def advance(value): return shift_month(value, 1)
        def label(value): return month_label(value)
    elif days > 14:
        cursor = start
        def advance(value): return value + timedelta(days=7)
        def label(value): return f"{value.strftime('%d/%m')}"
    else:
        cursor = start
        def advance(value): return value + timedelta(days=1)
        def label(value): return value.strftime("%d/%m")
    result = []
    while cursor < end:
        next_cursor = min(advance(cursor), end)
        values = dre_for_period(rows, cursor, next_cursor, units)
        result.append({"mes": label(cursor), "faturamento": values["faturamento"], "custo": values["custoTotal"], "margem": values["margem"], "margemPerc": values["margemPerc"]})
        cursor = next_cursor
    return result


def dre_products_for_period(rows, start: date, end: date, units: set[str] | None = None) -> list[dict]:
    products = defaultdict(lambda: defaultdict(float))
    for row in rows:
        completed = excel_date(row.get(26))
        if not completed or not start <= completed < end:
            continue
        if units and normalized_text(row.get(51)).upper() not in units:
            continue
        product = normalized_text(row.get(4)) or "Não informado"
        values = row_financials(row)
        products[product]["faturamento"] += values["faturamento"]
        products[product]["margem"] += values["margem"]
    result = []
    for name, values in products.items():
        revenue = values["faturamento"]
        result.append({"nome": name, "faturamento": money(revenue), "margem": money(values["margem"]),
                       "margemPerc": round(values["margem"] * 100 / revenue, 1) if revenue else 0.0})
    return sorted(result, key=lambda item: item["faturamento"], reverse=True)


def dre_data(rows, reference: date) -> dict:
    current_start = month_start(reference)
    current = dre_for_period(rows, current_start, shift_month(current_start, 1))
    previous_start = shift_month(current_start, -1)
    previous = dre_for_period(rows, previous_start, current_start)
    monthly = []
    for offset in range(-5, 1):
        start = shift_month(current_start, offset)
        values = dre_for_period(rows, start, shift_month(start, 1))
        monthly.append({"mes": month_label(start), "faturamento": values["faturamento"],
                        "custo": values["custoTotal"], "margem": values["margem"],
                        "margemPerc": values["margemPerc"]})
    products = defaultdict(lambda: defaultdict(float))
    for row in rows:
        completed = excel_date(row.get(26))
        if not completed or not current_start <= completed < shift_month(current_start, 1):
            continue
        product = normalized_text(row.get(4)) or "Não informado"
        values = row_financials(row)
        products[product]["faturamento"] += values["faturamento"]
        products[product]["margem"] += values["margem"]
    by_product = []
    for name, values in products.items():
        revenue = values["faturamento"]
        by_product.append({"nome": name, "faturamento": money(revenue),
                           "margem": money(values["margem"]),
                           "margemPerc": round(values["margem"] * 100 / revenue, 1) if revenue else 0.0})
    by_product.sort(key=lambda item: item["faturamento"], reverse=True)
    return {"atual": current, "anterior": previous, "mensal": monthly, "porProduto": by_product}


def build_dashboard(content: bytes, source: Path, source_stat: os.stat_result) -> dict:
    rows, _headers = xlsx_rows(content)
    today = datetime.now(TIMEZONE).date()
    entry_dates = [excel_date(row.get(1)) for row in rows]
    entry_dates = [value for value in entry_dates if value]
    if not entry_dates:
        raise SourceValidationError("Nenhuma DATA ENTRADA válida foi encontrada.")
    reference = max(entry_dates)
    orders, grouped = aggregate_orders(rows, today)
    active_orders = [order for order in orders if order["status"] != "concluido"]
    completed_orders = [order for order in orders if order["status"] == "concluido"]
    metrics, delays_by_sector = sector_metrics(rows, active_orders, reference)
    reference_start, reference_end = month_start(reference), shift_month(month_start(reference), 1)
    completed_in_period, completed_on_time, lead_times = [], 0, []
    for ficha, items in grouped.items():
        if stage_group(items) != "Concluído":
            continue
        actual = [excel_date(item.get(26)) for item in items]
        actual = [value for value in actual if value]
        if not actual or not reference_start <= max(actual) < reference_end:
            continue
        completed_in_period.append(ficha)
        planned = [excel_date(item.get(25)) for item in items]
        planned = [value for value in planned if value]
        completed_on_time += int(bool(planned) and max(actual) <= max(planned))
        entries = [excel_date(item.get(1)) for item in items]
        entries = [value for value in entries if value]
        if entries and (max(actual) - min(entries)).days >= 0:
            lead_times.append((max(actual) - min(entries)).days)
    next_deadline = sum(
        bool(order["dataPrevista"]) and 0 <= (date.fromisoformat(order["dataPrevista"]) - today).days <= 3
        for order in active_orders
    )
    summary = {
        "pedidosProducao": len(active_orders),
        "pecasProducao": int(sum(float(order["quantidade"]) for order in active_orders)),
        "pedidosAtrasados": sum(order["diasAtraso"] > 0 for order in active_orders),
        "pedidosUrgentes": sum(order["urgencia"] == "critica" for order in active_orders),
        "pedidosConcluidos": len(completed_in_period),
        "entregueNoPrazo": round(completed_on_time * 100 / len(completed_in_period), 1) if completed_in_period else None,
        "leadTimeMedio": average(lead_times) if lead_times else None,
        "valorProducao": money(sum(order["valor"] for order in active_orders)),
        "proximosPrazo": next_deadline,
    }
    deliveries_week = []
    for offset in range(7):
        target = today + timedelta(days=offset)
        day_orders = [order for order in active_orders if order["dataPrevista"] == target.isoformat()]
        deliveries_week.append({"dia": target.strftime("%d/%m"), "entregas": len(day_orders),
                                "em_risco": sum(order["urgencia"] in {"alta", "critica"} for order in day_orders)})
    exact_rows = Counter(tuple(normalized_text(row.get(column)) for column in range(1, 54)) for row in rows)
    duplicate_groups = sum(count > 1 for count in exact_rows.values())
    duplicate_extra = sum(count - 1 for count in exact_rows.values() if count > 1)
    missing_quantity = sum(number(row.get(2)) is None for row in rows)
    invalid_delivered = sum(bool(normalized_text(row.get(50))) and excel_date(row.get(50)) is None for row in rows)
    future_delivered = sum((excel_date(row.get(50)) or date.min) > today for row in rows)
    stage_mismatches = sum(
        bool(normalized_text(row.get(53))) and
        header_key(row.get(53)) != header_key(stage_for_row(row).replace("Concluído", "FINALIZADO"))
        for row in rows
    )
    warnings = []
    if missing_quantity:
        warnings.append(f"{missing_quantity} linhas sem quantidade; elas contam como 0 peça.")
    if duplicate_groups:
        warnings.append(f"{duplicate_groups} grupos de linhas idênticas ({duplicate_extra} linhas adicionais) foram mantidos e sinalizados para conferência.")
    if invalid_delivered:
        warnings.append(f"{invalid_delivered} valores de DATA ENTREGUE não são datas válidas e foram ignorados.")
    if future_delivered:
        warnings.append(f"{future_delivered} datas de entrega futuras foram preservadas e sinalizadas.")
    if stage_mismatches:
        warnings.append(f"{stage_mismatches} linhas têm ETAPA ATUAL divergente das datas; a etapa foi recalculada pelas datas.")
    if not any(normalized_text(row.get(52)) for row in rows):
        warnings.append("A coluna VENDEDOR está vazia em todas as linhas.")
    warnings.append("A aba MOVIMENTAÇÃO não possui colunas de cliente, responsável ou facção; esses campos não foram inferidos.")
    delayed_sector = max(delays_by_sector, key=lambda item: item["atrasos"], default={"setor": "", "atrasos": 0})
    most_delayed = max(active_orders, key=lambda order: order["diasAtraso"], default=None)
    alerts = []
    if delayed_sector["atrasos"]:
        alerts.append({"id": 1, "msg": f"{delayed_sector['atrasos']} pedidos atrasados em {delayed_sector['setor']}.",
                       "critica": delayed_sector["atrasos"] >= 10, "tipo": "atraso"})
    if most_delayed and most_delayed["diasAtraso"]:
        alerts.append({"id": 2, "msg": f"Pedido {most_delayed['id']} está {most_delayed['diasAtraso']} dias atrasado — {most_delayed['produto']}.",
                       "critica": most_delayed["diasAtraso"] >= 7, "tipo": "atraso"})
    alerts.append({"id": 3, "msg": f"{next_deadline} pedidos possuem entrega nos próximos 3 dias.",
                   "critica": False, "tipo": "prazo"})
    if reference < today - timedelta(days=30):
        alerts.append({"id": 4, "msg": f"A última DATA ENTRADA da base é {reference.strftime('%d/%m/%Y')}.",
                       "critica": False, "tipo": "fonte"})
    filters = {
        "clientes": [],
        "vendedores": sorted({normalized_text(row.get(52)) for row in rows if normalized_text(row.get(52))}),
        "unidades": sorted({normalized_text(row.get(51)).upper() for row in rows if normalized_text(row.get(51))}),
        "produtos": sorted({normalized_text(row.get(4)) for row in rows if normalized_text(row.get(4))}),
    }
    next_deliveries = sorted(active_orders, key=lambda order: (order["dataPrevista"] or "9999-12-31", -order["diasAtraso"], order["id"]))[:12]
    return {
        "meta": {"source": source.name, "sheet": SHEET_NAME,
                 "sourceModifiedAt": datetime.fromtimestamp(source_stat.st_mtime, TIMEZONE).isoformat(),
                 "syncedAt": datetime.now(TIMEZONE).isoformat(), "referenceDate": reference.isoformat(),
                 "reportingPeriod": month_label(reference), "stale": False, "lastError": None},
        "validation": {"rowsRead": len(rows), "uniqueOrders": len(grouped),
                       "activeOrders": len(active_orders), "completedOrders": len(completed_orders),
                       "warnings": warnings},
        "summary": summary, "orders": active_orders, "sectorMetrics": metrics,
        "monthlyData": monthly_production(grouped, reference), "atrasosPorSetor": delays_by_sector,
        "entregasSemana": deliveries_week, "facacoes": [], "proximasEntregas": next_deliveries,
        "dre": dre_data(rows, reference), "alerts": alerts, "filters": filters,
    }



def export_orders_xlsx(orders: list[dict]) -> bytes:
    """Cria um XLSX simples, sem depender de bibliotecas externas."""
    from xml.sax.saxutils import escape
    headers = ["Ficha", "Cliente", "Produto", "Quantidade", "Etapa Atual", "Urgência", "Data Prevista", "Dias de Atraso", "Responsável", "Status", "Unidade", "Valor"]
    fields = ["id", "cliente", "produto", "quantidade", "etapa", "urgencia", "dataPrevista", "diasAtraso", "responsavel", "status", "unidade", "valor"]
    def cell(value, row, column):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f'<c r="{column}{row}"><v>{value}</v></c>'
        return f'<c r="{column}{row}" t="inlineStr"><is><t>{escape(str(value or ""))}</t></is></c>'
    def col_name(index):
        result = ""
        while index:
            index, remainder = divmod(index - 1, 26)
            result = chr(65 + remainder) + result
        return result
    rows_xml = []
    rows_xml.append('<row r="1">' + "".join(cell(value, 1, col_name(i)) for i, value in enumerate(headers, 1)) + "</row>")
    for row_number, order in enumerate(orders, 2):
        values = [order.get(field, "") for field in fields]
        rows_xml.append('<row r="%d">%s</row>' % (row_number, "".join(cell(value, row_number, col_name(i)) for i, value in enumerate(values, 1))))
    sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(rows_xml) + '</sheetData></worksheet>'
    workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pedidos" sheetId="1" r:id="rId1"/></sheets></workbook>'
    content_types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    root_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    workbook_rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/worksheets/sheet1.xml", sheet)
    return output.getvalue()


class DashboardStore:
    def __init__(self, source: Path, cache: Path):
        self.source, self.cache = source, cache
        self.lock = threading.RLock()
        self.payload: dict | None = None
        self.signature: tuple[int, int] | None = None
        self.last_error: str | None = None
        self.load_cache()

    def load_cache(self) -> None:
        try:
            cached = json.loads(self.cache.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return
        if isinstance(cached, dict) and cached.get("meta", {}).get("sheet") == SHEET_NAME:
            cached["meta"]["stale"] = True
            cached["meta"]["lastError"] = "Snapshot carregado do cache; aguardando sincronização da planilha."
            self.payload = cached

    def write_cache(self, payload: dict) -> None:
        self.cache.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.cache.with_suffix(f".{os.getpid()}.tmp")
        try:
            temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            os.replace(temporary, self.cache)
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def sync_once(self, force: bool = False) -> bool:
        try:
            source_stat = self.source.stat()
            signature = (source_stat.st_mtime_ns, source_stat.st_size)
            with self.lock:
                if not force and self.signature == signature and self.payload is not None:
                    return False
            content = self.source.read_bytes()
            payload = build_dashboard(content, self.source, source_stat)
            self.write_cache(payload)
            with self.lock:
                self.payload, self.signature, self.last_error = payload, signature, None
            return True
        except (OSError, BadZipFile, ET.ParseError, SourceValidationError, ValueError) as exc:
            with self.lock:
                self.last_error = str(exc)
            return False

    def snapshot(self) -> dict:
        with self.lock:
            if self.payload is None:
                return {"meta": {"sheet": SHEET_NAME, "stale": True,
                                 "lastError": self.last_error or "Nenhum snapshot válido disponível."},
                        "error": "Dados indisponíveis"}
            payload = dict(self.payload)
            payload["meta"] = dict(self.payload["meta"])
            if self.last_error:
                payload["meta"]["stale"] = True
                payload["meta"]["lastError"] = self.last_error
            return payload


def make_handler(store: DashboardStore, static_dir: Path | None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "DeRiPI/1.0"

        def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_POST(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/refresh":
                updated = store.sync_once(force=True)
                self.send_json({"updated": updated, "data": store.snapshot()})
                return
            if path == "/api/export":
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length > 20_000_000:
                        raise ValueError("Exportação muito grande.")
                    payload = json.loads(self.rfile.read(length) or b"{}")
                    orders = payload.get("orders", [])
                    body = export_orders_xlsx(orders if isinstance(orders, list) else [])
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                    self.send_header("Content-Disposition", "attachment; filename=pedidos-producao.xlsx")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (ValueError, TypeError, json.JSONDecodeError) as exc:
                    self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            self.send_error(HTTPStatus.NOT_FOUND)

        def do_GET(self) -> None:
            path = urlparse(self.path).path
            if path == "/api/dashboard":
                store.sync_once()
                payload = store.snapshot()
                self.send_json(payload, HTTPStatus.SERVICE_UNAVAILABLE if payload.get("error") else HTTPStatus.OK)
                return
            if path == "/api/dre":
                try:
                    query = parse_qs(urlparse(self.path).query)
                    start = date.fromisoformat(query.get("start", [""])[0])
                    end = date.fromisoformat(query.get("end", [""])[0])
                    unit = normalized_text(query.get("unit", [""])[0]).upper()
                    units = {unit} if unit else None
                    rows, _ = xlsx_rows(store.source.read_bytes())
                    inclusive_end = end + timedelta(days=1)
                    span = inclusive_end - start
                    previous_end = start
                    previous_start = previous_end - span
                    self.send_json({
                        "atual": dre_for_period(rows, start, inclusive_end, units),
                        "anterior": dre_for_period(rows, previous_start, previous_end, units),
                        "porProduto": dre_products_for_period(rows, start, inclusive_end, units),
                        "serie": dre_series_for_period(rows, start, inclusive_end, units),
                    })
                except (ValueError, OSError, BadZipFile, ET.ParseError, SourceValidationError) as exc:
                    self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
                return
            if path == "/api/health":
                payload = store.snapshot()
                self.send_json({"ok": not bool(payload.get("error")), "meta": payload.get("meta", {})})
                return
            if static_dir:
                relative = path.lstrip("/") or "index.html"
                candidate = (static_dir / relative).resolve()
                try:
                    candidate.relative_to(static_dir.resolve())
                except ValueError:
                    self.send_error(HTTPStatus.FORBIDDEN)
                    return
                if not candidate.is_file():
                    candidate = static_dir / "index.html"
                if candidate.is_file():
                    body = candidate.read_bytes()
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
            self.send_error(HTTPStatus.NOT_FOUND)

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"[{self.log_date_time_string()}] {fmt % args}")
    return Handler


def run_server(store: DashboardStore, host: str, port: int, static_dir: Path | None, dev: bool) -> None:
    store.sync_once(force=True)
    stop = threading.Event()

    def watcher() -> None:
        while not stop.wait(30):
            store.sync_once()

    threading.Thread(target=watcher, name="xlsx-sync", daemon=True).start()
    server = ThreadingHTTPServer((host, port), make_handler(store, static_dir))
    if dev:
        threading.Thread(target=server.serve_forever, name="http-server", daemon=True).start()
        vite = ROOT / "node_modules" / ".bin" / "vite"
        if not vite.exists():
            raise SystemExit("Dependências do frontend ausentes. Execute pnpm install.")
        process = subprocess.Popen([str(vite)], cwd=ROOT)
        try:
            process.wait()
        except KeyboardInterrupt:
            process.send_signal(signal.SIGINT)
            process.wait()
        finally:
            stop.set()
            server.shutdown()
            server.server_close()
        return
    print(f"DE RI PI disponível em http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.shutdown()
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--static", type=Path)
    parser.add_argument("--dev", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    store = DashboardStore(args.source.resolve(), args.cache.resolve())
    if args.once:
        if not store.sync_once(force=True):
            raise SystemExit(store.last_error or "Falha ao sincronizar a planilha.")
        snapshot = store.snapshot()
        print(json.dumps({"meta": snapshot["meta"], "validation": snapshot["validation"],
                          "summary": snapshot["summary"]}, ensure_ascii=False, indent=2))
        return
    run_server(store, args.host, args.port, args.static.resolve() if args.static else None, args.dev)


if __name__ == "__main__":
    main()
