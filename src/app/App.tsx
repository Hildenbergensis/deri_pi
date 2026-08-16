import { createContext, useContext, useEffect, useState } from "react";
import {
  LayoutDashboard, ClipboardList, Scissors, Sparkles, Layers,
  Users, Factory, Package, TrendingUp, Bell, Search, Settings,
  ChevronDown, AlertTriangle, CheckCircle2, Clock, ArrowUpRight,
  ArrowDownRight, ChevronRight, Truck, DollarSign, BarChart3,
  Zap, Timer, RefreshCw, Download, CalendarDays, Filter,
  Circle, Target,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell,
  ComposedChart,
} from "recharts";
import {
  DashboardData, EMPTY_DASHBOARD, Order, OrderStatus, SectorMetric, Urgencia,
  useDashboardData,
} from "./dashboard-data";

// ─── Types ──────────────────────────────────────────────────────────────────

type PageId =
  | "dashboard" | "pendencias" | "corte" | "bordado"
  | "silk" | "costura-externa" | "costura-interna"
  | "expedicao" | "dre";

// ─── Utilities ───────────────────────────────────────────────────────────────

const STATUS_CFG: Record<OrderStatus, { label: string; color: string; bg: string }> = {
  concluido: { label: "Concluído",   color: "#16A34A", bg: "#F0FDF4" },
  producao:  { label: "Em Produção", color: "#2563EB", bg: "#EFF6FF" },
  atrasado:  { label: "Atrasado",    color: "#DC2626", bg: "#FEF2F2" },
  urgente:   { label: "Urgente",     color: "#EA580C", bg: "#FFF7ED" },
  aguardando:{ label: "Aguardando",  color: "#6B7280", bg: "#F9FAFB" },
};

const URG_CFG: Record<Urgencia, { label: string; color: string; bg: string }> = {
  normal: { label: "Normal",  color: "#6B7280", bg: "#F3F4F6" },
  alta:   { label: "Alta",    color: "#D97706", bg: "#FFFBEB" },
  critica:{ label: "Crítica", color: "#DC2626", bg: "#FEF2F2" },
};

const fmt  = (n: number) => n.toLocaleString("pt-BR");
const fmtR = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtDate = (value: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const pct  = (a: number, b: number) => b === 0 ? 0 : +((((a - b) / b) * 100).toFixed(1));

function healthColor(delayed: number, total: number) {
  if (total === 0 || delayed === 0) return "#16A34A";
  const r = delayed / total;
  if (r < 0.15) return "#D97706";
  if (r < 0.35) return "#EA580C";
  return "#DC2626";
}

// ─── Reusable Components ─────────────────────────────────────────────────────

type FilterPeriod = "hoje" | "semana" | "mes" | "personalizado";
type ActiveFilters = { period: FilterPeriod; produto: string; unidade: string; status: string; etapa: string; sort: "atraso" | "data" | "urgencia" };
interface DashboardViewContext extends DashboardData {
  activeFilters: ActiveFilters;
  setActiveFilters: React.Dispatch<React.SetStateAction<ActiveFilters>>;
}

const initialFilters: ActiveFilters = { period: "mes", produto: "", unidade: "", status: "", etapa: "", sort: "atraso" };
const DashboardContext = createContext<DashboardViewContext>({
  ...EMPTY_DASHBOARD, activeFilters: initialFilters, setActiveFilters: () => undefined,
});
const useDashboard = () => useContext(DashboardContext);

function sortOrders(orders: Order[], sort: ActiveFilters["sort"]): Order[] {
  const urgencyRank: Record<Urgencia, number> = { critica: 0, alta: 1, normal: 2 };
  return [...orders].sort((left, right) => {
    if (sort === "data") return (left.dataPrevista || "9999-12-31").localeCompare(right.dataPrevista || "9999-12-31");
    if (sort === "urgencia") return urgencyRank[left.urgencia] - urgencyRank[right.urgencia] || right.diasAtraso - left.diasAtraso;
    return right.diasAtraso - left.diasAtraso;
  });
}

function filterOrders(orders: Order[], filters: ActiveFilters, referenceDate: string): Order[] {
  const base = referenceDate ? new Date(`${referenceDate}T12:00:00`) : new Date();
  const day = (value: string) => value ? new Date(`${value}T12:00:00`) : null;
  return orders.filter(order => {
    const planned = day(order.dataPrevista);
    let periodMatch = true;
    if (filters.period === "hoje") periodMatch = !!planned && planned.toDateString() === base.toDateString();
    if (filters.period === "semana") {
      const end = new Date(base); end.setDate(end.getDate() + 7);
      periodMatch = !!planned && planned >= base && planned <= end;
    }
    if (filters.period === "mes") periodMatch = !!planned && planned.getMonth() === base.getMonth() && planned.getFullYear() === base.getFullYear();
    const productMatch = !filters.produto || order.produto.toLocaleLowerCase("pt-BR").includes(filters.produto.toLocaleLowerCase("pt-BR"));
    const unitMatch = !filters.unidade || order.unidade.split(", ").includes(filters.unidade);
    const statusMatch = !filters.status || order.status === filters.status;
    const stageMatch = !filters.etapa || order.etapa === filters.etapa;
    return periodMatch && productMatch && unitMatch && statusMatch && stageMatch;
  });
}

interface KPIProps {
  label: string; value: string | number; sub?: string;
  delta?: number; icon?: React.ReactNode; accent?: string;
  mono?: boolean; inverse?: boolean; info?: string; comparisonLabel?: string;
}

function KPICard({ label, value, sub, delta, icon, accent = "#2563EB", mono, inverse, info, comparisonLabel = "vs. mês ant." }: KPIProps) {
  const isGood = delta === undefined ? undefined : inverse ? delta <= 0 : delta >= 0;
  return (
    <div title={info} className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-tight">{label}</span>
        {icon && (
          <div className="rounded-lg p-2 flex-shrink-0" style={{ backgroundColor: `${accent}16` }}>
            <div style={{ color: accent }}>{icon}</div>
          </div>
        )}
      </div>
      <div>
        <div className={`text-[1.6rem] font-bold leading-none text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</div>
        {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
      </div>
      {delta !== undefined && (
        <div className="flex items-center gap-1 text-xs">
          {isGood
            ? <ArrowUpRight size={13} style={{ color: "#16A34A" }} />
            : <ArrowDownRight size={13} style={{ color: "#DC2626" }} />}
          <span className="font-semibold" style={{ color: isGood ? "#16A34A" : "#DC2626" }}>
            {delta > 0 ? "+" : ""}{delta}%
          </span>
          <span className="text-slate-400">{comparisonLabel}</span>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const c = STATUS_CFG[status];
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ color: c.color, backgroundColor: c.bg }}>
      <Circle size={5} fill={c.color} color={c.color} />
      {c.label}
    </span>
  );
}

function UrgBadge({ urgencia }: { urgencia: Urgencia }) {
  const c = URG_CFG[urgencia];
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ color: c.color, backgroundColor: c.bg }}>
      {c.label}
    </span>
  );
}

function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-4">{actions}</div>
    </div>
  );
}

function FilterBar() {
  const { filters, orders, meta, activeFilters, setActiveFilters } = useDashboard();
  const setFilter = (patch: Partial<ActiveFilters>) => setActiveFilters(current => ({ ...current, ...patch }));
  const selectClass = "text-xs border border-black/[0.07] rounded-lg px-3 py-[7px] bg-white text-slate-600 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <div className="flex items-center bg-white border border-black/[0.07] rounded-lg overflow-hidden shadow-sm">
        {([["hoje", "Hoje"], ["semana", "Semana"], ["mes", "Mês"], ["personalizado", "Personalizado"]] as [FilterPeriod, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setFilter({ period: key })}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${activeFilters.period === key ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
            {label}
          </button>
        ))}
      </div>
      <select value={activeFilters.produto} onChange={event => setFilter({ produto: event.target.value })} className={selectClass}>
        <option value="">Todos os produtos</option>
        {filters.produtos.map(product => <option key={product} value={product}>{product}</option>)}
      </select>
      <select value={activeFilters.unidade} onChange={event => setFilter({ unidade: event.target.value })} className={selectClass}>
        <option value="">Todas as unidades</option>
        {filters.unidades.map(unit => <option key={unit} value={unit}>{unit}</option>)}
      </select>
      <select value={activeFilters.status} onChange={event => setFilter({ status: event.target.value })} className={selectClass}>
        <option value="">Todos os status</option>
        <option value="producao">Em Produção</option>
        <option value="atrasado">Atrasado</option>
        <option value="urgente">Urgente</option>
      </select>
      <select value={activeFilters.etapa} onChange={event => setFilter({ etapa: event.target.value })} className={selectClass}>
        <option value="">Todas as etapas</option>
        {["Corte", "Bordado", "Silk", "Costura Externa", "Costura Interna", "Expedição"].map(stage => <option key={stage} value={stage}>{stage}</option>)}
      </select>
      <select value={activeFilters.sort} onChange={event => setFilter({ sort: event.target.value as ActiveFilters["sort"] })} className={selectClass}>
        <option value="atraso">Ordenar por atraso</option>
        <option value="data">Ordenar por data prevista</option>
        <option value="urgencia">Ordenar por urgência</option>
      </select>
      <button onClick={() => setActiveFilters(initialFilters)} className="text-xs text-slate-500 hover:text-blue-600 px-2 py-1.5">Limpar filtros</button>
      <ExportButton orders={filterOrders(orders, activeFilters, meta.referenceDate)} />
    </div>
  );
}

function ExportButton({ orders, className }: { orders: Order[]; className?: string }) {
  const [exporting, setExporting] = useState(false);
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const response = await fetch("/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orders }) });
      if (!response.ok) throw new Error("Não foi possível exportar os dados.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "pedidos-producao.xlsx"; link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    } finally {
      setExporting(false);
    }
  };
  return <button onClick={() => void exportXlsx()} disabled={exporting} className={className || "ml-auto flex items-center gap-1.5 text-xs border border-black/[0.07] rounded-lg px-3 py-[7px] bg-white text-slate-600 hover:bg-slate-50 shadow-sm disabled:opacity-50"}>
    <Download size={13} />{exporting ? "Exportando…" : "Exportar XLSX"}
  </button>;
}

function OrdersTable({ data, compact }: { data: Order[]; compact?: boolean }) {
  const { activeFilters } = useDashboard();
  const [columnSort, setColumnSort] = useState<{ key: string; asc: boolean } | null>(null);
  const orderValue = (order: Order, key: string) => ({ Ficha: order.id, Cliente: order.cliente, Produto: order.produto, Qtd: order.quantidade, Etapa: order.etapa, "Etapa Atual": order.etapa, Urgência: order.urgencia, "Data Prevista": order.dataPrevista, Atraso: order.diasAtraso, Responsável: order.responsavel, Status: order.status } as Record<string, string | number>)[key] ?? "";
  const baseData = sortOrders(data, activeFilters.sort);
  const sortedData = columnSort ? [...baseData].sort((a, b) => {
    const av = orderValue(a, columnSort.key), bv = orderValue(b, columnSort.key);
    const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "pt-BR");
    return columnSort.asc ? result : -result;
  }) : baseData;
  const toggleColumn = (key: string) => setColumnSort(current => current?.key === key ? { key, asc: !current.asc } : { key, asc: true });
  return (
    <div className="overflow-x-auto rounded-xl border border-black/[0.06] bg-white shadow-sm">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-black/[0.06] bg-slate-50/80">
            {(compact
              ? ["Ficha", "Cliente", "Produto", "Etapa", "Urgência", "Atraso", "Status"]
              : ["Ficha", "Cliente", "Produto", "Qtd", "Etapa Atual", "Urgência", "Data Prevista", "Atraso", "Responsável", "Status"]
            ).map(h => (
              <th key={h} className="text-left px-4 py-2.5 font-bold text-slate-400 uppercase tracking-wider text-[10px] whitespace-nowrap"><button onClick={() => toggleColumn(h)} className="hover:text-blue-600">{h}{columnSort?.key === h ? (columnSort.asc ? " ↑" : " ↓") : ""}</button></th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.04]">
          {sortedData.length === 0 && <tr><td colSpan={compact ? 7 : 10} className="px-5 py-8 text-center text-slate-400">Nenhum registro disponível.</td></tr>}
          {sortedData.map(o => (
            <tr key={o.id} className={`hover:bg-blue-50/30 transition-colors ${o.status === "urgente" ? "bg-orange-50/30" : o.status === "atrasado" ? "bg-red-50/20" : ""}`}>
              <td className="px-4 py-2.5 font-mono font-bold text-blue-600">{o.id}</td>
              <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap font-medium">{o.cliente}</td>
              <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{o.produto}</td>
              {!compact && <td className="px-4 py-2.5 font-mono text-slate-700">{fmt(o.quantidade)}</td>}
              <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{o.etapa}</td>
              <td className="px-4 py-2.5"><UrgBadge urgencia={o.urgencia} /></td>
              {!compact && <td className="px-4 py-2.5 font-mono text-slate-500">{fmtDate(o.dataPrevista)}</td>}
              <td className="px-4 py-2.5 font-mono font-bold">
                {o.diasAtraso > 0 ? <span className="text-red-600">+{o.diasAtraso}d</span> : <span className="text-slate-300">—</span>}
              </td>
              {!compact && <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{o.responsavel}</td>}
              <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Production Flow ─────────────────────────────────────────────────────────

function ProductionFlow({ onNavigate }: { onNavigate?: (p: PageId) => void }) {
  const { sectorMetrics, summary, meta } = useDashboard();
  const b = sectorMetrics.bordado, si = sectorMetrics.silk;
  const flowStages = [
    { key: "corte", label: "Corte", icon: <Scissors size={14} />, ...sectorMetrics.corte },
    { key: "bordado_silk", label: "Bordado/Silk", icon: <Sparkles size={14} />, pedidos: b.producao + si.producao, pecas: b.pecas + si.pecas, atrasados: b.atrasados + si.atrasados, urgentes: b.urgentes + si.urgentes, tempoMedio: b.tempoMedio || si.tempoMedio },
    { key: "costura_ext", label: "Costura Ext.", icon: <Users size={14} />, ...sectorMetrics.costuraExterna },
    { key: "costura_int", label: "Costura Int.", icon: <Factory size={14} />, ...sectorMetrics.costuraInterna },
    { key: "expedicao", label: "Expedição", icon: <Truck size={14} />, ...sectorMetrics.expedicao },
  ].map(stage => ({ ...stage, pedidos: "pedidos" in stage ? stage.pedidos : stage.producao, tempo: `${stage.tempoMedio || 0}d` }));
  const navMap: Record<string, PageId> = {
    corte: "corte", bordado_silk: "bordado", costura_ext: "costura-externa",
    costura_int: "costura-interna", expedicao: "expedicao",
  };
  return (
    <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5 mb-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-slate-800 text-sm">Fluxo de Produção</h3>
          <span className="text-[10px] bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">AO VIVO</span>
        </div>
        <span className="text-[11px] text-slate-400">{meta.syncedAt ? `Sincronizado ${new Date(meta.syncedAt).toLocaleString("pt-BR")}` : "Sincronizando…"}</span>
      </div>
      <div className="flex items-start gap-0 overflow-x-auto pb-1 -mx-1 px-1">
        {/* Pedido */}
        <div className="flex-shrink-0 w-[90px]">
          <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-3 text-center">
            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Pedido</div>
            <div className="text-2xl font-bold font-mono text-slate-800">{summary.pedidosProducao}</div>
            <div className="text-[9px] text-slate-400 mt-0.5">em prod.</div>
          </div>
        </div>

        {flowStages.map((s) => {
          const hc = healthColor(s.atrasados, s.pedidos);
          const isCritical = s.atrasados >= 8;
          return (
            <div key={s.key} className="flex items-start">
              <div className="flex-shrink-0 flex items-center justify-center pt-5 w-5">
                <ChevronRight size={14} className="text-slate-300" />
              </div>
              <button
                onClick={() => onNavigate && navMap[s.key] && onNavigate(navMap[s.key])}
                className="flex-shrink-0 w-[118px] rounded-xl border-2 p-3 text-left transition-all hover:shadow-md"
                style={{
                  borderColor: `${hc}55`,
                  backgroundColor: isCritical ? "#FEF2F2" : "#FAFBFF",
                }}>
                <div className="flex items-center gap-1 mb-2.5">
                  <span style={{ color: hc }}>{s.icon}</span>
                  <span className="text-[9px] font-black text-slate-600 uppercase tracking-wider leading-tight">{s.label}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                  <div><div className="text-slate-400 leading-none mb-0.5">Pedidos</div><div className="font-bold font-mono text-slate-800">{s.pedidos}</div></div>
                  <div><div className="text-slate-400 leading-none mb-0.5">Peças</div><div className="font-bold font-mono text-slate-800">{fmt(s.pecas)}</div></div>
                  <div>
                    <div className="text-slate-400 leading-none mb-0.5">Atraso</div>
                    <div className="font-bold font-mono" style={{ color: s.atrasados > 0 ? "#DC2626" : "#16A34A" }}>{s.atrasados}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 leading-none mb-0.5">Urgente</div>
                    <div className="font-bold font-mono" style={{ color: s.urgentes > 0 ? "#EA580C" : "#16A34A" }}>{s.urgentes}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-slate-400 leading-none mb-0.5">Tempo médio</div>
                    <div className="font-bold font-mono text-slate-700">{s.tempo}</div>
                  </div>
                </div>
                <div className="mt-2 h-1 rounded-full" style={{ backgroundColor: `${hc}22` }}>
                  <div className="h-full rounded-full" style={{ width: `${s.pedidos ? Math.min(100, (s.atrasados / s.pedidos) * 100 * 3 + 10) : 0}%`, backgroundColor: hc }} />
                </div>
              </button>
            </div>
          );
        })}

        <div className="flex-shrink-0 flex items-center justify-center pt-5 w-5">
          <ChevronRight size={14} className="text-slate-300" />
        </div>
        {/* Concluído */}
        <div className="flex-shrink-0 w-[90px]">
          <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3 text-center">
            <div className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1">Concluído</div>
            <div className="text-2xl font-bold font-mono text-emerald-700">{summary.pedidosConcluidos}</div>
            <div className="text-[9px] text-emerald-500 mt-0.5">este mês</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Alerts Panel ────────────────────────────────────────────────────────────

function AlertsPanel({ compact }: { compact?: boolean }) {
  const { alerts } = useDashboard();
  const iconMap: Record<string, React.ReactNode> = {
    atraso:     <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />,
    prazo:      <Clock size={13} className="text-orange-500 flex-shrink-0" />,
    gargalo:    <Zap size={13} className="text-orange-500 flex-shrink-0" />,
    financeiro: <DollarSign size={13} className="text-yellow-500 flex-shrink-0" />,
    fornecedor: <Users size={13} className="text-yellow-600 flex-shrink-0" />,
    fonte:      <RefreshCw size={13} className="text-blue-500 flex-shrink-0" />,
  };
  const shown = compact ? alerts.slice(0, 4) : alerts;

  return (
    <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.05]">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-slate-500" />
          <span className="text-sm font-bold text-slate-800">Alertas da Produção</span>
          <span className="text-[10px] font-black bg-red-500 text-white rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
            {alerts.filter(a => a.critica).length}
          </span>
        </div>
        <RefreshCw size={12} className="text-slate-400 cursor-pointer hover:text-slate-600 transition-colors" />
      </div>
      <div className="divide-y divide-black/[0.04]">
        {shown.map(a => (
          <div key={a.id} className={`flex items-start gap-3 px-5 py-3 hover:bg-slate-50/80 transition-colors ${a.critica ? "bg-red-50/40" : ""}`}>
            <div className="mt-0.5">{iconMap[a.tipo] || <Bell size={13} />}</div>
            <p className="text-[12px] text-slate-700 leading-relaxed flex-1">{a.msg}</p>
            {a.critica && (
              <span className="flex-shrink-0 text-[9px] font-black text-red-600 bg-red-100 px-1.5 py-0.5 rounded uppercase tracking-wide">
                Crítico
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TOOLTIP custom ──────────────────────────────────────────────────────────

const ttStyle = { border: "1px solid #E2E8F0", borderRadius: 10, fontSize: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" };

// ─── Dashboard Page ───────────────────────────────────────────────────────────

function DashboardPage({ onNav }: { onNav: (p: PageId) => void }) {
  const { orders, summary, monthlyData, atrasosPorSetor, entregasSemana, sectorMetrics, meta, activeFilters } = useDashboard();
  const delayed = orders.filter(o => o.status === "atrasado" || o.status === "urgente");
  const stageDistribution = [
    { name: "Corte", value: sectorMetrics.corte.producao },
    { name: "Bordado", value: sectorMetrics.bordado.producao },
    { name: "Silk", value: sectorMetrics.silk.producao },
    { name: "Cost. Ext.", value: sectorMetrics.costuraExterna.producao },
    { name: "Cost. Int.", value: sectorMetrics.costuraInterna.producao },
    { name: "Expedição", value: sectorMetrics.expedicao.producao },
  ];
  return (
    <div>
      <PageHeader
        title="Dashboard Geral"
        subtitle={`Visão consolidada · período da base ${meta.reportingPeriod} · fonte até ${fmtDate(meta.referenceDate)}`}
        actions={<>
<ExportButton orders={filterOrders(orders, activeFilters, meta.referenceDate)} className="flex items-center gap-1.5 text-xs bg-blue-600 text-white rounded-lg px-3 py-2 hover:bg-blue-700 disabled:opacity-50" />
        </>}
      />

      <div className="grid grid-cols-4 gap-4 mb-4">
        <KPICard label="Pedidos em Produção" value={summary.pedidosProducao} icon={<Package size={15} />} />
        <KPICard label="Peças em Produção" value={fmt(summary.pecasProducao)} icon={<BarChart3 size={15} />} mono />
        <KPICard label="Pedidos Atrasados" value={summary.pedidosAtrasados} icon={<AlertTriangle size={15} />} accent="#DC2626" />
        <KPICard label="Pedidos Urgentes" value={summary.pedidosUrgentes} sub="classificação 5" icon={<Zap size={15} />} accent="#EA580C" />
      </div>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <KPICard label="Concluídos (mês)" value={summary.pedidosConcluidos} icon={<CheckCircle2 size={15} />} accent="#16A34A" />
        <KPICard label="Entregue no Prazo" value={summary.entregueNoPrazo === null ? "N/D" : `${summary.entregueNoPrazo.toLocaleString("pt-BR")}%`} icon={<Target size={15} />} />
        <KPICard label="Lead Time Médio" value={summary.leadTimeMedio === null ? "N/D" : `${summary.leadTimeMedio.toLocaleString("pt-BR")} dias`} icon={<Clock size={15} />} accent="#7C3AED" mono />
        <KPICard label="Valor em Produção" value={fmtR(summary.valorProducao)} icon={<DollarSign size={15} />} accent="#059669" />
      </div>

      <ProductionFlow onNavigate={onNav} />

      {/* Charts row 1 */}
      <div className="grid grid-cols-3 gap-5 mb-5">
        <div className="col-span-2 bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Evolução da Produção</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={monthlyData}>
              <defs>
                <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gE" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16A34A" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="#16A34A" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ttStyle} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Area type="monotone" dataKey="pedidos"  name="Pedidos"  stroke="#2563EB" fill="url(#gP)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="entregas" name="Entregas" stroke="#16A34A" fill="url(#gE)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Atrasos por Setor</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={atrasosPorSetor} layout="vertical" barCategoryGap={10}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
              <XAxis type="number" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="setor" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={70} />
              <Tooltip contentStyle={ttStyle} />
              <Bar dataKey="atrasos" name="Atrasos" radius={[0, 4, 4, 0]}>
                {atrasosPorSetor.map((e, i) => (
                  <Cell key={i} fill={e.atrasos >= 8 ? "#DC2626" : e.atrasos >= 4 ? "#EA580C" : e.atrasos >= 2 ? "#D97706" : "#16A34A"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="grid grid-cols-3 gap-5 mb-6">
        <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Pedidos por Etapa</h3>
          <ResponsiveContainer width="100%" height={190}>
            <RPieChart>
              <Pie
data={stageDistribution}
                cx="50%" cy="50%" innerRadius={38} outerRadius={65}
                dataKey="value" stroke="none"
              >
                {["#3B82F6","#8B5CF6","#EC4899","#F97316","#10B981","#14B8A6"].map((c, i) => <Cell key={i} fill={c} />)}
              </Pie>
              <Tooltip contentStyle={ttStyle} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </RPieChart>
          </ResponsiveContainer>
        </div>

        <div className="col-span-2 bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Entregas Previstas — Próximos 7 Dias</h3>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={entregasSemana}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="dia" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ttStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="entregas" name="Entregas"  fill="#3B82F6" radius={[3,3,0,0]} />
              <Bar dataKey="em_risco" name="Em Risco"  fill="#FCA5A5" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Alerts + table */}
      <div className="grid grid-cols-5 gap-5">
        <div className="col-span-2"><AlertsPanel compact /></div>
        <div className="col-span-3 bg-white rounded-xl border border-black/[0.06] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-black/[0.05]">
            <span className="text-sm font-bold text-slate-800">Pedidos em Atenção</span>
            <button onClick={() => onNav("pendencias")} className="text-xs text-blue-600 hover:underline font-medium">Ver todos</button>
          </div>
          <OrdersTable data={delayed.slice(0, 6)} compact />
        </div>
      </div>
    </div>
  );
}

// ─── Pendências Page ──────────────────────────────────────────────────────────

function PendenciasPage() {
  const { orders, summary, activeFilters, meta, setActiveFilters } = useDashboard();
  const pendentes = filterOrders(orders, activeFilters, meta.referenceDate).filter(o => o.status !== "concluido");
  const criticas  = pendentes.filter(o => o.urgencia === "critica");
  const atrasadas = pendentes.filter(o => o.diasAtraso > 0);
  const totalPecas = pendentes.reduce((a, o) => a + o.quantidade, 0);

  return (
    <div>
      <PageHeader
        title="Pendências"
        subtitle="Pedidos em andamento que requerem acompanhamento ou ação imediata"
        actions={
          <ExportButton orders={pendentes} className="flex items-center gap-1.5 text-xs bg-blue-600 text-white rounded-lg px-3 py-2 hover:bg-blue-700 disabled:opacity-50" />
        }
      />
      <div className="grid grid-cols-5 gap-4 mb-5">
        <KPICard label="Total Pendências"   value={pendentes.length}  icon={<ClipboardList size={15} />} />
        <KPICard label="Críticas"           value={criticas.length}   icon={<AlertTriangle size={15} />} accent="#DC2626" />
        <KPICard label="Atrasadas"          value={atrasadas.length}  icon={<Clock size={15} />}         accent="#EA580C" />
        <KPICard label="Próx. do Prazo"     value={summary.proximosPrazo} sub="≤ 3 dias"  icon={<Timer size={15} />}         accent="#D97706" />
        <KPICard label="Peças Envolvidas"   value={fmt(totalPecas)}   icon={<Package size={15} />}       mono />
      </div>
      <FilterBar />
      <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-black/[0.05]">
          <span className="text-sm font-bold text-slate-700">{pendentes.length} pendências encontradas</span>
          <select value={activeFilters.sort} onChange={event => setActiveFilters(filters => ({ ...filters, sort: event.target.value as ActiveFilters["sort"] }))} className="text-xs border border-black/[0.07] rounded-lg px-2 py-1.5 bg-white text-slate-600 focus:outline-none">
            <option value="atraso">Ordenar por atraso</option>
            <option value="data">Ordenar por data prevista</option>
            <option value="urgencia">Ordenar por urgência</option>
          </select>
        </div>
        <OrdersTable data={pendentes} />
      </div>
    </div>
  );
}

// ─── Generic Sector Page ──────────────────────────────────────────────────────

interface SectorCfg {
  label: string;
  metrics: SectorMetric;
  sectorOrders: Order[];
  extra?: React.ReactNode;
}

function SectorPage({ cfg }: { cfg: SectorCfg }) {
  const { meta, activeFilters } = useDashboard();
  const { label, metrics, sectorOrders, extra } = cfg;
  const visibleOrders = filterOrders(sectorOrders, activeFilters, meta.referenceDate);
  const visibleMetrics: SectorMetric = {
    ...metrics,
    producao: visibleOrders.length,
    pecas: visibleOrders.reduce((total, order) => total + order.quantidade, 0),
    atrasados: visibleOrders.filter(order => order.diasAtraso > 0).length,
    urgentes: visibleOrders.filter(order => order.urgencia === "critica").length,
  };
  const reference = meta.referenceDate ? new Date(`${meta.referenceDate}T12:00:00`) : new Date();
  const weeklyData = visibleMetrics.tendencia.map((v, i) => { const day = new Date(reference); day.setDate(day.getDate() - 6 + i); return { dia: day.toLocaleDateString("pt-BR", { weekday: "short" }), pecas: v }; });
  const total = visibleMetrics.producao + visibleMetrics.aguardando + visibleMetrics.atrasados;

  return (
    <div>
      <PageHeader
        title={label}
        subtitle={`Acompanhamento do setor · período da base ${meta.reportingPeriod}`}
        actions={<>
          <button className="text-xs border border-black/[0.07] rounded-lg px-3 py-2 bg-white text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 shadow-sm">
            <Filter size={12} />Filtrar
          </button>
          <ExportButton orders={visibleOrders} className="text-xs bg-blue-600 text-white rounded-lg px-3 py-2 hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-50" />
        </>}
      />

      <div className="grid grid-cols-4 gap-4 mb-4">
        <KPICard label="Aguardando"       value={visibleMetrics.aguardando}            icon={<Clock size={15} />}         accent="#6B7280" />
        <KPICard label="Em Produção"      value={visibleMetrics.producao}              icon={<Factory size={15} />}       />
        <KPICard label="Concluídos (mês)" value={metrics.concluido}             icon={<CheckCircle2 size={15} />}  accent="#16A34A" />
        <KPICard label="Peças em Prod."   value={fmt(visibleMetrics.pecas)} mono       icon={<Package size={15} />}       />
      </div>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <KPICard label="Atrasados"        value={visibleMetrics.atrasados}             icon={<AlertTriangle size={15} />} accent="#DC2626" />
        <KPICard label="Urgentes"         value={visibleMetrics.urgentes}              icon={<Zap size={15} />}           accent="#EA580C" />
        <KPICard label="Tempo Médio"      value={`${visibleMetrics.tempoMedio}d`} mono icon={<Timer size={15} />}         accent="#7C3AED" />
        <KPICard label="Produtividade"    value={visibleMetrics.produtividade === null ? "N/D" : `${visibleMetrics.produtividade} p/dia`} icon={<Target size={15} />} accent="#059669" info="Metodologia: peças concluídas na etapa ÷ soma do tempo total registrado para essas peças. O valor é expresso em peças por dia." />
      </div>

      <div className="grid grid-cols-2 gap-5 mb-5">
        <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Peças Produzidas — Semana</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={ttStyle} />
              <Bar dataKey="pecas" name="Peças" fill="#2563EB" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Distribuição de Status</h3>
          {[
            { label: "Em Produção", value: visibleMetrics.producao, color: "#2563EB" },
            { label: "Aguardando",  value: visibleMetrics.aguardando, color: "#6B7280" },
            { label: "Atrasados",   value: visibleMetrics.atrasados, color: "#DC2626" },
          ].map(item => (
            <div key={item.label} className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 font-medium">{item.label}</span>
                <span className="font-mono font-bold" style={{ color: item.color }}>{item.value}</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700" style={{
                  width: `${total > 0 ? (item.value / total) * 100 : 0}%`,
                  backgroundColor: item.color,
                }} />
              </div>
            </div>
          ))}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <div title="Metodologia: peças concluídas na etapa ÷ soma do tempo total registrado para essas peças." className="text-3xl font-black font-mono text-slate-800">{visibleMetrics.produtividade === null ? "N/D" : `${visibleMetrics.produtividade} p/dia`}</div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5 uppercase tracking-wide">Produtividade</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <div className="text-3xl font-black font-mono text-slate-800">{visibleMetrics.tempoMedio}<span className="text-lg">d</span></div>
              <div className="text-[10px] text-slate-500 font-semibold mt-0.5 uppercase tracking-wide">Tempo Médio</div>
            </div>
          </div>
        </div>
      </div>

      {extra}

      <FilterBar />
      <OrdersTable data={visibleOrders} />
    </div>
  );
}

// ─── Costura Externa Extra: Facções ──────────────────────────────────────────

function FacacoesTable() {
  const { facacoes } = useDashboard();
  return (
    <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm mb-5 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-black/[0.05]">
        <span className="text-sm font-bold text-slate-800">Desempenho por Facção / Fornecedor</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-black/[0.05] bg-slate-50/80">
              {["Facção","Pedidos Ativos","Peças","Atrasados","Taxa de Entrega","Tempo Médio","Avaliação"].map(h => (
                <th key={h} className="text-left px-5 py-2.5 font-bold text-slate-400 uppercase tracking-wider text-[10px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {facacoes.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-400">Dados de facção não disponíveis na aba MOVIMENTAÇÃO.</td></tr>}
            {facacoes.map(f => {
              const color = f.taxaEntrega >= 80 ? "#16A34A" : f.taxaEntrega >= 70 ? "#2563EB" : f.taxaEntrega >= 60 ? "#D97706" : "#DC2626";
              const rating = f.taxaEntrega >= 80 ? "Ótimo" : f.taxaEntrega >= 70 ? "Bom" : f.taxaEntrega >= 60 ? "Regular" : "Crítico";
              const bg     = f.taxaEntrega >= 80 ? "#F0FDF4" : f.taxaEntrega >= 70 ? "#EFF6FF" : f.taxaEntrega >= 60 ? "#FFFBEB" : "#FEF2F2";
              return (
                <tr key={f.nome} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-semibold text-slate-700">{f.nome}</td>
                  <td className="px-5 py-3 font-mono text-slate-700">{f.pedidos}</td>
                  <td className="px-5 py-3 font-mono text-slate-700">{fmt(f.pecas)}</td>
                  <td className="px-5 py-3 font-mono font-bold text-red-600">{f.atrasados}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${f.taxaEntrega}%`, backgroundColor: color }} />
                      </div>
                      <span className="font-mono font-semibold" style={{ color }}>{f.taxaEntrega}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 font-mono text-slate-700">{f.tempoMedio}d</td>
                  <td className="px-5 py-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-black" style={{ color, backgroundColor: bg }}>{rating}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Expedição Extra: Próximas Entregas ───────────────────────────────────────

function ProximasEntregas() {
  const { proximasEntregas } = useDashboard();
  return (
    <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm mb-5 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-black/[0.05]">
        <Truck size={14} className="text-blue-600" />
        <span className="text-sm font-bold text-slate-800">Próximas Entregas</span>
        <span className="text-[11px] text-slate-400 ml-1">Ordenado por data de entrega</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-black/[0.05] bg-slate-50/80">
              {["Pedido","Cliente","Produto","Qtd","Data Entrega","Urgência","Status"].map(h => (
                <th key={h} className="text-left px-5 py-2.5 font-bold text-slate-400 uppercase tracking-wider text-[10px]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.04]">
            {proximasEntregas.map((e, i) => {
              const isLate = e.status === "atrasado" || e.status === "urgente";
              return (
                <tr key={i} className={`hover:bg-slate-50 transition-colors ${isLate ? "bg-red-50/30" : ""}`}>
                  <td className="px-5 py-2.5 font-mono font-bold text-blue-600">{e.id}</td>
                  <td className="px-5 py-2.5 font-medium text-slate-700">{e.cliente}</td>
                  <td className="px-5 py-2.5 text-slate-500">{e.produto}</td>
                  <td className="px-5 py-2.5 font-mono text-slate-700">{fmt(e.quantidade)}</td>
                  <td className="px-5 py-2.5 font-mono font-bold text-slate-800">{fmtDate(e.dataPrevista)}</td>
                  <td className="px-5 py-2.5"><UrgBadge urgencia={e.urgencia} /></td>
                  <td className="px-5 py-2.5"><StatusBadge status={e.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── DRE Page ─────────────────────────────────────────────────────────────────

function DREPage() {
  const { dre, meta, orders, activeFilters } = useDashboard();
  const { atual: initialDre, anterior: initialPrevious, mensal: dreMonthly, porProduto: initialProducts } = dre;
  const [view, setView] = useState<"resumo" | "mensal" | "produto">("resumo");
  const [period, setPeriod] = useState<"ano" | "trimestre" | "mes" | "semana" | "personalizado">("mes");
  const [unit, setUnit] = useState<"" | "BEBEDOURO" | "BARRETOS">("");
  const initialDate = meta.referenceDate ? new Date(`${meta.referenceDate}T12:00:00`) : new Date();
  const formatPt = (value: Date) => value.toLocaleDateString("pt-BR");
  const [customStart, setCustomStart] = useState(`01/${String(initialDate.getMonth() + 1).padStart(2, "0")}/${initialDate.getFullYear()}`);
  const [customEnd, setCustomEnd] = useState(formatPt(initialDate));
  const [periodDre, setPeriodDre] = useState({ atual: initialDre, anterior: initialPrevious, porProduto: initialProducts, serie: dreMonthly });
  const [periodLabel, setPeriodLabel] = useState(meta.reportingPeriod || "—");
  const [previousLabel, setPreviousLabel] = useState("");
  const [periodError, setPeriodError] = useState("");
  const dreAtual = periodDre.atual;
  const dreAnterior = periodDre.anterior;
  const margemPorProduto = periodDre.porProduto;
  const dreSeries = periodDre.serie;
  const [productSort, setProductSort] = useState<{ key: "nome" | "faturamento" | "margem" | "margemPerc"; asc: boolean }>({ key: "faturamento", asc: false });
  const sortedProducts = [...margemPorProduto].sort((a, b) => { const result = typeof a[productSort.key] === "number" ? Number(a[productSort.key]) - Number(b[productSort.key]) : String(a[productSort.key]).localeCompare(String(b[productSort.key]), "pt-BR"); return productSort.asc ? result : -result; });
  const toggleProductSort = (key: typeof productSort.key) => setProductSort(current => current.key === key ? { key, asc: !current.asc } : { key, asc: true });
  useEffect(() => {
    const ref = meta.referenceDate ? new Date(`${meta.referenceDate}T12:00:00`) : new Date();
    const parsePt = (value: string) => {
      const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return match ? new Date(`${match[3]}-${match[2]}-${match[1]}T12:00:00`) : null;
    };
    let start = new Date(ref), end = new Date(ref);
    let label = "", previous = "";
    if (period === "ano") {
      start = new Date(ref.getFullYear(), 0, 1); end = new Date(ref.getFullYear(), 11, 31);
      label = String(ref.getFullYear()); previous = String(ref.getFullYear() - 1);
    } else if (period === "trimestre") {
      const quarter = Math.floor(ref.getMonth() / 3); start = new Date(ref.getFullYear(), quarter * 3, 1); end = new Date(ref.getFullYear(), quarter * 3 + 3, 0);
      label = `${quarter + 1}º tri/${String(ref.getFullYear()).slice(-2)}`;
      const previousEnd = new Date(start); previousEnd.setDate(previousEnd.getDate() - 1);
      previous = `${Math.floor(previousEnd.getMonth() / 3) + 1}º tri/${String(previousEnd.getFullYear()).slice(-2)}`;
    } else if (period === "mes") {
      start = new Date(ref.getFullYear(), ref.getMonth(), 1); end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      label = start.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
      const previousDate = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
      previous = previousDate.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
    } else if (period === "semana") {
      start.setDate(ref.getDate() - ((ref.getDay() + 6) % 7)); end = new Date(start); end.setDate(start.getDate() + 6);
      label = `${formatPt(start)}–${formatPt(end)}`;
      const priorStart = new Date(start); priorStart.setDate(priorStart.getDate() - 7); const priorEnd = new Date(start); priorEnd.setDate(priorEnd.getDate() - 1);
      previous = `${formatPt(priorStart)}–${formatPt(priorEnd)}`;
    } else {
      const parsedStart = parsePt(customStart), parsedEnd = parsePt(customEnd);
      if (!parsedStart || !parsedEnd || parsedEnd < parsedStart) { setPeriodError("Informe datas válidas no formato dd/mm/aaaa."); return; }
      start = parsedStart; end = parsedEnd; label = `${formatPt(start)}–${formatPt(end)}`;
      const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      const priorEnd = new Date(start); priorEnd.setDate(priorEnd.getDate() - 1); const priorStart = new Date(priorEnd); priorStart.setDate(priorStart.getDate() - days + 1);
      previous = `${formatPt(priorStart)}–${formatPt(priorEnd)}`;
    }
    const iso = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    setPeriodError(""); setPeriodLabel(label); setPreviousLabel(previous);
    fetch(`/api/dre?start=${iso(start)}&end=${iso(end)}&unit=${encodeURIComponent(unit)}`, { cache: "no-store" })
      .then(async response => { const value = await response.json(); if (!response.ok || value.error) throw new Error(value.error || "Não foi possível recalcular o DRE."); return value; })
      .then(value => setPeriodDre(value)).catch(error => setPeriodError(error instanceof Error ? error.message : "Falha ao atualizar o DRE."));
  }, [period, customStart, customEnd, unit, meta.referenceDate]);

  const dreRows = [
    { label: "Faturamento Bruto",         cat: "receita",   atual: dreAtual.faturamento,    ant: dreAnterior.faturamento },
    { label: "(-) Deduções / Impostos",   cat: "deducao",   atual: -dreAtual.deducoes,      ant: -dreAnterior.deducoes },
    { label: "= Receita Líquida",         cat: "subtotal",  atual: dreAtual.receitaLiquida, ant: dreAnterior.receitaLiquida },
    { label: "(-) Matéria-Prima",         cat: "custo",     atual: -dreAtual.materiaPrima,  ant: -dreAnterior.materiaPrima },
    { label: "(-) Mão de Obra",           cat: "custo",     atual: -dreAtual.maoDeObra,     ant: -dreAnterior.maoDeObra },
    { label: "(-) Aviamentos",            cat: "custo",     atual: -dreAtual.aviamentos,    ant: -dreAnterior.aviamentos },
    { label: "(-) Silk / Bordado",        cat: "custo",     atual: -dreAtual.silkBordado,   ant: -dreAnterior.silkBordado },
    { label: "(-) Frete",                 cat: "custo",     atual: -dreAtual.frete,         ant: -dreAnterior.frete },
    { label: "(-) Comissão",              cat: "custo",     atual: -dreAtual.comissao,      ant: -dreAnterior.comissao },
    { label: "(-) Perdas",                cat: "custo",     atual: -dreAtual.perdas,        ant: -dreAnterior.perdas },
    { label: "(-) Taxas e Tarifas",       cat: "custo",     atual: -dreAtual.taxas,         ant: -dreAnterior.taxas },
    { label: "= Custo Total",             cat: "subtotal",  atual: -dreAtual.custoTotal,    ant: -dreAnterior.custoTotal },
    { label: "= Margem de Contribuição",  cat: "margem",    atual: dreAtual.margem,         ant: dreAnterior.margem },
    { label: "Margem %",                  cat: "margempct", atual: dreAtual.margemPerc,     ant: dreAnterior.margemPerc },
  ];

  return (
    <div>
      <PageHeader
        title="DRE — Demonstrativo de Resultados"
        subtitle={`Análise financeira calculada da movimentação · ${periodLabel}`}
        actions={<>
          <select value={unit} onChange={e => setUnit(e.target.value as typeof unit)} aria-label="Loja" className="text-xs border border-black/[0.07] rounded-lg px-2 py-2 bg-white text-slate-600">
            <option value="">Todas as lojas</option><option value="BEBEDOURO">Bebedouro</option><option value="BARRETOS">Barretos</option>
          </select>
          <select value={period} onChange={e => setPeriod(e.target.value as typeof period)} className="text-xs border border-black/[0.07] rounded-lg px-2 py-2 bg-white text-slate-600">
            <option value="semana">Semana</option><option value="mes">Mês</option><option value="trimestre">Trimestre</option><option value="ano">Ano</option><option value="personalizado">Intervalo personalizado</option>
          </select>
          {period === "personalizado" && <><input inputMode="numeric" aria-label="Data inicial" placeholder="dd/mm/aaaa" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-28 text-xs border rounded-lg px-2 py-2" /><input inputMode="numeric" aria-label="Data final" placeholder="dd/mm/aaaa" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-28 text-xs border rounded-lg px-2 py-2" /></>}
          <div className="flex border border-black/[0.07] rounded-lg overflow-hidden bg-white shadow-sm">
            {([["resumo","Resumo"],["mensal","Evolução Mensal"],["produto","Por Produto"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setView(k)}
                className={`text-xs px-3 py-1.5 font-semibold transition-colors ${view === k ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}>
                {l}
              </button>
            ))}
          </div>
          <ExportButton orders={filterOrders(orders, activeFilters, meta.referenceDate)} className="text-xs bg-blue-600 text-white rounded-lg px-3 py-2 hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-50" />
        </>}
      />

      {periodError && <p className="mb-3 text-xs text-red-600">{periodError}</p>}
      {view === "resumo" && (
        <>
          <div className="grid grid-cols-4 gap-4 mb-5">
            <KPICard label="Faturamento"         value={fmtR(dreAtual.faturamento)}    delta={pct(dreAtual.faturamento, dreAnterior.faturamento)}    comparisonLabel={`vs. ${previousLabel}`} icon={<DollarSign size={15} />} accent="#059669" />
            <KPICard label="Receita Líquida"     value={fmtR(dreAtual.receitaLiquida)} delta={pct(dreAtual.receitaLiquida, dreAnterior.receitaLiquida)} comparisonLabel={`vs. ${previousLabel}`} icon={<TrendingUp size={15} />} />
            <KPICard label="Margem de Contrib."  value={fmtR(dreAtual.margem)}         delta={pct(dreAtual.margem, dreAnterior.margem)}              comparisonLabel={`vs. ${previousLabel}`} icon={<BarChart3 size={15} />}  accent="#7C3AED" />
            <KPICard label="Margem %"            value={`${dreAtual.margemPerc}%`}     delta={pct(dreAtual.margemPerc, dreAnterior.margemPerc)}      comparisonLabel={`vs. ${previousLabel}`} icon={<Target size={15} />}     accent="#EA580C" />
          </div>

          <div className="grid grid-cols-5 gap-5">
            <div className="col-span-3 bg-white rounded-xl border border-black/[0.06] shadow-sm overflow-hidden">
              <div className="grid grid-cols-3 bg-slate-50 px-5 py-3 border-b border-black/[0.06] text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <span>Item</span>
                <span className="text-right">{periodLabel}</span>
                <span className="text-right">{previousLabel}</span>
              </div>
              <div className="divide-y divide-black/[0.04]">
                {dreRows.map(row => {
                  const isSub   = row.cat === "subtotal";
                  const isMarg  = row.cat === "margem" || row.cat === "margempct";
                  const isCusto = row.cat === "custo";
                  const isRec   = row.cat === "receita";
                  return (
                    <div key={row.label}
                      className={`grid grid-cols-3 px-5 py-2.5 items-center text-[12px] ${isSub ? "bg-slate-50/80 font-bold" : ""} ${isMarg ? "bg-blue-50" : ""}`}>
                      <span className={`${isSub || isMarg ? "font-bold text-slate-900" : "text-slate-600"} ${isCusto ? "pl-3 text-[11px]" : ""}`}>
                        {row.label}
                      </span>
                      <span className={`text-right font-mono ${
                        isMarg ? "text-blue-700 font-bold text-sm" :
                        isCusto ? "text-red-500" :
                        isRec ? "text-emerald-700 font-semibold" :
                        isSub ? "font-bold text-slate-800" : "text-slate-700"
                      }`}>
                        {row.cat === "margempct" ? `${row.atual}%` : fmtR(Math.abs(row.atual))}
                      </span>
                      <span className="text-right font-mono text-slate-400">
                        {row.cat === "margempct" ? `${row.ant}%` : fmtR(Math.abs(row.ant))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="col-span-2 space-y-5">
              <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-4">Estrutura de Custos</h3>
                <ResponsiveContainer width="100%" height={230}>
                  <RPieChart>
                    <Pie
                      data={[
                        { name: "Mat. Prima", value: dreAtual.materiaPrima },
                        { name: "Mão de Obra", value: dreAtual.maoDeObra },
                        { name: "Aviamentos",  value: dreAtual.aviamentos },
                        { name: "Silk/Bordado",value: dreAtual.silkBordado },
                        { name: "Frete",       value: dreAtual.frete },
                        { name: "Comissão",    value: dreAtual.comissao },
                        { name: "Impostos",    value: dreAtual.impostos },
                        { name: "Outros",      value: dreAtual.perdas + dreAtual.taxas },
                      ]}
                      cx="50%" cy="50%" outerRadius={80} dataKey="value" stroke="none"
                    >
                      {["#3B82F6","#8B5CF6","#10B981","#F59E0B","#EF4444","#EC4899","#14B8A6","#6B7280"].map((c,i) => <Cell key={i} fill={c} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtR(v)} contentStyle={ttStyle} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </RPieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}

      {view === "mensal" && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-4">
            <KPICard label="Faturamento Acumulado" value={fmtR(dreSeries.reduce((a,b) => a+b.faturamento,0))} icon={<DollarSign size={15} />} accent="#059669" />
            <KPICard label="Margem Acumulada"      value={fmtR(dreSeries.reduce((a,b) => a+b.margem,0))}      icon={<TrendingUp size={15} />} />
            <KPICard label="Margem Média"           value={`${(dreSeries.length ? dreSeries.reduce((a,b)=>a+b.margemPerc,0)/dreSeries.length : 0).toFixed(1)}%`} icon={<Target size={15} />} accent="#7C3AED" />
          </div>
          <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
            <h3 className="text-sm font-bold text-slate-800 mb-4">Evolução do Período — Receita · Custo · Margem</h3>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={dreSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="L" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={v=>`R$${(v/1000).toFixed(0)}k`} />
                <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} />
                <Tooltip formatter={(v: number, n: string) => n === "Margem %" ? `${v}%` : fmtR(v)} contentStyle={ttStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="L" dataKey="faturamento" name="Faturamento" fill="#BFDBFE" radius={[3,3,0,0]} />
                <Bar yAxisId="L" dataKey="custo"       name="Custo Total" fill="#FCA5A5" radius={[3,3,0,0]} />
                <Line yAxisId="L" type="monotone" dataKey="margem"     name="Margem R$" stroke="#1D4ED8" strokeWidth={2.5} dot={{ fill:"#1D4ED8", r:4 }} />
                <Line yAxisId="R" type="monotone" dataKey="margemPerc" name="Margem %"  stroke="#7C3AED" strokeWidth={2}   dot={false} strokeDasharray="5 3" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {view === "produto" && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-black/[0.05]">
              <span className="text-sm font-bold text-slate-800">Margem por Produto</span>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-black/[0.05] bg-slate-50/80">
                  {([ ["Produto", "nome"], ["Faturamento", "faturamento"], ["Margem R$", "margem"], ["Margem %", "margemPerc"] ] as const).map(([label, key]) => (
                    <th key={key} className="text-left px-5 py-2.5 font-bold text-slate-400 uppercase tracking-wider text-[10px]"><button onClick={() => toggleProductSort(key)} className="hover:text-blue-600">{label}{productSort.key === key ? (productSort.asc ? " ↑" : " ↓") : ""}</button></th>
                  ))}<th className="text-left px-5 py-2.5 font-bold text-slate-400 uppercase tracking-wider text-[10px]">Performance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04]">
                {sortedProducts.map(c => {
                  const color = c.margemPerc >= 12 ? "#16A34A" : c.margemPerc >= 8 ? "#2563EB" : c.margemPerc >= 5 ? "#D97706" : "#DC2626";
                  const perf  = c.margemPerc >= 12 ? "Excelente" : c.margemPerc >= 8 ? "Ok" : c.margemPerc >= 5 ? "Baixa" : "Crítica";
                  const bg    = c.margemPerc >= 12 ? "#F0FDF4" : c.margemPerc >= 8 ? "#EFF6FF" : c.margemPerc >= 5 ? "#FFFBEB" : "#FEF2F2";
                  return (
                    <tr key={c.nome} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 font-semibold text-slate-700">{c.nome}</td>
                      <td className="px-5 py-3 font-mono text-slate-600">{fmtR(c.faturamento)}</td>
                      <td className="px-5 py-3 font-mono font-bold" style={{ color }}>{fmtR(c.margem)}</td>
                      <td className="px-5 py-3 font-mono font-black text-base" style={{ color }}>{c.margemPerc}%</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-28 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(c.margemPerc/15)*100}%`, backgroundColor: color }} />
                          </div>
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded" style={{ color, backgroundColor: bg }}>{perf}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl border border-black/[0.06] shadow-sm p-5">
            <h3 className="text-sm font-bold text-slate-800 mb-4">Margem % por Produto</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={margemPorProduto.map(c => ({ ...c, nomeShort: c.nome.split(" ")[0] }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="nomeShort" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={v=>`${v}%`} />
                <Tooltip formatter={(v: number) => [`${v}%`, "Margem"]} contentStyle={ttStyle} />
                <Bar dataKey="margemPerc" name="Margem %" radius={[4,4,0,0]}>
                  {margemPorProduto.map((c,i) => (
                    <Cell key={i} fill={c.margemPerc>=12?"#16A34A":c.margemPerc>=8?"#2563EB":c.margemPerc>=5?"#D97706":"#DC2626"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

const navGroups = [
  { section: "VISÃO GERAL", items: [
    { id: "dashboard" as PageId,       label: "Dashboard Geral",  icon: <LayoutDashboard size={15} /> },
  ]},
  { section: "PRODUÇÃO", items: [
    { id: "pendencias" as PageId,      label: "Pendências",        icon: <ClipboardList size={15} /> },
    { id: "corte" as PageId,           label: "Corte",             icon: <Scissors size={15} /> },
    { id: "bordado" as PageId,         label: "Bordado",           icon: <Sparkles size={15} /> },
    { id: "silk" as PageId,            label: "Silk",              icon: <Layers size={15} /> },
    { id: "costura-externa" as PageId, label: "Costura Externa",   icon: <Users size={15} /> },
    { id: "costura-interna" as PageId, label: "Costura Interna",   icon: <Factory size={15} /> },
    { id: "expedicao" as PageId,       label: "Expedição",         icon: <Truck size={15} /> },
  ]},
  { section: "RESULTADOS", items: [
    { id: "dre" as PageId,             label: "DRE",               icon: <TrendingUp size={15} /> },
  ]},
];

function Sidebar({ current, setPage }: { current: PageId; setPage: (p: PageId) => void }) {
  const { orders, sectorMetrics } = useDashboard();
  const totalDelayed = orders.filter(o => o.diasAtraso > 0).length;
  return (
    <aside className="fixed left-0 top-0 h-full w-60 flex flex-col z-30" style={{ backgroundColor: "#0A1628" }}>
      <div className="px-5 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-600 flex-shrink-0">
            <Factory size={17} className="text-white" />
          </div>
          <div>
            <div className="text-white font-black text-sm leading-tight tracking-tight">DE RI</div>
            <div className="text-blue-400 text-[10px] font-semibold leading-tight tracking-widest uppercase">Confecções</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 scrollbar-hide">
        {navGroups.map(g => (
          <div key={g.section} className="mb-5">
            <div className="text-[9px] font-black tracking-[0.15em] px-2.5 mb-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>
              {g.section}
            </div>
            {g.items.map(item => {
              const active = current === item.id;
              const hasBadge = item.id === "pendencias" && totalDelayed > 0;
              return (
                <button
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  className="w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg mb-0.5 text-left transition-all group"
                  style={{
                    backgroundColor: active ? "#1D4ED8" : "transparent",
                    color: active ? "#fff" : "rgba(255,255,255,0.5)",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                  onMouseLeave={e => { if (!active) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}}
                >
                  <div className="flex items-center gap-2.5">
                    <span style={{ color: active ? "#fff" : "#60A5FA" }}>{item.icon}</span>
                    <span className="text-[12px] font-semibold">{item.label}</span>
                  </div>
                  {hasBadge && (
                    <span className="text-[9px] font-black bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                      {totalDelayed}
                    </span>
                  )}
                  {item.id === "costura-externa" && sectorMetrics.costuraExterna.atrasados > 0 && (
                    <span className="text-[9px] font-black bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{sectorMetrics.costuraExterna.atrasados}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-5 py-3 border-t" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
        <div className="text-[10px] font-semibold" style={{ color: "rgba(255,255,255,0.2)" }}>PI Platform v1.0 · dados reais</div>
      </div>
    </aside>
  );
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────

function TopBar({ module, setModule, onRefresh, refreshing }: { module: string; setModule: (m: string) => void; onRefresh: () => void; refreshing: boolean }) {
  const { alerts, meta } = useDashboard();
  const [alertsOpen, setAlertsOpen] = useState(false);
  return (
    <header className="fixed top-0 left-60 right-0 h-[52px] bg-white border-b border-black/[0.06] flex items-center z-20 px-5 gap-3">
      {/* Modules */}
      <div className="flex items-center gap-0.5">
        {["PRODUÇÃO","FINANCEIRO","COMPRAS"].map(m => {
          const active = module === m;
          const enabled = m === "PRODUÇÃO";
          return (
            <button key={m} onClick={() => enabled && setModule(m)} disabled={!enabled}
              className={`px-3 py-1.5 text-[11px] font-black rounded-lg tracking-wider transition-colors ${
                active ? "bg-blue-600 text-white" : enabled ? "text-slate-500 hover:bg-slate-100" : "text-slate-300 cursor-not-allowed"
              }`}>
              {m}
              {!enabled && <span className="ml-1 font-normal text-[9px] tracking-normal opacity-60">em breve</span>}
            </button>
          );
        })}
      </div>

      <div className="h-4 w-px bg-black/[0.08]" />

      {/* Search */}
      <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-1.5 flex-1 max-w-72">
        <Search size={13} className="text-slate-400 flex-shrink-0" />
        <input type="text" placeholder="Buscar pedido, cliente, produto..."
          className="bg-transparent text-[12px] text-slate-600 placeholder-slate-400 outline-none w-full" />
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <button onClick={onRefresh} disabled={refreshing} title="Atualizar dados da base" className="flex items-center gap-1.5 text-[12px] border border-black/[0.07] rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 whitespace-nowrap font-medium disabled:opacity-50">
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />{refreshing ? "Atualizando…" : "Atualizar"}
        </button>
        <button className="flex items-center gap-1.5 text-[12px] border border-black/[0.07] rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 whitespace-nowrap font-medium">
          <CalendarDays size={13} />{meta.reportingPeriod || "—"}<ChevronDown size={11} className="text-slate-400" />
        </button>

        <div className="relative">
          <button aria-label="Alertas da produção" aria-expanded={alertsOpen} onClick={() => setAlertsOpen(open => !open)} className={`w-8 h-8 rounded-lg border border-black/[0.07] flex items-center justify-center transition-colors ${alertsOpen ? "bg-blue-50 text-blue-600 border-blue-200" : "text-slate-500 hover:bg-slate-50"}`}>
            <Bell size={14} />
          </button>
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
            {alerts.filter(a=>a.critica).length}
          </span>
          {alertsOpen && (
            <div className="absolute right-0 top-10 w-[390px] max-w-[calc(100vw-2rem)] z-50">
              <AlertsPanel />
            </div>
          )}
        </div>

        <button className="w-8 h-8 rounded-lg border border-black/[0.07] flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors">
          <Settings size={14} />
        </button>

        <div className="flex items-center gap-2 pl-2 border-l border-black/[0.07]">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
            <span className="text-white text-[10px] font-black">DR</span>
          </div>
          <div className="leading-none">
            <div className="text-[12px] font-bold text-slate-700">Direção</div>
            <div className="text-[10px] text-slate-400">Administrador</div>
          </div>
          <ChevronDown size={11} className="text-slate-400" />
        </div>
      </div>
    </header>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const { data, error, refreshing, refresh } = useDashboardData();
  const [page, setPage] = useState<PageId>("dashboard");
  const [module, setModule] = useState("PRODUÇÃO");
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(initialFilters);
  if (!data) return <div className="h-screen grid place-items-center bg-slate-100 text-slate-600">{error || "Carregando dados da produção…"}</div>;
  const { orders, sectorMetrics } = data;

  const sectorPages: Partial<Record<PageId, SectorCfg>> = {
    corte:           { label: "Corte",          metrics: sectorMetrics.corte,          sectorOrders: orders.filter(o=>o.etapa==="Corte") },
    bordado:         { label: "Bordado",         metrics: sectorMetrics.bordado,        sectorOrders: orders.filter(o=>o.etapa==="Bordado") },
    silk:            { label: "Silk",            metrics: sectorMetrics.silk,           sectorOrders: orders.filter(o=>o.etapa==="Silk") },
    "costura-externa":{ label:"Costura Externa", metrics: sectorMetrics.costuraExterna, sectorOrders: orders.filter(o=>o.etapa==="Costura Externa"), extra: <FacacoesTable /> },
    "costura-interna":{ label:"Costura Interna", metrics: sectorMetrics.costuraInterna, sectorOrders: orders.filter(o=>o.etapa==="Costura Interna") },
    expedicao:       { label: "Expedição",       metrics: sectorMetrics.expedicao,      sectorOrders: orders.filter(o=>o.etapa==="Expedição"), extra: <ProximasEntregas /> },
  };

  function renderPage() {
    if (page === "dashboard")  return <DashboardPage onNav={setPage} />;
    if (page === "pendencias") return <PendenciasPage />;
    if (page === "dre")        return <DREPage />;
    const cfg = sectorPages[page];
    return cfg ? <SectorPage cfg={cfg} /> : null;
  }

  return (
    <DashboardContext.Provider value={{ ...data, activeFilters, setActiveFilters }}>
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "#F1F5F9", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <Sidebar current={page} setPage={setPage} />
      <div className="flex-1 flex flex-col" style={{ marginLeft: 240 }}>
        <TopBar module={module} setModule={setModule} onRefresh={() => void refresh(true)} refreshing={refreshing} />
        <main className="flex-1 overflow-y-auto p-6" style={{ marginTop: 52 }}>
          {data.meta.stale && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">Servindo o último snapshot válido. {data.meta.lastError}</div>}
          {renderPage()}
        </main>
      </div>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        main::-webkit-scrollbar { width: 4px; }
        main::-webkit-scrollbar-track { background: transparent; }
        main::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 99px; }
        main:hover::-webkit-scrollbar-thumb { background: #94A3B8; }
      `}</style>
    </div>
    </DashboardContext.Provider>
  );
}
